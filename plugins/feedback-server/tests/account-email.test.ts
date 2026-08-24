import { afterEach, describe, expect, test } from 'bun:test';
import {
  bindAdministratorEmail,
  resetAdministratorPassword,
} from '../src/account-email.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

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
      baseUrl: 'https://api.feedkit.cn',
      identifier: 'owner@example.com',
      password: 'hidden-password',
      email: 'Owner@Example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
    });
    expect(result.email).toBe('owner@example.com');
    expect(requests.map(({ method }) => method)).toEqual(['POST', 'POST', 'POST', 'POST']);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/api/admin/auth/login',
      '/v1/api/admin/auth/email/challenges',
      '/v1/api/admin/auth/email/verify',
      '/v1/api/admin/auth/logout',
    ]);
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
      baseUrl: 'https://api.feedkit.cn',
      identifier: 'owner@example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
      readNewPassword: () => Promise.resolve('new-correct-horse-battery-staple'),
      ensureInteractive: () => undefined,
    });
    expect(requests).toHaveLength(2);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/api/admin/auth/password-reset/request',
      '/v1/api/admin/auth/password-reset/confirm',
    ]);
    expect(await requests[0]!.json()).toEqual({ identifier: 'owner@example.com' });
    expect(await requests[1]!.json()).toEqual({
      requestId: '22222222-2222-4222-8222-222222222222',
      code: 'fsemail_hidden-code',
      newPassword: 'new-correct-horse-battery-staple',
    });
    expect(requests.every((request) => request.headers.get('authorization') === null)).toBe(true);
  });

  test('rejects unsafe remote HTTP URLs before transmitting account secrets', async () => {
    let requestCount = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      new Request(input, init);
      requestCount += 1;
      return Promise.reject(new Error('must not send'));
    }) as typeof fetch;

    const bindError = await capturedError(bindAdministratorEmail({
      baseUrl: 'http://feedback.example.com',
      identifier: 'owner',
      password: 'hidden-password',
      email: 'owner@example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
    }));
    const resetError = await capturedError(resetAdministratorPassword({
      baseUrl: 'http://feedback.example.com',
      identifier: 'owner',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
      readNewPassword: () => Promise.resolve('new-correct-horse-battery-staple'),
      ensureInteractive: () => undefined,
    }));
    expect(bindError).toBeInstanceOf(Error);
    expect((bindError as Error).message).toContain('must use HTTPS');
    expect(resetError).toBeInstanceOf(Error);
    expect((resetError as Error).message).toContain('must use HTTPS');
    expect(requestCount).toBe(0);
  });

  test('checks interactivity before consuming reset email and rate-limit capacity', async () => {
    let requestCount = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      new Request(input, init);
      requestCount += 1;
      return Promise.reject(new Error('must not send'));
    }) as typeof fetch;

    const error = await capturedError(resetAdministratorPassword({
      baseUrl: 'https://api.feedkit.cn',
      identifier: 'owner',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
      readNewPassword: () => Promise.resolve('new-correct-horse-battery-staple'),
      ensureInteractive: () => {
        throw new Error('A TTY is required for hidden password input');
      },
    }));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('A TTY is required');
    expect(requestCount).toBe(0);
  });

  test('warns when binding commits but temporary-session logout fails', async () => {
    const warnings: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const request = new Request(input);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/logout')) {
        return Promise.resolve(Response.json(
          { code: 'internal_error', message: 'Internal server error', data: null },
          { status: 500 },
        ));
      }
      const data = path.endsWith('/login')
        ? { accessToken: 'access', refreshToken: 'refresh' }
        : path.endsWith('/challenges')
          ? { challengeId: '11111111-1111-4111-8111-111111111111', expiresAt: '2026-09-01T00:00:00.000Z' }
          : { email: 'owner@example.com', verifiedAt: '2026-08-24T00:00:00.000Z' };
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const result = await bindAdministratorEmail({
      baseUrl: 'https://api.feedkit.cn',
      identifier: 'owner',
      password: 'hidden-password',
      email: 'owner@example.com',
      readCode: () => Promise.resolve('fsemail_hidden-code'),
      warn: (message) => warnings.push(message),
    });
    expect(result.email).toBe('owner@example.com');
    expect(warnings).toEqual([
      'Warning: unable to revoke the temporary email-binding session; it will expire automatically.',
    ]);
  });
});
