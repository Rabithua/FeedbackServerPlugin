import { describe, expect, test } from 'bun:test';
import type { AgentEnrollmentCredentialResult } from '../src/agent-auth-api.js';
import type {
  PendingEmailLogin,
  StoredCredentials,
} from '../src/credentials.js';
import {
  EmailLoginProfileConflictError,
  completeAgentEmailLogin,
  requestAgentEmailLogin,
  type EmailLoginDependencies,
} from '../src/email-authentication.js';

const oldCredentials: StoredCredentials = {
  baseUrl: 'https://api.example.com/v1/api',
  adminId: '11111111-1111-4111-8111-111111111111',
  email: 'old@example.com',
  tokenId: '22222222-2222-4222-8222-222222222222',
  token: `fspat_${'o'.repeat(64)}`,
  scopes: ['products:read'],
  expiresAt: '2027-08-25T00:00:00.000Z',
};
const accepted: AgentEnrollmentCredentialResult = {
  enrollmentId: '33333333-3333-4333-8333-333333333333',
  admin: {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'owner@example.com',
    emailVerifiedAt: '2026-08-25T00:00:00.000Z',
    role: 'admin',
  },
  credential: {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Recovery Agent',
    token: `fspat_${'n'.repeat(64)}`,
    scopes: ['products:read', 'products:write'],
    expiresAt: '2027-08-25T00:00:00.000Z',
  },
};

function dependencies(overrides: Partial<EmailLoginDependencies> = {}): EmailLoginDependencies {
  return {
    preflight: () => Promise.resolve(),
    readActiveProfile: () => Promise.resolve(undefined),
    readProfile: () => Promise.resolve(undefined),
    listProfiles: () => Promise.resolve([]),
    referencedTokenIds: () => Promise.resolve(new Set()),
    writeProfile: () => Promise.resolve(),
    writePending: () => Promise.resolve(),
    readPending: () => Promise.resolve(undefined),
    deletePending: () => Promise.resolve(),
    request: () => Promise.resolve({
      challengeId: '66666666-6666-4666-8666-666666666666',
      expiresAt: '2026-08-25T01:00:00.000Z',
    }),
    confirm: () => Promise.resolve(accepted),
    acknowledge: () => Promise.resolve(null),
    revokePrevious: () => Promise.resolve(),
    ...overrides,
  };
}

