import { describe, expect, test } from 'bun:test';
import {
  listKeychainProfiles,
  preflightNativeCredentialStore,
  readKeychainCredentials,
  readKeychainProfileCredentials,
  readPendingEmailLogin,
  readRecentReauthentication,
  useKeychainProfile,
  writeKeychainProfileCredentials,
  writePendingEmailLogin,
  writeRecentReauthentication,
  type NativeEntryFactory,
  type StoredCredentials,
} from '../src/credentials.js';
import {
  acceptInvitationAndConfigure,
  enrollmentIdForInvitation,
  type InvitationAcceptanceDependencies,
} from '../src/invitation-acceptance.js';
import {
  acceptAdminInvitation,
  acknowledgeInvitationEnrollment,
  revokeCurrentAgentCredential,
} from '../src/invitation-api.js';

const token = `fsinv_${'a'.repeat(48)}`;
const pat = `fspat_${'b'.repeat(64)}`;
const credentials: StoredCredentials = {
  baseUrl: 'https://api.example.com/v1/api',
  adminId: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  tokenId: '22222222-2222-4222-8222-222222222222',
  token: pat,
  scopes: ['products:read', 'products:write'],
  expiresAt: '2027-08-25T00:00:00.000Z',
};

function memoryKeyring(): { factory: NativeEntryFactory; values: Map<string, string> } {
  const values = new Map<string, string>();
  const factory: NativeEntryFactory = (service, account) => {
    const key = `${service}\0${account}`;
    return {
      setPassword(value) {
        values.set(key, value);
        return Promise.resolve();
      },
      getPassword() {
        return Promise.resolve(values.get(key));
      },
      deleteCredential() {
        values.delete(key);
        return Promise.resolve(true);
      },
    };
  };
  return { factory, values };
}

function accepted(enrollmentId: string) {
  return {
    enrollmentId,
    admin: {
      id: credentials.adminId,
      email: credentials.email,
      emailVerifiedAt: '2026-08-25T00:00:00.000Z',
      role: 'admin' as const,
    },
    subscription: {
      plan: 'free' as const,
      term: 'free' as const,
      expiresAt: null,
      graceEndsAt: null,
    },
    credential: {
      id: credentials.tokenId,
      name: 'Codex',
      token: credentials.token,
      scopes: credentials.scopes,
      expiresAt: credentials.expiresAt,
    },
  };
}

describe('native credential storage', () => {
  test('writes, selects, and reads complete v2 profiles without a platform-specific fallback', async () => {
    const keyring = memoryKeyring();
    await preflightNativeCredentialStore(keyring.factory);
    expect([...keyring.values.keys()].some((key) => key.includes('preflight'))).toBe(false);
    await writeKeychainProfileCredentials(credentials, 'work', keyring.factory);
    const second = { ...credentials, email: 'second@example.com', token: `fspat_${'c'.repeat(64)}` };
    await writeKeychainProfileCredentials(second, 'second', keyring.factory);
    expect(await listKeychainProfiles(keyring.factory)).toEqual([
      { name: 'second', active: true },
      { name: 'work', active: false },
    ]);
    expect(await readKeychainCredentials(keyring.factory)).toEqual(second);
    await useKeychainProfile('work', keyring.factory);
    expect(await readKeychainProfileCredentials('work', keyring.factory)).toEqual(credentials);
  });

  test('keeps pending and recent authentication secrets only in the native store and deletes expired values', async () => {
    const keyring = memoryKeyring();
    const requestId = '33333333-3333-4333-8333-333333333333';
    await writePendingEmailLogin({
      version: 1,
      requestId,
      baseUrl: credentials.baseUrl,
      enrollmentSecret: `fsenr_${'s'.repeat(43)}`,
      challengeId: '44444444-4444-4444-8444-444444444444',
      email: credentials.email,
      credentialName: 'Recovery Agent',
      profile: 'work',
      replaceExisting: false,
      previousCredentials: null,
      acceptedTokenId: null,
      expiresAt: '2099-08-25T00:00:00.000Z',
    }, keyring.factory);
    expect(await readPendingEmailLogin(requestId, keyring.factory)).toMatchObject({
      requestId,
      profile: 'work',
    });
    await writeRecentReauthentication({
      version: 1,
      profile: 'work',
      tokenId: credentials.tokenId,
      token: 'short-lived-reauth-token-value',
      expiresAt: '2000-08-25T00:00:00.000Z',
    }, keyring.factory);
    expect(await readRecentReauthentication(
      'work',
      credentials.tokenId,
      keyring.factory,
    )).toBeUndefined();
    expect([...keyring.values.keys()].some((key) => key.includes('recent-reauth'))).toBe(false);
  });
});

