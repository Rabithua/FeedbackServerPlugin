import { describe, expect, test } from 'bun:test';
import {
  AGENT_SCOPES,
  HiddenPasswordInput,
  PendingTokenRecoveryError,
  configureAgent,
  disconnectAgent,
  revokeAgentTokenById,
  type ConfigurationDependencies,
} from '../src/admin-session.js';
import {
  CredentialPersistenceIndeterminateError,
  type StoredCredentials,
} from '../src/credentials.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const oldTokenId = '11111111-1111-4111-8111-111111111111';
const newTokenId = '22222222-2222-4222-8222-222222222222';
const otherProfileTokenId = '33333333-3333-4333-8333-333333333333';
const scopedWorkTokenId = '44444444-4444-4444-8444-444444444444';
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
  const pendingRevocations: Array<{
    baseUrl: string;
    username: string;
    tokenId: string;
  }> = [];
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
    readPendingRevocations: () => Promise.resolve([...pendingRevocations]),
    readReferencedTokenIds: () => Promise.resolve(new Set()),
    addPendingRevocation: (entry) => {
      events.push(`pending:add:${entry.tokenId}`);
      if (!pendingRevocations.some((candidate) => candidate.tokenId === entry.tokenId)) {
        pendingRevocations.push(entry);
      }
      return Promise.resolve();
    },
    removePendingRevocation: (entry) => {
      events.push(`pending:remove:${entry.tokenId}`);
      const index = pendingRevocations.findIndex((candidate) => candidate.tokenId === entry.tokenId);
      if (index >= 0) pendingRevocations.splice(index, 1);
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
  test('requests every scope required by the waitlist tools', () => {
    expect(AGENT_SCOPES).toEqual(expect.arrayContaining([
      'waitlist:read',
      'waitlist:write',
      'waitlist:dangerous',
    ]));
  });

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
      `pending:add:${newTokenId}`,
      `pending:add:${oldTokenId}`,
      'write',
      `pending:remove:${newTokenId}`,
      `revoke:${oldTokenId}`,
      `pending:remove:${oldTokenId}`,
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
    expect(writes[0]).toMatchObject({ tokenId: newTokenId });
    expect(writes[0]?.pendingRevocationTokenIds).toBeUndefined();
    expect(events).toEqual([
      'login',
      'create',
      `pending:add:${newTokenId}`,
      `pending:add:${oldTokenId}`,
      'write',
      `pending:remove:${newTokenId}`,
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

    expect(events.slice(0, 4)).toEqual([
      'login',
      `pending:add:${oldTokenId}`,
      `revoke:${oldTokenId}`,
      `pending:remove:${oldTokenId}`,
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
      `pending:add:${newTokenId}`,
      `pending:add:${oldTokenId}`,
      'write',
      `revoke:${newTokenId}`,
      `pending:remove:${newTokenId}`,
      `pending:remove:${oldTokenId}`,
      'logout',
    ]);
  });

  test('does not revoke a token when Keychain reports an indeterminate committed profile', async () => {
    const events: string[] = [];
    const persistenceError = new CredentialPersistenceIndeterminateError(
      'work',
      new Error('simulated rollback interruption'),
    );
    const error = await capturedError(
      configureAgent(
        { baseUrl, username: 'owner', password: 'not-logged', profile: 'work' },
        dependencies(events, {
          writeCredentials: () => {
            events.push('write');
            return Promise.reject(persistenceError);
          },
        }),
      ),
    );

    expect(error).toBe(persistenceError);
    expect(events).not.toContain(`revoke:${newTokenId}`);
    expect(events).not.toContain(`pending:remove:${newTokenId}`);
    expect(events.at(-1)).toBe('logout');
  });

  test('retains the new token ID when persistence and compensating revocation both fail', async () => {
    const events: string[] = [];
    const error = await capturedError(
      configureAgent(
        { baseUrl, username: 'owner', password: 'not-logged' },
        dependencies(events, {
          writeCredentials: () => {
            events.push('write');
            return Promise.reject(new Error('Keychain unavailable'));
          },
          revokeToken: (_url, _accessToken, tokenId) => {
            events.push(`revoke:${tokenId}`);
            return tokenId === newTokenId
              ? Promise.reject(new Error('revocation unavailable'))
              : Promise.resolve();
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(PendingTokenRecoveryError);
    expect((error as Error).message).toContain(newTokenId);
    expect((error as Error).message).toContain('feedback-server agent revoke-token');
    expect(events).not.toContain(`pending:remove:${newTokenId}`);
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
    expect((error as Error).message).toContain('agent disconnect');
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
    expect((error as Error).message).toContain('agent disconnect');
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

  test('keeps profile credentials recoverable when PAT revocation fails', async () => {
    const events: string[] = [];
    const failure = new Error('simulated PAT revocation outage');
    const error = await capturedError(
      disconnectAgent(
        { username: 'owner', password: 'not-logged', profile: 'work' },
        dependencies(events, {
          revokeToken: (_url, _accessToken, tokenId) => {
            events.push(`revoke:${tokenId}`);
            return Promise.reject(failure);
          },
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(events).toEqual(['login', `revoke:${oldTokenId}`, 'logout']);
    expect(events).not.toContain('delete');
  });

  test('does not revoke PATs referenced by or scoped to another profile', async () => {
    const events: string[] = [];
    const pending = [
      { baseUrl, username: 'owner', tokenId: otherProfileTokenId },
      { baseUrl, username: 'owner', tokenId: scopedWorkTokenId, profile: 'work' },
    ];

    expect(await disconnectAgent(
      { username: 'owner', password: 'not-logged', profile: 'personal' },
      dependencies(events, {
        readPendingRevocations: () => Promise.resolve([...pending]),
        readReferencedTokenIds: () => Promise.resolve(new Set([otherProfileTokenId])),
        removePendingRevocation: (entry) => {
          events.push(`pending:remove:${entry.tokenId}`);
          const index = pending.findIndex((candidate) =>
            candidate.tokenId === entry.tokenId && candidate.profile === entry.profile);
          if (index >= 0) pending.splice(index, 1);
          return Promise.resolve();
        },
      }),
    )).toBe(true);

    expect(events).toEqual([
      'login',
      `pending:remove:${otherProfileTokenId}`,
      `revoke:${oldTokenId}`,
      'delete',
      'logout',
    ]);
    expect(pending).toEqual([
      { baseUrl, username: 'owner', tokenId: scopedWorkTokenId, profile: 'work' },
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
      `pending:add:${oldTokenId}`,
      `revoke:${oldTokenId}`,
      `pending:remove:${oldTokenId}`,
      `revoke:${newTokenId}`,
      'delete',
      'logout',
    ]);
  });

  test('explicitly revokes a recoverable token ID and clears its ledger entry', async () => {
    const events: string[] = [];
    await revokeAgentTokenById(
      { baseUrl, username: 'owner', password: 'not-logged', tokenId: newTokenId },
      dependencies(events, {
        readPendingRevocations: () => Promise.resolve([{
          baseUrl,
          username: 'owner',
          tokenId: newTokenId,
          profile: 'work',
        }]),
      }),
    );
    expect(events).toEqual([
      'login',
      `revoke:${newTokenId}`,
      `pending:remove:${newTokenId}`,
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
