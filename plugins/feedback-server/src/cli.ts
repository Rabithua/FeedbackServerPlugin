import {
  configureAgent,
  disconnectAgent,
  promptPassword,
  promptText,
  revokeAgentTokenById,
} from './admin-session.js';
import { withAdministratorPassword } from './admin-password.js';
import { parseCliOptions, parseIntegerOption } from './cli-arguments.js';
import { reportCliFailure } from './cli-reporting.js';
import {
  DEFAULT_BASE_URL,
  KEYCHAIN_ACCOUNT,
  listKeychainProfiles,
  profileIdSchema,
  readActiveKeychainProfile,
  readKeychainCredentials,
  readKeychainProfileCredentials,
  useKeychainProfile,
} from './credentials.js';
import { acceptInvitationAndConfigure } from './invitation-acceptance.js';
import {
  createInvitationHandoffMessage,
  createShareableInvitation,
  formatInvitationSubscriptionGrant,
  getInvitations,
  revokeInvitationById,
} from './invitation-administration.js';
import type {
  AppliedInvitationSubscription,
  InvitationSubscriptionGrant,
} from './invitation-api.js';
import { createLocalAdmin } from './local-admin.js';
import { diagnoseFeedbackServer, formatDoctorReport } from './doctor.js';
import { runFeedbackRoundTrip } from './roundtrip.js';

export type FeedbackServerCliCommand =
  | 'doctor'
  | 'test roundtrip'
  | 'agent configure'
  | 'agent disconnect'
  | 'agent revoke-token'
  | 'profile list'
  | 'profile use'
  | 'profile remove'
  | 'admin invite'
  | 'admin invitations'
  | 'admin invite revoke'
  | 'admin accept-invite'
  | 'admin create-local';

export interface ParsedFeedbackServerCliCommand {
  command: FeedbackServerCliCommand;
  options: string[];
}

export const usage = [
  'feedback-server doctor [--product ID_OR_SLUG] [--app-path PATH] [--format text|json]',
  'feedback-server test roundtrip --product ID_OR_SLUG --confirm PRODUCT_SLUG [--locale LOCALE]',
  'feedback-server agent configure [--url URL] [--username USERNAME] [--profile NAME]',
  'feedback-server agent disconnect [--username USERNAME] [--profile NAME]',
  'feedback-server agent revoke-token --id UUID [--url URL] [--username USERNAME]',
  'feedback-server profile list',
  'feedback-server profile use NAME',
  'feedback-server profile remove NAME',
  [
    'feedback-server admin invite [--url URL] [--username USERNAME]',
    '[--expires-in-days DAYS] [--delivery stdout|clipboard] [--plan free|solo|studio]',
    '[--subscription-term month|year|perpetual]',
  ].join(' '),
  'feedback-server admin invitations [--url URL] [--username USERNAME]',
  'feedback-server admin invite revoke --id UUID [--url URL] [--username USERNAME]',
  [
    'feedback-server admin accept-invite [--url URL] [--username USERNAME]',
    '[--display-name NAME] [--token INVITATION_TOKEN]',
  ].join(' '),
  [
    'feedback-server admin create-local [--url URL] [--username USERNAME]',
    '[--plan free|solo|studio] [--subscription-term month|year|perpetual]',
  ].join(' '),
].join('\n');

export const AGENT_ONBOARDING_PROMPT = '帮我完成 FeedbackServer 初始配置';

export function agentConfigurationCompletionMessage(summary: string): string {
  return [
    summary,
    'Account connection is complete; app configuration is not complete yet.',
    `Return to the current Agent task and send: “${AGENT_ONBOARDING_PROMPT}”`,
    'The running MCP process reads the new Keychain credential on its next tool call.',
  ].join('\n');
}

export function isHelpRequest(argv: string[]): boolean {
  return argv.length === 0 || argv.includes('--help') || argv.includes('-h');
}

export type ExistingAgentChoice = 'keep' | 'switch';

