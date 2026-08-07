import { describe, expect, test } from 'bun:test';
import {
  AGENT_SCOPES,
  ConfigurationApiError,
} from '../src/admin-session.js';
import type { StoredCredentials } from '../src/credentials.js';
import {
  AgentAlreadyConfiguredError,
  CommittedInvitationAcceptanceError,
  IndeterminateInvitationAcceptanceError,
  acceptInvitationAndConfigure,
  type InvitationAcceptanceDependencies,
} from '../src/invitation-acceptance.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const token = `fsinv_${'x'.repeat(48)}`;
const pat = `fspat_${'p'.repeat(64)}`;
const input = {
  baseUrl,
  token,
  username: 'new-admin',
  displayName: 'New Admin',
  password: 'correct horse battery staple',
};

function identity(role: 'admin' | 'super_admin' = 'admin') {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    username: input.username,
    displayName: input.displayName,
    role,
  };
}

function dependencies(
  events: string[],
  overrides: Partial<InvitationAcceptanceDependencies> = {},
): InvitationAcceptanceDependencies {
  const pendingRevocations: Array<{
    baseUrl: string;
    username: string;
    tokenId: string;
  }> = [];
  return {
    isMacOS: () => true,
    readCredentials: () => {
      events.push('read-credentials');
      return Promise.resolve(undefined);
    },
    writeCredentials: () => {
      events.push('write-credentials');
      return Promise.resolve();
    },
    acceptInvitation: (_url, acceptedInput) => {
      expect(acceptedInput.token).toBe(token);
      events.push('accept');
      return Promise.resolve({
        accessToken: 'accepted-access',
        refreshToken: 'accepted-refresh',
        admin: identity(),
      });
    },
    login: () => {
      events.push('verify-login');
      return Promise.resolve({
        accessToken: 'verified-access',
        refreshToken: 'verified-refresh',
        admin: identity(),
      });
    },
    listProducts: () => {
      events.push('list-products');
      return Promise.resolve([]);
    },
    createToken: () => {
      events.push('create-token');
      return Promise.resolve({
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Codex MCP test',
        token: pat,
        scopes: [...AGENT_SCOPES],
        expiresAt: '2027-08-04T00:00:00.000Z',
      });
    },
    revokeToken: (_url, _access, tokenId) => {
      events.push(`revoke-token:${tokenId}`);
      return Promise.resolve();
    },
    logout: (_url, refreshToken) => {
      events.push(`logout:${refreshToken}`);
      return Promise.resolve();
    },
    readPendingRevocations: () => {
      events.push('read-pending');
      return Promise.resolve([...pendingRevocations]);
    },
    addPendingRevocation: (entry) => {
      events.push(`add-pending:${entry.tokenId}`);
      pendingRevocations.push(entry);
      return Promise.resolve();
    },
    removePendingRevocation: (entry) => {
      events.push(`remove-pending:${entry.tokenId}`);
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

describe('invitation acceptance and Agent configuration', () => {
  test('verifies the new isolated admin, stores a PAT, and logs out both sessions', async () => {
    const events: string[] = [];
    let stored: StoredCredentials | undefined;
    const configured = await acceptInvitationAndConfigure(
      input,
      dependencies(events, {
        writeCredentials: (credentials) => {
          events.push('write-credentials');
          stored = credentials;
          return Promise.resolve();
        },
      }),
    );
    expect(stored).toBeDefined();
    expect(configured).toEqual(stored!);
    expect(configured).toMatchObject({
      baseUrl,
      token: pat,
      username: input.username,
      scopes: [...AGENT_SCOPES],
    });
    expect(events).toEqual([
      'read-credentials',
      'accept',
      'verify-login',
      'list-products',
      'read-pending',
      'create-token',
      'add-pending:22222222-2222-4222-8222-222222222222',
      'write-credentials',
      'remove-pending:22222222-2222-4222-8222-222222222222',
      'logout:verified-refresh',
      'logout:accepted-refresh',
    ]);
  });

  test('fails before consuming the invitation when Agent credentials exist', async () => {
    const events: string[] = [];
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          readCredentials: () => {
            events.push('read-credentials');
            return Promise.resolve({ baseUrl, token: pat, username: 'someone-else' });
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(AgentAlreadyConfiguredError);
    expect((error as Error).message).toContain('someone-else');
    expect((error as Error).message).toContain(baseUrl);
    expect((error as Error).message).toContain('Keep the existing account');
    expect((error as Error).message).toContain('invitation was not consumed');
    expect(events).toEqual(['read-credentials']);
  });

  test('fails before reading credentials or consuming an invitation off macOS', async () => {
    const events: string[] = [];
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, { isMacOS: () => false }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('requires macOS Keychain');
    expect(events).toEqual([]);
  });

  test('keeps a username conflict retryable', async () => {
    const events: string[] = [];
    const conflict = new ConfigurationApiError(409, 'username_unavailable', 'Username is used');
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          acceptInvitation: () => {
            events.push('accept');
            return Promise.reject(conflict);
          },
        }),
      ),
    );
    expect(error).toBe(conflict);
    expect(events).toEqual(['read-credentials', 'accept']);
  });

  test('marks interrupted acceptance as indeterminate', async () => {
    const events: string[] = [];
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          acceptInvitation: () => {
            events.push('accept');
            return Promise.reject(new Error('connection reset'));
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(IndeterminateInvitationAcceptanceError);
    expect(events).toEqual(['read-credentials', 'accept']);
  });

  test('revokes a new PAT when Keychain persistence fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          writeCredentials: () => {
            events.push('write-credentials');
            return Promise.reject(new Error('Keychain unavailable'));
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(CommittedInvitationAcceptanceError);
    expect((error as Error).message).toContain('Do not reuse the invitation');
    expect(events).toEqual([
      'read-credentials',
      'accept',
      'verify-login',
      'list-products',
      'read-pending',
      'create-token',
      'add-pending:22222222-2222-4222-8222-222222222222',
      'write-credentials',
      'revoke-token:22222222-2222-4222-8222-222222222222',
      'remove-pending:22222222-2222-4222-8222-222222222222',
      'logout:verified-refresh',
      'logout:accepted-refresh',
    ]);
  });

  test('surfaces recoverable token identification when Keychain and revocation both fail', async () => {
    const events: string[] = [];
    const tokenId = '22222222-2222-4222-8222-222222222222';
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          writeCredentials: () => Promise.reject(new Error('Keychain unavailable')),
          revokeToken: () => Promise.reject(new Error('revocation unavailable')),
        }),
      ),
    );
    expect(error).toBeInstanceOf(CommittedInvitationAcceptanceError);
    expect((error as Error).message).toContain(tokenId);
    expect((error as Error).message).toContain('feedback-server agent revoke-token');
    expect(events).not.toContain(`remove-pending:${tokenId}`);
  });

  test('does not create a PAT if tenant isolation verification fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      acceptInvitationAndConfigure(
        input,
        dependencies(events, {
          listProducts: () => {
            events.push('list-products');
            return Promise.resolve([{ id: 'unexpected' }]);
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(CommittedInvitationAcceptanceError);
    expect(events).toEqual([
      'read-credentials',
      'accept',
      'verify-login',
      'list-products',
      'logout:verified-refresh',
      'logout:accepted-refresh',
    ]);
  });
});
