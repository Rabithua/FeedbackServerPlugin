import { describe, expect, test } from 'bun:test';
import { ConfigurationApiError } from '../src/admin-session.js';
import {
  CommittedAdminCreationError,
  createLocalAdmin,
  type LocalAdminDependencies,
} from '../src/local-admin.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const invitationToken = `fsinv_${'x'.repeat(48)}`;
const subscriptionGrant = { plan: 'solo', term: 'perpetual' } as const;
const subscription = {
  plan: 'solo' as const,
  term: 'perpetual' as const,
  expiresAt: null,
  graceEndsAt: null,
};

function dependencies(
  events: string[],
  overrides: Partial<LocalAdminDependencies> = {},
): LocalAdminDependencies {
  return {
    login: (_url, username) => {
      events.push(`login:${username}`);
      return Promise.resolve({
        accessToken: `${username}-access`,
        refreshToken: `${username}-refresh`,
        admin: {
          id: username === 'owner' ? 'owner-id' : 'new-id',
          username,
          displayName: username === 'owner' ? 'Owner' : 'New Administrator',
          role: username === 'owner' ? 'super_admin' : 'admin',
        },
      });
    },
    logout: (_url, refreshToken) => {
      events.push(`logout:${refreshToken}`);
      return Promise.resolve();
    },
    createInvitation: (_url, _accessToken, expiresInDays, grant) => {
      events.push('create-invitation');
      expect(expiresInDays).toBe(1);
      expect(grant).toEqual(subscriptionGrant);
      return Promise.resolve({
        id: 'invitation-id',
        token: invitationToken,
        subscriptionGrant,
      });
    },
    acceptInvitation: (_url, input) => {
      events.push(`accept:${input.username}`);
      expect(input.token).toBe(invitationToken);
      return Promise.resolve({
        accessToken: 'accepted-access',
        refreshToken: 'accepted-refresh',
        admin: {
          id: 'new-id',
          username: input.username,
          displayName: input.displayName,
          role: 'admin',
        },
        subscription,
      });
    },
    revokeInvitation: (_url, _accessToken, invitationId) => {
      events.push(`revoke:${invitationId}`);
      return Promise.resolve();
    },
    listProducts: () => {
      events.push('list-products');
      return Promise.resolve([]);
    },
    waitBeforeVerificationRetry: (attempt) => {
      events.push(`verification-retry:${attempt}`);
      return Promise.resolve();
    },
    now: () => new Date('2026-08-22T12:00:00.000Z'),
    ...overrides,
  };
}

