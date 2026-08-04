import {
  ConfigurationApiError,
  promptPassword,
  promptText,
} from './admin-session.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { createLocalAdmin } from './local-admin.js';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

try {
  const baseUrl = argument('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const superAdminUsername =
    argument('--username') ?? (await promptText('Existing super administrator username'));
  if (!superAdminUsername) throw new Error('Existing super administrator username is required');
  const superAdminPassword = await promptPassword('Existing super administrator password');
  const username = await promptText('New administrator username');
  if (!username) throw new Error('New administrator username is required');
  const displayName = await promptText('New administrator display name');
  if (!displayName) throw new Error('New administrator display name is required');
  const password = await promptPassword('New administrator password');
  const passwordConfirmation = await promptPassword('Confirm new administrator password');
  if (password !== passwordConfirmation) throw new Error('New administrator passwords do not match');

  const admin = await createLocalAdmin({
    baseUrl,
    superAdminUsername,
    superAdminPassword,
    username,
    displayName,
    password,
  });
  console.error(
    `Administrator ${admin.username} created with role ${admin.role}; login and empty Product ownership verified.`,
  );
} catch (error) {
  if (error instanceof ConfigurationApiError) {
    console.error(`Administrator creation failed: HTTP ${error.status} ${error.code}: ${error.message}`);
  } else {
    console.error(
      `Administrator creation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  process.exitCode = 1;
}
