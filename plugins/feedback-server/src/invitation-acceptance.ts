import {
  ConfigurationApiError,
  PendingTokenRecoveryError,
  createAgentToken,
  login,
  logout,
  revokeAgentToken,
  type CreatedToken,
  type LoginResponse,
} from './admin-session.js';
import {
  addPendingTokenRevocation,
  KEYCHAIN_ACCOUNT,
  normalizeBaseUrl,
  readPendingTokenRevocations,
  readKeychainCredentials,
  readKeychainProfileCredentials,
  readKeychainReferencedTokenIds,
  removePendingTokenRevocation,
  writeKeychainCredentials,
  writeKeychainProfileCredentials,
  type PendingTokenRevocation,
  type StoredCredentials,
} from './credentials.js';
import {
  acceptAdminInvitation,
  listOwnedProducts,
  type AcceptedInvitation,
  type AppliedInvitationSubscription,
} from './invitation-api.js';

export interface ConfiguredInvitationAccount {
  credentials: StoredCredentials;
  subscription: AppliedInvitationSubscription;
}

export class AgentAlreadyConfiguredError extends Error {
  public constructor(existing: StoredCredentials) {
    const username = existing.username ?? 'an unknown administrator';
    super(
      `FeedbackServer Agent is already configured for ${username} at ${existing.baseUrl}. `
      + 'Keep the existing account, or explicitly switch accounts before accepting the invitation. '
      + 'The invitation was not consumed.',
    );
    this.name = 'AgentAlreadyConfiguredError';
  }
}

export class CommittedInvitationAcceptanceError extends Error {
  public constructor(cause: unknown) {
    const recovery = cause instanceof PendingTokenRecoveryError ? ` ${cause.message}` : '';
    super(
      `The administrator account was created, but Agent configuration did not finish. Do not reuse the invitation; run feedback-server agent configure with the new account instead.${recovery}`,
      { cause },
    );
    this.name = 'CommittedInvitationAcceptanceError';
  }
}

export class IndeterminateInvitationAcceptanceError extends Error {
  public constructor(cause: unknown) {
    super(
      'The invitation response was interrupted, so account creation may have completed. Try agent:configure with the chosen account before attempting the invitation again.',
      { cause },
    );
    this.name = 'IndeterminateInvitationAcceptanceError';
  }
}

export interface InvitationAcceptanceDependencies {
  isMacOS: () => boolean;
  readCredentials: () => Promise<StoredCredentials | undefined>;
  writeCredentials: (credentials: StoredCredentials) => Promise<void>;
  acceptInvitation: typeof acceptAdminInvitation;
  login: typeof login;
  listProducts: typeof listOwnedProducts;
  createToken: (
    baseUrl: string,
    accessToken: string,
  ) => Promise<CreatedToken>;
  revokeToken: typeof revokeAgentToken;
  logout: typeof logout;
  readPendingRevocations: () => Promise<PendingTokenRevocation[]>;
  readReferencedTokenIds: () => Promise<Set<string>>;
  addPendingRevocation: (entry: PendingTokenRevocation) => Promise<void>;
  removePendingRevocation: (entry: PendingTokenRevocation) => Promise<void>;
}

function defaultDependencies(profile?: string): InvitationAcceptanceDependencies {
  return {
    isMacOS: () => process.platform === 'darwin',
    readCredentials: profile
      ? () => readKeychainProfileCredentials(profile)
      : readKeychainCredentials,
    writeCredentials: profile
      ? (credentials) => writeKeychainProfileCredentials(credentials, profile)
      : writeKeychainCredentials,
    acceptInvitation: acceptAdminInvitation,
    login,
    listProducts: listOwnedProducts,
    createToken: createAgentToken,
    revokeToken: revokeAgentToken,
    logout,
    readPendingRevocations: readPendingTokenRevocations,
    readReferencedTokenIds: readKeychainReferencedTokenIds,
    addPendingRevocation: addPendingTokenRevocation,
    removePendingRevocation: removePendingTokenRevocation,
  };
}

function verifyIdentity(session: LoginResponse | AcceptedInvitation, username: string): void {
  if (session.admin?.role !== 'admin' || session.admin.username !== username) {
    throw new Error('Invitation created an unexpected administrator identity');
  }
}

