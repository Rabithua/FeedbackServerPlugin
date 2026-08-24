import { afterEach, describe, expect, test } from 'bun:test';
import {
  bindAdministratorEmail,
  resetAdministratorPassword,
} from '../src/account-email.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('visible-terminal account email flows', () => {
  test('binds an email through a temporary interactive session and logs out', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      const data = path.endsWith('/login')
        ? { accessToken: 'access', refreshToken: 'refresh' }
        : path.endsWith('/challenges')
          ? { challengeId: '11111111-1111-4111-8111-111111111111', expiresAt: '2026-09-01T00:00:00.000Z' }
          : path.endsWith('/verify')
            ? { email: 'owner@example.com', verifiedAt: '2026-08-24T00:00:00.000Z' }
            : null;
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const result = await bindAdministratorEmail({
      baseUrl: 'https://api.feedkit.cn/v1/api',
      identifier: 'owner@example.com',
      password: 'hidden-password',
      email: 'Owner@Example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
    });
    expect(result.email).toBe('owner@example.com');
    expect(requests.map(({ method }) => method)).toEqual(['POST', 'POST', 'POST', 'POST']);
    expect(await requests[0]!.json()).toEqual({
      identifier: 'owner@example.com',
      password: 'hidden-password',
    });
    expect(await requests[1]!.json()).toEqual({
      email: 'Owner@Example.com',
      password: 'hidden-password',
    });
    expect(await requests[2]!.json()).toEqual({
      challengeId: '11111111-1111-4111-8111-111111111111',
      code: 'fsemail_hidden-code',
    });
    expect(await requests[3]!.json()).toEqual({ refreshToken: 'refresh' });
  });

  test('requests and confirms a password reset without an authenticated session', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = new URL(request.url).pathname.endsWith('/request')
        ? { requestId: '22222222-2222-4222-8222-222222222222', expiresAt: '2026-09-01T00:00:00.000Z' }
        : null;
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    await resetAdministratorPassword({
      baseUrl: 'https://api.feedkit.cn/v1/api',
      identifier: 'owner@example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
      readNewPassword: () => Promise.resolve('new-correct-horse-battery-staple'),
    });
    expect(requests).toHaveLength(2);
    expect(await requests[0]!.json()).toEqual({ identifier: 'owner@example.com' });
    expect(await requests[1]!.json()).toEqual({
      requestId: '22222222-2222-4222-8222-222222222222',
      code: 'fsemail_hidden-code',
      newPassword: 'new-correct-horse-battery-staple',
    });
    expect(requests.every((request) => request.headers.get('authorization') === null)).toBe(true);
  });
});
