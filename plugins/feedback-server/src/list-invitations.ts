import { promptPassword, promptText } from './admin-session.js';
import { parseCliOptions } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { getInvitations } from './invitation-administration.js';

try {
  const options = parseCliOptions(Bun.argv.slice(2), ['--url', '--username']);
  const baseUrl = options.get('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const superAdminUsername =
    options.get('--username') ?? (await promptText('Super administrator username'));
  if (!superAdminUsername) throw new Error('Super administrator username is required');
  const superAdminPassword = await promptPassword('Super administrator password');
  const invitations = await getInvitations({
    baseUrl,
    superAdminUsername,
    superAdminPassword,
  });

  if (invitations.length === 0) {
    console.error('No administrator invitations found.');
  } else {
    console.error('ID\tSTATUS\tTOKEN PREFIX\tEXPIRES AT');
    for (const invitation of invitations) {
      console.error(
        `${invitation.id}\t${invitation.status}\t${invitation.tokenPrefix}…\t${invitation.expiresAt}`,
      );
    }
  }
} catch (error) {
  reportCliFailure('Invitation listing', error);
}

