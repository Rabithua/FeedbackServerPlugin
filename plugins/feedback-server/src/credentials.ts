import { randomUUID } from 'node:crypto';
import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';

export const DEFAULT_BASE_URL = 'https://api.feedkit.cn/v1/api';
export const LEGACY_DEFAULT_BASE_URL = 'https://feedbackserver.rote.ink/v1/api';
export const KEYRING_SERVICE = 'cc.feedkit.agent';
export const KEYCHAIN_SERVICE = KEYRING_SERVICE;
export const KEYCHAIN_ACCOUNT = 'default';
export const MAX_KEYCHAIN_PROFILES = 100;

const PROFILE_SERVICE = `${KEYRING_SERVICE}.profile`;
const ACTIVE_PROFILE_SERVICE = `${KEYRING_SERVICE}.active`;
const PROFILE_INDEX_SERVICE = `${KEYRING_SERVICE}.profiles`;
const PENDING_EMAIL_LOGIN_SERVICE = `${KEYRING_SERVICE}.pending-email-login`;
const PENDING_REAUTH_SERVICE = `${KEYRING_SERVICE}.pending-reauth`;
const RECENT_REAUTH_SERVICE = `${KEYRING_SERVICE}.recent-reauth`;
const ACTIVE_ACCOUNT = 'active';
const INDEX_ACCOUNT = 'index';

export const profileIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9._-]+$/,
    'Profile IDs may contain only lowercase letters, numbers, dots, underscores, and hyphens',
  );

const credentialSchema = z.object({
  baseUrl: z.url(),
  adminId: z.uuid(),
  email: z.email(),
  tokenId: z.uuid(),
  token: z.string().startsWith('fspat_').min(40).max(120).regex(/^fspat_[A-Za-z0-9_-]+$/),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.iso.datetime(),
}).strict();

const profileIndexSchema = z.object({
  version: z.literal(2),
  profiles: z.array(profileIdSchema).max(MAX_KEYCHAIN_PROFILES),
}).strict();

const pendingEmailLoginSchema = z.object({
  version: z.literal(1),
  requestId: z.uuid(),
  baseUrl: z.url(),
  enrollmentSecret: z.string().regex(/^fsenr_[A-Za-z0-9_-]{43,}$/).max(120),
  challengeId: z.uuid(),
  email: z.email(),
  credentialName: z.string().min(1).max(160),
  profile: profileIdSchema,
  replaceExisting: z.boolean(),
  previousCredentials: credentialSchema.nullable(),
  acceptedTokenId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
}).strict();

const pendingReauthenticationSchema = z.object({
  version: z.literal(1),
  requestId: z.uuid(),
  challengeId: z.uuid(),
  profile: profileIdSchema,
  tokenId: z.uuid(),
  expiresAt: z.iso.datetime(),
}).strict();

const recentReauthenticationSchema = z.object({
  version: z.literal(1),
  profile: profileIdSchema,
  tokenId: z.uuid(),
  token: z.string().min(20).max(4096),
  expiresAt: z.iso.datetime(),
}).strict();

export type StoredCredentials = z.infer<typeof credentialSchema>;
export type PendingEmailLogin = z.infer<typeof pendingEmailLoginSchema>;
export type PendingReauthentication = z.infer<typeof pendingReauthenticationSchema>;
export type RecentReauthentication = z.infer<typeof recentReauthenticationSchema>;
export interface PendingTokenRevocation {
  baseUrl: string;
  tokenId: string;
  email: string;
  profile?: string;
}
export interface LoadedCredentials {
  credentials: StoredCredentials;
  credentialSource: 'environment' | 'keyring';
  activeProfile: string | null;
}

export interface NativeEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined>;
  deleteCredential(): Promise<boolean>;
}

export type NativeEntryFactory = (service: string, account: string) => NativeEntry;

const nativeEntry: NativeEntryFactory = (service, account) => {
  const entry = new AsyncEntry(service, account);
  return {
    setPassword: (password) => entry.setPassword(password),
    getPassword: () => entry.getPassword(),
    deleteCredential: () => entry.deleteCredential(),
  };
};