export function parseExistingAgentChoice(value: string): ExistingAgentChoice {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'keep') return 'keep';
  if (normalized === 'switch') return 'switch';
  throw new Error('Choose keep or switch');
}

export function parseInvitationSubscriptionGrant(
  options: ReadonlyMap<string, string>,
): InvitationSubscriptionGrant {
  const plan = options.get('--plan') ?? 'free';
  const term = options.get('--subscription-term');
  if (plan !== 'free' && plan !== 'solo' && plan !== 'studio') {
    throw new Error('--plan must be free, solo, or studio; Indie is not supported');
  }
  if (plan === 'free') {
    if (term !== undefined) {
      throw new Error('--subscription-term cannot be used with the Free plan');
    }
    return { plan: 'free' };
  }
  if (term !== 'month' && term !== 'year' && term !== 'perpetual') {
    throw new Error(
      '--subscription-term is required for Solo and Studio and must be month, year, or perpetual',
    );
  }
  return { plan, term };
}

export function formatAppliedSubscription(
  subscription: AppliedInvitationSubscription,
): string {
  const plan = subscription.plan === 'free'
    ? 'Free'
    : subscription.plan === 'solo'
      ? 'Solo'
      : 'Studio';
  if (subscription.term === 'free') return `${plan} (free)`;
  if (subscription.term === 'perpetual') return `${plan} (perpetual)`;
  return `${plan} (fixed); expires ${subscription.expiresAt ?? 'at an unknown time'}; `
    + `grace ends ${subscription.graceEndsAt ?? 'at an unknown time'}`;
}

export interface AdminAcceptInviteDependencies {
  readActiveProfile: typeof readActiveKeychainProfile;
  readCredentials: typeof readKeychainCredentials;
  promptText: typeof promptText;
  promptPassword: typeof promptPassword;
  disconnect: typeof disconnectAgent;
  configure: typeof configureAgent;
  acceptInvitation: typeof acceptInvitationAndConfigure;
  log: (message: string) => void;
}

const defaultAdminAcceptInviteDependencies: AdminAcceptInviteDependencies = {
  readActiveProfile: readActiveKeychainProfile,
  readCredentials: readKeychainCredentials,
  promptText,
  promptPassword,
  disconnect: disconnectAgent,
  configure: configureAgent,
  acceptInvitation: acceptInvitationAndConfigure,
  log: console.error,
};

