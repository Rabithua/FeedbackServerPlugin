import { describe, expect, test } from 'bun:test';
import {
  runAdminAcceptInvite,
  type AdminAcceptInviteDependencies,
} from '../src/cli.js';
import type { StoredCredentials } from '../src/credentials.js';

const existingCredentials: StoredCredentials = {
  baseUrl: 'https://current.example.com/v1/api',
  token: `fspat_${'a'.repeat(48)}`,
  tokenId: '11111111-1111-4111-8111-111111111111',
  username: 'current-admin',
};

function dependencies(
  events: string[],
  overrides: Partial<AdminAcceptInviteDependencies> = {},
): AdminAcceptInviteDependencies {
  return {
    readCredentials: () => {
      events.push('read-credentials');
      return Promise.resolve(existingCredentials);
    },
    promptText: (label, defaultValue) => {
      events.push(`text:${label}`);
      return Promise.resolve(defaultValue ?? '');
    },
    promptPassword: (label) => {
      events.push(`password:${label}`);
      return Promise.reject(new Error('unexpected password prompt'));
    },
    disconnect: () => {
      events.push('disconnect');
      return Promise.reject(new Error('unexpected disconnect'));
    },
    configure: () => {
      events.push('configure');
      return Promise.reject(new Error('unexpected configure'));
    },
    acceptInvitation: () => {
      events.push('accept-invitation');
      return Promise.reject(new Error('unexpected invitation acceptance'));
    },
    log: (message) => events.push(`log:${message}`),
    ...overrides,
  };
}

const options = [
  '--url',
  'https://invited.example.com/v1/api',
  '--token',
  `fsinv_${'b'.repeat(48)}`,
  '--username',
  'invited-admin',
  '--display-name',
  'Invited Admin',
];

describe('accept-invite existing Agent choice', () => {
  test('keeps the existing account by default without reading passwords or consuming the invite', async () => {
    const events: string[] = [];
    await runAdminAcceptInvite(options, dependencies(events));

    expect(events[0]).toBe('read-credentials');
    expect(events).toContain(
      'text:Enter keep to use the existing account, or switch to replace it with the invited account',
    );
    expect(events.some((event) => event.startsWith('password:'))).toBe(false);
    expect(events).not.toContain('disconnect');
    expect(events).not.toContain('configure');
    expect(events).not.toContain('accept-invitation');
    expect(events.some((event) => event.includes('the invitation was not consumed'))).toBe(true);
    expect(events.some((event) => event.includes('shared by every'))).toBe(true);
  });

  test('reprompts an invalid account choice instead of exiting or switching', async () => {
    const events: string[] = [];
    const choices = ['replace', ''];
    await runAdminAcceptInvite(
      options,
      dependencies(events, {
        promptText: (label) => {
          events.push(`text:${label}`);
          return Promise.resolve(choices.shift() ?? '');
        },
      }),
    );

    expect(events.filter((event) => event.startsWith('text:'))).toHaveLength(2);
    expect(events.some((event) => event.includes('Please enter keep or switch'))).toBe(true);
    expect(events).not.toContain('disconnect');
    expect(events).not.toContain('accept-invitation');
  });

  test('switches only after an explicit choice and disconnects before accepting', async () => {
    const events: string[] = [];
    const newPassword = 'new-administrator-password';
    await runAdminAcceptInvite(
      options,
      dependencies(events, {
        promptText: (label) => {
          events.push(`text:${label}`);
          return Promise.resolve('switch');
        },
        promptPassword: (label) => {
          events.push(`password:${label}`);
          return Promise.resolve(
            label?.startsWith('Current administrator') ? 'current-password' : newPassword,
          );
        },
        disconnect: (input) => {
          events.push(`disconnect:${input.username}:${input.password}`);
          return Promise.resolve(true);
        },
        acceptInvitation: (input) => {
          events.push(`accept-invitation:${input.username}:${input.password}`);
          return Promise.resolve({
            baseUrl: input.baseUrl,
            token: `fspat_${'c'.repeat(48)}`,
            username: input.username,
          });
        },
      }),
    );

    const warningIndex = events.findIndex((event) => event.includes('Switching will revoke'));
    const disconnectIndex = events.indexOf('disconnect:current-admin:current-password');
    const acceptIndex = events.indexOf(`accept-invitation:invited-admin:${newPassword}`);
    expect(warningIndex).toBeGreaterThan(-1);
    expect(disconnectIndex).toBeGreaterThan(warningIndex);
    expect(acceptIndex).toBeGreaterThan(disconnectIndex);
    expect(events).not.toContain('configure');
  });

  test('restores the previous account automatically when acceptance fails after disconnect', async () => {
    const events: string[] = [];
    const invitationError = new Error('invitation expired');
    let credentialReads = 0;
    let thrown: unknown;
    try {
      await runAdminAcceptInvite(
        options,
        dependencies(events, {
          readCredentials: () => {
            credentialReads += 1;
            events.push('read-credentials');
            return Promise.resolve(credentialReads === 1 ? existingCredentials : undefined);
          },
          promptText: (label) => {
            events.push(`text:${label}`);
            return Promise.resolve('switch');
          },
          promptPassword: (label) => {
            events.push(`password:${label}`);
            return Promise.resolve(
              label?.startsWith('Current administrator')
                ? 'current-password'
                : 'new-administrator-password',
            );
          },
          disconnect: () => {
            events.push('disconnect');
            return Promise.resolve(true);
          },
          acceptInvitation: () => {
            events.push('accept-invitation');
            return Promise.reject(invitationError);
          },
          configure: (input) => {
            events.push(`configure:${input.username}:${input.password}`);
            return Promise.resolve(existingCredentials);
          },
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(invitationError);
    expect(events.indexOf('accept-invitation')).toBeLessThan(
      events.indexOf('configure:current-admin:current-password'),
    );
    expect(events.some((event) => event.includes('restored automatically'))).toBe(true);
  });

  test('does not overwrite active invited credentials when acceptance reports a late error', async () => {
    const events: string[] = [];
    const lateError = new Error('post-configuration cleanup failed');
    const invitedCredentials: StoredCredentials = {
      baseUrl: 'https://invited.example.com/v1/api',
      token: `fspat_${'d'.repeat(48)}`,
      username: 'invited-admin',
    };
    let credentialReads = 0;
    let thrown: unknown;
    try {
      await runAdminAcceptInvite(
        options,
        dependencies(events, {
          readCredentials: () => {
            credentialReads += 1;
            return Promise.resolve(
              credentialReads === 1 ? existingCredentials : invitedCredentials,
            );
          },
          promptText: () => Promise.resolve('switch'),
          promptPassword: (label) => Promise.resolve(
            label?.startsWith('Current administrator')
              ? 'current-password'
              : 'new-administrator-password',
          ),
          disconnect: () => Promise.resolve(true),
          acceptInvitation: () => Promise.reject(lateError),
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(lateError);
    expect(events).not.toContain('configure');
    expect(events.some((event) => event.includes('invited-admin'))).toBe(true);
    expect(events.some((event) => event.includes('previous account was not restored'))).toBe(true);
  });
});
