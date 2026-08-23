import { describe, expect, test } from 'bun:test';
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_ACTIVE_PROFILE_ACCOUNT,
  KEYCHAIN_ACTIVE_PROFILE_SERVICE,
  KEYCHAIN_METADATA_SERVICE,
  KEYCHAIN_PROFILE_INDEX_SERVICE,
  KEYCHAIN_PROFILE_POINTER_SERVICE,
  KEYCHAIN_SERVICE,
  KEYCHAIN_TOKEN_SERVICE,
  deleteKeychainProfileCredentials,
  listKeychainProfiles,
  loadCredentialsWithSource,
  profileIdSchema,
  readKeychainCredentials,
  readKeychainProfileCredentials,
  useKeychainProfile,
  writeKeychainProfileCredentials,
  type SecurityCommandRunner,
  type StoredCredentials,
} from '../src/credentials.js';

const firstRecordId = '11111111-1111-4111-8111-111111111111';
const secondRecordId = '22222222-2222-4222-8222-222222222222';
const firstToken = `fspat_${'a'.repeat(64)}`;
const secondToken = `fspat_${'b'.repeat(64)}`;

function key(service: string, account: string): string {
  return `${service}\u0000${account}`;
}

function memoryKeychain(initial: Record<string, string> = {}): {
  items: Map<string, string>;
  calls: Array<{ args: string[]; input?: string }>;
  runner: SecurityCommandRunner;
  failNext: (predicate: (args: string[]) => boolean) => void;
} {
  const items = new Map(Object.entries(initial));
  const calls: Array<{ args: string[]; input?: string }> = [];
  let failure: ((args: string[]) => boolean) | undefined;
  return {
    items,
    calls,
    failNext(predicate) {
      failure = predicate;
    },
    runner(args, input) {
      calls.push({ args, ...(input === undefined ? {} : { input }) });
      if (failure?.(args)) {
        failure = undefined;
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'simulated interruption' });
      }
      const account = args[args.indexOf('-a') + 1] ?? '';
      const service = args[args.indexOf('-s') + 1] ?? '';
      const itemKey = key(service, account);
      if (args[0] === 'find-generic-password') {
        const value = items.get(itemKey);
        return Promise.resolve(value === undefined
          ? { exitCode: 44, stdout: '', stderr: 'The specified item could not be found.' }
          : { exitCode: 0, stdout: value, stderr: '' });
      }
      if (args[0] === 'delete-generic-password') {
        const existed = items.delete(itemKey);
        return Promise.resolve(existed
          ? { exitCode: 0, stdout: '', stderr: '' }
          : { exitCode: 44, stdout: '', stderr: 'The specified item could not be found.' });
      }
      if (args[0] === 'add-generic-password') {
        const encodedIndex = args.indexOf('-X');
        const value = encodedIndex >= 0
          ? Buffer.from(args[encodedIndex + 1] ?? '', 'hex').toString('utf8')
          : (input ?? '').split('\n')[0] ?? '';
        items.set(itemKey, value);
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      }
      return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'unsupported test command' });
    },
  };
}

async function withDarwin<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    return await operation();
  } finally {
    Object.defineProperty(process, 'platform', { value: previous });
  }
}

