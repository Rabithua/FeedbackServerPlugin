import { ConfigurationApiError } from './admin-session.js';
import {
  deleteKeychainAdminPassword,
  readKeychainAdminPassword,
} from './credentials.js';

export interface AdministratorPasswordDependencies {
  readPassword: typeof readKeychainAdminPassword;
  deletePassword: typeof deleteKeychainAdminPassword;
  warn: (message: string) => void;
}

const defaultDependencies: AdministratorPasswordDependencies = {
  readPassword: readKeychainAdminPassword,
  deletePassword: deleteKeychainAdminPassword,
  warn: (message) => {
    console.error(message);
  },
};

export class MissingAdministratorPasswordError extends Error {
  public constructor(baseUrl: string, username: string) {
    super(
      [
        `FeedbackServer administrator password is not saved in macOS Keychain for ${username}.`,
        `Expected service dev.rote.feedback-server.admin and account ${username}.`,
        'Save it in Keychain once, then rerun the command.',
      ].join(' '),
    );
    this.name = 'MissingAdministratorPasswordError';
  }
}

export class RejectedAdministratorPasswordError extends Error {
  public constructor(cause: unknown) {
    super(
      'Stored FeedbackServer administrator password was rejected and has been removed from Keychain. Save the current password in Keychain, then rerun the command.',
      { cause },
    );
    this.name = 'RejectedAdministratorPasswordError';
  }
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof ConfigurationApiError
    && (error.status === 401 || error.status === 403);
}

async function tryForgetRejectedPassword(
  baseUrl: string,
  username: string,
  dependencies: AdministratorPasswordDependencies,
): Promise<void> {
  try {
    await dependencies.deletePassword(baseUrl, username);
  } catch (error) {
    dependencies.warn(
      `Warning: unable to remove rejected FeedbackServer administrator password from Keychain: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

export async function withAdministratorPassword<T>(
  input: {
    baseUrl: string;
    username: string;
  },
  operation: (password: string) => Promise<T>,
  dependencies: AdministratorPasswordDependencies = defaultDependencies,
): Promise<T> {
  let storedPassword: string | undefined;
  try {
    storedPassword = await dependencies.readPassword(input.baseUrl, input.username);
  } catch (error) {
    dependencies.warn(
      `Warning: unable to read FeedbackServer administrator password from Keychain: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  if (storedPassword) {
    try {
      return await operation(storedPassword);
    } catch (error) {
      if (!isAuthenticationFailure(error)) throw error;
      await tryForgetRejectedPassword(input.baseUrl, input.username, dependencies);
      throw new RejectedAdministratorPasswordError(error);
    }
  }

  throw new MissingAdministratorPasswordError(input.baseUrl, input.username);
}
