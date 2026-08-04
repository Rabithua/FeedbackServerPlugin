import {
  configureAgent,
  disconnectAgent,
  promptPassword,
  promptText,
  revokeAgentTokenById,
} from './admin-session.js';
import { parseCliOptions, parseIntegerOption } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import { DEFAULT_BASE_URL } from './credentials.js';
import { acceptInvitationAndConfigure } from './invitation-acceptance.js';
import {
  createShareableInvitation,
  getInvitations,
  revokeInvitationById,
} from './invitation-administration.js';
import { createLocalAdmin } from './local-admin.js';

export type FeedbackServerCliCommand =
  | 'agent configure'
  | 'agent disconnect'
  | 'agent revoke-token'
  | 'admin invite'
  | 'admin invitations'
  | 'admin invite revoke'
  | 'admin accept-invite'
  | 'admin create-local';

export interface ParsedFeedbackServerCliCommand {
  command: FeedbackServerCliCommand;
  options: string[];
}

const usage = [
  'feedback-server agent configure [--url URL] [--username USERNAME]',
  'feedback-server agent disconnect [--username USERNAME]',
  'feedback-server agent revoke-token --id UUID [--url URL] [--username USERNAME]',
  'feedback-server admin invite [--url URL] [--username USERNAME] [--expires-in-days DAYS]',
  'feedback-server admin invitations [--url URL] [--username USERNAME]',
  'feedback-server admin invite revoke --id UUID [--url URL] [--username USERNAME]',
  'feedback-server admin accept-invite [--url URL] [--username USERNAME] [--display-name NAME]',
  'feedback-server admin create-local [--url URL] [--username USERNAME]',
].join('\n');

export function parseFeedbackServerCliCommand(argv: string[]): ParsedFeedbackServerCliCommand {
  const [group, action, nestedAction, ...remaining] = argv;
  if (group === 'agent' && action === 'configure') {
    return { command: 'agent configure', options: argv.slice(2) };
  }
  if (group === 'agent' && action === 'disconnect') {
    return { command: 'agent disconnect', options: argv.slice(2) };
  }
  if (group === 'agent' && action === 'revoke-token') {
    return { command: 'agent revoke-token', options: argv.slice(2) };
  }
  if (group === 'admin' && action === 'invite' && nestedAction === 'revoke') {
    return { command: 'admin invite revoke', options: remaining };
  }
  if (group === 'admin' && action === 'invite') {
    return { command: 'admin invite', options: argv.slice(2) };
  }
  if (group === 'admin' && action === 'invitations') {
    return { command: 'admin invitations', options: argv.slice(2) };
  }
  if (group === 'admin' && action === 'accept-invite') {
    return { command: 'admin accept-invite', options: argv.slice(2) };
  }
  if (group === 'admin' && action === 'create-local') {
    return { command: 'admin create-local', options: argv.slice(2) };
  }
  throw new Error(`Unknown FeedbackServer command.\n\n${usage}`);
}

async function urlAndUsername(
  optionArguments: string[],
  usernameLabel: string,
  extraAllowedOptions: readonly string[] = [],
): Promise<{
  baseUrl: string;
  username: string;
  options: ReadonlyMap<string, string>;
}> {
  const options = parseCliOptions(optionArguments, [
    '--url',
    '--username',
    ...extraAllowedOptions,
  ]);
  const baseUrl = options.get('--url') ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const username = options.get('--username') ?? (await promptText(usernameLabel));
  if (!username) throw new Error(`${usernameLabel} is required`);
  return { baseUrl, username, options };
}

async function runAgentConfigure(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Administrator username');
  const password = await promptPassword();
  const configured = await configureAgent({
    baseUrl: input.baseUrl,
    username: input.username,
    password,
  });
  console.error(
    `FeedbackServer Agent configured for ${configured.baseUrl}; token expires ${configured.expiresAt ?? 'at an unknown time'}.`,
  );
}

async function runAgentDisconnect(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--username']);
  const username = parsed.get('--username') ?? (await promptText('Administrator username'));
  if (!username) throw new Error('Administrator username is required');
  const password = await promptPassword();
  const removed = await disconnectAgent({ username, password });
  console.error(
    removed
      ? 'FeedbackServer Agent token revoked and local credentials removed.'
      : 'FeedbackServer Agent was not configured.',
  );
}

async function runAgentRevokeToken(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Administrator username', ['--id']);
  const tokenId = input.options.get('--id');
  if (!tokenId) throw new Error('--id is required');
  const password = await promptPassword();
  await revokeAgentTokenById({
    baseUrl: input.baseUrl,
    username: input.username,
    password,
    tokenId,
  });
  console.error(`FeedbackServer PAT ${tokenId} revoked or already absent.`);
}

