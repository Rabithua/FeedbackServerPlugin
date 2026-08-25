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
    process.env.FEEDBACK_SERVER_BASE_URL = 'https://feedback.example.com/v1/api';
    process.env.FEEDBACK_SERVER_API_TOKEN = `fspat_${'a'.repeat(64)}`;
    process.env.FEEDBACK_SERVER_ADMIN_ID = '11111111-1111-4111-8111-111111111110';
    process.env.FEEDBACK_SERVER_ADMIN_EMAIL = 'owner@example.com';
    process.env.FEEDBACK_SERVER_API_TOKEN_ID = '11111111-1111-4111-8111-111111111112';
    process.env.FEEDBACK_SERVER_API_SCOPES = 'products:read,products:write';
    process.env.FEEDBACK_SERVER_API_TOKEN_EXPIRES_AT = '2027-08-07T00:00:00.000Z';
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
});
