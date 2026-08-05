import { describe, expect, test } from 'bun:test';
import {
  ConfigurationApiError,
} from '../src/admin-session.js';
import {
  MissingAdministratorPasswordError,
  RejectedAdministratorPasswordError,
  withAdministratorPassword,
  type AdministratorPasswordDependencies,
} from '../src/admin-password.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const username = 'owner';

function dependencies(
  overrides: Partial<AdministratorPasswordDependencies> = {},
): AdministratorPasswordDependencies {
  return {
    readPassword: () => Promise.resolve('stored-password'),
    deletePassword: () => Promise.resolve(),
    warn: () => {},
    ...overrides,
  };
}

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('administrator password Keychain lookup', () => {
  test('uses the stored administrator password without prompting', async () => {
    const result = await withAdministratorPassword(
      { baseUrl, username },
      (password) => Promise.resolve(`used:${password}`),
      dependencies(),
    );
    expect(result).toBe('used:stored-password');
  });

  test('fails fast when the administrator password is missing from Keychain', async () => {
    let operationCalled = false;
    const error = await capturedError(
      withAdministratorPassword(
        { baseUrl, username },
        () => {
          operationCalled = true;
          return Promise.resolve('unused');
        },
        dependencies({ readPassword: () => Promise.resolve(undefined) }),
      ),
    );
    expect(operationCalled).toBe(false);
    expect(error).toBeInstanceOf(MissingAdministratorPasswordError);
    expect((error as Error).message).toContain('dev.rote.feedback-server.admin');
    expect((error as Error).message).toContain('account owner');
    expect((error as Error).message).not.toContain('dev.rote.feedback-server.mcp.admin-password');
    expect((error as Error).message).not.toContain(`${baseUrl}|${username}`);
  });

  test('removes and rejects a stored administrator password when authentication fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      withAdministratorPassword(
        { baseUrl, username },
        () =>
          Promise.reject(new ConfigurationApiError(401, 'unauthorized', 'wrong password')),
        dependencies({
          deletePassword: () => {
            events.push('delete');
            return Promise.resolve();
          },
        }),
      ),
    );
    expect(events).toEqual(['delete']);
    expect(error).toBeInstanceOf(RejectedAdministratorPasswordError);
  });

  test('does not delete the stored password for non-authentication failures', async () => {
    const error = await capturedError(
      withAdministratorPassword(
        { baseUrl, username },
        () => Promise.reject(new Error('network down')),
        dependencies({
          deletePassword: () => Promise.reject(new Error('should not delete')),
        }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('network down');
  });

  test('warns and still fails fast when Keychain cannot be read', async () => {
    const warnings: string[] = [];
    const error = await capturedError(
      withAdministratorPassword(
        { baseUrl, username },
        () => Promise.resolve('unused'),
        dependencies({
          readPassword: () => Promise.reject(new Error('Keychain locked')),
          warn: (message) => warnings.push(message),
        }),
      ),
    );
    expect(warnings.join('\n')).toContain('Keychain locked');
    expect(error).toBeInstanceOf(MissingAdministratorPasswordError);
  });
});
