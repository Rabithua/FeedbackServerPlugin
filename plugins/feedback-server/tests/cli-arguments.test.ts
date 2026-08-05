import { describe, expect, test } from 'bun:test';
import { parseCliOptions, parseIntegerOption } from '../src/cli-arguments.js';
import { isHelpRequest, parseFeedbackServerCliCommand, usage } from '../src/cli.js';

describe('CLI argument policy', () => {
  test('accepts only declared non-secret options', () => {
    const options = parseCliOptions(
      ['--url', 'https://feedback.example.com', '--expires-in-days', '9'],
      ['--url', '--expires-in-days'],
    );
    expect(options.get('--url')).toBe('https://feedback.example.com');
    expect(parseIntegerOption(options, '--expires-in-days', 7, 1, 30)).toBe(9);
  });

  test('rejects secret and unknown arguments', () => {
    expect(() => parseCliOptions(['--password', 'secret'], ['--url'])).toThrow(
      'Unsupported option: --password',
    );
    expect(() => parseCliOptions(['--secret', 'value'], ['--url'])).toThrow(
      'Unsupported option: --secret',
    );
  });

  test('allows invitation tokens only when a command explicitly declares them', () => {
    const options = parseCliOptions(
      ['--token', 'fsinv_time_limited'],
      ['--token'],
    );
    expect(options.get('--token')).toBe('fsinv_time_limited');
  });

  test('rejects missing, duplicate, and out-of-range values', () => {
    expect(() => parseCliOptions(['--url'], ['--url'])).toThrow('Missing value');
    expect(() => parseCliOptions(['--url', 'a', '--url', 'b'], ['--url'])).toThrow(
      'only be provided once',
    );
    const options = new Map([['--expires-in-days', '31']]);
    expect(() => parseIntegerOption(options, '--expires-in-days', 7, 1, 30)).toThrow(
      '1 through 30',
    );
  });

  test('dispatches every public multi-agent command without treating options as subcommands', () => {
    expect(parseFeedbackServerCliCommand(['agent', 'configure', '--url', 'https://example.com']))
      .toEqual({
        command: 'agent configure',
        options: ['--url', 'https://example.com'],
      });
    expect(parseFeedbackServerCliCommand(['agent', 'disconnect'])).toEqual({
      command: 'agent disconnect',
      options: [],
    });
    expect(parseFeedbackServerCliCommand(['agent', 'revoke-token', '--id', 'id'])).toEqual({
      command: 'agent revoke-token',
      options: ['--id', 'id'],
    });
    expect(parseFeedbackServerCliCommand(['admin', 'invite', '--expires-in-days', '7']))
      .toEqual({ command: 'admin invite', options: ['--expires-in-days', '7'] });
    expect(parseFeedbackServerCliCommand(['admin', 'invite', '--delivery', 'clipboard']))
      .toEqual({ command: 'admin invite', options: ['--delivery', 'clipboard'] });
    expect(parseFeedbackServerCliCommand(['admin', 'invitations'])).toEqual({
      command: 'admin invitations',
      options: [],
    });
    expect(parseFeedbackServerCliCommand(['admin', 'invite', 'revoke', '--id', 'id']))
      .toEqual({ command: 'admin invite revoke', options: ['--id', 'id'] });
    expect(parseFeedbackServerCliCommand(['admin', 'accept-invite'])).toEqual({
      command: 'admin accept-invite',
      options: [],
    });
    expect(parseFeedbackServerCliCommand(['admin', 'accept-invite', '--token', 'fsinv_abc']))
      .toEqual({ command: 'admin accept-invite', options: ['--token', 'fsinv_abc'] });
    expect(parseFeedbackServerCliCommand(['admin', 'create-local'])).toEqual({
      command: 'admin create-local',
      options: [],
    });
  });

  test('recognizes help requests before strict option parsing', () => {
    expect(isHelpRequest([])).toBe(true);
    expect(isHelpRequest(['admin', 'invite', '--help'])).toBe(true);
    expect(usage).toContain('feedback-server admin invite');
    expect(usage).toContain('--delivery stdout|clipboard');
    expect(usage).toContain('--token INVITATION_TOKEN');
  });
});
