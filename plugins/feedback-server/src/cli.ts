import { createInterface } from 'node:readline/promises';
import { FeedbackServerApiClient } from './api-client.js';
import { parseCliOptions } from './cli-arguments.js';
import {
  DEFAULT_BASE_URL,
  KEYCHAIN_ACCOUNT,
  deleteKeychainProfileCredentials,
  listKeychainProfiles,
  loadCredentials,
  profileIdSchema,
  readActiveKeychainProfile,
  readKeychainProfileCredentials,
  useKeychainProfile,
} from './credentials.js';
import { diagnoseFeedbackServer, formatDoctorReport } from './doctor.js';
import { acceptInvitationAndConfigure } from './invitation-acceptance.js';
import {
  completeAgentEmailLogin,
  requestAgentEmailLogin,
} from './email-authentication.js';
import {
  deriveOnboardingStatus,
  notificationSetupActionForPreference,
  notificationSetupChoiceAction,
  type FeedbackServerOnboardingStatus,
  type NotificationSetupPreference,
} from './onboarding.js';

const usage = `FeedbackKit Agent CLI

Usage:
  feedbackkit accept-invite [--url URL] [--profile NAME] [--credential-name NAME]
  feedbackkit login email request --email EMAIL [--url URL] [--profile NAME] [--credential-name NAME]
  feedbackkit login email complete --request UUID
  feedbackkit onboarding status [--product ID] [--format text|json]
  feedbackkit notification preference set --product ID --choice bark|webhook|defer
  feedbackkit product create --name NAME --platform ios|ipados|macos|android|web [--slug SLUG] [--locale LOCALE]
  feedbackkit doctor [--product ID] [--app-path PATH] [--format text|json]
  feedbackkit profile list
  feedbackkit profile use NAME
  feedbackkit profile remove NAME

One-time invitation tokens and six-digit email codes are accepted only on stdin or ordinary TTY
input. They may be passed by the Agent from the current conversation, but never as command arguments.`;

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug.length < 2) throw new Error('Unable to derive a valid App slug; provide --slug');
  return slug;
}

async function promptText(label: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`${label} is required in a non-interactive environment`);
  }
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    return (await terminal.question(`${label}${suffix}: `)).trim() || defaultValue || '';
  } finally {
    terminal.close();
  }
}

async function oneTimeInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return (await Bun.stdin.text()).trim();
  return promptText(label);
}

async function chooseInvitationProfile(requested?: string): Promise<{
  profile: string;
  replaceExisting: boolean;
  stop: boolean;
}> {
  const active = await readActiveKeychainProfile() ?? KEYCHAIN_ACCOUNT;
  const preferred = requested ? profileIdSchema.parse(requested) : active;
  const existing = await readKeychainProfileCredentials(preferred);
  if (!existing) return { profile: preferred, replaceExisting: false, stop: false };

  console.error(`FeedbackKit profile ${preferred} is already connected to ${existing.email}.`);
  const choice = (await promptText('Choose keep, add, or replace', 'keep')).toLowerCase();
  if (choice === 'keep') return { profile: preferred, replaceExisting: false, stop: true };
  if (choice === 'replace') return { profile: preferred, replaceExisting: true, stop: false };
  if (choice === 'add') {
    const profile = profileIdSchema.parse(await promptText('New profile name'));
    if (await readKeychainProfileCredentials(profile)) {
      throw new Error(`FeedbackKit profile ${profile} already exists`);
    }
    return { profile, replaceExisting: false, stop: false };
  }
  throw new Error('Profile choice must be keep, add, or replace');
}

