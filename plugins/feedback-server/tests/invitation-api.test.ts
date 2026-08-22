import { describe, expect, test } from 'bun:test';
import {
  appliedSubscriptionMatchesGrant,
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

  test('distinguishes monthly and yearly applied subscriptions using UTC calendar terms', () => {
    const acceptanceWindow = {
      earliest: new Date('2028-01-31T12:34:56.789Z'),
      latest: new Date('2028-01-31T12:34:57.789Z'),
    };
    const monthly = {
      plan: 'solo' as const,
      term: 'fixed' as const,
      expiresAt: '2028-02-29T12:34:57.000Z',
      graceEndsAt: '2028-03-07T12:34:57.000Z',
    };
    const yearly = {
      plan: 'solo' as const,
      term: 'fixed' as const,
      expiresAt: '2029-01-31T12:34:57.000Z',
      graceEndsAt: '2029-02-07T12:34:57.000Z',
    };

    expect(appliedSubscriptionMatchesGrant(
      monthly,
      { plan: 'solo', term: 'month' },
      acceptanceWindow,
    )).toBe(true);
    expect(appliedSubscriptionMatchesGrant(
      monthly,
      { plan: 'solo', term: 'year' },
      acceptanceWindow,
    )).toBe(false);
    expect(appliedSubscriptionMatchesGrant(
      yearly,
      { plan: 'solo', term: 'year' },
      acceptanceWindow,
    )).toBe(true);
    expect(appliedSubscriptionMatchesGrant(
      yearly,
      { plan: 'solo', term: 'month' },
      acceptanceWindow,
    )).toBe(false);
  });

  test('requires the exact seven-day grace period and an acceptance window for fixed terms', () => {
    const applied = {
      plan: 'studio' as const,
      term: 'fixed' as const,
      expiresAt: '2029-02-28T12:00:00.000Z',
      graceEndsAt: '2029-03-07T12:00:00.000Z',
    };
    const leapDayAcceptance = {
      earliest: new Date('2028-02-29T12:00:00.000Z'),
      latest: new Date('2028-02-29T12:00:01.000Z'),
    };

    expect(appliedSubscriptionMatchesGrant(
      applied,
      { plan: 'studio', term: 'year' },
      leapDayAcceptance,
    )).toBe(true);
    expect(appliedSubscriptionMatchesGrant(
      { ...applied, graceEndsAt: '2029-03-08T12:00:00.000Z' },
      { plan: 'studio', term: 'year' },
      leapDayAcceptance,
    )).toBe(false);
    expect(appliedSubscriptionMatchesGrant(
      applied,
      { plan: 'studio', term: 'year' },
    )).toBe(false);
  });

  test('validates clamped expiry candidates when the acceptance window crosses UTC midnight', () => {
    const cases = [
      {
        grant: { plan: 'solo', term: 'month' } as const,
        acceptanceWindow: {
          earliest: new Date('2028-01-29T23:59:30.000Z'),
          latest: new Date('2028-01-30T00:00:30.000Z'),
        },
        expiresAt: '2028-02-29T00:00:00.000Z',
        graceEndsAt: '2028-03-07T00:00:00.000Z',
      },
      {
        grant: { plan: 'studio', term: 'year' } as const,
        acceptanceWindow: {
          earliest: new Date('2028-02-28T23:59:30.000Z'),
          latest: new Date('2028-02-29T00:00:30.000Z'),
        },
        expiresAt: '2029-02-28T00:00:00.000Z',
        graceEndsAt: '2029-03-07T00:00:00.000Z',
      },
    ];

    for (const testCase of cases) {
      expect(appliedSubscriptionMatchesGrant(
        {
          plan: testCase.grant.plan,
          term: 'fixed',
          expiresAt: testCase.expiresAt,
          graceEndsAt: testCase.graceEndsAt,
        },
        testCase.grant,
        testCase.acceptanceWindow,
      )).toBe(true);
    }

    expect(appliedSubscriptionMatchesGrant(
      {
        plan: 'solo',
        term: 'fixed',
        expiresAt: '2028-02-29T12:00:00.000Z',
        graceEndsAt: '2028-03-07T12:00:00.000Z',
      },
      { plan: 'solo', term: 'month' },
      cases[0]!.acceptanceWindow,
    )).toBe(false);
  });
});