describe('Agent email login', () => {
  test('preflights keyring and resolves Profile conflicts before sending email', async () => {
    let requests = 0;
    const occupied = dependencies({
      readProfile: () => Promise.resolve(oldCredentials),
      request: () => {
        requests += 1;
        return Promise.reject(new Error('must not send'));
      },
    });
    let occupiedError: unknown;
    try {
      await requestAgentEmailLogin({
        email: 'owner@example.com',
        profile: 'default',
      }, occupied);
    } catch (error) {
      occupiedError = error;
    }
    expect(occupiedError).toBeInstanceOf(EmailLoginProfileConflictError);
    expect(requests).toBe(0);

    let preflightError: unknown;
    try {
      await requestAgentEmailLogin({ email: 'owner@example.com' }, dependencies({
        preflight: () => Promise.reject(new Error('locked keyring')),
        request: () => {
          requests += 1;
          return Promise.reject(new Error('must not send'));
        },
      }));
    } catch (error) {
      preflightError = error;
    }
    expect(preflightError).toMatchObject({ message: 'locked keyring' });
    expect(requests).toBe(0);

    let capacityError: unknown;
    try {
      await requestAgentEmailLogin({ email: 'owner@example.com', profile: 'new-profile' }, dependencies({
        listProfiles: () => Promise.resolve(Array.from({ length: 100 }, (_, index) => ({
          name: `profile-${index}`,
          active: false,
        }))),
        request: () => {
          requests += 1;
          return Promise.reject(new Error('must not send'));
        },
      }));
    } catch (error) {
      capacityError = error;
    }
    expect(capacityError).toMatchObject({ message: expect.stringContaining('100 profiles') });
    expect(requests).toBe(0);
  });

  test('stores enrollment state but returns no enrollment secret or PAT', async () => {
    let pending: PendingEmailLogin | undefined;
    const result = await requestAgentEmailLogin({
      email: ' OWNER@EXAMPLE.COM ',
      baseUrl: 'https://api.example.com',
      profile: 'work',
      credentialName: 'Recovery Agent',
    }, dependencies({
      request: (_baseUrl, input) => {
        expect(input.email).toBe('owner@example.com');
        expect(input.enrollmentId).toBeString();
        return Promise.resolve({
          challengeId: '66666666-6666-4666-8666-666666666666',
          expiresAt: '2026-08-25T01:00:00.000Z',
        });
      },
      writePending: (value) => {
        pending = value;
        return Promise.resolve();
      },
    }));
    expect(pending?.enrollmentSecret).toStartWith('fsenr_');
    expect(result).toMatchObject({ email: 'owner@example.com', profile: 'work' });
    expect(JSON.stringify(result)).not.toContain('fsenr_');
    expect(JSON.stringify(result)).not.toContain('fspat_');
  });

  test('retries a lost confirmation with the same enrollment, saves before ack, and never returns PAT', async () => {
    const pending: PendingEmailLogin = {
      version: 1,
      requestId: accepted.enrollmentId,
      baseUrl: oldCredentials.baseUrl,
      enrollmentSecret: `fsenr_${'s'.repeat(43)}`,
      challengeId: '66666666-6666-4666-8666-666666666666',
      email: accepted.admin.email,
      credentialName: accepted.credential.name,
      profile: 'work',
      replaceExisting: true,
      previousCredentials: oldCredentials,
      acceptedTokenId: null,
      expiresAt: '2099-08-25T01:00:00.000Z',
    };
    const events: string[] = [];
    let confirms = 0;
    const deps = dependencies({
      readPending: () => Promise.resolve(pending),
      readProfile: () => Promise.resolve(oldCredentials),
      writePending: () => Promise.resolve(),
      confirm: (_baseUrl, input) => {
        confirms += 1;
        expect(input.enrollmentSecret).toBe(pending.enrollmentSecret);
        if (confirms === 1) return Promise.reject(new Error('response lost'));
        return Promise.resolve(accepted);
      },
      writeProfile: (credentials) => {
        events.push('write');
        expect(credentials.token).toBe(accepted.credential.token);
        return Promise.resolve();
      },
      acknowledge: () => {
        events.push('ack');
        return Promise.resolve(null);
      },
      deletePending: () => {
        events.push('delete-pending');
        return Promise.resolve();
      },
      revokePrevious: (_baseUrl, token) => {
        events.push('revoke-old');
        expect(token).toBe(oldCredentials.token);
        return Promise.resolve();
      },
    });
    let interruptedError: unknown;
    try {
      await completeAgentEmailLogin({
        requestId: pending.requestId,
        code: '123456',
      }, deps);
    } catch (error) {
      interruptedError = error;
    }
    expect(interruptedError).toMatchObject({ message: 'response lost' });
    const completed = await completeAgentEmailLogin({
      requestId: pending.requestId,
      code: '123456',
    }, deps);
    expect(events).toEqual(['write', 'ack', 'delete-pending', 'revoke-old']);
    expect(completed).toMatchObject({
      email: accepted.admin.email,
      tokenId: accepted.credential.id,
      profile: 'work',
    });
    expect(JSON.stringify(completed)).not.toContain(accepted.credential.token);
    expect(JSON.stringify(completed)).not.toContain(oldCredentials.token);
  });

  test('recovers when the new credential was written before Profile activation failed', async () => {
    let pending: PendingEmailLogin = {
      version: 1,
      requestId: accepted.enrollmentId,
      baseUrl: oldCredentials.baseUrl,
      enrollmentSecret: `fsenr_${'s'.repeat(43)}`,
      challengeId: '66666666-6666-4666-8666-666666666666',
      email: accepted.admin.email,
      credentialName: accepted.credential.name,
      profile: 'work',
      replaceExisting: true,
      previousCredentials: oldCredentials,
      acceptedTokenId: null,
      expiresAt: '2099-08-25T01:00:00.000Z',
    };
    const newCredentials: StoredCredentials = {
      baseUrl: oldCredentials.baseUrl,
      adminId: accepted.admin.id,
      email: accepted.admin.email,
      tokenId: accepted.credential.id,
      token: accepted.credential.token,
      scopes: accepted.credential.scopes,
      expiresAt: accepted.credential.expiresAt,
    };
    let profile = oldCredentials;
    let writes = 0;
    let acknowledgements = 0;
    let revokedToken: string | undefined;
    const deps = dependencies({
      readPending: () => Promise.resolve(pending),
      writePending: (value) => {
        pending = value;
        return Promise.resolve();
      },
      readProfile: () => Promise.resolve(profile),
      confirm: () => Promise.resolve(accepted),
      writeProfile: (value) => {
        writes += 1;
        profile = value;
        if (writes === 1) return Promise.reject(new Error('active Profile write failed'));
        return Promise.resolve();
      },
      acknowledge: () => {
        acknowledgements += 1;
        return Promise.resolve(null);
      },
      revokePrevious: (_baseUrl, token) => {
        revokedToken = token;
        return Promise.resolve();
      },
    });
    let persistenceError: unknown;
    try {
      await completeAgentEmailLogin({ requestId: pending.requestId, code: '123456' }, deps);
    } catch (error) {
      persistenceError = error;
    }
    expect(persistenceError).toMatchObject({ message: 'active Profile write failed' });
    expect(profile).toEqual(newCredentials);
    expect(pending.acceptedTokenId).toBe(accepted.credential.id);

    const completed = await completeAgentEmailLogin({
      requestId: pending.requestId,
      code: '123456',
    }, deps);
    expect(completed.acknowledged).toBe(true);
    expect(acknowledgements).toBe(1);
    expect(revokedToken).toBe(oldCredentials.token);
  });

  test('does not revoke a previous credential still referenced by another Profile', async () => {
    const pending: PendingEmailLogin = {
      version: 1,
      requestId: accepted.enrollmentId,
      baseUrl: oldCredentials.baseUrl,
      enrollmentSecret: `fsenr_${'s'.repeat(43)}`,
      challengeId: '66666666-6666-4666-8666-666666666666',
      email: accepted.admin.email,
      credentialName: accepted.credential.name,
      profile: 'work',
      replaceExisting: true,
      previousCredentials: oldCredentials,
      acceptedTokenId: null,
      expiresAt: '2099-08-25T01:00:00.000Z',
    };
    let revocations = 0;
    const completed = await completeAgentEmailLogin({
      requestId: pending.requestId,
      code: '123456',
    }, dependencies({
      readPending: () => Promise.resolve(pending),
      readProfile: () => Promise.resolve(oldCredentials),
      referencedTokenIds: () => Promise.resolve(new Set([oldCredentials.tokenId])),
      revokePrevious: () => {
        revocations += 1;
        return Promise.resolve();
      },
    }));
    expect(revocations).toBe(0);
    expect(completed.previousCredentialRevoked).toBeNull();
  });
});