export function parseFeedbackServerCliCommand(argv: string[]): ParsedFeedbackServerCliCommand {
  const [group, action, nestedAction, ...remaining] = argv;
  if (group === 'doctor') {
    return { command: 'doctor', options: argv.slice(1) };
  }
  if (group === 'test' && action === 'roundtrip') {
    return { command: 'test roundtrip', options: argv.slice(2) };
  }
  if (group === 'agent' && action === 'configure') {
    return { command: 'agent configure', options: argv.slice(2) };
  }
  if (group === 'agent' && action === 'disconnect') {
    return { command: 'agent disconnect', options: argv.slice(2) };
  }
  if (group === 'agent' && action === 'revoke-token') {
    return { command: 'agent revoke-token', options: argv.slice(2) };
  }
  if (group === 'profile' && action === 'list') {
    return { command: 'profile list', options: argv.slice(2) };
  }
  if (group === 'profile' && action === 'use') {
    return { command: 'profile use', options: argv.slice(2) };
  }
  if (group === 'profile' && action === 'remove') {
    return { command: 'profile remove', options: argv.slice(2) };
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
  const configured = options.has('--url') && options.has('--username')
    ? undefined
    : await readKeychainCredentials().catch(() => undefined);
  const baseUrl = options.get('--url')
    ?? configured?.baseUrl
    ?? (await promptText('FeedbackServer URL', DEFAULT_BASE_URL));
  const username = options.get('--username')
    ?? configured?.username
    ?? (await promptText(usernameLabel));
  if (!username) throw new Error(`${usernameLabel} is required`);
  return { baseUrl, username, options };
}

async function runAgentConfigure(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--url', '--username', '--profile']);
  const profile = profileIdSchema.parse(
    parsed.get('--profile') ?? await readActiveKeychainProfile() ?? KEYCHAIN_ACCOUNT,
  );
  const existing = await readKeychainProfileCredentials(profile);
  const baseUrl = parsed.get('--url')
    ?? existing?.baseUrl
    ?? await promptText('FeedbackServer URL', DEFAULT_BASE_URL);
  const username = parsed.get('--username')
    ?? existing?.username
    ?? await promptText('Administrator username');
  if (!username) throw new Error('Administrator username is required');
  const active = await readActiveKeychainProfile();
  if (active !== profile) {
    console.error(
      `Activating profile ${profile} affects every FeedbackServer Codex and Claude session on this Mac.`,
    );
  }
  const password = await promptPassword();
  const configured = await configureAgent({
    baseUrl,
    username,
    password,
    profile,
  });
  console.error(
    agentConfigurationCompletionMessage(
      `FeedbackServer Agent profile ${profile} configured for ${configured.baseUrl}; token expires ${configured.expiresAt ?? 'at an unknown time'}.`,
    ),
  );
}

async function runAgentDisconnect(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--username', '--profile']);
  const profile = profileIdSchema.parse(
    parsed.get('--profile') ?? await readActiveKeychainProfile() ?? KEYCHAIN_ACCOUNT,
  );
  const existing = await readKeychainProfileCredentials(profile);
  if (!existing) {
    console.error(`FeedbackServer Agent profile ${profile} was not configured.`);
    return;
  }
  const username = parsed.get('--username')
    ?? existing.username
    ?? (await promptText('Administrator username'));
  if (!username) throw new Error('Administrator username is required');
  const password = await promptPassword();
  const removed = await disconnectAgent({ username, password, profile });
  console.error(
    removed
      ? `FeedbackServer Agent profile ${profile} token revoked and local credentials removed.`
      : `FeedbackServer Agent profile ${profile} was not configured.`,
  );
}

async function runProfileList(options: string[]): Promise<void> {
  if (options.length > 0) throw new Error('profile list does not accept arguments');
  const profiles = await listKeychainProfiles();
  if (profiles.length === 0) {
    console.error('No FeedbackServer profiles are configured.');
    return;
  }
  console.error('ACTIVE\tPROFILE');
  for (const profile of profiles) {
    console.error(`${profile.active ? '*' : ''}\t${profile.name}`);
  }
}

async function runProfileUse(options: string[]): Promise<void> {
  if (options.length !== 1) throw new Error('profile use requires exactly one NAME');
  const profile = profileIdSchema.parse(options[0]);
  console.error(
    `Switching to profile ${profile} affects every FeedbackServer Codex and Claude session on this Mac.`,
  );
  await useKeychainProfile(profile);
  console.error(`FeedbackServer profile ${profile} is now active.`);
}

async function runProfileRemove(options: string[]): Promise<void> {
  if (options.length !== 1) throw new Error('profile remove requires exactly one NAME');
  const profile = profileIdSchema.parse(options[0]);
  const existing = await readKeychainProfileCredentials(profile);
  if (!existing) throw new Error(`FeedbackServer profile ${profile} does not exist`);
  const username = existing.username ?? await promptText('Administrator username');
  if (!username) throw new Error('Administrator username is required');
  console.error(
    `Removing profile ${profile} affects every FeedbackServer Codex and Claude session on this Mac.`,
  );
  const password = await promptPassword();
  await disconnectAgent({ username, password, profile });
  console.error(`FeedbackServer profile ${profile} token revoked and local credentials removed.`);
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
    ['--expires-in-days', '--delivery', '--plan', '--subscription-term'],
  );
  const expiresInDays = parseIntegerOption(input.options, '--expires-in-days', 7, 1, 30);
  const subscriptionGrant = parseInvitationSubscriptionGrant(input.options);
  const delivery = input.options.get('--delivery') ?? 'stdout';
  if (delivery !== 'stdout' && delivery !== 'clipboard') {
    throw new Error('--delivery must be stdout or clipboard');
  }
  if (delivery === 'stdout') {
    const result = await withAdministratorPassword(
      input,
      (superAdminPassword) =>
        createInvitationHandoffMessage({
          baseUrl: input.baseUrl,
          superAdminUsername: input.username,
          superAdminPassword,
          expiresInDays,
          subscriptionGrant,
        }),
    );
    console.error(
      `Invitation ${result.invitation.id} (${result.invitation.tokenPrefix}…) expires ${
        result.invitation.expiresAt
      }; initial subscription ${formatInvitationSubscriptionGrant(
        subscriptionGrant,
      ).plan} (${formatInvitationSubscriptionGrant(
        subscriptionGrant,
      ).term}).`,
    );
    process.stdout.write(`\`\`\`text\n${result.handoffMessage.trimEnd()}\n\`\`\`\n`);
    return;
  }
  const result = await withAdministratorPassword(
    input,
    (superAdminPassword) =>
      createShareableInvitation(
        {
          baseUrl: input.baseUrl,
          superAdminUsername: input.username,
          superAdminPassword,
          expiresInDays,
          subscriptionGrant,
        },
        async (invitation) => {
          console.error(
            `Invitation ${invitation.id} (${invitation.tokenPrefix}…) expires ${invitation.expiresAt}; `
            + `initial subscription ${formatInvitationSubscriptionGrant(subscriptionGrant).plan} `
            + `(${formatInvitationSubscriptionGrant(subscriptionGrant).term}).`,
          );
          await promptText(
            'The recipient handoff package is in your clipboard. Share it through a trusted channel, then press Return to clear it',
          );
        },
      ),
  );
  console.error(
    result.clipboardCleared
      ? 'Invitation created; the unchanged handoff package was cleared from the clipboard.'
      : 'Invitation created; the clipboard had already changed and was left untouched.',
  );
}

