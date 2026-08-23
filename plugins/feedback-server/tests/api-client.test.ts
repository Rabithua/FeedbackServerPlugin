import { describe, expect, test } from 'bun:test';
import {
  FeedbackServerApiClient,
  FeedbackServerApiError,
} from '../src/api-client.js';
import {
  DEFAULT_BASE_URL,
  KEYCHAIN_ADMIN_PASSWORD_SERVICE,
  KEYCHAIN_METADATA_SERVICE,
  KEYCHAIN_PENDING_REVOCATIONS_SERVICE,
  KEYCHAIN_SERVICE,
  KEYCHAIN_TOKEN_SERVICE,
  LEGACY_DEFAULT_BASE_URL,
  SECURITY_EXECUTABLE,
  SECURITY_EXECUTABLE_FALLBACK,
  SECURITY_SHELL_EXECUTABLE,
  deleteKeychainCredentialRecord,
  deleteKeychainAdminPassword,
  keychainAdminPasswordAccount,
  keychainAdminPasswordWriteArguments,
  loadCredentials,
  normalizeBaseUrl,
  promoteLegacyKeychainAdminPassword,
  readKeychainAdminPassword,
  readKeychainAdminPasswordCandidate,
  readKeychainCredentialRecord,
  readKeychainPendingTokenRevocations,
  resumeKeychainCredentialRecordCleanup,
  securityCommandCandidates,
  writeKeychainAdminPassword,
  writeKeychainPendingTokenRevocations,
  writeKeychainCredentialRecord,
  type SecurityCommandRunner,
} from '../src/credentials.js';

const token = `fspat_${'a'.repeat(64)}`;

async function withPlatform<T>(platform: NodeJS.Platform, operation: () => Promise<T>): Promise<T> {
  const previousPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await operation();
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform });
  }
}

