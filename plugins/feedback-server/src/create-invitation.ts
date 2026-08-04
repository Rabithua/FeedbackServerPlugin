import { promptPassword, promptText } from './admin-session.js';
import { parseCliOptions, parseIntegerOption } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { createShareableInvitation } from './invitation-administration.js';

try {
  const options = parseCliOptions(Bun.argv.slice(2), [
    '--url',
    '--username',
    '--expires-in-days',
  ]);
  const baseUrl = options.get('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const superAdminUsername =
    options.get('--username') ?? (await promptText('Super administrator username'));
  if (!superAdminUsername) throw new Error('Super administrator username is required');
  const expiresInDays = parseIntegerOption(options, '--expires-in-days', 7, 1, 30);
  const superAdminPassword = await promptPassword('Super administrator password');

  const result = await createShareableInvitation(
    { baseUrl, superAdminUsername, superAdminPassword, expiresInDays },
    async (invitation) => {
      console.error(
        `Invitation ${invitation.id} (${invitation.tokenPrefix}…) expires ${invitation.expiresAt}.`,
      );
      await promptText(
        'The one-time invitation is in your clipboard. Share it through a trusted channel, then press Return to clear it',
      );
    },
  );
  console.error(
    result.clipboardCleared
      ? 'Invitation created; the unchanged invitation token was cleared from the clipboard.'
      : 'Invitation created; the clipboard had already changed and was left untouched.',
  );
} catch (error) {
  reportCliFailure('Invitation creation', error);
}

