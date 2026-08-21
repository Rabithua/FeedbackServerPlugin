import { ConfigurationApiError } from './admin-session.js';
import {
  deleteKeychainAdminPassword,
  keychainAdminPasswordAccount,
  promoteLegacyKeychainAdminPassword,
  readKeychainAdminPasswordCandidate,
  type KeychainAdminPasswordCandidate,
} from './credentials.js';

export interface AdministratorPasswordDependencies {
  readPassword: typeof readKeychainAdminPasswordCandidate;
  deletePassword: typeof deleteKeychainAdminPassword;
  promoteLegacyPassword: typeof promoteLegacyKeychainAdminPassword;
  warn: (message: string) => void;
}

const defaultDependencies: AdministratorPasswordDependencies = {
  readPassword: readKeychainAdminPasswordCandidate,
  deletePassword: deleteKeychainAdminPassword,
  promoteLegacyPassword: promoteLegacyKeychainAdminPassword,
  warn: (message) => {
    console.error(message);
  },
};

export class MissingAdministratorPasswordError extends Error {
  public constructor(baseUrl: string, username: string) {
    super(
      [
        `FeedbackServer administrator password is not saved in macOS Keychain for ${username}.`,
        `Expected service dev.rote.feedback-server.admin and account ${keychainAdminPasswordAccount(baseUrl, username)}.`,
        'Save it in Keychain once, then rerun the command.',
      ].join(' '),
    );
    this.name = 'MissingAdministratorPasswordError';
  }
}

export class RejectedAdministratorPasswordError extends Error {
  public constructor(cause: unknown, legacy: boolean) {
    super(
      legacy
        ? 'The legacy username-only FeedbackServer administrator password was rejected by this server and was not migrated or removed. Save the current password under the server-scoped Keychain account, then rerun the command.'
        : 'Stored FeedbackServer administrator password was rejected and has been removed from its server-scoped Keychain account. Save the current password in Keychain, then rerun the command.',
      { cause },
    );
    this.name = 'RejectedAdministratorPasswordError';
  }
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof ConfigurationApiError
    && error.status === 401;
}

async function tryForgetRejectedPassword(
  baseUrl: string,
  username: string,
  candidate: KeychainAdminPasswordCandidate,
  dependencies: AdministratorPasswordDependencies,
): Promise<void> {
  if (candidate.legacy) return;
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
  let storedPassword: KeychainAdminPasswordCandidate | undefined;
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
      const result = await operation(storedPassword.password);
      if (storedPassword.legacy) {
        try {
          await dependencies.promoteLegacyPassword(
            input.baseUrl,
            input.username,
            storedPassword,
          );
        } catch (error) {
          dependencies.warn(
            `Warning: unable to migrate the verified FeedbackServer administrator password to its server-scoped Keychain account: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
      return result;
    } catch (error) {
      if (!isAuthenticationFailure(error)) throw error;
      await tryForgetRejectedPassword(input.baseUrl, input.username, storedPassword, dependencies);
      throw new RejectedAdministratorPasswordError(error, storedPassword.legacy);
    }
  }

  throw new MissingAdministratorPasswordError(input.baseUrl, input.username);
}
