import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_BASE_URL = 'https://feedbackserver.rote.ink/v1/api';
export const KEYCHAIN_SERVICE = 'dev.rote.feedback-server.mcp';
export const KEYCHAIN_ACCOUNT = 'default';
export const KEYCHAIN_TOKEN_SERVICE = `${KEYCHAIN_SERVICE}.token`;
export const KEYCHAIN_METADATA_SERVICE = `${KEYCHAIN_SERVICE}.metadata`;
export const SECURITY_EXECUTABLE = '/usr/bin/security';

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

export type StoredCredentials = z.infer<typeof credentialSchema>;
export type SecurityCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
export type SecurityCommandRunner = (
  args: string[],
  input?: string,
) => Promise<SecurityCommandResult>;

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/v1/api')) {
    url.pathname = `${url.pathname}/v1/api`.replaceAll('//', '/');
  }
  return url.toString().replace(/\/+$/, '');
}

async function runSecurity(
  args: string[],
  input?: string,
): Promise<SecurityCommandResult> {
  const subprocess = Bun.spawn({
    cmd: [SECURITY_EXECUTABLE, ...args],
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

function keychainReadArguments(service: string, account: string): string[] {
  return ['find-generic-password', '-a', account, '-s', service, '-w'];
}

function keychainDeleteArguments(service: string, account: string): string[] {
  return ['delete-generic-password', '-a', account, '-s', service];
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

export async function readKeychainCredentialRecord(
  runner: SecurityCommandRunner,
): Promise<StoredCredentials | undefined> {
  const pointer = await readKeychainValue(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, runner);
  if (!pointer) return undefined;

  const recordId = keychainRecordIdSchema.safeParse(pointer);
  if (!recordId.success) {
    return credentialSchema.parse(JSON.parse(pointer));
  }

  const [token, metadataValue] = await Promise.all([
    readKeychainValue(KEYCHAIN_TOKEN_SERVICE, recordId.data, runner),
    readKeychainValue(KEYCHAIN_METADATA_SERVICE, recordId.data, runner),
  ]);
  if (!token || !metadataValue) {
    throw new Error('FeedbackServer credentials in Keychain are incomplete');
  }
  const metadata = credentialMetadataSchema.parse(JSON.parse(metadataValue));
  return credentialSchema.parse({ ...metadata, token });
}

export async function readKeychainCredentials(
  runner: SecurityCommandRunner = runSecurity,
): Promise<StoredCredentials | undefined> {
  if (process.platform !== 'darwin') return undefined;
  return readKeychainCredentialRecord(runner);
}

export async function writeKeychainCredentialRecord(
  credentials: StoredCredentials,
  runner: SecurityCommandRunner,
  createRecordId: () => string = randomUUID,
): Promise<void> {
  const parsed = credentialSchema.parse(credentials);
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
  await writeKeychainCredentialRecord(credentials, runner, createRecordId);
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
  await deleteKeychainCredentialRecord(runner);
}

export async function resumeKeychainCredentialCleanup(
  runner: SecurityCommandRunner = runSecurity,
): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  return resumeKeychainCredentialRecordCleanup(runner);
}

export async function loadCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  const environmentBaseUrl = environment.FEEDBACK_SERVER_BASE_URL;
  const environmentToken = environment.FEEDBACK_SERVER_API_TOKEN;
  if (environmentBaseUrl || environmentToken) {
    if (!environmentBaseUrl || !environmentToken) {
      throw new Error(
        'FEEDBACK_SERVER_BASE_URL and FEEDBACK_SERVER_API_TOKEN must be set together',
      );
    }
    return credentialSchema.parse({
      baseUrl: normalizeBaseUrl(environmentBaseUrl),
      token: environmentToken,
    });
  }
  const stored = await readKeychainCredentials();
  if (!stored) {
    throw new Error(
      'FeedbackServer Agent is not configured. Run bun run agent:configure in the FeedbackServer-Codex repository.',
    );
  }
  return {
    ...stored,
    baseUrl: normalizeBaseUrl(stored.baseUrl),
  };
}