describe('credentials and API client', () => {
  test('uses the absolute macOS Keychain executable in restricted MCP environments', () => {
    expect(SECURITY_EXECUTABLE).toBe('/usr/bin/security');
  });

  test('keeps PATH and shell Keychain fallbacks for sandboxed MCP runtimes', () => {
    const candidates = securityCommandCandidates(
      ['find-generic-password', '-s', KEYCHAIN_SERVICE],
      { FEEDBACK_SERVER_SECURITY_EXECUTABLE: '/custom/security' },
    );
    expect(candidates).toContainEqual([
      '/custom/security',
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    expect(candidates).toContainEqual([
      SECURITY_EXECUTABLE,
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    expect(candidates).toContainEqual([
      SECURITY_EXECUTABLE_FALLBACK,
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    expect(candidates.at(-1)).toEqual([
      SECURITY_SHELL_EXECUTABLE,
      '-lc',
      'exec security "$@"',
      'security',
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
  });

  test('normalizes API roots and requires paired environment credentials', async () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.feedkit.cn/v1/api');
    expect(normalizeBaseUrl(LEGACY_DEFAULT_BASE_URL)).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('https://feedback.example.com/')).toBe(
      'https://feedback.example.com/v1/api',
    );
    expect(normalizeBaseUrl('https://feedback.example.com/v1/api/')).toBe(
      'https://feedback.example.com/v1/api',
    );
    let credentialError: unknown;
    try {
      await loadCredentials({
        FEEDBACK_SERVER_BASE_URL: 'https://feedback.example.com',
      });
    } catch (error) {
      credentialError = error;
    }
    expect(credentialError).toBeInstanceOf(Error);
    expect((credentialError as Error).message).toContain('must be set together');
    expect(
      await loadCredentials({
        FEEDBACK_SERVER_BASE_URL: 'https://feedback.example.com',
        FEEDBACK_SERVER_API_TOKEN: token,
      }),
    ).toMatchObject({
      baseUrl: 'https://feedback.example.com/v1/api',
      token,
    });
  });

  test('requires HTTPS except for exact loopback development hosts', () => {
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000/v1/api');
    expect(normalizeBaseUrl('http://127.0.0.1:3000/api')).toBe(
      'http://127.0.0.1:3000/api/v1/api',
    );
    expect(normalizeBaseUrl('http://[::1]:3000')).toBe('http://[::1]:3000/v1/api');
    expect(() => normalizeBaseUrl('http://feedback.example.com')).toThrow('must use HTTPS');
    expect(() => normalizeBaseUrl('http://localhost.example.com')).toThrow('must use HTTPS');
    expect(() => normalizeBaseUrl('ftp://localhost')).toThrow('must use HTTPS');
    const userInformationUrl = `https://${['user', 'password'].join(':')}@feedback.example.com`;
    expect(() => normalizeBaseUrl(userInformationUrl)).toThrow(
      'must not include user information',
    );
  });

  test('stores only non-secret pending revocation metadata in a separate Keychain item', async () => {
    const entries = [{
      baseUrl: 'https://feedback.example.com/v1/api',
      username: 'owner',
      tokenId: '11111111-1111-4111-8111-111111111111',
    }];
    let stored = '';
    const runner: SecurityCommandRunner = (args) => {
      if (args[0] === 'find-generic-password') {
        return Promise.resolve({
          exitCode: stored ? 0 : 44,
          stdout: stored,
          stderr: stored ? '' : 'The specified item could not be found.',
        });
      }
      expect(args).toContain(KEYCHAIN_PENDING_REVOCATIONS_SERVICE);
      const encoded = args[args.indexOf('-X') + 1];
      stored = Buffer.from(encoded!, 'hex').toString('utf8');
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    };

    await writeKeychainPendingTokenRevocations(entries, runner);
    expect(stored).not.toContain('fspat_');
    expect(stored).not.toContain('password');
    expect(await readKeychainPendingTokenRevocations(runner)).toEqual(entries);
  });

  test('addresses administrator passwords by canonical server origin and username', () => {
    expect(keychainAdminPasswordAccount('https://feedback.example.com', 'owner')).toBe(
      'https://feedback.example.com|owner',
    );
    expect(
      keychainAdminPasswordWriteArguments('https://feedback.example.com/v1/api/', 'owner'),
    ).toEqual([
      'add-generic-password',
      '-U',
      '-a',
      'https://feedback.example.com|owner',
      '-s',
      KEYCHAIN_ADMIN_PASSWORD_SERVICE,
      '-l',
      'FeedbackServer administrator password for owner at https://feedback.example.com',
      '-w',
    ]);
  });

  test('keeps the administrator password out of Keychain process arguments', async () => {
    await withPlatform('darwin', async () => {
      const calls: { args: string[]; input?: string }[] = [];
      const runner: SecurityCommandRunner = (args, input) => {
        calls.push({ args, ...(input === undefined ? {} : { input }) });
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      };
      const password = 'secret administrator password';
      await writeKeychainAdminPassword('https://feedback.example.com', 'owner', password, runner);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.join(' ')).not.toContain(password);
      expect(calls[0]?.args).toContain(KEYCHAIN_ADMIN_PASSWORD_SERVICE);
      expect(calls[0]?.input).toBe(`${password}\n${password}\n`);
    });
  });

  test('reads and deletes administrator passwords through the canonical Keychain item', async () => {
    await withPlatform('darwin', async () => {
      const calls: string[][] = [];
      const runner: SecurityCommandRunner = (args) => {
        calls.push(args);
        if (args[0] === 'find-generic-password') {
          return Promise.resolve({ exitCode: 0, stdout: 'stored-password\n', stderr: '' });
        }
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      };
      expect(await readKeychainAdminPassword('https://feedback.example.com', 'owner', runner))
        .toBe('stored-password');
      await deleteKeychainAdminPassword('https://feedback.example.com', 'owner', runner);
      expect(calls[0]).toEqual([
        'find-generic-password',
        '-a',
        'https://feedback.example.com|owner',
        '-s',
        KEYCHAIN_ADMIN_PASSWORD_SERVICE,
        '-w',
      ]);
      expect(calls[1]).toEqual([
        'delete-generic-password',
        '-a',
        'https://feedback.example.com|owner',
        '-s',
        KEYCHAIN_ADMIN_PASSWORD_SERVICE,
      ]);
    });
  });

  test('promotes a legacy username-only password only after its caller verifies it', async () => {
    await withPlatform('darwin', async () => {
      const calls: { args: string[]; input?: string }[] = [];
      const runner: SecurityCommandRunner = (args, input) => {
        calls.push({ args, ...(input === undefined ? {} : { input }) });
        if (args[0] === 'find-generic-password') {
          const account = args[args.indexOf('-a') + 1];
          return Promise.resolve(account === 'owner'
            ? { exitCode: 0, stdout: 'legacy-password\n', stderr: '' }
            : { exitCode: 44, stdout: '', stderr: 'The specified item could not be found.' });
        }
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      };

      const candidate = await readKeychainAdminPasswordCandidate(
        'https://feedback.example.com/v1/api',
        'owner',
        runner,
      );
      expect(candidate).toEqual({ password: 'legacy-password', legacy: true });
      expect(calls.map(({ args }) => args[0])).toEqual([
        'find-generic-password',
        'find-generic-password',
      ]);

      await promoteLegacyKeychainAdminPassword(
        'https://feedback.example.com/v1/api',
        'owner',
        candidate!,
        runner,
      );
      const write = calls.find(({ args }) => args[0] === 'add-generic-password');
      expect(write?.args).toContain('https://feedback.example.com|owner');
      expect(write?.input).toBe('legacy-password\nlegacy-password\n');
      const deletion = calls.find(({ args }) => args[0] === 'delete-generic-password');
      expect(deletion?.args).toContain('owner');
    });
  });

  test('keeps the PAT out of Keychain process arguments and command output', async () => {
    const credentials = {
      baseUrl: 'https://feedback.example.com/v1/api',
      token,
      tokenId: '11111111-1111-4111-8111-111111111111',
      pendingRevocationTokenIds: ['33333333-3333-4333-8333-333333333333'],
      username: 'owner',
      scopes: ['products:read', 'feedback:read'],
      expiresAt: '2027-07-29T00:00:00.000Z',
    };
    const recordId = '22222222-2222-4222-8222-222222222222';
    const calls: {
      args: string[];
      input?: string;
      result: { exitCode: number; stdout: string; stderr: string };
    }[] = [];
    const runner: SecurityCommandRunner = (args, input) => {
      const result = args[0] === 'find-generic-password'
        ? { exitCode: 44, stdout: '', stderr: 'The specified item could not be found.' }
        : { exitCode: 0, stdout: 'Keychain command completed', stderr: '' };
      calls.push({ args, ...(input === undefined ? {} : { input }), result });
      return Promise.resolve(result);
    };

    await writeKeychainCredentialRecord(credentials, runner, () => recordId);

    expect(calls.flatMap(({ args }) => args).join(' ')).not.toContain(token);
    expect(
      JSON.stringify(calls.map(({ args, result }) => ({ args, result }))),
    ).not.toContain(token);
    const tokenCall = calls.find(({ args }) => args.includes(KEYCHAIN_TOKEN_SERVICE));
    expect(tokenCall?.args.at(-1)).toBe('-w');
    expect(tokenCall?.input).toBe(`${token}\n${token}\n`);
    expect(calls.filter(({ input }) => input?.includes(token))).toHaveLength(1);

    const metadataCall = calls.find(({ args }) => args.includes(KEYCHAIN_METADATA_SERVICE));
    const encodedMetadata = metadataCall?.args[metadataCall.args.indexOf('-X') + 1];
    const metadata = Buffer.from(encodedMetadata!, 'hex').toString('utf8');
    expect(metadata).not.toContain(token);
    expect(JSON.parse(metadata)).toEqual({
      version: 1,
      baseUrl: credentials.baseUrl,
      tokenId: credentials.tokenId,
      pendingRevocationTokenIds: credentials.pendingRevocationTokenIds,
      username: credentials.username,
      scopes: credentials.scopes,
      expiresAt: credentials.expiresAt,
    });
  });

  test('continues to read the combined legacy Keychain credential record', async () => {
    const credentials = {
      baseUrl: 'https://feedback.example.com/v1/api',
      token,
      tokenId: '11111111-1111-4111-8111-111111111111',
      username: 'owner',
      scopes: ['products:read'],
      expiresAt: '2027-07-29T00:00:00.000Z',
    };
    const runner: SecurityCommandRunner = () => Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify(credentials),
      stderr: '',
    });
    expect(await readKeychainCredentialRecord(runner)).toEqual(
      credentials,
    );
  });

  test('migrates the legacy production URL when reading Keychain credentials', async () => {
    const credentials = {
      baseUrl: LEGACY_DEFAULT_BASE_URL,
      token,
      username: 'owner',
    };
    const runner: SecurityCommandRunner = () => Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify(credentials),
      stderr: '',
    });
    expect(await readKeychainCredentialRecord(runner)).toEqual({
      ...credentials,
      baseUrl: DEFAULT_BASE_URL,
    });
  });

  test('reassembles split Keychain records without putting the PAT in metadata', async () => {
    const recordId = '33333333-3333-4333-8333-333333333333';
    const credentials = {
      baseUrl: 'https://feedback.example.com/v1/api',
      token,
      tokenId: '11111111-1111-4111-8111-111111111111',
      username: 'owner',
      scopes: ['products:read'],
      expiresAt: '2027-07-29T00:00:00.000Z',
    };
    const runner: SecurityCommandRunner = (args) => {
      const service = args[args.indexOf('-s') + 1];
      const stdout = service === KEYCHAIN_TOKEN_SERVICE
        ? token
        : service === KEYCHAIN_METADATA_SERVICE
          ? JSON.stringify({
              version: 1,
              baseUrl: credentials.baseUrl,
              tokenId: credentials.tokenId,
              username: credentials.username,
              scopes: credentials.scopes,
              expiresAt: credentials.expiresAt,
            })
          : recordId;
      return Promise.resolve({ exitCode: 0, stdout, stderr: '' });
    };
    expect(await readKeychainCredentialRecord(runner)).toEqual(credentials);
  });

  test('does not replace the active pointer when a split record write fails', async () => {
    const oldRecordId = '44444444-4444-4444-8444-444444444444';
    const newRecordId = '55555555-5555-4555-8555-555555555555';
    const calls: string[][] = [];
    const runner: SecurityCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === 'find-generic-password') {
        return Promise.resolve({ exitCode: 0, stdout: oldRecordId, stderr: '' });
      }
      if (args[0] === 'add-generic-password' && args.includes(KEYCHAIN_METADATA_SERVICE)) {
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'simulated failure' });
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    };
    let writeError: unknown;
    try {
      await writeKeychainCredentialRecord(
        {
          baseUrl: 'https://feedback.example.com/v1/api',
          token,
        },
        runner,
        () => newRecordId,
      );
    } catch (error) {
      writeError = error;
    }
    expect(writeError).toBeInstanceOf(Error);
    expect((writeError as Error).message).toContain(
      'Unable to store FeedbackServer metadata',
    );
    expect(
      calls.some(
        (args) =>
          args[0] === 'add-generic-password' &&
          args.includes(KEYCHAIN_SERVICE),
      ),
    ).toBe(false);
  });

  test('keeps the active pointer when split record deletion needs a retry', async () => {
    const recordId = '66666666-6666-4666-8666-666666666666';
    const calls: string[][] = [];
    let tokenDeleteAttempts = 0;
    const runner: SecurityCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === 'find-generic-password') {
        return Promise.resolve({ exitCode: 0, stdout: recordId, stderr: '' });
      }
      if (
        args[0] === 'delete-generic-password' &&
        args.includes(KEYCHAIN_TOKEN_SERVICE)
      ) {
        tokenDeleteAttempts += 1;
        if (tokenDeleteAttempts === 1) {
          return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'simulated failure' });
        }
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    };
    let deleteError: unknown;
    try {
      await deleteKeychainCredentialRecord(runner);
    } catch (error) {
      deleteError = error;
    }
    expect(deleteError).toBeInstanceOf(Error);
    expect(
      calls.some(
        (args) =>
          args[0] === 'delete-generic-password' &&
          args.includes(KEYCHAIN_SERVICE),
      ),
    ).toBe(false);
    await deleteKeychainCredentialRecord(runner);
    expect(
      calls.filter(
        (args) =>
          args[0] === 'delete-generic-password' &&
          args.includes(KEYCHAIN_SERVICE),
      ),
    ).toHaveLength(1);
  });

  test('resumes cleanup when the token is gone but metadata and pointer remain', async () => {
    const recordId = '77777777-7777-4777-8777-777777777777';
    const calls: string[][] = [];
    const runner: SecurityCommandRunner = (args) => {
      calls.push(args);
      const service = args[args.indexOf('-s') + 1];
      if (args[0] === 'find-generic-password') {
        if (service === KEYCHAIN_SERVICE) {
          return Promise.resolve({ exitCode: 0, stdout: recordId, stderr: '' });
        }
        if (service === KEYCHAIN_TOKEN_SERVICE) {
          return Promise.resolve({
            exitCode: 44,
            stdout: '',
            stderr: 'The specified item could not be found.',
          });
        }
        return Promise.resolve({ exitCode: 0, stdout: '{"version":1}', stderr: '' });
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    };
    expect(await resumeKeychainCredentialRecordCleanup(runner)).toBe(true);
    expect(
      calls.filter(
        (args) =>
          args[0] === 'delete-generic-password' &&
          args.includes(KEYCHAIN_SERVICE),
      ),
    ).toHaveLength(1);
  });

  test('sends bounded authenticated JSON requests and preserves API errors', async () => {
    let captured: Request | undefined;
    const fetcher = (input: string | URL | Request, init?: RequestInit) => {
      captured = new Request(input, init);
      return Promise.resolve(
        Response.json({
          code: 'ok',
          message: 'success',
          data: { products: [] },
        }),
      );
    };
    const client = new FeedbackServerApiClient(
      { baseUrl: 'https://feedback.example.com/v1/api', token },
      fetcher as typeof fetch,
    );
    expect(
      await client.request<{ products: unknown[] }>('/admin/products', {
        query: { limit: 50, cursor: undefined },
        ifMatch: `"${'a'.repeat(64)}"`,
      }),
    ).toEqual({ products: [] });
    expect(captured?.url).toBe(
      'https://feedback.example.com/v1/api/admin/products?limit=50',
    );
    expect(captured?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(captured?.headers.get('if-match')).toBe(`"${'a'.repeat(64)}"`);

    const failing = new FeedbackServerApiClient(
      { baseUrl: 'https://feedback.example.com/v1/api', token },
      (() =>
        Promise.resolve(
        Response.json(
          { code: 'admin_scope_required', message: 'Missing scope', data: null },
          {
            status: 403,
            headers: { 'X-Request-ID': 'request-abc', 'Retry-After': '12' },
          },
        ),
        )) as unknown as typeof fetch,
    );
    try {
      await failing.request('/admin/products');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackServerApiError);
      expect(error).toMatchObject({
        status: 403,
        code: 'admin_scope_required',
        message: 'Missing scope',
        requestId: 'request-abc',
        retryAfterSeconds: 12,
      });
    }
  });
});
