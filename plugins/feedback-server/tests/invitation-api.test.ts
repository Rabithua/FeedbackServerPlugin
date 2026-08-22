import { describe, expect, test } from 'bun:test';
import {
  createAdminInvitation,
  type CreatedInvitation,
} from '../src/invitation-api.js';

describe('invitation API contract', () => {
  test('sends the requested normalized subscription grant in the creation body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const invitation: CreatedInvitation = {
      id: '11111111-1111-4111-8111-111111111111',
      token: `fsinv_${'x'.repeat(48)}`,
      tokenPrefix: 'fsinv_xxxxxxxxxxxx',
      status: 'pending',
      createdByAdminId: '22222222-2222-4222-8222-222222222222',
      acceptedByAdminId: null,
      expiresAt: '2026-08-29T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-08-22T00:00:00.000Z',
      subscriptionGrant: { plan: 'studio', term: 'year' },
    };
    globalThis.fetch = ((input, init) => {
      capturedUrl = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
      capturedInit = init;
      return Promise.resolve(Response.json({ code: 'ok', message: 'ok', data: invitation }));
    }) as typeof fetch;
    try {
      const result = await createAdminInvitation(
        'https://feedback.example.com/v1/api',
        'access-token',
        9,
        { plan: 'studio', term: 'year' },
      );
      expect(result.subscriptionGrant).toEqual({ plan: 'studio', term: 'year' });
      expect(capturedUrl).toBe(
        'https://feedback.example.com/v1/api/admin/auth/invitations',
      );
      expect(capturedInit?.method).toBe('POST');
      const requestBody = capturedInit?.body;
      if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body');
      expect(JSON.parse(requestBody)).toEqual({
        expiresInDays: 9,
        subscriptionGrant: { plan: 'studio', term: 'year' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
