import { hostname } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  acknowledgeEmailAgentEnrollment,
  confirmEmailAgentEnrollment,
  confirmEmailChange,
  confirmEmailReauthentication,
  listAgentCredentials,
  requestEmailAgentEnrollment,
  requestEmailChange,
  requestEmailReauthentication,
  revokeAgentCredential,
  type AgentCredentialMetadata,
} from './agent-auth-api.js';
import {
  DEFAULT_BASE_URL,
  KEYCHAIN_ACCOUNT,
  MAX_KEYCHAIN_PROFILES,
  deletePendingEmailLogin,
  deletePendingReauthentication,
  listKeychainProfiles,
  normalizeBaseUrl,
  preflightNativeCredentialStore,
  profileIdSchema,
  readActiveKeychainProfile,
  readKeychainProfileCredentials,
  readKeychainReferencedTokenIds,
  readPendingEmailLogin,
  readPendingReauthentication,
  readRecentReauthentication,
  writeKeychainProfileCredentials,
  writePendingEmailLogin,
  writePendingReauthentication,
  writeRecentReauthentication,
  type StoredCredentials,
} from './credentials.js';
import { revokeCurrentAgentCredential } from './invitation-api.js';

export class EmailLoginProfileConflictError extends Error {
  public constructor(
    public readonly profile: string,
    public readonly email: string,
    public readonly emailSent = false,
  ) {
    super(
      `FeedbackKit profile ${profile} is already connected to ${email}. `
      + 'Keep it, choose a different profile, or explicitly replace it before requesting email.',
    );
    this.name = 'EmailLoginProfileConflictError';
  }
}

export interface EmailLoginDependencies {
  preflight: typeof preflightNativeCredentialStore;
  readActiveProfile: typeof readActiveKeychainProfile;
  readProfile: typeof readKeychainProfileCredentials;
  listProfiles: typeof listKeychainProfiles;
  referencedTokenIds: typeof readKeychainReferencedTokenIds;
  writeProfile: typeof writeKeychainProfileCredentials;
  writePending: typeof writePendingEmailLogin;
  readPending: typeof readPendingEmailLogin;
  deletePending: typeof deletePendingEmailLogin;
  request: typeof requestEmailAgentEnrollment;
  confirm: typeof confirmEmailAgentEnrollment;
  acknowledge: typeof acknowledgeEmailAgentEnrollment;
  revokePrevious: typeof revokeCurrentAgentCredential;
}

const emailLoginDependencies: EmailLoginDependencies = {
  preflight: preflightNativeCredentialStore,
  readActiveProfile: readActiveKeychainProfile,
  readProfile: readKeychainProfileCredentials,
  listProfiles: listKeychainProfiles,
  referencedTokenIds: readKeychainReferencedTokenIds,
  writeProfile: writeKeychainProfileCredentials,
  writePending: writePendingEmailLogin,
  readPending: readPendingEmailLogin,
  deletePending: deletePendingEmailLogin,
  request: requestEmailAgentEnrollment,
  confirm: confirmEmailAgentEnrollment,
  acknowledge: acknowledgeEmailAgentEnrollment,
  revokePrevious: revokeCurrentAgentCredential,
};

function enrollmentSecret(): string {
  return `fsenr_${randomBytes(32).toString('base64url')}`;
}

async function keyringCredentials(profile?: string): Promise<{
  profile: string;
  credentials: StoredCredentials;
}> {
  const selected = profileIdSchema.parse(
    profile ?? await readActiveKeychainProfile() ?? KEYCHAIN_ACCOUNT,
  );
  const credentials = await readKeychainProfileCredentials(selected);
  if (!credentials) throw new Error(`FeedbackKit profile ${selected} is not configured`);
  return { profile: selected, credentials };
}

