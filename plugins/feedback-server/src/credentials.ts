import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_BASE_URL = 'https://api.feedkit.cn/v1/api';
export const LEGACY_DEFAULT_BASE_URL = 'https://feedbackserver.rote.ink/v1/api';
export const KEYCHAIN_SERVICE = 'dev.rote.feedback-server.mcp';
export const KEYCHAIN_ACCOUNT = 'default';
export const KEYCHAIN_TOKEN_SERVICE = `${KEYCHAIN_SERVICE}.token`;
export const KEYCHAIN_METADATA_SERVICE = `${KEYCHAIN_SERVICE}.metadata`;
export const KEYCHAIN_PROFILE_POINTER_SERVICE = `${KEYCHAIN_SERVICE}.profile`;
export const KEYCHAIN_PROFILE_INDEX_SERVICE = `${KEYCHAIN_SERVICE}.profiles`;
export const KEYCHAIN_ACTIVE_PROFILE_SERVICE = `${KEYCHAIN_SERVICE}.active-profile`;
export const KEYCHAIN_ACTIVE_PROFILE_ACCOUNT = 'active';
export const KEYCHAIN_PENDING_REVOCATIONS_SERVICE = `${KEYCHAIN_SERVICE}.pending-revocations`;
export const KEYCHAIN_ADMIN_PASSWORD_SERVICE = 'dev.rote.feedback-server.admin';
export const SECURITY_EXECUTABLE = '/usr/bin/security';
export const SECURITY_EXECUTABLE_FALLBACK = 'security';
export const SECURITY_SHELL_EXECUTABLE = '/bin/sh';
export const MAX_KEYCHAIN_PROFILES = 100;

const credentialSchema = z.object({
  baseUrl: z.url(),
  token: z
    .string()
    .startsWith('fspat_')
    .min(40)
    .max(120)
    .regex(/^fspat_[A-Za-z0-9_-]+$/),
  tokenId: z.uuid().optional(),
  pendingRevocationTokenIds: z.array(z.uuid()).max(32).optional(),
  username: z.string().min(1).max(80).optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.iso.datetime().optional(),
});

const credentialMetadataSchema = credentialSchema
  .omit({ token: true })
  .extend({ version: z.literal(1) });
const keychainRecordIdSchema = z.uuid();
export const profileIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Profile IDs may contain only lowercase letters, numbers, dots, underscores, and hyphens');
const profileIndexSchema = z.object({
  version: z.literal(1),
  profiles: z
    .array(profileIdSchema)
    .max(MAX_KEYCHAIN_PROFILES)
    .transform((profiles) => [...new Set(profiles)].sort()),
});
const pendingTokenRevocationSchema = z.object({
  baseUrl: z.url(),
  username: z.string().min(1).max(80),
  tokenId: z.uuid(),
  profile: profileIdSchema.optional(),
});
const pendingTokenRevocationLedgerSchema = z.object({
  version: z.literal(1),
  entries: z.array(pendingTokenRevocationSchema).max(64),
});

export type StoredCredentials = z.infer<typeof credentialSchema>;
export type PendingTokenRevocation = z.infer<typeof pendingTokenRevocationSchema>;
export type SecurityCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
export type SecurityCommandRunner = (
  args: string[],
  input?: string,
) => Promise<SecurityCommandResult>;
export interface KeychainAdminPasswordCandidate {
  password: string;
  legacy: boolean;
}

export interface LoadedCredentials {
  credentials: StoredCredentials;
  credentialSource: 'environment' | 'keychain';
  activeProfile: string | null;
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password) {
    throw new Error('FeedbackServer URL must not include user information');
  }
  const isLoopbackHttp =
    url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error('FeedbackServer URL must use HTTPS; HTTP is allowed only for localhost development');
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

function normalizeStoredCredentials(value: unknown): StoredCredentials {
  const credentials = credentialSchema.parse(value);
  return {
    ...credentials,
    baseUrl: normalizeBaseUrl(credentials.baseUrl),
  };
}

async function runSecurity(
  args: string[],
  input?: string,
): Promise<SecurityCommandResult> {
  const launchErrors: string[] = [];

  for (const command of securityCommandCandidates(args)) {
    try {
      return await runSecurityCommand(command, input);
    } catch (error) {
      if (!isExecutableMissingError(error)) throw error;
      launchErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `Unable to start macOS Keychain command. Tried security executable fallbacks: ${
      launchErrors.join('; ')
    }`,
  );
}

export function securityCommandCandidates(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): string[][] {
  const directCommands = [
    [environment.FEEDBACK_SERVER_SECURITY_EXECUTABLE, ...args],
    [SECURITY_EXECUTABLE, ...args],
    [SECURITY_EXECUTABLE_FALLBACK, ...args],
  ].filter((command): command is string[] => Boolean(command[0]));
  return [
    ...directCommands,
    [SECURITY_SHELL_EXECUTABLE, '-lc', 'exec security "$@"', 'security', ...args],
  ];
}

function isExecutableMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || error.message.includes('ENOENT');
}

