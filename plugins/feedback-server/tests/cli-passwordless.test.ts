import { describe, expect, test } from 'bun:test';
import { runFeedbackServerCli } from '../src/cli.js';

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
});