export async function requestAgentEmailLogin(input: {
  email: string;
  baseUrl?: string | undefined;
  profile?: string | undefined;
  credentialName?: string | undefined;
  replaceExisting?: boolean | undefined;
}, dependencies: EmailLoginDependencies = emailLoginDependencies): Promise<{
  status: 'verification_email_queued';
  requestId: string;
  email: string;
  profile: string;
  expiresAt: string;
}> {
  await dependencies.preflight();
  const profile = profileIdSchema.parse(
    input.profile ?? await dependencies.readActiveProfile() ?? KEYCHAIN_ACCOUNT,
  );
  const existing = await dependencies.readProfile(profile);
  if (existing && !input.replaceExisting) {
    throw new EmailLoginProfileConflictError(profile, existing.email);
  }
  const profiles = existing ? [] : await dependencies.listProfiles();
  if (
    !existing
    && !profiles.some(({ name }) => name === profile)
    && profiles.length >= MAX_KEYCHAIN_PROFILES
  ) {
    throw new Error(
      `FeedbackKit already has ${MAX_KEYCHAIN_PROFILES} profiles. Remove or reuse one before requesting email.`,
    );
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL);
  const email = input.email.trim().toLowerCase();
  const requestId = randomUUID();
  const secret = enrollmentSecret();
  const credentialName = input.credentialName?.trim()
    || `FeedbackKit Agent on ${hostname() || 'this device'}`;
  const challenge = await dependencies.request(baseUrl, {
    email,
    enrollmentId: requestId,
    enrollmentSecret: secret,
    credentialName,
  });
  await dependencies.writePending({
    version: 1,
    requestId,
    baseUrl,
    enrollmentSecret: secret,
    challengeId: challenge.challengeId,
    email,
    credentialName,
    profile,
    replaceExisting: input.replaceExisting ?? false,
    previousCredentials: existing ?? null,
    acceptedTokenId: null,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  });
  return {
    status: 'verification_email_queued',
    requestId,
    email,
    profile,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  };
}