export class CredentialPersistenceIndeterminateError extends Error {
  public constructor(public readonly profile: string, cause: unknown) {
    super(
      `FeedbackKit profile ${profile} may already contain the new Agent credential. `
      + 'Inspect onboarding status before accepting another invitation.',
      { cause },
    );
    this.name = 'CredentialPersistenceIndeterminateError';
  }
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password) throw new Error('FeedbackKit URL must not include user information');
  const loopbackHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('FeedbackKit URL must use HTTPS; HTTP is allowed only for localhost development');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/v1/api')) {
    url.pathname = `${url.pathname}/v1/api`.replaceAll('//', '/');
  }
  const normalized = url.toString().replace(/\/+$/, '');
  return normalized === LEGACY_DEFAULT_BASE_URL ? DEFAULT_BASE_URL : normalized;
}

function normalizeCredentials(value: unknown): StoredCredentials {
  const parsed = credentialSchema.parse(value);
  return credentialSchema.parse({
    ...parsed,
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    email: parsed.email.trim().toLowerCase(),
  });
}

async function readValue(
  service: string,
  account: string,
  factory: NativeEntryFactory,
): Promise<string | undefined> {
  return factory(service, account).getPassword();
}

async function deleteValue(
  service: string,
  account: string,
  factory: NativeEntryFactory,
): Promise<void> {
  await factory(service, account).deleteCredential();
}

async function readProfileIndex(factory: NativeEntryFactory): Promise<string[]> {
  const stored = await readValue(PROFILE_INDEX_SERVICE, INDEX_ACCOUNT, factory);
  if (!stored) return [];
  return [...new Set(profileIndexSchema.parse(JSON.parse(stored)).profiles)].sort();
}

async function writeProfileIndex(profiles: string[], factory: NativeEntryFactory): Promise<void> {
  const normalized = [...new Set(profiles.map((profile) => profileIdSchema.parse(profile)))].sort();
  await factory(PROFILE_INDEX_SERVICE, INDEX_ACCOUNT).setPassword(JSON.stringify({
    version: 2,
    profiles: normalized,
  }));
}

export async function preflightNativeCredentialStore(
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const account = `preflight-${randomUUID()}`;
  const probe = randomUUID();
  const entry = factory(`${KEYRING_SERVICE}.preflight`, account);
  try {
    await entry.setPassword(probe);
    if (await entry.getPassword() !== probe) {
      throw new Error('Native credential store did not return the value it accepted');
    }
  } catch (error) {
    throw new Error(
      'The native credential store is unavailable. Unlock macOS Keychain, Windows Credential Manager, or Linux Secret Service before accepting the invitation.',
      { cause: error },
    );
  } finally {
    await entry.deleteCredential().catch(() => false);
  }
}

