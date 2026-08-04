import {
  ConfigurationApiError,
  login,
  logout,
} from './admin-session.js';
import { normalizeBaseUrl } from './credentials.js';
import {
  acceptAdminInvitation,
  createAdminInvitation,
  listOwnedProducts,
  revokeAdminInvitation,
  type AdminIdentity,
} from './invitation-api.js';

interface ConsumableInvitation {
  id: string;
  token: string;
}

class LocalAdminVerificationError extends Error {}

export class CommittedAdminCreationError extends Error {
  public constructor(cause: unknown) {
    super(
      'Administrator creation committed, but login and Product isolation verification did not complete after three attempts; verify the account manually instead of retrying the same username',
      { cause },
    );
    this.name = 'CommittedAdminCreationError';
  }
}

export interface LocalAdminDependencies {
  login: typeof login;
  logout: typeof logout;
  createInvitation: (
    baseUrl: string,
    accessToken: string,
    expiresInDays: number,
  ) => Promise<ConsumableInvitation>;
  acceptInvitation: typeof acceptAdminInvitation;
  revokeInvitation: typeof revokeAdminInvitation;
  listProducts: typeof listOwnedProducts;
  waitBeforeVerificationRetry: (attempt: number) => Promise<void>;
}

export interface CreateLocalAdminInput {
  baseUrl: string;
  superAdminUsername: string;
  superAdminPassword: string;
  username: string;
  displayName: string;
  password: string;
}

const defaultDependencies: LocalAdminDependencies = {
  login,
  logout,
  createInvitation: createAdminInvitation,
  acceptInvitation: acceptAdminInvitation,
  revokeInvitation: revokeAdminInvitation,
  listProducts: listOwnedProducts,
  waitBeforeVerificationRetry: (attempt) =>
    new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1))),
};

function isIndeterminateApiFailure(error: unknown): boolean {
  if (error instanceof LocalAdminVerificationError) return false;
  return (
    !(error instanceof ConfigurationApiError)
    || error.status === 429
    || error.status >= 500
  );
}

export async function createLocalAdmin(
  input: CreateLocalAdminInput,
  dependencies: LocalAdminDependencies = defaultDependencies,
): Promise<AdminIdentity> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const superAdminSession = await dependencies.login(
    baseUrl,
    input.superAdminUsername,
    input.superAdminPassword,
  );
  let invitation: ConsumableInvitation | undefined;
  let invitationAccepted = false;
  const temporaryRefreshTokens = [superAdminSession.refreshToken];
  let result: AdminIdentity | undefined;
  let operationError: unknown;

  const verifyNewAdminOnce = async (): Promise<AdminIdentity> => {
    const verified = await dependencies.login(baseUrl, input.username, input.password);
    temporaryRefreshTokens.push(verified.refreshToken);
    if (verified.admin?.role !== 'admin' || verified.admin.username !== input.username) {
      throw new LocalAdminVerificationError('New administrator login verification failed');
    }
    const products = await dependencies.listProducts(baseUrl, verified.accessToken);
    if (products.length !== 0) {
      throw new LocalAdminVerificationError('New administrator unexpectedly owns Products');
    }
    return verified.admin;
  };

  const verifyNewAdmin = async (): Promise<AdminIdentity> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await verifyNewAdminOnce();
      } catch (error) {
        if (!isIndeterminateApiFailure(error) || attempt === 3) throw error;
        await dependencies.waitBeforeVerificationRetry(attempt);
      }
    }
    throw new Error('Administrator verification retry loop exhausted');
  };

  try {
    invitation = await dependencies.createInvitation(
      baseUrl,
      superAdminSession.accessToken,
      1,
    );
    try {
      const accepted = await dependencies.acceptInvitation(baseUrl, {
        token: invitation.token,
        username: input.username,
        displayName: input.displayName,
        password: input.password,
      });
      invitationAccepted = true;
      temporaryRefreshTokens.push(accepted.refreshToken);
      if (accepted.admin.role !== 'admin' || accepted.admin.username !== input.username) {
        throw new Error('Invitation created an unexpected administrator account');
      }
      try {
        result = await verifyNewAdmin();
      } catch (error) {
        if (isIndeterminateApiFailure(error)) {
          throw new CommittedAdminCreationError(error);
        }
        throw error;
      }
    } catch (error) {
      if (
        invitationAccepted
        || (error instanceof ConfigurationApiError && error.status < 500)
      ) {
        throw error;
      }
      try {
        result = await verifyNewAdmin();
        invitationAccepted = true;
      } catch (verificationError) {
        if (isIndeterminateApiFailure(verificationError)) {
          invitationAccepted = true;
          throw new CommittedAdminCreationError(verificationError);
        }
        throw error;
      }
    }
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (invitation && !invitationAccepted) {
    try {
      await dependencies.revokeInvitation(
        baseUrl,
        superAdminSession.accessToken,
        invitation.id,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const refreshToken of temporaryRefreshTokens.reverse()) {
    try {
      await dependencies.logout(baseUrl, refreshToken);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (operationError !== undefined || cleanupErrors.length > 0) {
    if (operationError instanceof CommittedAdminCreationError) {
      if (cleanupErrors.length === 0) throw operationError;
      throw new CommittedAdminCreationError(
        new AggregateError(
          [operationError, ...cleanupErrors],
          'Committed administrator creation verification or cleanup failed',
        ),
      );
    }
    const errors: unknown[] = [];
    if (operationError !== undefined) errors.push(operationError);
    errors.push(...cleanupErrors);
    throw errors.length === 1
      ? errors[0] instanceof Error
        ? errors[0]
        : new Error('Administrator creation failed', { cause: errors[0] })
      : new AggregateError(errors, 'Administrator creation or cleanup failed');
  }
  if (!result) throw new Error('Administrator creation did not return an account');
  return result;
}