async function logoutSessions(
  baseUrl: string,
  refreshTokens: readonly string[],
  logoutSession: typeof logout,
): Promise<void> {
  for (const refreshToken of [...refreshTokens].reverse()) {
    try {
      await logoutSession(baseUrl, refreshToken);
    } catch (error) {
      console.error(
        `Warning: unable to revoke a temporary refresh session: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

function isIndeterminateAcceptanceFailure(error: unknown): boolean {
  return !(error instanceof ConfigurationApiError) || error.status >= 500;
}

function isAlreadyRevoked(error: unknown): boolean {
  return error instanceof ConfigurationApiError && error.status === 404;
}

async function revokeOrAcceptMissing(
  baseUrl: string,
  accessToken: string,
  tokenId: string,
  dependencies: InvitationAcceptanceDependencies,
): Promise<void> {
  try {
    await dependencies.revokeToken(baseUrl, accessToken, tokenId);
  } catch (error) {
    if (!isAlreadyRevoked(error)) throw error;
  }
}

async function retryPendingRevocations(
  baseUrl: string,
  username: string,
  profile: string,
  accessToken: string,
  dependencies: InvitationAcceptanceDependencies,
): Promise<void> {
  const referencedTokenIds = await dependencies.readReferencedTokenIds();
  for (const entry of await dependencies.readPendingRevocations()) {
    if (normalizeBaseUrl(entry.baseUrl) !== baseUrl || entry.username !== username) continue;
    if (entry.profile !== undefined && entry.profile !== profile) continue;
    if (!referencedTokenIds.has(entry.tokenId)) {
      await revokeOrAcceptMissing(baseUrl, accessToken, entry.tokenId, dependencies);
    }
    await dependencies.removePendingRevocation(entry);
  }
}

async function compensateUnstoredToken(
  originalError: unknown,
  entry: PendingTokenRevocation,
  accessToken: string,
  dependencies: InvitationAcceptanceDependencies,
): Promise<never> {
  try {
    await revokeOrAcceptMissing(entry.baseUrl, accessToken, entry.tokenId, dependencies);
  } catch (revocationError) {
    throw new PendingTokenRecoveryError(
      entry.tokenId,
      new AggregateError(
        [originalError, revocationError],
        'PAT persistence and compensating revocation failed',
      ),
    );
  }
  try {
    await dependencies.removePendingRevocation(entry);
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      'PAT persistence failed and pending-revocation cleanup was incomplete',
    );
  }
  throw originalError;
}

export async function acceptInvitationAndConfigure(
  input: {
    baseUrl: string;
    token: string;
    username: string;
    displayName: string;
    password: string;
    profile?: string;
  },
  dependencies: InvitationAcceptanceDependencies = defaultDependencies(input.profile),
): Promise<ConfiguredInvitationAccount> {
  if (!dependencies.isMacOS()) {
    throw new Error('Invitation acceptance with automatic Agent configuration requires macOS Keychain');
  }
  const existing = await dependencies.readCredentials();
  if (existing) throw new AgentAlreadyConfiguredError(existing);

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const profile = input.profile ?? KEYCHAIN_ACCOUNT;
  let accepted: AcceptedInvitation;
  try {
    accepted = await dependencies.acceptInvitation(baseUrl, {
      token: input.token,
      username: input.username,
      displayName: input.displayName,
      password: input.password,
    });
  } catch (error) {
    if (isIndeterminateAcceptanceFailure(error)) {
      throw new IndeterminateInvitationAcceptanceError(error);
    }
    throw error;
  }

  const refreshTokens = [accepted.refreshToken];
  try {
    verifyIdentity(accepted, input.username);
    if (!accepted.subscription) {
      throw new Error('The Server did not return the applied subscription summary');
    }
    const verified = await dependencies.login(baseUrl, input.username, input.password);
    refreshTokens.push(verified.refreshToken);
    verifyIdentity(verified, input.username);

    const products = await dependencies.listProducts(baseUrl, verified.accessToken);
    if (products.length !== 0) {
      throw new Error('The new administrator unexpectedly owns Products');
    }

    await retryPendingRevocations(
      baseUrl,
      input.username,
      profile,
      verified.accessToken,
      dependencies,
    );

    const created = await dependencies.createToken(baseUrl, verified.accessToken);
    const pendingEntry: PendingTokenRevocation = {
      baseUrl,
      username: input.username,
      tokenId: created.id,
      profile,
    };
    try {
      await dependencies.addPendingRevocation(pendingEntry);
    } catch (error) {
      await compensateUnstoredToken(error, pendingEntry, verified.accessToken, dependencies);
    }
    const credentials: StoredCredentials = {
      baseUrl,
      token: created.token,
      tokenId: created.id,
      username: input.username,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
    };
    try {
      await dependencies.writeCredentials(credentials);
    } catch (error) {
      await compensateUnstoredToken(error, pendingEntry, verified.accessToken, dependencies);
    }
    await dependencies.removePendingRevocation(pendingEntry);
    return { credentials, subscription: accepted.subscription };
  } catch (error) {
    throw new CommittedInvitationAcceptanceError(error);
  } finally {
    await logoutSessions(baseUrl, refreshTokens, dependencies.logout);
  }
}
