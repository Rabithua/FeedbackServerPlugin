import { promptPassword, promptText } from './admin-session.js';
import { parseCliOptions } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { revokeInvitationById } from './invitation-administration.js';

try {
  const options = parseCliOptions(Bun.argv.slice(2), ['--url', '--username', '--id']);
  const baseUrl = options.get('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const superAdminUsername =
    options.get('--username') ?? (await promptText('Super administrator username'));
  if (!superAdminUsername) throw new Error('Super administrator username is required');
  const invitationId = options.get('--id') ?? (await promptText('Invitation ID'));
  if (!invitationId) throw new Error('Invitation ID is required');
  const superAdminPassword = await promptPassword('Super administrator password');

  await revokeInvitationById({
    baseUrl,
    superAdminUsername,
    superAdminPassword,
    invitationId,
  });
  console.error(`Invitation ${invitationId} revoked.`);
} catch (error) {
  reportCliFailure('Invitation revocation', error);
}