describe('passwordless invitation enrollment', () => {
  test('preflights storage, accepts with a stable enrollment, persists the returned PAT, then acknowledges it', async () => {
    const events: string[] = [];
    let stored: StoredCredentials | undefined;
    const dependencies: InvitationAcceptanceDependencies = {
      preflight: () => {
        events.push('preflight');
        return Promise.resolve();
      },
      readProfile: () => {
        events.push('read');
        return Promise.resolve(undefined);
      },
      accept: (_baseUrl, input) => {
        events.push('accept');
        expect(input.token).toBe(token);
        expect(input.enrollmentId).toBe(enrollmentIdForInvitation(token));
        return Promise.resolve(accepted(input.enrollmentId));
      },
      writeProfile: (value) => {
        events.push('write');
        stored = value;
        return Promise.resolve();
      },
      acknowledge: (_baseUrl, input) => {
        events.push('ack');
        expect(input.token).toBe(pat);
        return Promise.resolve();
      },
    };
    const result = await acceptInvitationAndConfigure({
      baseUrl: 'https://api.example.com',
      token,
      profile: 'work',
      credentialName: 'Codex',
    }, dependencies);
    expect(events).toEqual(['preflight', 'read', 'accept', 'write', 'ack']);
    expect(stored).toEqual(credentials);
    expect(result.acknowledged).toBe(true);
    expect(enrollmentIdForInvitation(token)).toBe(enrollmentIdForInvitation(token));
    expect(enrollmentIdForInvitation(`${token}x`)).not.toBe(enrollmentIdForInvitation(token));
  });

  test('does not consume an invitation when native storage preflight fails or the profile is occupied', async () => {
    let accepts = 0;
    const base: InvitationAcceptanceDependencies = {
      preflight: () => Promise.resolve(),
      readProfile: () => Promise.resolve(undefined),
      writeProfile: () => Promise.resolve(),
      accept: (_baseUrl, input) => {
        accepts += 1;
        return Promise.resolve(accepted(input.enrollmentId));
      },
      acknowledge: () => Promise.resolve(),
    };
    let preflightError: unknown;
    try {
      await acceptInvitationAndConfigure({ baseUrl: credentials.baseUrl, token }, {
        ...base,
        preflight: () => Promise.reject(new Error('locked')),
      });
    } catch (error) {
      preflightError = error;
    }
    expect(preflightError).toMatchObject({ message: 'locked' });
    let occupiedError: unknown;
    try {
      await acceptInvitationAndConfigure({ baseUrl: credentials.baseUrl, token }, {
        ...base,
        readProfile: () => Promise.resolve(credentials),
      });
    } catch (error) {
      occupiedError = error;
    }
    expect(occupiedError).toMatchObject({ message: expect.stringContaining('already configured') });
    expect(accepts).toBe(0);
  });

  test('revokes the previous Agent credential only after a replacement is stored', async () => {
    const events: string[] = [];
    const previous = { ...credentials, token: `fspat_${'d'.repeat(64)}`, email: 'old@example.com' };
    const dependencies: InvitationAcceptanceDependencies = {
      preflight: () => Promise.resolve(),
      readProfile: () => Promise.resolve(previous),
      accept: (_baseUrl, input) => Promise.resolve(accepted(input.enrollmentId)),
      writeProfile: () => {
        events.push('write');
        return Promise.resolve();
      },
      acknowledge: () => {
        events.push('ack');
        return Promise.resolve();
      },
      revokePrevious: (baseUrl, value) => {
        events.push('revoke');
        expect(baseUrl).toBe(previous.baseUrl);
        expect(value).toBe(previous.token);
        return Promise.resolve();
      },
    };
    const result = await acceptInvitationAndConfigure({
      baseUrl: credentials.baseUrl,
      token,
      profile: 'work',
      replaceExisting: true,
    }, dependencies);
    expect(events).toEqual(['write', 'ack', 'revoke']);
    expect(result.previousCredentialRevoked).toBe(true);
  });

  test('uses only the new accept and acknowledgement contracts', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const enrollmentId = enrollmentIdForInvitation(token);
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const requestBody = init?.body;
      const body = typeof requestBody === 'string'
        ? JSON.parse(requestBody) as Record<string, unknown>
        : {};
      const headers = new Headers(init?.headers);
      requests.push({ url, body, authorization: headers.get('authorization') });
      return Promise.resolve(Response.json({
        code: 'ok',
        message: 'ok',
        data: url.endsWith('/accept') ? accepted(enrollmentId) : null,
      }));
    }) as typeof fetch;
    await acceptAdminInvitation(credentials.baseUrl, {
      token,
      enrollmentId,
      credentialName: 'Codex',
    }, fetcher);
    await acknowledgeInvitationEnrollment(credentials.baseUrl, {
      enrollmentId,
      token: pat,
    }, fetcher);
    await revokeCurrentAgentCredential(credentials.baseUrl, pat, fetcher);
    expect(requests[0]?.body).toEqual({ token, enrollmentId, credentialName: 'Codex' });
    expect(requests[0]?.authorization).toBeNull();
    expect(requests[1]?.body).toEqual({ enrollmentId });
    expect(requests[1]?.authorization).toBe(`Bearer ${pat}`);
    expect(requests[2]).toEqual({
      url: 'https://api.example.com/v1/api/admin/auth/api-tokens/current',
      body: {},
      authorization: `Bearer ${pat}`,
    });
  });
});
