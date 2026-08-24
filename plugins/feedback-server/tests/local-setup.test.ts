import { describe, expect, test } from 'bun:test';
import { prepareLocalSetup } from '../src/local-setup.js';

describe('local setup preparation', () => {
  test('prepares account configuration from the installed bundle without credentials', () => {
    const result = prepareLocalSetup(
      { flow: 'configure_account' },
      "/tmp/Feedback Server's Plugin/bin/feedback-server",
    );
    expect(result).toMatchObject({
      status: 'ready',
      flow: 'configure_account',
      requiresVisibleTerminal: true,
      executesCommand: false,
      reloadAfterSuccess: false,
    });
    expect(result.command).toBe(
      "'/tmp/Feedback Server'\\''s Plugin/bin/feedback-server' 'agent' 'configure'",
    );
  });

  test('prepares an explicit global profile without exposing credentials', () => {
    const result = prepareLocalSetup(
      { flow: 'configure_account', profile: 'work.production' },
      '/tmp/plugin/bin/feedback-server',
    );
    expect(result.command).toBe(
      "'/tmp/plugin/bin/feedback-server' 'agent' 'configure' '--profile' 'work.production'",
    );
  });

  test('validates and shell-quotes an invitation acceptance command', () => {
    const result = prepareLocalSetup({
      flow: 'accept_invitation',
      baseUrl: 'https://feedback.example.com',
      invitationToken: `fsinv_${'x'.repeat(48)}`,
      username: 'invited-admin',
      displayName: "O'Connor Admin",
    }, '/tmp/plugin/bin/feedback-server');
    expect(result.command).toContain("'admin' 'accept-invite'");
    expect(result.command).toContain("'https://feedback.example.com/v1/api'");
    expect(result.command).toContain("'O'\\''Connor Admin'");
    expect(result.command).not.toContain('password');
    expect(result.command).not.toContain('fspat_');
  });

  test('rejects incomplete and flow-inappropriate invitation fields', () => {
    expect(() => prepareLocalSetup({
      flow: 'accept_invitation',
      baseUrl: 'https://feedback.example.com',
    }, '/tmp/plugin/bin/feedback-server')).toThrow('invitationToken is required');
    expect(() => prepareLocalSetup({
      flow: 'configure_account',
      username: 'unexpected',
    }, '/tmp/plugin/bin/feedback-server')).toThrow('username is only valid');
    expect(() => prepareLocalSetup({
      flow: 'accept_invitation',
      baseUrl: 'https://feedback.example.com',
      invitationToken: `fsinv_${'x'.repeat(48)}`,
      username: 'invited-admin',
      displayName: 'Invited Admin',
      profile: 'work',
    }, '/tmp/plugin/bin/feedback-server')).toThrow('profile is only valid');
  });

  test('rejects automatic setup on platforms without macOS Keychain', () => {
    expect(() => prepareLocalSetup(
      { flow: 'configure_account' },
      '/tmp/plugin/bin/feedback-server',
      'linux',
    )).toThrow('FEEDBACK_SERVER_BASE_URL and FEEDBACK_SERVER_API_TOKEN together');
  });
});