const input = {
  baseUrl,
  superAdminUsername: 'owner',
  superAdminPassword: 'owner-password',
  username: 'new-admin',
  displayName: 'New Administrator',
  password: 'new-password',
  subscriptionGrant,
};

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('local administrator creation', () => {
  test('accepts a one-day invitation, verifies login and isolation, then logs out every session', async () => {
    const events: string[] = [];
    const result = await createLocalAdmin(input, dependencies(events));

    expect(result.admin).toMatchObject({ username: 'new-admin', role: 'admin' });
    expect(result.subscription).toEqual(subscription);
    expect(events).toEqual([
      'login:owner',
      'create-invitation',
      'accept:new-admin',
      'login:new-admin',
      'list-products',
      'logout:new-admin-refresh',
      'logout:accepted-refresh',
      'logout:owner-refresh',
    ]);
  });

  test('revokes an unaccepted invitation and logs out when acceptance fails', async () => {
    const events: string[] = [];
    const failure = new ConfigurationApiError(
      409,
      'username_unavailable',
      'acceptance failed',
    );

    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          acceptInvitation: () => {
            events.push('accept:new-admin');
            return Promise.reject(failure);
          },
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(events).toEqual([
      'login:owner',
      'create-invitation',
      'accept:new-admin',
      'revoke:invitation-id',
      'logout:owner-refresh',
    ]);
  });

  test('revokes before acceptance when the Server does not echo the requested grant', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          createInvitation: () => Promise.resolve({
            id: 'invitation-id',
            token: invitationToken,
          }),
        }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('must be upgraded');
    expect((error as Error).message).not.toContain(invitationToken);
    expect(events).toEqual([
      'login:owner',
      'revoke:invitation-id',
      'logout:owner-refresh',
    ]);
  });

  test('reports the invitation ID but not token when grant compensation is uncertain', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          createInvitation: () => Promise.resolve({
            id: 'invitation-id',
            token: invitationToken,
          }),
          revokeInvitation: () => Promise.reject(new Error('revocation unavailable')),
        }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain('invitation-id');
    expect((error as Error).message).toContain('uncertain state');
    expect((error as Error).message).not.toContain(invitationToken);
  });

  test('does not report uncertain invitation state when revocation succeeded but logout failed', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          createInvitation: () => Promise.resolve({
            id: 'invitation-id',
            token: invitationToken,
          }),
          logout: (_url, refreshToken) => {
            events.push(`logout:${refreshToken}:failed`);
            return Promise.reject(new Error('logout unavailable'));
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toBe('Administrator creation or cleanup failed');
    expect((error as Error).message).not.toContain('uncertain state');
    expect(events).toContain('revoke:invitation-id');
    expect(events).toContain('logout:owner-refresh:failed');
  });

  test('does not revoke an accepted invitation when Product isolation verification fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          listProducts: () => {
            events.push('list-products');
            return Promise.resolve([{ id: 'unexpected-product' }]);
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('unexpectedly owns Products');
    expect(events).not.toContain('revoke:invitation-id');
    expect(events.slice(-3)).toEqual([
      'logout:new-admin-refresh',
      'logout:accepted-refresh',
      'logout:owner-refresh',
    ]);
  });

  test('does not claim success when the applied subscription differs from the invitation grant', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          acceptInvitation: (_url, acceptedInput) => Promise.resolve({
            accessToken: 'accepted-access',
            refreshToken: 'accepted-refresh',
            admin: {
              id: 'new-id',
              username: acceptedInput.username,
              displayName: acceptedInput.displayName,
              role: 'admin',
            },
            subscription: {
              plan: 'free',
              term: 'free',
              expiresAt: null,
              graceEndsAt: null,
            },
          }),
        }),
      ),
    );
    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect(events).not.toContain('revoke:invitation-id');
    expect(events).not.toContain('list-products');
  });

  test('does not claim success when a monthly grant receives a yearly expiration', async () => {
    const events: string[] = [];
    const monthlyInput = {
      ...input,
      subscriptionGrant: { plan: 'solo', term: 'month' } as const,
    };
    const error = await capturedError(
      createLocalAdmin(
        monthlyInput,
        dependencies(events, {
          createInvitation: () => Promise.resolve({
            id: 'invitation-id',
            token: invitationToken,
            subscriptionGrant: monthlyInput.subscriptionGrant,
          }),
          acceptInvitation: (_url, acceptedInput) => Promise.resolve({
            accessToken: 'accepted-access',
            refreshToken: 'accepted-refresh',
            admin: {
              id: 'new-id',
              username: acceptedInput.username,
              displayName: acceptedInput.displayName,
              role: 'admin',
            },
            subscription: {
              plan: 'solo',
              term: 'fixed',
              expiresAt: '2027-08-22T12:00:00.000Z',
              graceEndsAt: '2027-08-29T12:00:00.000Z',
            },
          }),
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect(events).not.toContain('list-products');
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('continues logging out when invitation revocation fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          acceptInvitation: () => Promise.reject(
            new ConfigurationApiError(409, 'username_unavailable', 'acceptance failed'),
          ),
          revokeInvitation: () => {
            events.push('revoke:failed');
            return Promise.reject(new Error('revocation failed'));
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(events.slice(-2)).toEqual(['revoke:failed', 'logout:owner-refresh']);
  });

  test('reports committed state when acceptance succeeds but its subscription response is lost', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          acceptInvitation: () => {
            events.push('accept:response-lost');
            return Promise.reject(new TypeError('connection closed after commit'));
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect(events).toEqual([
      'login:owner',
      'create-invitation',
      'accept:response-lost',
      'login:new-admin',
      'list-products',
      'logout:new-admin-refresh',
      'logout:owner-refresh',
    ]);
  });

  test('preserves indeterminate committed status when response loss reconciliation stays unavailable', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          acceptInvitation: () => {
            events.push('accept:response-lost');
            return Promise.reject(new TypeError('connection closed after commit'));
          },
          listProducts: () => {
            events.push('list-products:unavailable');
            return Promise.reject(
              new ConfigurationApiError(503, 'unavailable', 'try again'),
            );
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect(events.filter((event) => event === 'login:new-admin')).toHaveLength(3);
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('preserves committed status when post-commit verification and logout both fail', async () => {
    const events: string[] = [];
    const verificationFailure = new ConfigurationApiError(503, 'unavailable', 'try again');
    const logoutFailure = new Error('logout unavailable');
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          listProducts: () => {
            events.push('list-products:unavailable');
            return Promise.reject(verificationFailure);
          },
          logout: (_url, refreshToken) => {
            events.push(`logout:${refreshToken}:failed`);
            return Promise.reject(logoutFailure);
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect((error as Error).message).toContain('creation committed');
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toContain(logoutFailure);
    expect(events.filter((event) => event === 'login:new-admin')).toHaveLength(3);
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('retries transient verification failures after acceptance has committed', async () => {
    const events: string[] = [];
    let productAttempts = 0;
    const result = await createLocalAdmin(
      input,
      dependencies(events, {
        listProducts: () => {
          productAttempts += 1;
          events.push(`list-products:${productAttempts}`);
          return productAttempts === 1
            ? Promise.reject(new ConfigurationApiError(503, 'unavailable', 'try again'))
            : Promise.resolve([]);
        },
      }),
    );

    expect(result.admin).toMatchObject({ username: 'new-admin', role: 'admin' });
    expect(events).toContain('verification-retry:1');
    expect(events.filter((event) => event === 'login:new-admin')).toHaveLength(2);
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('reports committed creation distinctly after verification retries are exhausted', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          listProducts: () => {
            events.push('list-products:unavailable');
            return Promise.reject(
              new ConfigurationApiError(503, 'unavailable', 'try again'),
            );
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect((error as Error).message).toContain('creation committed');
    expect(events.filter((event) => event === 'login:new-admin')).toHaveLength(3);
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('reports committed creation after post-acceptance login rate limits persist', async () => {
    const events: string[] = [];
    const baseDependencies = dependencies(events);
    const error = await capturedError(
      createLocalAdmin(input, {
        ...baseDependencies,
        login: (url, username, password) => {
          if (username === input.superAdminUsername) {
            return baseDependencies.login(url, username, password);
          }
          events.push('login:new-admin:rate-limited');
          return Promise.reject(
            new ConfigurationApiError(429, 'rate_limited', 'try later'),
          );
        },
      }),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect(events.filter((event) => event === 'login:new-admin:rate-limited')).toHaveLength(3);
    expect(events.filter((event) => event.startsWith('verification-retry:'))).toEqual([
      'verification-retry:1',
      'verification-retry:2',
    ]);
    expect(events).not.toContain('revoke:invitation-id');
  });

  test('reports committed creation when only temporary-session cleanup fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createLocalAdmin(
        input,
        dependencies(events, {
          logout: (_url, refreshToken) => {
            events.push(`logout:${refreshToken}`);
            return refreshToken === 'owner-refresh'
              ? Promise.reject(new Error('logout unavailable'))
              : Promise.resolve();
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(CommittedAdminCreationError);
    expect((error as Error).message).toContain('account exists');
    expect(events).toContain('list-products');
    expect(events.slice(-3)).toEqual([
      'logout:new-admin-refresh',
      'logout:accepted-refresh',
      'logout:owner-refresh',
    ]);
  });
});
