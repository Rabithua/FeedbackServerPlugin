import { describe, expect, test } from 'bun:test';
import {
  confirmEmailAgentEnrollment,
  confirmEmailReauthentication,
  requestEmailAgentEnrollment,
  requestEmailChange,
} from '../src/agent-auth-api.js';
import type { StoredCredentials } from '../src/credentials.js';

const credentials: StoredCredentials = {
  baseUrl: 'https://api.example.com/v1/api',
  adminId: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  tokenId: '22222222-2222-4222-8222-222222222222',
  token: `fspat_${'p'.repeat(64)}`,
  scopes: ['products:read'],
  expiresAt: '2027-08-25T00:00:00.000Z',
};

describe('Agent authentication API', () => {
  test('keeps enrollment secrets in the bearer header and codes in JSON bodies', async () => {
    const requests: Request[] = [];
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.url.endsWith('/challenges')
        ? {
            challengeId: '33333333-3333-4333-8333-333333333333',
            expiresAt: '2026-08-25T01:00:00.000Z',
          }
        : {
            enrollmentId: '44444444-4444-4444-8444-444444444444',
            admin: {
              id: credentials.adminId,
              email: credentials.email,
              emailVerifiedAt: '2026-08-25T00:00:00.000Z',
              role: 'admin',
            },
            credential: {
              id: credentials.tokenId,
              name: 'Agent',
              token: credentials.token,
              scopes: credentials.scopes,
              expiresAt: credentials.expiresAt,
            },
          };
      return Promise.resolve(Response.json({ code: 'ok', message: 'ok', data }));
    }) as typeof fetch;
    const enrollmentSecret = `fsenr_${'s'.repeat(43)}`;
    await requestEmailAgentEnrollment(credentials.baseUrl, {
      email: credentials.email,
      enrollmentId: '44444444-4444-4444-8444-444444444444',
      enrollmentSecret,
      credentialName: 'Agent',
    }, fetcher);
    await confirmEmailAgentEnrollment(credentials.baseUrl, {
      enrollmentId: '44444444-4444-4444-8444-444444444444',
      enrollmentSecret,
      challengeId: '33333333-3333-4333-8333-333333333333',
      code: '123456',
    }, fetcher);
    expect(requests[0]?.headers.get('authorization')).toBeNull();
    expect(requests[0]?.url).not.toContain(enrollmentSecret);
    expect(requests[1]?.headers.get('authorization')).toBe(`Bearer ${enrollmentSecret}`);
    expect(requests[1]?.url).not.toContain('123456');
    const confirmationRequest = requests[1];
    if (!confirmationRequest) throw new Error('Missing confirmation request');
    expect(await confirmationRequest.json()).toEqual({
      challengeId: '33333333-3333-4333-8333-333333333333',
      code: '123456',
    });
  });

  test('binds reauthentication and email change to the current PAT without returning it in requests', async () => {
    const requests: Request[] = [];
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.url.endsWith('/confirm')
        ? { reauthToken: 'short-lived-reauth-token-value', expiresAt: '2026-08-25T01:00:00.000Z' }
        : { challengeId: '33333333-3333-4333-8333-333333333333', expiresAt: '2026-08-25T01:00:00.000Z' };
      return Promise.resolve(Response.json({ code: 'ok', message: 'ok', data }));
    }) as typeof fetch;
    const reauth = await confirmEmailReauthentication(credentials, {
      challengeId: '33333333-3333-4333-8333-333333333333',
      code: '654321',
    }, fetcher);
    await requestEmailChange(
      credentials,
      reauth.reauthToken,
      'new@example.com',
      fetcher,
    );
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${credentials.token}`);
    expect(requests[0]?.url).not.toContain(credentials.token);
    expect(requests[1]?.headers.get('x-feedbackkit-reauth')).toBe(reauth.reauthToken);
    expect(requests[1]?.headers.get('authorization')).toBe(`Bearer ${credentials.token}`);
  });
});