export async function readKeychainProfileCredentials(
  profile: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<StoredCredentials | undefined> {
  const stored = await readValue(PROFILE_SERVICE, profileIdSchema.parse(profile), factory);
  return stored ? normalizeCredentials(JSON.parse(stored)) : undefined;
}

export async function readActiveKeychainProfile(
  factory: NativeEntryFactory = nativeEntry,
): Promise<string | undefined> {
  const value = await readValue(ACTIVE_PROFILE_SERVICE, ACTIVE_ACCOUNT, factory);
  return value ? profileIdSchema.parse(value) : undefined;
}

export async function readKeychainCredentials(
  factory: NativeEntryFactory = nativeEntry,
): Promise<StoredCredentials | undefined> {
  const active = await readActiveKeychainProfile(factory);
  return active ? readKeychainProfileCredentials(active, factory) : undefined;
}

export async function writeKeychainProfileCredentials(
  credentials: StoredCredentials,
  profile: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsedProfile = profileIdSchema.parse(profile);
  const parsed = normalizeCredentials(credentials);
  const profiles = await readProfileIndex(factory);
  if (!profiles.includes(parsedProfile) && profiles.length >= MAX_KEYCHAIN_PROFILES) {
    throw new Error(`FeedbackKit supports at most ${MAX_KEYCHAIN_PROFILES} profiles`);
  }
  await factory(PROFILE_SERVICE, parsedProfile).setPassword(JSON.stringify(parsed));
  try {
    await writeProfileIndex([...profiles, parsedProfile], factory);
    await factory(ACTIVE_PROFILE_SERVICE, ACTIVE_ACCOUNT).setPassword(parsedProfile);
  } catch (error) {
    throw new CredentialPersistenceIndeterminateError(parsedProfile, error);
  }
}

export async function writeKeychainCredentials(
  credentials: StoredCredentials,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  await writeKeychainProfileCredentials(
    credentials,
    await readActiveKeychainProfile(factory) ?? KEYCHAIN_ACCOUNT,
    factory,
  );
}

export async function listKeychainProfiles(
  factory: NativeEntryFactory = nativeEntry,
): Promise<Array<{ name: string; active: boolean }>> {
  const [profiles, active] = await Promise.all([
    readProfileIndex(factory),
    readActiveKeychainProfile(factory),
  ]);
  return profiles.map((name) => ({ name, active: name === active }));
}

export async function useKeychainProfile(
  profile: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsed = profileIdSchema.parse(profile);
  if (!await readKeychainProfileCredentials(parsed, factory)) {
    throw new Error(`FeedbackKit profile ${parsed} does not exist`);
  }
  await factory(ACTIVE_PROFILE_SERVICE, ACTIVE_ACCOUNT).setPassword(parsed);
}

export async function deleteKeychainProfileCredentials(
  profile: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsed = profileIdSchema.parse(profile);
  await deleteValue(PROFILE_SERVICE, parsed, factory);
  const profiles = (await readProfileIndex(factory)).filter((candidate) => candidate !== parsed);
  await writeProfileIndex(profiles, factory);
  if (await readActiveKeychainProfile(factory) === parsed) {
    const next = profiles.includes(KEYCHAIN_ACCOUNT) ? KEYCHAIN_ACCOUNT : profiles[0];
    if (next) await factory(ACTIVE_PROFILE_SERVICE, ACTIVE_ACCOUNT).setPassword(next);
    else await deleteValue(ACTIVE_PROFILE_SERVICE, ACTIVE_ACCOUNT, factory);
  }
}

export async function deleteKeychainCredentials(
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const profile = await readActiveKeychainProfile(factory);
  if (profile) await deleteKeychainProfileCredentials(profile, factory);
}

export async function readKeychainReferencedTokenIds(
  factory: NativeEntryFactory = nativeEntry,
): Promise<Set<string>> {
  const credentials = await Promise.all(
    (await readProfileIndex(factory)).map((profile) => readKeychainProfileCredentials(profile, factory)),
  );
  return new Set(credentials.flatMap((value) => value ? [value.tokenId] : []));
}

export async function writePendingEmailLogin(
  pending: PendingEmailLogin,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsed = pendingEmailLoginSchema.parse({
    ...pending,
    baseUrl: normalizeBaseUrl(pending.baseUrl),
    email: pending.email.trim().toLowerCase(),
  });
  await factory(PENDING_EMAIL_LOGIN_SERVICE, parsed.requestId).setPassword(JSON.stringify(parsed));
}

export async function readPendingEmailLogin(
  requestId: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<PendingEmailLogin | undefined> {
  const parsedId = z.uuid().parse(requestId);
  const stored = await readValue(PENDING_EMAIL_LOGIN_SERVICE, parsedId, factory);
  if (!stored) return undefined;
  const pending = pendingEmailLoginSchema.parse(JSON.parse(stored));
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    await deleteValue(PENDING_EMAIL_LOGIN_SERVICE, parsedId, factory);
    return undefined;
  }
  return pending;
}

export async function deletePendingEmailLogin(
  requestId: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  await deleteValue(PENDING_EMAIL_LOGIN_SERVICE, z.uuid().parse(requestId), factory);
}

export async function writePendingReauthentication(
  pending: PendingReauthentication,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsed = pendingReauthenticationSchema.parse(pending);
  await factory(PENDING_REAUTH_SERVICE, parsed.requestId).setPassword(JSON.stringify(parsed));
}

export async function readPendingReauthentication(
  requestId: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<PendingReauthentication | undefined> {
  const parsedId = z.uuid().parse(requestId);
  const stored = await readValue(PENDING_REAUTH_SERVICE, parsedId, factory);
  if (!stored) return undefined;
  const pending = pendingReauthenticationSchema.parse(JSON.parse(stored));
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    await deleteValue(PENDING_REAUTH_SERVICE, parsedId, factory);
    return undefined;
  }
  return pending;
}

export async function deletePendingReauthentication(
  requestId: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  await deleteValue(PENDING_REAUTH_SERVICE, z.uuid().parse(requestId), factory);
}

export async function writeRecentReauthentication(
  value: RecentReauthentication,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  const parsed = recentReauthenticationSchema.parse(value);
  await factory(RECENT_REAUTH_SERVICE, parsed.profile).setPassword(JSON.stringify(parsed));
}

export async function readRecentReauthentication(
  profile: string,
  tokenId: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<RecentReauthentication | undefined> {
  const parsedProfile = profileIdSchema.parse(profile);
  const stored = await readValue(RECENT_REAUTH_SERVICE, parsedProfile, factory);
  if (!stored) return undefined;
  const recent = recentReauthenticationSchema.parse(JSON.parse(stored));
  if (recent.tokenId !== z.uuid().parse(tokenId) || new Date(recent.expiresAt).getTime() <= Date.now()) {
    await deleteValue(RECENT_REAUTH_SERVICE, parsedProfile, factory);
    return undefined;
  }
  return recent;
}

export async function deleteRecentReauthentication(
  profile: string,
  factory: NativeEntryFactory = nativeEntry,
): Promise<void> {
  await deleteValue(RECENT_REAUTH_SERVICE, profileIdSchema.parse(profile), factory);
}

export function readPendingTokenRevocations(): Promise<PendingTokenRevocation[]> {
  return Promise.resolve([]);
}

export function addPendingTokenRevocation(): Promise<void> {
  return Promise.reject(new Error('Legacy PAT revocation recovery is unavailable in FeedbackKit 0.11'));
}

export async function removePendingTokenRevocation(): Promise<void> {}

export function resumeKeychainCredentialCleanup(): Promise<boolean> {
  return Promise.resolve(false);
}

export async function loadCredentialsWithSource(
  environment: NodeJS.ProcessEnv = process.env,
  factory: NativeEntryFactory = nativeEntry,
): Promise<LoadedCredentials> {
  const environmentValues = {
    baseUrl: environment.FEEDBACK_SERVER_BASE_URL,
    adminId: environment.FEEDBACK_SERVER_ADMIN_ID,
    email: environment.FEEDBACK_SERVER_ADMIN_EMAIL,
    tokenId: environment.FEEDBACK_SERVER_API_TOKEN_ID,
    token: environment.FEEDBACK_SERVER_API_TOKEN,
    scopes: environment.FEEDBACK_SERVER_API_SCOPES?.split(',').map((scope) => scope.trim()).filter(Boolean),
    expiresAt: environment.FEEDBACK_SERVER_API_TOKEN_EXPIRES_AT,
  };
  if (Object.values(environmentValues).some((value) => value !== undefined)) {
    return {
      credentials: normalizeCredentials(environmentValues),
      credentialSource: 'environment',
      activeProfile: null,
    };
  }
  const activeProfile = await readActiveKeychainProfile(factory);
  const credentials = activeProfile
    ? await readKeychainProfileCredentials(activeProfile, factory)
    : undefined;
  if (!credentials) {
    throw new Error(
      'FeedbackKit Agent is not configured. Accept an invitation or ask the Agent to request an email login code.',
    );
  }
  return { credentials, credentialSource: 'keyring', activeProfile: activeProfile ?? null };
}

export async function loadCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  return (await loadCredentialsWithSource(environment)).credentials;
}
