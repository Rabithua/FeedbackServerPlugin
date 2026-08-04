import {
  ConfigurationApiError,
  createAgentToken,
  login,
  logout,
  revokeAgentToken,
  type CreatedToken,
  type LoginResponse,
} from './admin-session.js';
import {
  normalizeBaseUrl,
  readKeychainCredentials,
  writeKeychainCredentials,
  type StoredCredentials,
} from './credentials.js';
import {
  acceptAdminInvitation,
  listOwnedProducts,
  type AcceptedInvitation,
} from './invitation-api.js';

export class AgentAlreadyConfiguredError extends Error {
  public constructor() {
    super('FeedbackServer Agent is already configured. Run agent:disconnect before accepting an invitation.');
    this.name = 'AgentAlreadyConfiguredError';
  }
}

export class CommittedInvitationAcceptanceError extends Error {
  public constructor(cause: unknown) {
    super(
      'The administrator account was created, but Agent configuration did not finish. Do not reuse the invitation; run agent:configure with the new account instead.',
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
}

const defaultDependencies: InvitationAcceptanceDependencies = {
  isMacOS: () => process.platform === 'darwin',
  readCredentials: readKeychainCredentials,
  writeCredentials: writeKeychainCredentials,
  acceptInvitation: acceptAdminInvitation,
  login,
  listProducts: listOwnedProducts,
  createToken: createAgentToken,
  revokeToken: revokeAgentToken,
  logout,
};

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

export async function acceptInvitationAndConfigure(
  input: {
    baseUrl: string;
    token: string;
    username: string;
    displayName: string;
    password: string;
  },
  dependencies: InvitationAcceptanceDependencies = defaultDependencies,
): Promise<StoredCredentials> {
  if (!dependencies.isMacOS()) {
    throw new Error('Invitation acceptance with automatic Agent configuration requires macOS Keychain');
  }
  if (await dependencies.readCredentials()) throw new AgentAlreadyConfiguredError();

  const baseUrl = normalizeBaseUrl(input.baseUrl);
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
    const verified = await dependencies.login(baseUrl, input.username, input.password);
    refreshTokens.push(verified.refreshToken);
    verifyIdentity(verified, input.username);

    const products = await dependencies.listProducts(baseUrl, verified.accessToken);
    if (products.length !== 0) {
      throw new Error('The new administrator unexpectedly owns Products');
    }

    const created = await dependencies.createToken(baseUrl, verified.accessToken);
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
      try {
        await dependencies.revokeToken(baseUrl, verified.accessToken, created.id);
      } catch (revocationError) {
        throw new AggregateError(
          [error, revocationError],
          'Keychain persistence and new PAT revocation both failed',
        );
      }
      throw error;
    }
    return credentials;
  } catch (error) {
    throw new CommittedInvitationAcceptanceError(error);
  } finally {
    await logoutSessions(baseUrl, refreshTokens, dependencies.logout);
  }
}

