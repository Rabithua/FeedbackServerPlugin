import {
  ConfigurationApiError,
  disconnectAgent,
  promptPassword,
  promptText,
} from './admin-session.js';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

try {
  const username =
    argument('--username') ?? (await promptText('Administrator username'));
  if (!username) throw new Error('Administrator username is required');
  const password = await promptPassword();
  const removed = await disconnectAgent({ username, password });
  console.error(
    removed
      ? 'FeedbackServer Agent token revoked and local credentials removed.'
      : 'FeedbackServer Agent was not configured.',
  );
} catch (error) {
  if (error instanceof ConfigurationApiError) {
    console.error(`Disconnect failed: HTTP ${error.status} ${error.code}: ${error.message}`);
  } else {
    console.error(`Disconnect failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  process.exitCode = 1;
}
