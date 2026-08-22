import {
  ConfigurationApiError,
  login,
  logout,
} from './admin-session.js';
import { normalizeBaseUrl } from './credentials.js';
import {
  acceptAdminInvitation,
  appliedSubscriptionMatchesGrant,
  createAdminInvitation,
  invitationSubscriptionGrantsMatch,
  listOwnedProducts,
  revokeAdminInvitation,
  type AdminIdentity,
  type AppliedInvitationSubscription,
  type InvitationSubscriptionGrant,
} from './invitation-api.js';

interface ConsumableInvitation {
  id: string;
  token: string;
  subscriptionGrant?: InvitationSubscriptionGrant;
}

class LocalAdminVerificationError extends Error {}

export class CommittedAdminCreationError extends Error {
  public constructor(cause: unknown) {
    super(
      'Administrator creation committed, but verification or temporary-session cleanup did not complete; the account exists, so verify it manually instead of retrying the same username',
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
    subscriptionGrant: InvitationSubscriptionGrant,
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
  subscriptionGrant?: InvitationSubscriptionGrant;
}

export interface CreateLocalAdminResult {
  admin: AdminIdentity;
  subscription: AppliedInvitationSubscription;
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
): Promise<CreateLocalAdminResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const subscriptionGrant = input.subscriptionGrant ?? { plan: 'free' };
  const superAdminSession = await dependencies.login(
    baseUrl,
    input.superAdminUsername,
    input.superAdminPassword,
  );
  let invitation: ConsumableInvitation | undefined;
  let invitationAccepted = false;
  let grantVerificationFailed = false;
  const temporaryRefreshTokens = [superAdminSession.refreshToken];
  let result: CreateLocalAdminResult | undefined;
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
      subscriptionGrant,
    );
    if (!invitationSubscriptionGrantsMatch(
      invitation.subscriptionGrant,
      subscriptionGrant,
    )) {
      grantVerificationFailed = true;
      throw new Error(
        `Invitation ${invitation.id} did not echo the requested initial subscription grant. `
        + 'The FeedbackServer must be upgraded before creating subscription-bearing invitations.',
      );
    }
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
      if (!accepted.subscription) {
        throw new CommittedAdminCreationError(
          new Error('The Server did not return the applied subscription summary'),
        );
      }
      if (!appliedSubscriptionMatchesGrant(accepted.subscription, subscriptionGrant)) {
        throw new CommittedAdminCreationError(
          new Error('The Server applied a subscription that does not match the invitation grant'),
        );
      }
      try {
        result = {
          admin: await verifyNewAdmin(),
          subscription: accepted.subscription,
        };
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
        await verifyNewAdmin();
        invitationAccepted = true;
        throw new CommittedAdminCreationError(error);
      } catch (verificationError) {
        if (verificationError instanceof CommittedAdminCreationError) {
          throw verificationError;
        }
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
    if (grantVerificationFailed && invitation && cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        `Invitation ${invitation.id} has an uncertain state after compensating revocation failed`,
      );
    }
    if (result && operationError === undefined) {
      throw new CommittedAdminCreationError(
        new AggregateError(cleanupErrors, 'Committed administrator creation cleanup failed'),
      );
    }
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
