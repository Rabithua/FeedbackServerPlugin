import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  KEYCHAIN_ACCOUNT,
  normalizeBaseUrl,
  preflightNativeCredentialStore,
  readKeychainProfileCredentials,
  writeKeychainProfileCredentials,
  type StoredCredentials,
} from './credentials.js';
import {
  acceptAdminInvitation,
  acknowledgeInvitationEnrollment,
  revokeCurrentAgentCredential,
  type AcceptedInvitation,
  type AppliedInvitationSubscription,
} from './invitation-api.js';

export interface ConfiguredInvitationAccount {
  credentials: StoredCredentials;
  subscription: AppliedInvitationSubscription;
  enrollmentId: string;
  acknowledged: boolean;
  previousCredentialRevoked: boolean | null;
}

export class AgentAlreadyConfiguredError extends Error {
  public constructor(existing: StoredCredentials, profile: string) {
    super(
      `FeedbackKit profile ${profile} is already configured for ${existing.email} at ${existing.baseUrl}. `
      + 'The invitation was not consumed.',
    );
    this.name = 'AgentAlreadyConfiguredError';
  }
}

export class InvitationCredentialPersistenceError extends Error {
  public constructor(cause: unknown) {
    super(
      'The account may have been created, but its Agent credential was not saved. '
      + 'Retry the same invitation within 15 minutes; FeedbackKit will return the same credential.',
      { cause },
    );
    this.name = 'InvitationCredentialPersistenceError';
  }
}

export interface InvitationAcceptanceDependencies {
  preflight: typeof preflightNativeCredentialStore;
  readProfile: typeof readKeychainProfileCredentials;
  writeProfile: typeof writeKeychainProfileCredentials;
  accept: typeof acceptAdminInvitation;
  acknowledge: typeof acknowledgeInvitationEnrollment;
  revokePrevious?: typeof revokeCurrentAgentCredential;
}

const defaultDependencies: InvitationAcceptanceDependencies = {
  preflight: preflightNativeCredentialStore,
  readProfile: readKeychainProfileCredentials,
  writeProfile: writeKeychainProfileCredentials,
  accept: acceptAdminInvitation,
  acknowledge: acknowledgeInvitationEnrollment,
  revokePrevious: revokeCurrentAgentCredential,
};

export function enrollmentIdForInvitation(token: string): string {
  const bytes = createHash('sha256').update('feedbackkit-enrollment\0').update(token).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function verifyAcceptance(accepted: AcceptedInvitation, enrollmentId: string): void {
  if (accepted.enrollmentId !== enrollmentId) throw new Error('FeedbackKit returned an unexpected enrollment');
  if (!accepted.admin.emailVerifiedAt) throw new Error('FeedbackKit did not verify the invited email');
  if (!accepted.credential.scopes.includes('products:write')) {
    throw new Error('The Agent credential cannot create the first App');
  }
}

export async function acceptInvitationAndConfigure(
  input: {
    baseUrl: string;
    token: string;
    profile?: string;
    credentialName?: string;
    replaceExisting?: boolean;
  },
  dependencies: InvitationAcceptanceDependencies = defaultDependencies,
): Promise<ConfiguredInvitationAccount> {
  const profile = input.profile ?? KEYCHAIN_ACCOUNT;
  await dependencies.preflight();
  const existing = await dependencies.readProfile(profile);
  if (existing && !input.replaceExisting) throw new AgentAlreadyConfiguredError(existing, profile);

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const enrollmentId = enrollmentIdForInvitation(input.token);
  const accepted = await dependencies.accept(baseUrl, {
    token: input.token,
    enrollmentId,
    credentialName: input.credentialName?.trim() || `FeedbackKit Agent on ${hostname() || randomUUID()}`,
  });
  verifyAcceptance(accepted, enrollmentId);
  const credentials: StoredCredentials = {
    baseUrl,
    adminId: accepted.admin.id,
    email: accepted.admin.email,
    tokenId: accepted.credential.id,
    token: accepted.credential.token,
    scopes: accepted.credential.scopes,
    expiresAt: accepted.credential.expiresAt,
  };
  try {
    await dependencies.writeProfile(credentials, profile);
  } catch (error) {
    throw new InvitationCredentialPersistenceError(error);
  }

  let acknowledged = true;
  try {
    await dependencies.acknowledge(baseUrl, {
      enrollmentId,
      token: credentials.token,
    });
  } catch {
    acknowledged = false;
  }
  let previousCredentialRevoked: boolean | null = null;
  if (existing && input.replaceExisting && dependencies.revokePrevious) {
    try {
      await dependencies.revokePrevious(existing.baseUrl, existing.token);
      previousCredentialRevoked = true;
    } catch {
      previousCredentialRevoked = false;
    }
  }
  return {
    credentials,
    subscription: accepted.subscription,
    enrollmentId,
    acknowledged,
    previousCredentialRevoked,
  };
}
