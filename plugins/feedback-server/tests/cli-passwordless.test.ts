import { describe, expect, spyOn, test } from 'bun:test';
import { runFeedbackServerCli } from '../src/cli.js';

function clearCredentialsEnvironment(): void {
  delete process.env.FEEDBACK_SERVER_BASE_URL;
  delete process.env.FEEDBACK_SERVER_API_TOKEN;
  delete process.env.FEEDBACK_SERVER_ADMIN_ID;
  delete process.env.FEEDBACK_SERVER_ADMIN_EMAIL;
  delete process.env.FEEDBACK_SERVER_API_TOKEN_ID;
  delete process.env.FEEDBACK_SERVER_API_SCOPES;
  delete process.env.FEEDBACK_SERVER_API_TOKEN_EXPIRES_AT;
}

function setCredentialsEnvironment(): void {
  process.env.FEEDBACK_SERVER_BASE_URL = 'https://feedback.example.com/v1/api';
  process.env.FEEDBACK_SERVER_API_TOKEN = `fspat_${'a'.repeat(64)}`;
  process.env.FEEDBACK_SERVER_ADMIN_ID = '11111111-1111-4111-8111-111111111110';
  process.env.FEEDBACK_SERVER_ADMIN_EMAIL = 'owner@example.com';
  process.env.FEEDBACK_SERVER_API_TOKEN_ID = '11111111-1111-4111-8111-111111111112';
  process.env.FEEDBACK_SERVER_API_SCOPES = 'products:read,products:write';
  process.env.FEEDBACK_SERVER_API_TOKEN_EXPIRES_AT = '2027-08-07T00:00:00.000Z';
}

describe('FeedbackKit passwordless CLI', () => {
  test('never accepts an invitation token as a command argument', async () => {
    let error: unknown;
    try {
      await runFeedbackServerCli([
        'accept-invite',
        '--token',
        `fsinv_${'a'.repeat(48)}`,
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ message: 'Unsupported option: --token' });
  });

  test('never accepts an email code as a command argument', async () => {
    let error: unknown;
    try {
      await runFeedbackServerCli([
        'login',
        'email',
        'complete',
        '--request',
        '11111111-1111-4111-8111-111111111111',
        '--code',
        '123456',
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ message: 'Unsupported option: --code' });
  });

  test('requires an explicit notification choice after Product creation', async () => {
    const originalFetch = globalThis.fetch;
    const output: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    setCredentialsEnvironment();
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/v1/api/admin/products');
      expect(await request.json()).toMatchObject({
        name: 'Peelit',
        slug: 'peelit',
        defaultLocale: 'zh-Hans',
      });
      return Response.json({
        code: 'ok',
        message: 'success',
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'peelit',
          name: 'Peelit',
          publishableKey: 'pk_test_product',
        },
      }, { status: 201 });
    }) as typeof fetch;

    try {
      await runFeedbackServerCli([
        'product',
        'create',
        '--name',
        'Peelit',
        '--platform',
        'ios',
        '--locale',
        'zh-Hans',
      ]);
      expect(JSON.parse(output.join(''))).toMatchObject({
        name: 'Peelit',
        slug: 'peelit',
        nextActions: [{
          id: 'configure_notification',
          requiresUserChoice: true,
          choices: ['bark', 'webhook', 'defer'],
        }],
      });
    } finally {
      globalThis.fetch = originalFetch;
      write.mockRestore();
      clearCredentialsEnvironment();
    }
  });

  test('shows notification choices in the default onboarding text output', async () => {
    const originalFetch = globalThis.fetch;
    const output: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    setCredentialsEnvironment();
    globalThis.fetch = ((input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname.replace('/v1/api', '');
      const data = path === '/admin/products'
        ? [{
            id: '11111111-1111-4111-8111-111111111111',
            slug: 'peelit',
            name: 'Peelit',
            defaultLocale: 'zh-Hans',
            status: 'active',
            notificationSetupPreference: 'unresolved',
          }]
        : path === '/admin/subscription'
          ? {
              declaredPlan: 'free',
              effectivePlan: 'free',
              lifecycle: 'free',
              term: 'free',
              expiresAt: null,
              graceEndsAt: null,
              primaryProductId: '11111111-1111-4111-8111-111111111111',
              revision: 1,
              limits: { maxProducts: 1, storageBytes: 262_144_000 },
              features: { diagnostics: false, webhooks: false, appStoreImport: false, bark: true },
              usage: {
                products: 1,
                storage: { finalizedBytes: 0, reservedBytes: 0, totalBytes: 0 },
              },
              products: [{
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Peelit',
                access: 'read_write',
              }],
            }
          : {};
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    try {
      await runFeedbackServerCli(['onboarding', 'status']);
      expect(output.join('')).toContain('Next actions:');
      expect(output.join('')).toContain('Choices: bark, webhook, defer');
    } finally {
      globalThis.fetch = originalFetch;
      write.mockRestore();
      clearCredentialsEnvironment();
    }
  });

  test('persists a defer choice immediately through the CLI', async () => {
    const originalFetch = globalThis.fetch;
    const output: string[] = [];
    const write = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    setCredentialsEnvironment();
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('PUT');
      expect(new URL(request.url).pathname).toBe(
        '/v1/api/admin/products/11111111-1111-4111-8111-111111111111/notification-setup',
      );
      expect(await request.json()).toEqual({ preference: 'deferred' });
      return Response.json({
        code: 'ok',
        message: 'success',
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Peelit',
          notificationSetupPreference: 'deferred',
        },
      });
    }) as typeof fetch;

    try {
      await runFeedbackServerCli([
        'notification',
        'preference',
        'set',
        '--product',
        '11111111-1111-4111-8111-111111111111',
        '--choice',
        'defer',
      ]);
      expect(JSON.parse(output.join(''))).toMatchObject({
        choice: 'defer',
        preference: 'deferred',
        nextActions: [],
        product: { notificationSetupPreference: 'deferred' },
      });
    } finally {
      globalThis.fetch = originalFetch;
      write.mockRestore();
      clearCredentialsEnvironment();
    }
  });
});