async function runSecurityCommand(
  command: string[],
  input?: string,
): Promise<SecurityCommandResult> {
  const subprocess = Bun.spawn({
    cmd: command,
    stdin: input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (input !== undefined) {
    const stdin = subprocess.stdin;
    if (!stdin) throw new Error('Unable to open Keychain input pipe');
    await stdin.write(input);
    await stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function hexadecimalValue(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

export function keychainTokenWriteArguments(recordId: string): string[] {
  return [
    'add-generic-password',
    '-a',
    keychainRecordIdSchema.parse(recordId),
    '-s',
    KEYCHAIN_TOKEN_SERVICE,
    '-l',
    'FeedbackServer MCP API token',
    '-w',
  ];
}

export function keychainMetadataWriteArguments(
  recordId: string,
  credentials: StoredCredentials,
): string[] {
  const value = JSON.stringify(
    credentialMetadataSchema.parse({ version: 1, ...credentialSchema.parse(credentials) }),
  );
  const encodedValue = Buffer.from(value, 'utf8').toString('hex');
  return [
    'add-generic-password',
    '-a',
    keychainRecordIdSchema.parse(recordId),
    '-s',
    KEYCHAIN_METADATA_SERVICE,
    '-l',
    'FeedbackServer MCP credential metadata',
    '-X',
    encodedValue,
  ];
}

export function keychainPointerWriteArguments(recordId: string): string[] {
  return [
    'add-generic-password',
    '-U',
    '-a',
    KEYCHAIN_ACCOUNT,
    '-s',
    KEYCHAIN_SERVICE,
    '-l',
    'FeedbackServer MCP credential pointer',
    '-X',
    hexadecimalValue(keychainRecordIdSchema.parse(recordId)),
  ];
}

export function keychainProfilePointerWriteArguments(
  profile: string,
  pointer: string,
): string[] {
  return [
    'add-generic-password',
    '-U',
    '-a',
    profileIdSchema.parse(profile),
    '-s',
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    '-l',
    `FeedbackServer MCP credential pointer for profile ${profile}`,
    '-X',
    hexadecimalValue(pointer),
  ];
}

export function keychainActiveProfileWriteArguments(profile: string): string[] {
  return [
    'add-generic-password',
    '-U',
    '-a',
    KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
    '-s',
    KEYCHAIN_ACTIVE_PROFILE_SERVICE,
    '-l',
    'FeedbackServer active MCP profile',
    '-X',
    hexadecimalValue(profileIdSchema.parse(profile)),
  ];
}

export function keychainProfileIndexWriteArguments(profiles: string[]): string[] {
  const value = JSON.stringify(profileIndexSchema.parse({ version: 1, profiles }));
  return [
    'add-generic-password',
    '-U',
    '-a',
    KEYCHAIN_ACCOUNT,
    '-s',
    KEYCHAIN_PROFILE_INDEX_SERVICE,
    '-l',
    'FeedbackServer MCP profile index',
    '-X',
    hexadecimalValue(value),
  ];
}

function keychainReadArguments(service: string, account: string): string[] {
  return ['find-generic-password', '-a', account, '-s', service, '-w'];
}

function keychainDeleteArguments(service: string, account: string): string[] {
  return ['delete-generic-password', '-a', account, '-s', service];
}

export function keychainPendingRevocationsWriteArguments(
  entries: PendingTokenRevocation[],
): string[] {
  const value = JSON.stringify(
    pendingTokenRevocationLedgerSchema.parse({ version: 1, entries }),
  );
  return [
    'add-generic-password',
    '-U',
    '-a',
    KEYCHAIN_ACCOUNT,
    '-s',
    KEYCHAIN_PENDING_REVOCATIONS_SERVICE,
    '-l',
    'FeedbackServer pending PAT revocations',
    '-X',
    hexadecimalValue(value),
  ];
}

export function keychainAdminPasswordAccount(baseUrl: string, username: string): string {
  return `${new URL(normalizeBaseUrl(baseUrl)).origin}|${username}`;
}

export function keychainAdminPasswordWriteArguments(
  baseUrl: string,
  username: string,
): string[] {
  return [
    'add-generic-password',
    '-U',
    '-a',
    keychainAdminPasswordAccount(baseUrl, username),
    '-s',
    KEYCHAIN_ADMIN_PASSWORD_SERVICE,
    '-l',
    `FeedbackServer administrator password for ${username} at ${new URL(normalizeBaseUrl(baseUrl)).origin}`,
    '-w',
  ];
}

function isMissingKeychainItem(result: SecurityCommandResult): boolean {
  return result.exitCode === 44 || result.stderr.includes('could not be found');
}

async function readKeychainValue(
  service: string,
  account: string,
  runner: SecurityCommandRunner,
): Promise<string | undefined> {
  const result = await runner(keychainReadArguments(service, account));
  if (result.exitCode === 0) return result.stdout.trim();
  if (isMissingKeychainItem(result)) return undefined;
  throw new Error(`Unable to read FeedbackServer credentials from Keychain: ${result.stderr.trim()}`);
}

async function deleteKeychainItem(
  service: string,
  account: string,
  runner: SecurityCommandRunner,
): Promise<boolean> {
  const result = await runner(keychainDeleteArguments(service, account));
  if (result.exitCode === 0 || isMissingKeychainItem(result)) return true;
  return false;
}

async function deleteKeychainRecord(
  recordId: string,
  runner: SecurityCommandRunner,
): Promise<boolean> {
  if (!(await deleteKeychainItem(KEYCHAIN_TOKEN_SERVICE, recordId, runner))) {
    return false;
  }
  return deleteKeychainItem(KEYCHAIN_METADATA_SERVICE, recordId, runner);
}

async function writeKeychainValue(
  args: string[],
  label: string,
  runner: SecurityCommandRunner,
): Promise<void> {
  const result = await runner(args);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to store ${label} in Keychain: ${result.stderr.trim()}`);
  }
}

async function readProfileIndex(runner: SecurityCommandRunner): Promise<string[]> {
  const value = await readKeychainValue(
    KEYCHAIN_PROFILE_INDEX_SERVICE,
    KEYCHAIN_ACCOUNT,
    runner,
  );
  if (!value) return [];
  return profileIndexSchema.parse(JSON.parse(value)).profiles;
}

async function writeProfileIndex(
  profiles: string[],
  runner: SecurityCommandRunner,
): Promise<void> {
  const normalized = profileIndexSchema.parse({ version: 1, profiles }).profiles;
  if (normalized.length === 0) {
    if (!(await deleteKeychainItem(KEYCHAIN_PROFILE_INDEX_SERVICE, KEYCHAIN_ACCOUNT, runner))) {
      throw new Error('Unable to clear the FeedbackServer profile index from Keychain');
    }
    return;
  }
  await writeKeychainValue(
    keychainProfileIndexWriteArguments(normalized),
    'FeedbackServer profile index',
    runner,
  );
}

async function setActiveProfile(profile: string, runner: SecurityCommandRunner): Promise<void> {
  await writeKeychainValue(
    keychainActiveProfileWriteArguments(profile),
    'the active FeedbackServer profile',
    runner,
  );
}

async function migrateLegacyDefaultProfile(
  runner: SecurityCommandRunner,
): Promise<string | undefined> {
  const activeValue = await readKeychainValue(
    KEYCHAIN_ACTIVE_PROFILE_SERVICE,
    KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
    runner,
  );
  const activeProfile = activeValue ? profileIdSchema.parse(activeValue) : undefined;
  const legacyPointer = await readKeychainValue(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);

  if (activeProfile) {
    const activePointer = await readKeychainValue(
      KEYCHAIN_PROFILE_POINTER_SERVICE,
      activeProfile,
      runner,
    );
    if (!activePointer) {
      const profiles = (await readProfileIndex(runner)).filter((name) => name !== activeProfile);
      const fallback = profiles.includes(KEYCHAIN_ACCOUNT) ? KEYCHAIN_ACCOUNT : profiles[0];
      if (fallback) await setActiveProfile(fallback, runner);
      else if (!(await deleteKeychainItem(
        KEYCHAIN_ACTIVE_PROFILE_SERVICE,
        KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
        runner,
      ))) {
        throw new Error(`Unable to recover missing active FeedbackServer profile ${activeProfile}`);
      }
      await writeProfileIndex(profiles, runner);
      return fallback;
    }
    const profiles = await readProfileIndex(runner);
    const repairedProfiles = [...profiles];
    if (!repairedProfiles.includes(activeProfile)) repairedProfiles.push(activeProfile);
    if (legacyPointer) {
      const defaultPointer = await readKeychainValue(
        KEYCHAIN_PROFILE_POINTER_SERVICE,
        KEYCHAIN_ACCOUNT,
        runner,
      );
      if (!defaultPointer) {
        await writeKeychainValue(
          keychainProfilePointerWriteArguments(KEYCHAIN_ACCOUNT, legacyPointer),
          'the migrated FeedbackServer default profile pointer',
          runner,
        );
      }
      if (!repairedProfiles.includes(KEYCHAIN_ACCOUNT)) repairedProfiles.push(KEYCHAIN_ACCOUNT);
    }
    if (repairedProfiles.length !== profiles.length) {
      await writeProfileIndex(repairedProfiles, runner);
    }
    if (legacyPointer) {
      if (!(await deleteKeychainItem(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner))) {
        throw new Error('Unable to finish migrating legacy FeedbackServer credentials');
      }
    }
    return activeProfile;
  }

  const defaultPointer = await readKeychainValue(
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    KEYCHAIN_ACCOUNT,
    runner,
  );
  if (!defaultPointer && !legacyPointer) return undefined;
  if (!defaultPointer && legacyPointer) {
    await writeKeychainValue(
      keychainProfilePointerWriteArguments(KEYCHAIN_ACCOUNT, legacyPointer),
      'the migrated FeedbackServer default profile pointer',
      runner,
    );
  }
  const profiles = await readProfileIndex(runner);
  if (!profiles.includes(KEYCHAIN_ACCOUNT)) {
    await writeProfileIndex([...profiles, KEYCHAIN_ACCOUNT], runner);
  }
  await setActiveProfile(KEYCHAIN_ACCOUNT, runner);
  if (legacyPointer && !(await deleteKeychainItem(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner))) {
    throw new Error('Unable to finish migrating legacy FeedbackServer credentials');
  }
  return KEYCHAIN_ACCOUNT;
}

async function readCredentialPointer(
  service: string,
  account: string,
  runner: SecurityCommandRunner,
): Promise<StoredCredentials | undefined> {
  const pointer = await readKeychainValue(service, account, runner);
  if (!pointer) return undefined;

  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (!recordId.success) return normalizeStoredCredentials(JSON.parse(pointer));

  const [token, metadataValue] = await Promise.all([
    readKeychainValue(KEYCHAIN_TOKEN_SERVICE, recordId.data, runner),
    readKeychainValue(KEYCHAIN_METADATA_SERVICE, recordId.data, runner),
  ]);
  if (!token || !metadataValue) {
    throw new Error('FeedbackServer credentials in Keychain are incomplete');
  }
  const metadata = credentialMetadataSchema.parse(JSON.parse(metadataValue));
  return normalizeStoredCredentials({ ...metadata, token });
}

async function readCredentialTokenIdPointer(
  service: string,
  account: string,
  runner: SecurityCommandRunner,
): Promise<string | undefined> {
  const pointer = await readKeychainValue(service, account, runner);
  if (!pointer) return undefined;

  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (!recordId.success) {
    return normalizeStoredCredentials(JSON.parse(pointer)).tokenId;
  }
  const metadataValue = await readKeychainValue(
    KEYCHAIN_METADATA_SERVICE,
    recordId.data,
    runner,
  );
  if (!metadataValue) {
    throw new Error('FeedbackServer credential metadata in Keychain is incomplete');
  }
  return credentialMetadataSchema.parse(JSON.parse(metadataValue)).tokenId;
}

export async function readKeychainCredentialRecord(
  runner: SecurityCommandRunner,
): Promise<StoredCredentials | undefined> {
  return readCredentialPointer(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);
}

export async function readKeychainCredentials(
  runner: SecurityCommandRunner = runSecurity,
): Promise<StoredCredentials | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const profile = await migrateLegacyDefaultProfile(runner);
  if (!profile) return undefined;
  return readCredentialPointer(KEYCHAIN_PROFILE_POINTER_SERVICE, profile, runner);
}

export async function readKeychainProfileCredentials(
  profile: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<StoredCredentials | undefined> {
  if (process.platform !== 'darwin') return undefined;
  await migrateLegacyDefaultProfile(runner);
  return readCredentialPointer(
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    profileIdSchema.parse(profile),
    runner,
  );
}

export async function readActiveKeychainProfile(
  runner: SecurityCommandRunner = runSecurity,
): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  return migrateLegacyDefaultProfile(runner);
}

export async function listKeychainProfiles(
  runner: SecurityCommandRunner = runSecurity,
): Promise<Array<{ name: string; active: boolean }>> {
  if (process.platform !== 'darwin') return [];
  const active = await migrateLegacyDefaultProfile(runner);
  const profiles = await readProfileIndex(runner);
  return profiles.map((name) => ({ name, active: name === active }));
}

export async function readKeychainReferencedTokenIds(
  runner: SecurityCommandRunner = runSecurity,
): Promise<Set<string>> {
  if (process.platform !== 'darwin') return new Set();
  await migrateLegacyDefaultProfile(runner);
  const profiles = await readProfileIndex(runner);
  const tokenIds = await Promise.all(
    profiles.map((profile) =>
      readCredentialTokenIdPointer(KEYCHAIN_PROFILE_POINTER_SERVICE, profile, runner)),
  );
  return new Set(tokenIds.flatMap((tokenId) => tokenId ? [tokenId] : []));
}

export async function useKeychainProfile(
  profile: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is unavailable on this platform');
  }
  const parsed = profileIdSchema.parse(profile);
  await migrateLegacyDefaultProfile(runner);
  const pointer = await readKeychainValue(KEYCHAIN_PROFILE_POINTER_SERVICE, parsed, runner);
  if (!pointer) throw new Error(`FeedbackServer profile ${parsed} does not exist`);
  await readCredentialPointer(KEYCHAIN_PROFILE_POINTER_SERVICE, parsed, runner);
  await setActiveProfile(parsed, runner);
}

export async function readKeychainPendingTokenRevocations(
  runner: SecurityCommandRunner,
): Promise<PendingTokenRevocation[]> {
  const value = await readKeychainValue(
    KEYCHAIN_PENDING_REVOCATIONS_SERVICE,
    KEYCHAIN_ACCOUNT,
    runner,
  );
  if (!value) return [];
  const ledger = pendingTokenRevocationLedgerSchema.parse(JSON.parse(value));
  return ledger.entries.map((entry) => ({
    ...entry,
    baseUrl: normalizeBaseUrl(entry.baseUrl),
  }));
}

export async function writeKeychainPendingTokenRevocations(
  entries: PendingTokenRevocation[],
  runner: SecurityCommandRunner,
): Promise<void> {
  const normalized = pendingTokenRevocationLedgerSchema.parse({
    version: 1,
    entries: entries.map((entry) => ({
      ...entry,
      baseUrl: normalizeBaseUrl(entry.baseUrl),
    })),
  }).entries;
  if (normalized.length === 0) {
    if (!(await deleteKeychainItem(
      KEYCHAIN_PENDING_REVOCATIONS_SERVICE,
      KEYCHAIN_ACCOUNT,
      runner,
    ))) {
      throw new Error('Unable to clear pending FeedbackServer PAT revocations from Keychain');
    }
    return;
  }
  const result = await runner(keychainPendingRevocationsWriteArguments(normalized));
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to store pending FeedbackServer PAT revocations in Keychain: ${result.stderr.trim()}`,
    );
  }
}

export async function readPendingTokenRevocations(
  runner: SecurityCommandRunner = runSecurity,
): Promise<PendingTokenRevocation[]> {
  if (process.platform !== 'darwin') return [];
  return readKeychainPendingTokenRevocations(runner);
}

export async function readKeychainAdminPassword(
  baseUrl: string,
  username: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<string | undefined> {
  return (await readKeychainAdminPasswordCandidate(baseUrl, username, runner))?.password;
}

export async function readKeychainAdminPasswordCandidate(
  baseUrl: string,
  username: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<KeychainAdminPasswordCandidate | undefined> {
  if (process.platform !== 'darwin') return undefined;
  const scoped = await readKeychainValue(
    KEYCHAIN_ADMIN_PASSWORD_SERVICE,
    keychainAdminPasswordAccount(baseUrl, username),
    runner,
  );
  if (scoped) return { password: scoped, legacy: false };
  const legacy = await readKeychainValue(KEYCHAIN_ADMIN_PASSWORD_SERVICE, username, runner);
  return legacy ? { password: legacy, legacy: true } : undefined;
}

export async function writeKeychainAdminPassword(
  baseUrl: string,
  username: string,
  password: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is unavailable on this platform');
  }
  const result = await runner(
    keychainAdminPasswordWriteArguments(baseUrl, username),
    `${password}\n${password}\n`,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to store FeedbackServer administrator password in Keychain: ${result.stderr.trim()}`,
    );
  }
}

export async function deleteKeychainAdminPassword(
  baseUrl: string,
  username: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') return;
  if (!(await deleteKeychainItem(
    KEYCHAIN_ADMIN_PASSWORD_SERVICE,
    keychainAdminPasswordAccount(baseUrl, username),
    runner,
  ))) {
    throw new Error('Unable to remove FeedbackServer administrator password from Keychain');
  }
}

export async function promoteLegacyKeychainAdminPassword(
  baseUrl: string,
  username: string,
  candidate: KeychainAdminPasswordCandidate,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin' || !candidate.legacy) return;
  await writeKeychainAdminPassword(baseUrl, username, candidate.password, runner);
  if (!(await deleteKeychainItem(KEYCHAIN_ADMIN_PASSWORD_SERVICE, username, runner))) {
    throw new Error('Unable to remove the legacy FeedbackServer administrator password from Keychain');
  }
}

export async function addPendingTokenRevocation(
  entry: PendingTokenRevocation,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is unavailable on this platform');
  }
  const parsed = pendingTokenRevocationSchema.parse({
    ...entry,
    baseUrl: normalizeBaseUrl(entry.baseUrl),
  });
  const current = await readKeychainPendingTokenRevocations(runner);
  const entries = current.filter((candidate) => !(
    candidate.baseUrl === parsed.baseUrl
    && candidate.username === parsed.username
    && candidate.tokenId === parsed.tokenId
    && candidate.profile === parsed.profile
  ));
  entries.push(parsed);
  await writeKeychainPendingTokenRevocations(entries, runner);
}

export async function removePendingTokenRevocation(
  entry: PendingTokenRevocation,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') return;
  const parsed = pendingTokenRevocationSchema.parse({
    ...entry,
    baseUrl: normalizeBaseUrl(entry.baseUrl),
  });
  const current = await readKeychainPendingTokenRevocations(runner);
  await writeKeychainPendingTokenRevocations(
    current.filter((candidate) => !(
      candidate.baseUrl === parsed.baseUrl
      && candidate.username === parsed.username
      && candidate.tokenId === parsed.tokenId
      && candidate.profile === parsed.profile
    )),
    runner,
  );
}

export async function writeKeychainCredentialRecord(
  credentials: StoredCredentials,
  runner: SecurityCommandRunner,
  createRecordId: () => string = randomUUID,
): Promise<void> {
  const parsed = normalizeStoredCredentials(credentials);
  const previousPointer = await readKeychainValue(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);
  const previousRecordId = keychainRecordIdSchema.safeParse(previousPointer);
  const recordId = keychainRecordIdSchema.parse(createRecordId());

  const tokenResult = await runner(
    keychainTokenWriteArguments(recordId),
    `${parsed.token}\n${parsed.token}\n`,
  );
  if (tokenResult.exitCode !== 0) {
    throw new Error(
      `Unable to store FeedbackServer token in Keychain: ${tokenResult.stderr.trim()}`,
    );
  }

  const metadataResult = await runner(keychainMetadataWriteArguments(recordId, parsed));
  if (metadataResult.exitCode !== 0) {
    await deleteKeychainRecord(recordId, runner);
    throw new Error(
      `Unable to store FeedbackServer metadata in Keychain: ${metadataResult.stderr.trim()}`,
    );
  }

  const pointerResult = await runner(keychainPointerWriteArguments(recordId));
  if (pointerResult.exitCode !== 0) {
    await deleteKeychainRecord(recordId, runner);
    throw new Error(
      `Unable to activate FeedbackServer credentials in Keychain: ${pointerResult.stderr.trim()}`,
    );
  }

  if (
    previousRecordId.success &&
    previousRecordId.data !== recordId &&
    !(await deleteKeychainRecord(previousRecordId.data, runner))
  ) {
    console.error('Warning: unable to remove obsolete FeedbackServer Keychain credentials.');
  }
}

export async function writeKeychainCredentials(
  credentials: StoredCredentials,
  runner: SecurityCommandRunner = runSecurity,
  createRecordId: () => string = randomUUID,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is unavailable on this platform');
  }
  const profile = await migrateLegacyDefaultProfile(runner) ?? KEYCHAIN_ACCOUNT;
  await writeKeychainProfileCredentials(credentials, profile, runner, createRecordId);
}

export async function writeKeychainProfileCredentials(
  credentials: StoredCredentials,
  profile: string,
  runner: SecurityCommandRunner = runSecurity,
  createRecordId: () => string = randomUUID,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain is unavailable on this platform');
  }
  const parsedProfile = profileIdSchema.parse(profile);
  await migrateLegacyDefaultProfile(runner);
  const parsed = normalizeStoredCredentials(credentials);
  const profiles = await readProfileIndex(runner);
  const wasIndexed = profiles.includes(parsedProfile);
  if (!wasIndexed && profiles.length >= MAX_KEYCHAIN_PROFILES) {
    throw new Error(
      `FeedbackServer supports at most ${MAX_KEYCHAIN_PROFILES} Keychain profiles; remove one before configuring ${parsedProfile}.`,
    );
  }
  const previousPointer = await readKeychainValue(
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    parsedProfile,
    runner,
  );
  const previousRecordId = keychainRecordIdSchema.safeParse(previousPointer);
  const recordId = keychainRecordIdSchema.parse(createRecordId());

  const tokenResult = await runner(
    keychainTokenWriteArguments(recordId),
    `${parsed.token}\n${parsed.token}\n`,
  );
  if (tokenResult.exitCode !== 0) {
    throw new Error(`Unable to store FeedbackServer token in Keychain: ${tokenResult.stderr.trim()}`);
  }
  const metadataResult = await runner(keychainMetadataWriteArguments(recordId, parsed));
  if (metadataResult.exitCode !== 0) {
    await deleteKeychainRecord(recordId, runner);
    throw new Error(
      `Unable to store FeedbackServer metadata in Keychain: ${metadataResult.stderr.trim()}`,
    );
  }
  const pointerResult = await runner(
    keychainProfilePointerWriteArguments(parsedProfile, recordId),
  );
  if (pointerResult.exitCode !== 0) {
    await deleteKeychainRecord(recordId, runner);
    throw new Error(
      `Unable to activate FeedbackServer profile ${parsedProfile} in Keychain: ${pointerResult.stderr.trim()}`,
    );
  }

  try {
    if (!wasIndexed) await writeProfileIndex([...profiles, parsedProfile], runner);
    await setActiveProfile(parsedProfile, runner);
  } catch (error) {
    const rollbackErrors: unknown[] = [error];
    let pointerMovedAwayFromRecord = false;
    try {
      if (previousPointer) {
        await writeKeychainValue(
          keychainProfilePointerWriteArguments(parsedProfile, previousPointer),
          `the previous FeedbackServer profile ${parsedProfile}`,
          runner,
        );
        pointerMovedAwayFromRecord = true;
      } else if (!(await deleteKeychainItem(
        KEYCHAIN_PROFILE_POINTER_SERVICE,
        parsedProfile,
        runner,
      ))) {
        throw new Error(`Unable to remove the incomplete FeedbackServer profile ${parsedProfile}`);
      } else {
        pointerMovedAwayFromRecord = true;
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (pointerMovedAwayFromRecord && !wasIndexed) {
      try {
        await writeProfileIndex(profiles, runner);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (pointerMovedAwayFromRecord && !(await deleteKeychainRecord(recordId, runner))) {
      rollbackErrors.push(new Error('Unable to remove the uncommitted FeedbackServer credential record'));
    }
    throw rollbackErrors.length === 1
      ? error
      : new AggregateError(
          rollbackErrors,
          `Unable to commit FeedbackServer profile ${parsedProfile}; rollback was incomplete`,
        );
  }

  if (
    previousRecordId.success
    && previousRecordId.data !== recordId
    && !(await deleteKeychainRecord(previousRecordId.data, runner))
  ) {
    console.error('Warning: unable to remove obsolete FeedbackServer Keychain credentials.');
  }
}

export async function deleteKeychainCredentialRecord(
  runner: SecurityCommandRunner,
): Promise<void> {
  const pointer = await readKeychainValue(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);
  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (recordId.success && !(await deleteKeychainRecord(recordId.data, runner))) {
    throw new Error('Unable to remove one or more FeedbackServer credentials from Keychain');
  }
  if (!(await deleteKeychainItem(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner))) {
    throw new Error('Unable to remove one or more FeedbackServer credentials from Keychain');
  }
}

export async function resumeKeychainCredentialRecordCleanup(
  runner: SecurityCommandRunner,
): Promise<boolean> {
  const pointer = await readKeychainValue(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);
  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (!recordId.success) return false;

  const [token, metadata] = await Promise.all([
    readKeychainValue(KEYCHAIN_TOKEN_SERVICE, recordId.data, runner),
    readKeychainValue(KEYCHAIN_METADATA_SERVICE, recordId.data, runner),
  ]);
  if (token && metadata) return false;
  if (token && !metadata) {
    throw new Error('FeedbackServer credentials in Keychain require manual repair');
  }
  await deleteKeychainCredentialRecord(runner);
  return true;
}

export async function deleteKeychainCredentials(
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') return;
  const profile = await migrateLegacyDefaultProfile(runner);
  if (!profile) return;
  await deleteKeychainProfileCredentials(profile, runner);
}

export async function deleteKeychainProfileCredentials(
  profile: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<void> {
  if (process.platform !== 'darwin') return;
  const parsedProfile = profileIdSchema.parse(profile);
  await migrateLegacyDefaultProfile(runner);
  const pointer = await readKeychainValue(
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    parsedProfile,
    runner,
  );
  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (recordId.success && !(await deleteKeychainRecord(recordId.data, runner))) {
    throw new Error('Unable to remove one or more FeedbackServer credentials from Keychain');
  }
  if (!(await deleteKeychainItem(KEYCHAIN_PROFILE_POINTER_SERVICE, parsedProfile, runner))) {
    throw new Error('Unable to remove the FeedbackServer profile pointer from Keychain');
  }

  const profiles = (await readProfileIndex(runner)).filter((name) => name !== parsedProfile);
  await writeProfileIndex(profiles, runner);
  const active = await readKeychainValue(
    KEYCHAIN_ACTIVE_PROFILE_SERVICE,
    KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
    runner,
  );
  if (active === parsedProfile) {
    const next = profiles.includes(KEYCHAIN_ACCOUNT) ? KEYCHAIN_ACCOUNT : profiles[0];
    if (next) await setActiveProfile(next, runner);
    else if (!(await deleteKeychainItem(
      KEYCHAIN_ACTIVE_PROFILE_SERVICE,
      KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
      runner,
    ))) {
      throw new Error('Unable to clear the active FeedbackServer profile from Keychain');
    }
  }
}

export async function resumeKeychainCredentialCleanup(
  runner: SecurityCommandRunner = runSecurity,
): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  const profile = await migrateLegacyDefaultProfile(runner);
  if (!profile) return false;
  return resumeKeychainProfileCredentialCleanup(profile, runner);
}

export async function resumeKeychainProfileCredentialCleanup(
  profile: string,
  runner: SecurityCommandRunner = runSecurity,
): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  const parsedProfile = profileIdSchema.parse(profile);
  await migrateLegacyDefaultProfile(runner);
  const pointer = await readKeychainValue(
    KEYCHAIN_PROFILE_POINTER_SERVICE,
    parsedProfile,
    runner,
  );
  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (!recordId.success) return false;
  const [token, metadata] = await Promise.all([
    readKeychainValue(KEYCHAIN_TOKEN_SERVICE, recordId.data, runner),
    readKeychainValue(KEYCHAIN_METADATA_SERVICE, recordId.data, runner),
  ]);
  if (token && metadata) return false;
  if (token && !metadata) {
    throw new Error('FeedbackServer credentials in Keychain require manual repair');
  }
  await deleteKeychainProfileCredentials(parsedProfile, runner);
  return true;
}

export async function loadCredentialsWithSource(
  environment: NodeJS.ProcessEnv = process.env,
  runner: SecurityCommandRunner = runSecurity,
): Promise<LoadedCredentials> {
  const environmentBaseUrl = environment.FEEDBACK_SERVER_BASE_URL;
  const environmentToken = environment.FEEDBACK_SERVER_API_TOKEN;
  if (environmentBaseUrl || environmentToken) {
    if (!environmentBaseUrl || !environmentToken) {
      throw new Error(
        'FEEDBACK_SERVER_BASE_URL and FEEDBACK_SERVER_API_TOKEN must be set together',
      );
    }
    return {
      credentials: credentialSchema.parse({
        baseUrl: normalizeBaseUrl(environmentBaseUrl),
        token: environmentToken,
      }),
      credentialSource: 'environment',
      activeProfile: null,
    };
  }
  const activeProfile = await readActiveKeychainProfile(runner);
  const stored = await readKeychainCredentials(runner);
  if (!stored) {
    throw new Error(
      'FeedbackServer Agent is not configured. Run feedback-server agent configure in a trusted terminal.',
    );
  }
  return {
    credentials: {
      ...stored,
      baseUrl: normalizeBaseUrl(stored.baseUrl),
    },
    credentialSource: 'keychain',
    activeProfile: activeProfile ?? KEYCHAIN_ACCOUNT,
  };
}

export async function loadCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  return (await loadCredentialsWithSource(environment)).credentials;
}