function metadata(credentials: StoredCredentials): string {
  return JSON.stringify({ version: 1, ...credentials, token: undefined });
}

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('global named profiles', () => {
  test('migrates the legacy default pointer without writing or rotating a PAT', async () => {
    await withDarwin(async () => {
      const credentials: StoredCredentials = {
        baseUrl: 'https://feedback.example.com/v1/api',
        token: firstToken,
        tokenId: secondRecordId,
        username: 'owner',
      };
      const keychain = memoryKeychain({
        [key(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)]: firstRecordId,
        [key(KEYCHAIN_TOKEN_SERVICE, firstRecordId)]: firstToken,
        [key(KEYCHAIN_METADATA_SERVICE, firstRecordId)]: metadata(credentials),
      });

      expect(await readKeychainCredentials(keychain.runner)).toEqual(credentials);
      expect(keychain.items.get(key(KEYCHAIN_PROFILE_POINTER_SERVICE, 'default'))).toBe(firstRecordId);
      expect(keychain.items.get(key(KEYCHAIN_ACTIVE_PROFILE_SERVICE, KEYCHAIN_ACTIVE_PROFILE_ACCOUNT))).toBe('default');
      expect(JSON.parse(keychain.items.get(key(KEYCHAIN_PROFILE_INDEX_SERVICE, KEYCHAIN_ACCOUNT)) ?? '{}')).toEqual({
        version: 1,
        profiles: ['default'],
      });
      expect(keychain.items.has(key(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))).toBe(false);
      expect(
        keychain.calls.some(({ args }) =>
          args[0] === 'add-generic-password' && args.includes(KEYCHAIN_TOKEN_SERVICE)),
      ).toBe(false);
    });
  });

  test('resumes an interrupted legacy pointer migration on the next read', async () => {
    await withDarwin(async () => {
      const credentials: StoredCredentials = {
        baseUrl: 'https://feedback.example.com/v1/api',
        token: firstToken,
        username: 'owner',
      };
      const keychain = memoryKeychain({
        [key(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)]: firstRecordId,
        [key(KEYCHAIN_TOKEN_SERVICE, firstRecordId)]: firstToken,
        [key(KEYCHAIN_METADATA_SERVICE, firstRecordId)]: metadata(credentials),
      });
      keychain.failNext((args) =>
        args[0] === 'add-generic-password' && args.includes(KEYCHAIN_ACTIVE_PROFILE_SERVICE));

      expect(await capturedError(readKeychainCredentials(keychain.runner))).toMatchObject({
        message: expect.stringContaining('active FeedbackServer profile'),
      });
      expect(keychain.items.get(key(KEYCHAIN_PROFILE_POINTER_SERVICE, 'default'))).toBe(firstRecordId);
      expect(keychain.items.has(key(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))).toBe(true);

      expect(await readKeychainCredentials(keychain.runner)).toEqual(credentials);
      expect(keychain.items.has(key(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))).toBe(false);
    });
  });

  test('switches, lists, reads, and removes profiles through shared Keychain pointers', async () => {
    await withDarwin(async () => {
      const keychain = memoryKeychain();
      await writeKeychainProfileCredentials(
        { baseUrl: 'https://first.example.com/v1/api', token: firstToken, username: 'first' },
        'first',
        keychain.runner,
        () => firstRecordId,
      );
      await writeKeychainProfileCredentials(
        { baseUrl: 'https://second.example.com/v1/api', token: secondToken, username: 'second' },
        'second',
        keychain.runner,
        () => secondRecordId,
      );

      expect(await listKeychainProfiles(keychain.runner)).toEqual([
        { name: 'first', active: false },
        { name: 'second', active: true },
      ]);
      await useKeychainProfile('first', keychain.runner);
      expect((await readKeychainCredentials(keychain.runner))?.username).toBe('first');
      expect((await readKeychainProfileCredentials('second', keychain.runner))?.username).toBe('second');

      await deleteKeychainProfileCredentials('second', keychain.runner);
      expect(await listKeychainProfiles(keychain.runner)).toEqual([{ name: 'first', active: true }]);
      expect(keychain.items.has(key(KEYCHAIN_TOKEN_SERVICE, secondRecordId))).toBe(false);
    });
  });

  test('reports environment override without an active Keychain profile', async () => {
    const loaded = await loadCredentialsWithSource({
      FEEDBACK_SERVER_BASE_URL: 'https://environment.example.com',
      FEEDBACK_SERVER_API_TOKEN: firstToken,
    });
    expect(loaded).toMatchObject({
      credentialSource: 'environment',
      activeProfile: null,
      credentials: { baseUrl: 'https://environment.example.com/v1/api', token: firstToken },
    });
  });

  test('reports the active profile for Keychain credentials', async () => {
    await withDarwin(async () => {
      const keychain = memoryKeychain();
      await writeKeychainProfileCredentials(
        { baseUrl: 'https://work.example.com/v1/api', token: firstToken, username: 'owner' },
        'work',
        keychain.runner,
        () => firstRecordId,
      );
      const loaded = await loadCredentialsWithSource({}, keychain.runner);
      expect(loaded).toMatchObject({
        credentialSource: 'keychain',
        activeProfile: 'work',
        credentials: { username: 'owner', token: firstToken },
      });
    });
  });

  test('accepts only the documented 1-40 character profile ID format', () => {
    expect(profileIdSchema.parse('team.production_1')).toBe('team.production_1');
    for (const invalid of ['', 'UPPER', 'has space', 'a'.repeat(41), 'slash/name']) {
      expect(profileIdSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