async function runAdminInvitations(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Super administrator username');
  const invitations = await withAdministratorPassword(
    input,
    (superAdminPassword) =>
      getInvitations({
        baseUrl: input.baseUrl,
        superAdminUsername: input.username,
        superAdminPassword,
      }),
  );
  if (invitations.length === 0) {
    console.error('No administrator invitations found.');
    return;
  }
  console.error('ID\tSTATUS\tTOKEN PREFIX\tEXPIRES AT\tPLAN\tSUBSCRIPTION TERM');
  for (const invitation of invitations) {
    const grant = invitation.subscriptionGrant
      ? formatInvitationSubscriptionGrant(invitation.subscriptionGrant)
      : { plan: 'Unknown', term: 'Unknown (upgrade Server)' };
    console.error(
      `${invitation.id}\t${invitation.status}\t${invitation.tokenPrefix}…\t${invitation.expiresAt}`
      + `\t${grant.plan}\t${grant.term}`,
    );
  }
}

async function runAdminInviteRevoke(options: string[]): Promise<void> {
  const input = await urlAndUsername(options, 'Super administrator username', ['--id']);
  const invitationId = input.options.get('--id');
  if (!invitationId) throw new Error('--id is required');
  await withAdministratorPassword(
    input,
    (superAdminPassword) =>
      revokeInvitationById({
        baseUrl: input.baseUrl,
        superAdminUsername: input.username,
        superAdminPassword,
        invitationId,
      }),
  );
  console.error(`Invitation ${invitationId} revoked.`);
}

