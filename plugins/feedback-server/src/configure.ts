import {
  ConfigurationApiError,
  configureAgent,
  promptPassword,
  promptText,
} from './admin-session.js';
import { DEFAULT_BASE_URL } from './credentials.js';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

try {
  const baseUrl =
    argument('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const username =
    argument('--username') ?? (await promptText('Administrator username'));
  if (!username) throw new Error('Administrator username is required');
  const password = await promptPassword();
  const configured = await configureAgent({ baseUrl, username, password });
  console.error(
    `FeedbackServer Agent configured for ${configured.baseUrl}; token expires ${configured.expiresAt ?? 'at an unknown time'}.`,
  );
} catch (error) {
  if (error instanceof ConfigurationApiError) {
    console.error(`Configuration failed: HTTP ${error.status} ${error.code}: ${error.message}`);
  } else {
    console.error(`Configuration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  process.exitCode = 1;
}