async function runAdminInvite(options: string[]): Promise<void> {
  const input = await urlAndUsername(
    options,
    'Super administrator username',
    ['--expires-in-days'],
  );
  const expiresInDays = parseIntegerOption(input.options, '--expires-in-days', 7, 1, 30);
  const superAdminPassword = await promptPassword('Super administrator password');
  const result = await createShareableInvitation(
    {
      baseUrl: input.baseUrl,
      superAdminUsername: input.username,
      superAdminPassword,
      expiresInDays,
    },
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
}

async function runAdminInvitations(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Super administrator username');
  const superAdminPassword = await promptPassword('Super administrator password');
  const invitations = await getInvitations({
    baseUrl: input.baseUrl,
    superAdminUsername: input.username,
    superAdminPassword,
  });
  if (invitations.length === 0) {
    console.error('No administrator invitations found.');
    return;
  }
  console.error('ID\tSTATUS\tTOKEN PREFIX\tEXPIRES AT');
  for (const invitation of invitations) {
    console.error(
      `${invitation.id}\t${invitation.status}\t${invitation.tokenPrefix}…\t${invitation.expiresAt}`,
    );
  }
}

async function runAdminInviteRevoke(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Super administrator username', ['--id']);
  const invitationId = input.options.get('--id');
  if (!invitationId) throw new Error('--id is required');
  const superAdminPassword = await promptPassword('Super administrator password');
  await revokeInvitationById({
    baseUrl: input.baseUrl,
    superAdminUsername: input.username,
    superAdminPassword,
    invitationId,
  });
  console.error(`Invitation ${invitationId} revoked.`);
}

async function runAdminAcceptInvite(options: string[]): Promise<void> {
  const input = await urlAndUsername(
    options,
    'Administrator username',
    ['--display-name'],
  );
  const token = await promptPassword('One-time invitation token');
  const displayName = input.options.get('--display-name')
    ?? (await promptText('Administrator display name'));
  if (!displayName) throw new Error('Administrator display name is required');
  const password = await promptPassword('Administrator password');
  if (password.length < 12 || password.length > 200) {
    throw new Error('Administrator password must contain 12 through 200 characters');
  }
  const passwordConfirmation = await promptPassword('Confirm administrator password');
  if (password !== passwordConfirmation) throw new Error('Administrator passwords do not match');
  const configured = await acceptInvitationAndConfigure({
    baseUrl: input.baseUrl,
    token,
    username: input.username,
    displayName,
    password,
  });
  console.error(
    `Administrator ${input.username} created and FeedbackServer Agent configured; token expires ${configured.expiresAt ?? 'at an unknown time'}.`,
  );
}

async function runAdminCreateLocal(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Existing super administrator username');
  const superAdminPassword = await promptPassword('Existing super administrator password');
  const username = await promptText('New administrator username');
  if (!username) throw new Error('New administrator username is required');
  const displayName = await promptText('New administrator display name');
  if (!displayName) throw new Error('New administrator display name is required');
  const password = await promptPassword('New administrator password');
  const passwordConfirmation = await promptPassword('Confirm new administrator password');
  if (password !== passwordConfirmation) throw new Error('New administrator passwords do not match');
  const admin = await createLocalAdmin({
    baseUrl: input.baseUrl,
    superAdminUsername: input.username,
    superAdminPassword,
    username,
    displayName,
    password,
  });
  console.error(
    `Administrator ${admin.username} created with role ${admin.role}; login and empty Product ownership verified.`,
  );
}

export async function runFeedbackServerCli(argv: string[]): Promise<void> {
  const parsed = parseFeedbackServerCliCommand(argv);
  switch (parsed.command) {
    case 'agent configure': return runAgentConfigure(parsed.options);
    case 'agent disconnect': return runAgentDisconnect(parsed.options);
    case 'agent revoke-token': return runAgentRevokeToken(parsed.options);
    case 'admin invite': return runAdminInvite(parsed.options);
    case 'admin invitations': return runAdminInvitations(parsed.options);
    case 'admin invite revoke': return runAdminInviteRevoke(parsed.options);
    case 'admin accept-invite': return runAdminAcceptInvite(parsed.options);
    case 'admin create-local': return runAdminCreateLocal(parsed.options);
  }
}

export async function main(argv: string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    await runFeedbackServerCli(argv);
  } catch (error) {
    reportCliFailure('FeedbackServer command', error);
  }
}

if (import.meta.main) await main();