export async function runAdminAcceptInvite(
  options: string[],
  dependencies: AdminAcceptInviteDependencies = defaultAdminAcceptInviteDependencies,
): Promise<void> {
  const parsed = parseCliOptions(options, [
    '--url',
    '--username',
    '--display-name',
    '--token',
  ]);
  const targetProfile = await dependencies.readActiveProfile() ?? KEYCHAIN_ACCOUNT;
  const existing = await dependencies.readCredentials();
  const baseUrl = parsed.get('--url')
    ?? existing?.baseUrl
    ?? (await dependencies.promptText('FeedbackServer URL', DEFAULT_BASE_URL));

  if (existing) {
    const existingUsername = existing.username ?? 'unknown administrator';
    dependencies.log(
      `FeedbackServer Agent is already configured for ${existingUsername} at ${existing.baseUrl}.`,
    );
    dependencies.log(
      'This Keychain account is shared by every FeedbackServer-enabled Codex and Claude session '
      + 'on this Mac; switching is not limited to the current project.',
    );
    let choice: ExistingAgentChoice | undefined;
    while (!choice) {
      try {
        choice = parseExistingAgentChoice(
          await dependencies.promptText(
            'Enter keep to use the existing account, or switch to replace it with the invited account',
            'keep',
          ),
        );
      } catch {
        dependencies.log('Please enter keep or switch. The default is keep.');
      }
    }
    if (choice === 'keep') {
      dependencies.log(
        `Keeping FeedbackServer Agent account ${existingUsername} at ${existing.baseUrl}; `
        + 'the invitation was not consumed. Continue in the current Agent task and verify connection_status.',
      );
      return;
    }
    dependencies.log(
      `Switching will revoke the current Agent PAT for ${existingUsername}, remove its local `
      + 'credentials for all FeedbackServer-enabled sessions on this Mac, and then attempt to '
      + 'accept the invitation. If invitation acceptance fails, the CLI will try to restore the '
      + 'previous account automatically.',
    );
  }

  const username = parsed.get('--username')
    ?? (await dependencies.promptText('New administrator username'));
  if (!username) throw new Error('New administrator username is required');
  const token = parsed.get('--token')
    ?? await dependencies.promptPassword('One-time invitation token');
  const displayName = parsed.get('--display-name')
    ?? (await dependencies.promptText('Administrator display name'));
  if (!displayName) throw new Error('Administrator display name is required');
  const password = await dependencies.promptPassword('Administrator password');
  if (password.length < 12 || password.length > 200) {
    throw new Error('Administrator password must contain 12 through 200 characters');
  }
  const passwordConfirmation = await dependencies.promptPassword(
    'Confirm administrator password',
  );
  if (password !== passwordConfirmation) throw new Error('Administrator passwords do not match');

  let existingPassword: string | undefined;
  let existingUsernameForSwitch: string | undefined;
  let existingDisconnected = false;
  if (existing) {
    const existingUsername = existing.username
      ?? (await dependencies.promptText('Current administrator username'));
    if (!existingUsername) throw new Error('Current administrator username is required');
    existingUsernameForSwitch = existingUsername;
    existingPassword = await dependencies.promptPassword(
      `Current administrator password for ${existingUsername}`,
    );
    const removed = await dependencies.disconnect({
      username: existingUsername,
      password: existingPassword,
      profile: targetProfile,
    });
    if (!removed) {
      throw new Error('Existing FeedbackServer Agent credentials changed before the switch');
    }
    existingDisconnected = true;
    dependencies.log(
      `Previous FeedbackServer Agent account ${existingUsername} disconnected; accepting invitation.`,
    );
  }

  let configured;
  try {
    configured = await dependencies.acceptInvitation({
      baseUrl,
      token,
      username,
      displayName,
      password,
      profile: targetProfile,
    });
  } catch (error) {
    if (
      !existing
      || !existingDisconnected
      || existingPassword === undefined
      || !existingUsernameForSwitch
    ) throw error;

    let activeCredentials;
    try {
      activeCredentials = await dependencies.readCredentials();
    } catch (credentialReadError) {
      throw new AggregateError(
        [error, credentialReadError],
        'Invitation acceptance failed after disconnecting the previous Agent account, and the CLI '
        + `could not inspect Keychain recovery state. Restore the previous account with `
        + `feedback-server agent configure --url ${existing.baseUrl} `
        + `--username ${existingUsernameForSwitch}.`,
      );
    }
    if (activeCredentials) {
      dependencies.log(
        `Invitation acceptance reported an error, but FeedbackServer Agent credentials for `
        + `${activeCredentials.username ?? 'an unknown administrator'} at `
        + `${activeCredentials.baseUrl} are active. The previous account was not restored.`,
      );
      throw error;
    }

    try {
      await dependencies.configure({
        baseUrl: existing.baseUrl,
        username: existingUsernameForSwitch,
        password: existingPassword,
        profile: targetProfile,
      });
      dependencies.log(
        'Invitation acceptance failed; the previous FeedbackServer Agent account was restored '
        + 'automatically. The invitation error follows.',
      );
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Invitation acceptance failed after disconnecting the previous Agent account, and '
        + `automatic restoration also failed. Restore it with feedback-server agent configure `
        + `--url ${existing.baseUrl} --username ${existing.username ?? 'PREVIOUS_USERNAME'}.`,
      );
    }
    throw error;
  }
  dependencies.log(
    agentConfigurationCompletionMessage(
      `Administrator ${username} created and FeedbackServer Agent configured; token expires ${configured.credentials.expiresAt ?? 'at an unknown time'}. `
      + `Server applied initial subscription: ${formatAppliedSubscription(configured.subscription)}.`,
    ),
  );
}