export async function completeAgentEmailLogin(input: {
  requestId: string;
  code: string;
}, dependencies: EmailLoginDependencies = emailLoginDependencies): Promise<{
  status: 'connected';
  adminId: string;
  email: string;
  profile: string;
  tokenId: string;
  scopes: string[];
  expiresAt: string;
  acknowledged: boolean;
  previousCredentialRevoked: boolean | null;
}> {
  await dependencies.preflight();
  const pending = await dependencies.readPending(input.requestId);
  if (!pending) throw new Error('Email login request is unavailable or expired');
  const existing = await dependencies.readProfile(pending.profile);
  const expectedExistingTokenIds = new Set([
    pending.previousCredentials?.tokenId,
    pending.acceptedTokenId,
  ].filter((value): value is string => Boolean(value)));
  if (existing && (
    expectedExistingTokenIds.size === 0
    || !expectedExistingTokenIds.has(existing.tokenId)
  )) {
    throw new EmailLoginProfileConflictError(
      pending.profile,
      existing.email,
      true,
    );
  }
  // Preserve the client-generated enrollment for the full server replay window
  // in case confirmation succeeds but the HTTP response is lost.
  await dependencies.writePending({
    ...pending,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  const accepted = await dependencies.confirm(pending.baseUrl, {
    enrollmentId: pending.requestId,
    enrollmentSecret: pending.enrollmentSecret,
    challengeId: pending.challengeId,
    code: input.code,
  });
  if (accepted.enrollmentId !== pending.requestId || accepted.admin.email !== pending.email) {
    throw new Error('FeedbackKit returned an unexpected Agent enrollment');
  }
  await dependencies.writePending({
    ...pending,
    acceptedTokenId: accepted.credential.id,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  const credentials: StoredCredentials = {
    baseUrl: pending.baseUrl,
    adminId: accepted.admin.id,
    email: accepted.admin.email,
    tokenId: accepted.credential.id,
    token: accepted.credential.token,
    scopes: accepted.credential.scopes,
    expiresAt: accepted.credential.expiresAt,
  };
  await dependencies.writeProfile(credentials, pending.profile);

  let acknowledged = true;
  try {
    await dependencies.acknowledge(pending.baseUrl, {
      enrollmentId: pending.requestId,
      token: credentials.token,
    });
  } catch {
    acknowledged = false;
  }
  await dependencies.deletePending(pending.requestId).catch(() => undefined);

  let previousCredentialRevoked: boolean | null = null;
  if (pending.previousCredentials && pending.replaceExisting) {
    try {
      const referencedTokenIds = await dependencies.referencedTokenIds();
      if (!referencedTokenIds.has(pending.previousCredentials.tokenId)) {
        await dependencies.revokePrevious(
          pending.previousCredentials.baseUrl,
          pending.previousCredentials.token,
        );
        previousCredentialRevoked = true;
      }
    } catch {
      previousCredentialRevoked = false;
    }
  }
  return {
    status: 'connected',
    adminId: credentials.adminId,
    email: credentials.email,
    profile: pending.profile,
    tokenId: credentials.tokenId,
    scopes: credentials.scopes,
    expiresAt: credentials.expiresAt,
    acknowledged,
    previousCredentialRevoked,
  };
}

export async function requestAgentEmailReauthentication(input: { profile?: string | undefined } = {}): Promise<{
  status: 'verification_email_queued';
  requestId: string;
  email: string;
  profile: string;
  expiresAt: string;
}> {
  await preflightNativeCredentialStore();
  const { profile, credentials } = await keyringCredentials(input.profile);
  const requestId = randomUUID();
  const challenge = await requestEmailReauthentication(credentials);
  await writePendingReauthentication({
    version: 1,
    requestId,
    challengeId: challenge.challengeId,
    profile,
    tokenId: credentials.tokenId,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  });
  return {
    status: 'verification_email_queued',
    requestId,
    email: credentials.email,
    profile,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  };
}

export async function completeAgentEmailReauthentication(input: {
  requestId: string;
  code: string;
}): Promise<{
  status: 'reauthenticated';
  email: string;
  profile: string;
  expiresAt: string;
}> {
  await preflightNativeCredentialStore();
  const pending = await readPendingReauthentication(input.requestId);
  if (!pending) throw new Error('Email reauthentication request is unavailable or expired');
  const credentials = await readKeychainProfileCredentials(pending.profile);
  if (!credentials || credentials.tokenId !== pending.tokenId) {
    throw new Error('The Agent credential changed after email reauthentication was requested');
  }
  const confirmed = await confirmEmailReauthentication(credentials, {
    challengeId: pending.challengeId,
    code: input.code,
  });
  await writeRecentReauthentication({
    version: 1,
    profile: pending.profile,
    tokenId: credentials.tokenId,
    token: confirmed.reauthToken,
    expiresAt: new Date(confirmed.expiresAt).toISOString(),
  });
  await deletePendingReauthentication(pending.requestId).catch(() => undefined);
  return {
    status: 'reauthenticated',
    email: credentials.email,
    profile: pending.profile,
    expiresAt: new Date(confirmed.expiresAt).toISOString(),
  };
}

async function recentCredentials(profile?: string) {
  const selected = await keyringCredentials(profile);
  const recent = await readRecentReauthentication(selected.profile, selected.credentials.tokenId);
  if (!recent) {
    throw new Error('Recent email authentication is required. Request and complete email reauthentication first.');
  }
  return { ...selected, reauthToken: recent.token };
}

export async function requestAgentEmailChange(input: { email: string; profile?: string | undefined }) {
  const { profile, credentials, reauthToken } = await recentCredentials(input.profile);
  const result = await requestEmailChange(credentials, reauthToken, input.email.trim().toLowerCase());
  return { ...result, profile, email: input.email.trim().toLowerCase() };
}

export async function completeAgentEmailChange(input: {
  challengeId: string;
  code: string;
  profile?: string | undefined;
}) {
  const { profile, credentials, reauthToken } = await recentCredentials(input.profile);
  const changed = await confirmEmailChange(credentials, reauthToken, {
    challengeId: input.challengeId,
    code: input.code,
  });
  await writeKeychainProfileCredentials({ ...credentials, email: changed.email }, profile);
  return { status: 'email_changed' as const, profile, ...changed };
}

export async function listAgentCredentialMetadata(input: { profile?: string | undefined } = {}): Promise<{
  profile: string;
  currentTokenId: string;
  credentials: AgentCredentialMetadata[];
}> {
  const { profile, credentials, reauthToken } = await recentCredentials(input.profile);
  return {
    profile,
    currentTokenId: credentials.tokenId,
    credentials: await listAgentCredentials(credentials, reauthToken),
  };
}

export async function revokeAgentCredentialById(input: { tokenId: string; profile?: string | undefined }) {
  const { profile, credentials, reauthToken } = await recentCredentials(input.profile);
  if (input.tokenId === credentials.tokenId) {
    throw new Error('The active Agent credential cannot revoke itself; replace or remove the Profile instead.');
  }
  await revokeAgentCredential(credentials, reauthToken, input.tokenId);
  return { status: 'revoked' as const, profile, tokenId: input.tokenId };
}
