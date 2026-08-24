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
});
