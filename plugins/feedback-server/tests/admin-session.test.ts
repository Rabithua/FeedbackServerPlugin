import { describe, expect, test } from 'bun:test';
import {
  AGENT_SCOPES,
  HiddenPasswordInput,
  configureAgent,
  disconnectAgent,
  type ConfigurationDependencies,
} from '../src/admin-session.js';
import type { StoredCredentials } from '../src/credentials.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const oldTokenId = '11111111-1111-4111-8111-111111111111';
const newTokenId = '22222222-2222-4222-8222-222222222222';
const newToken = `fspat_${'c'.repeat(64)}`;
const previous: StoredCredentials = {
  baseUrl,
  token: `fspat_${'d'.repeat(64)}`,
  tokenId: oldTokenId,
  username: 'owner',
  scopes: [...AGENT_SCOPES],
  expiresAt: '2027-07-29T00:00:00.000Z',
};

function dependencies(
  events: string[],
  overrides: Partial<ConfigurationDependencies> = {},
): ConfigurationDependencies {
  return {
    readCredentials: () => Promise.resolve(previous),
    resumeCredentialCleanup: () => Promise.resolve(false),
    writeCredentials: () => {
      events.push('write');
      return Promise.resolve();
    },
    deleteCredentials: () => {
      events.push('delete');
      return Promise.resolve();
    },
    login: () => {
      events.push('login');
      return Promise.resolve({
        accessToken: 'short-lived-access',
        refreshToken: 'short-lived-refresh',
      });
    },
    createToken: () => {
      events.push('create');
      return Promise.resolve({
        id: newTokenId,
        name: 'Codex MCP test',
        token: newToken,
        scopes: [...AGENT_SCOPES],
        expiresAt: '2027-07-29T00:00:00.000Z',
      });
    },
    revokeToken: (_url, _accessToken, tokenId) => {
      events.push(`revoke:${tokenId}`);
      return Promise.resolve();
    },
    logout: () => {
      events.push('logout');
      return Promise.resolve();
    },
    ...overrides,
  };
}

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('Agent configuration lifecycle', () => {
  test('preserves multibyte UTF-8 in hidden password input across chunks', () => {
    const input = new HiddenPasswordInput();
    const encoded = Buffer.from('密碼🔒');

    expect(input.consume(encoded.subarray(0, 1))).toEqual({ status: 'reading' });
    expect(input.consume(encoded.subarray(1, 5))).toEqual({ status: 'reading' });
    expect(input.consume(Buffer.concat([encoded.subarray(5), Buffer.from([13])]))).toEqual({
      status: 'submitted',
      value: '密碼🔒',
    });
  });

  test('stores a new token before revoking the previous token and logs out', async () => {
    const events: string[] = [];
    const configured = await configureAgent(
      { baseUrl, username: 'owner', password: 'not-logged' },
      dependencies(events),
    );
    expect(configured).toMatchObject({
      baseUrl,
      tokenId: newTokenId,
      token: newToken,
      username: 'owner',
    });
    expect(events).toEqual([
      'login',
      'create',
      'write',
      `revoke:${oldTokenId}`,
      'write',
      'logout',
    ]);
  });

  test('retains the previous token ID when its revocation fails', async () => {
    const events: string[] = [];
    const writes: StoredCredentials[] = [];
    const failure = new Error('simulated previous token revocation failure');
    const error = await capturedError(
      configureAgent(
        { baseUrl, username: 'owner', password: 'not-logged' },
        dependencies(events, {
          writeCredentials: (credentials) => {
            events.push('write');
            writes.push(credentials);
            return Promise.resolve();
          },
          revokeToken: (_url, _accessToken, tokenId) => {
            events.push(`revoke:${tokenId}`);
            return tokenId === oldTokenId ? Promise.reject(failure) : Promise.resolve();
          },
        }),
      ),
    );

    expect(error).toBe(failure);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      tokenId: newTokenId,
      pendingRevocationTokenIds: [oldTokenId],
    });
    expect(events).toEqual([
      'login',
      'create',
      'write',
      `revoke:${oldTokenId}`,
      'logout',
    ]);
  });

  test('retries a retained token revocation before rotating again', async () => {
    const events: string[] = [];
    const retained: StoredCredentials = {
      ...previous,
      tokenId: newTokenId,
      token: newToken,
      pendingRevocationTokenIds: [oldTokenId],
    };

    await configureAgent(
      { baseUrl, username: 'owner', password: 'not-logged' },
      dependencies(events, {
        readCredentials: () => Promise.resolve(retained),
      }),
    );

    expect(events.slice(0, 3)).toEqual([
      'login',
      `revoke:${oldTokenId}`,
      'write',
    ]);
    expect(events.indexOf(`revoke:${oldTokenId}`)).toBeLessThan(events.indexOf('create'));
  });

  test('revokes the new token when Keychain persistence fails', async () => {
    const events: string[] = [];
    const failure = new Error('simulated Keychain failure');
    const error = await capturedError(
      configureAgent(
        { baseUrl, username: 'owner', password: 'not-logged' },
        dependencies(events, {
          writeCredentials: () => {
            events.push('write');
            return Promise.reject(failure);
          },
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(events).toEqual([
      'login',
      'create',
      'write',
      `revoke:${newTokenId}`,
      'logout',
    ]);
  });

  test('requires disconnect before switching servers so no old token is orphaned', async () => {
    const events: string[] = [];
    const error = await capturedError(
      configureAgent(
        {
          baseUrl: 'https://other.example.com/v1/api',
          username: 'owner',
          password: 'not-logged',
        },
        dependencies(events),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('agent:disconnect');
    expect(events).toEqual([]);
  });

  test('requires disconnect before switching administrator accounts', async () => {
    const events: string[] = [];
    const error = await capturedError(
      configureAgent(
        { baseUrl, username: 'different-admin', password: 'not-logged' },
        dependencies(events),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('agent:disconnect');
    expect(events).toEqual([]);
  });

  test('revokes the stored token before deleting credentials and logging out', async () => {
    const events: string[] = [];
    expect(
      await disconnectAgent(
        { username: 'owner', password: 'not-logged' },
        dependencies(events),
      ),
    ).toBe(true);
    expect(events).toEqual([
      'login',
      `revoke:${oldTokenId}`,
      'delete',
      'logout',
    ]);
  });

  test('disconnect retries retained revocations before removing the active token', async () => {
    const events: string[] = [];
    const retained: StoredCredentials = {
      ...previous,
      tokenId: newTokenId,
      token: newToken,
      pendingRevocationTokenIds: [oldTokenId],
    };

    expect(
      await disconnectAgent(
        { username: 'owner', password: 'not-logged' },
        dependencies(events, {
          readCredentials: () => Promise.resolve(retained),
        }),
      ),
    ).toBe(true);
    expect(events).toEqual([
      'login',
      `revoke:${oldTokenId}`,
      'write',
      `revoke:${newTokenId}`,
      'delete',
      'logout',
    ]);
  });

  test('resumes interrupted local cleanup before reading complete credentials', async () => {
    const events: string[] = [];
    expect(
      await disconnectAgent(
        { username: 'owner', password: 'not-logged' },
        dependencies(events, {
          resumeCredentialCleanup: () => {
            events.push('resume');
            return Promise.resolve(true);
          },
          readCredentials: () => {
            events.push('read');
            return Promise.reject(new Error('must not read incomplete credentials'));
          },
        }),
      ),
    ).toBe(true);
    expect(events).toEqual(['resume']);
  });
});