async function runAdminCreateLocal(options: string[]): Promise<void> {
  const input = await urlAndUsername(
    options,
    'Existing super administrator username',
    ['--plan', '--subscription-term'],
  );
  const subscriptionGrant = parseInvitationSubscriptionGrant(input.options);
  const username = await promptText('New administrator username');
  if (!username) throw new Error('New administrator username is required');
  const displayName = await promptText('New administrator display name');
  if (!displayName) throw new Error('New administrator display name is required');
  const password = await promptPassword('New administrator password');
  const passwordConfirmation = await promptPassword('Confirm new administrator password');
  if (password !== passwordConfirmation) throw new Error('New administrator passwords do not match');
  const admin = await withAdministratorPassword(
    input,
    (superAdminPassword) =>
      createLocalAdmin({
        baseUrl: input.baseUrl,
        superAdminUsername: input.username,
        superAdminPassword,
        username,
        displayName,
        password,
        subscriptionGrant,
      }),
  );
  console.error(
    `Administrator ${admin.admin.username} created with role ${admin.admin.role}; login and empty `
    + `Product ownership verified. Server applied initial subscription: `
    + `${formatAppliedSubscription(admin.subscription)}.`,
  );
}

async function runDoctor(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--product', '--app-path', '--format']);
  const format = parsed.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error('--format must be text or json');
  }
  const product = parsed.get('--product');
  const appPath = parsed.get('--app-path');
  const report = await diagnoseFeedbackServer({
    ...(product ? { product } : {}),
    ...(appPath ? { appPath } : {}),
  });
  process.stdout.write(
    format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report),
  );
  if (!report.ok) process.exitCode = 1;
}

async function runRoundTrip(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--product', '--confirm', '--locale']);
  const product = parsed.get('--product');
  const confirmProductSlug = parsed.get('--confirm');
  if (!product) throw new Error('--product is required');
  if (!confirmProductSlug) throw new Error('--confirm is required');
  const locale = parsed.get('--locale');
  const result = await runFeedbackRoundTrip({
    product,
    confirmProductSlug,
    ...(locale ? { locale } : {}),
  });
  console.error(
    `Feedback round-trip passed for ${result.product.slug}: submit, receive, reply, unread, read, and cleanup verified.`,
  );
}

export async function runFeedbackServerCli(argv: string[]): Promise<void> {
  if (isHelpRequest(argv)) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const parsed = parseFeedbackServerCliCommand(argv);
  switch (parsed.command) {
    case 'doctor': return runDoctor(parsed.options);
    case 'test roundtrip': return runRoundTrip(parsed.options);
    case 'agent configure': return runAgentConfigure(parsed.options);
    case 'agent disconnect': return runAgentDisconnect(parsed.options);
    case 'agent revoke-token': return runAgentRevokeToken(parsed.options);
    case 'profile list': return runProfileList(parsed.options);
    case 'profile use': return runProfileUse(parsed.options);
    case 'profile remove': return runProfileRemove(parsed.options);
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
