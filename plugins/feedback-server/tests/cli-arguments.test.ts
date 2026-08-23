import { describe, expect, test } from 'bun:test';
import { parseCliOptions, parseIntegerOption } from '../src/cli-arguments.js';
import {
  AGENT_ONBOARDING_PROMPT,
  agentConfigurationCompletionMessage,
  isHelpRequest,
  parseExistingAgentChoice,
  parseFeedbackServerCliCommand,
  parseInvitationSubscriptionGrant,
  usage,
} from '../src/cli.js';

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
    expect(parseFeedbackServerCliCommand(['doctor', '--product', 'app']))
      .toEqual({ command: 'doctor', options: ['--product', 'app'] });
    expect(parseFeedbackServerCliCommand(['test', 'roundtrip', '--product', 'app']))
      .toEqual({ command: 'test roundtrip', options: ['--product', 'app'] });
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
    expect(parseFeedbackServerCliCommand(['profile', 'list'])).toEqual({
      command: 'profile list',
      options: [],
    });
    expect(parseFeedbackServerCliCommand(['profile', 'use', 'work'])).toEqual({
      command: 'profile use',
      options: ['work'],
    });
    expect(parseFeedbackServerCliCommand(['profile', 'remove', 'work'])).toEqual({
      command: 'profile remove',
      options: ['work'],
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
    expect(usage).toContain('feedback-server doctor');
    expect(usage).toContain('feedback-server test roundtrip');
    expect(usage).toContain('--delivery stdout|clipboard');
    expect(usage).toContain('--plan free|solo|studio');
    expect(usage).toContain('--subscription-term month|year|perpetual');
    expect(usage).toContain('--token INVITATION_TOKEN');
    expect(usage).toContain('agent configure [--url URL] [--username USERNAME] [--profile NAME]');
    expect(usage).toContain('feedback-server profile use NAME');
  });

  test('defaults existing Agent handling to keep and requires an explicit switch', () => {
    expect(parseExistingAgentChoice('')).toBe('keep');
    expect(parseExistingAgentChoice(' KEEP ')).toBe('keep');
    expect(parseExistingAgentChoice('switch')).toBe('switch');
    expect(() => parseExistingAgentChoice('replace')).toThrow('Choose keep or switch');
  });

  test('validates invitation subscription plan and term combinations', () => {
    expect(parseInvitationSubscriptionGrant(new Map())).toEqual({ plan: 'free' });
    expect(parseInvitationSubscriptionGrant(new Map([['--plan', 'free']]))).toEqual({
      plan: 'free',
    });
    for (const plan of ['solo', 'studio'] as const) {
      for (const term of ['month', 'year', 'perpetual'] as const) {
        expect(parseInvitationSubscriptionGrant(new Map([
          ['--plan', plan],
          ['--subscription-term', term],
        ]))).toEqual({ plan, term });
      }
      expect(() => parseInvitationSubscriptionGrant(new Map([['--plan', plan]])))
        .toThrow('--subscription-term is required');
    }
    expect(() => parseInvitationSubscriptionGrant(new Map([
      ['--plan', 'free'],
      ['--subscription-term', 'month'],
    ]))).toThrow('cannot be used with the Free plan');
    expect(() => parseInvitationSubscriptionGrant(new Map([['--plan', 'indie']])))
      .toThrow('Indie is not supported');
  });

  test('distinguishes account connection from app setup in configure completion text', () => {
    const message = agentConfigurationCompletionMessage('Agent configured.');
    expect(message).toContain('Account connection is complete');
    expect(message).toContain('app configuration is not complete yet');
    expect(message).toContain('Return to the current Agent task');
    expect(message).toContain('next tool call');
    expect(message).toContain(AGENT_ONBOARDING_PROMPT);
  });
});