async function runAcceptInvite(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--url', '--profile', '--credential-name']);
  const selection = await chooseInvitationProfile(parsed.get('--profile'));
  if (selection.stop) {
    console.error('Keeping the existing account; the invitation was not consumed.');
    return;
  }
  const baseUrl = parsed.get('--url') ?? DEFAULT_BASE_URL;
  const token = await oneTimeInput('One-time FeedbackKit invitation token');
  if (!/^fsinv_[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invitation token is invalid');
  const credentialName = parsed.get('--credential-name');
  const configured = await acceptInvitationAndConfigure({
    baseUrl,
    token,
    profile: selection.profile,
    replaceExisting: selection.replaceExisting,
    ...(credentialName ? { credentialName } : {}),
  });
  console.error(
    `FeedbackKit account ${configured.credentials.email} connected as profile ${selection.profile}. `
    + 'Free is active. Ask the user for App name, Apple platform, default language, and target App; '
    + 'then create the Product and request approval before changing the Apple project.',
  );
  if (!configured.acknowledged) {
    console.error(
      'Warning: the local credential is saved, but the Server acknowledgement was interrupted. '
      + 'The recoverable copy will expire automatically.',
    );
  }
  if (configured.previousCredentialRevoked === false) {
    console.error(
      'Warning: the replacement account is connected, but the previous Agent credential could not be revoked. Revoke it from that account when access is available.',
    );
  }
}

async function runEmailLogin(action: string | undefined, options: string[]): Promise<void> {
  if (action === 'request') {
    const parsed = parseCliOptions(options, ['--email', '--url', '--profile', '--credential-name']);
    const email = parsed.get('--email');
    if (!email) throw new Error('--email is required');
    const selection = await chooseInvitationProfile(parsed.get('--profile'));
    if (selection.stop) {
      console.error('Keeping the existing account; no verification email was sent.');
      return;
    }
    const credentialName = parsed.get('--credential-name');
    const requested = await requestAgentEmailLogin({
      email,
      baseUrl: parsed.get('--url') ?? DEFAULT_BASE_URL,
      profile: selection.profile,
      replaceExisting: selection.replaceExisting,
      ...(credentialName ? { credentialName } : {}),
    });
    process.stdout.write(`${JSON.stringify(requested, null, 2)}\n`);
    return;
  }
  if (action === 'complete') {
    const parsed = parseCliOptions(options, ['--request']);
    const requestId = parsed.get('--request');
    if (!requestId) throw new Error('--request is required');
    const code = await oneTimeInput('Six-digit FeedbackKit email code');
    if (!/^\d{6}$/.test(code)) throw new Error('Email code must contain exactly six digits');
    const completed = await completeAgentEmailLogin({ requestId, code });
    process.stdout.write(`${JSON.stringify(completed, null, 2)}\n`);
    if (!completed.acknowledged) {
      console.error(
        'Warning: the local credential is saved, but server acknowledgement was interrupted. '
        + 'The recoverable copy will expire automatically.',
      );
    }
    if (completed.previousCredentialRevoked === false) {
      console.error(
        'Warning: the new credential is saved, but the previous Agent credential could not be revoked.',
      );
    }
    return;
  }
  throw new Error('Use login email request or login email complete');
}

async function runOnboardingStatus(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--product', '--format']);
  const format = parsed.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') throw new Error('--format must be text or json');
  const credentials = await loadCredentials();
  const client = new FeedbackServerApiClient(credentials);
  const status = await deriveOnboardingStatus({
    client,
    endpoint: credentials.baseUrl,
    email: credentials.email,
    scopes: credentials.scopes,
    productId: parsed.get('--product'),
  });
  if (format === 'json') process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(formatOnboardingStatus(status, credentials.email));
}

export function formatOnboardingStatus(
  status: FeedbackServerOnboardingStatus,
  email: string,
): string {
  const lines = [
    `Account: ${email}`,
    `Apps: ${status.product.count}`,
    `Core ready: ${status.coreReady ? 'yes' : 'no'}`,
  ];
  if (status.nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of status.nextActions) {
      lines.push(`- ${action.message}`);
      if (action.requiresUserChoice && action.choices) {
        lines.push(`  Choices: ${action.choices.join(', ')}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

async function runNotificationPreferenceSet(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--product', '--choice']);
  const productId = parsed.get('--product');
  const choice = parsed.get('--choice');
  if (!productId) throw new Error('--product is required');
  if (!choice || !['bark', 'webhook', 'defer'].includes(choice)) {
    throw new Error('--choice must be bark, webhook, or defer');
  }
  const preference: NotificationSetupPreference = choice === 'defer'
    ? 'deferred'
    : choice === 'bark'
      ? 'bark'
      : 'webhook';
  const credentials = await loadCredentials();
  const client = new FeedbackServerApiClient(credentials);
  const product = await client.request<{
    id: string;
    name: string;
    notificationSetupPreference: NotificationSetupPreference;
  }>(`/admin/products/${encodeURIComponent(productId)}/notification-setup`, {
    method: 'PUT',
    body: { preference },
  });
  const nextAction = notificationSetupActionForPreference(preference);
  process.stdout.write(`${JSON.stringify({
    product,
    choice,
    preference,
    nextActions: nextAction ? [nextAction] : [],
  }, null, 2)}\n`);
}

async function runProductCreate(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--name', '--platform', '--slug', '--locale']);
  const name = parsed.get('--name');
  const platform = parsed.get('--platform');
  if (!name) throw new Error('--name is required');
  if (!platform || !['ios', 'ipados', 'macos', 'android', 'web'].includes(platform)) {
    throw new Error('--platform must be ios, ipados, macos, android, or web');
  }
  const slug = parsed.get('--slug') ?? slugify(name);
  const locale = parsed.get('--locale') ?? 'en';
  const credentials = await loadCredentials();
  const client = new FeedbackServerApiClient(credentials);
  const product = await client.request<{
    id: string;
    slug: string;
    name: string;
    publishableKey: string;
  }>('/admin/products', {
    method: 'POST',
    body: {
      name,
      slug,
      defaultLocale: locale,
      status: 'active',
      defaultFeedbackVisibility: 'private',
      diagnosticsEnabled: false,
    },
  });
  process.stdout.write(`${JSON.stringify({
    ...product,
    platform,
    defaultLocale: locale,
    nextActions: [notificationSetupChoiceAction()],
  }, null, 2)}\n`);
}

async function runDoctor(options: string[]): Promise<void> {
  const parsed = parseCliOptions(options, ['--product', '--app-path', '--format']);
  const format = parsed.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') throw new Error('--format must be text or json');
  const product = parsed.get('--product');
  const appPath = parsed.get('--app-path');
  const report = await diagnoseFeedbackServer({
    ...(product ? { product } : {}),
    ...(appPath ? { appPath } : {}),
  });
  process.stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
  if (!report.ok) process.exitCode = 1;
}

async function runProfile(argv: string[]): Promise<void> {
  const [action, name, ...rest] = argv;
  if (rest.length > 0) throw new Error('Unexpected profile arguments');
  if (action === 'list' && !name) {
    for (const profile of await listKeychainProfiles()) {
      process.stdout.write(`${profile.active ? '* ' : '  '}${profile.name}\n`);
    }
    return;
  }
  if ((action === 'use' || action === 'remove') && name) {
    if (action === 'use') await useKeychainProfile(name);
    else await deleteKeychainProfileCredentials(name);
    return;
  }
  throw new Error('Use profile list, profile use NAME, or profile remove NAME');
}

export async function runFeedbackServerCli(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const [group, action, ...options] = argv;
  if (group === 'accept-invite') return runAcceptInvite(argv.slice(1));
  if (group === 'login' && action === 'email') {
    const [emailAction, ...emailOptions] = options;
    return runEmailLogin(emailAction, emailOptions);
  }
  if (group === 'onboarding' && action === 'status') return runOnboardingStatus(options);
  if (group === 'notification' && action === 'preference') {
    const [preferenceAction, ...preferenceOptions] = options;
    if (preferenceAction === 'set') return runNotificationPreferenceSet(preferenceOptions);
    throw new Error('Use notification preference set');
  }
  if (group === 'product' && action === 'create') return runProductCreate(options);
  if (group === 'doctor') return runDoctor(argv.slice(1));
  if (group === 'profile') return runProfile(argv.slice(1));
  throw new Error(`Unknown FeedbackKit command.\n\n${usage}`);
}

export async function main(argv: string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    await runFeedbackServerCli(argv);
  } catch (error) {
    console.error(`FeedbackKit command failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
