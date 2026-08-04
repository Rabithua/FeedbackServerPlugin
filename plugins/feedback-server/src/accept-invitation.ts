import { promptPassword, promptText } from './admin-session.js';
import { parseCliOptions } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { acceptInvitationAndConfigure } from './invitation-acceptance.js';

try {
  const options = parseCliOptions(Bun.argv.slice(2), [
    '--url',
    '--username',
    '--display-name',
  ]);
  const baseUrl = options.get('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const token = await promptPassword('One-time invitation token');
  const username = options.get('--username') ?? (await promptText('Administrator username'));
  if (!username) throw new Error('Administrator username is required');
  const displayName =
    options.get('--display-name') ?? (await promptText('Administrator display name'));
  if (!displayName) throw new Error('Administrator display name is required');
  const password = await promptPassword('Administrator password');
  if (password.length < 12 || password.length > 200) {
    throw new Error('Administrator password must contain 12 through 200 characters');
  }
  const passwordConfirmation = await promptPassword('Confirm administrator password');
  if (password !== passwordConfirmation) throw new Error('Administrator passwords do not match');

  const configured = await acceptInvitationAndConfigure({
    baseUrl,
    token,
    username,
    displayName,
    password,
  });
  console.error(
    `Administrator ${username} created and FeedbackServer Agent configured; token expires ${configured.expiresAt ?? 'at an unknown time'}.`,
  );
} catch (error) {
  reportCliFailure('Invitation acceptance', error);
}

