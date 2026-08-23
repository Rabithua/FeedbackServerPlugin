import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { normalizeBaseUrl, profileIdSchema } from './credentials.js';

const invitationToken = z
  .string()
  .trim()
  .min(8)
  .max(512)
  .regex(/^fsinv_[A-Za-z0-9_-]+$/)
  .describe('The time-limited fsinv_ invitation token from the administrator handoff.');

export const localSetupInputSchema = z.object({
  flow: z
    .enum(['configure_account', 'accept_invitation'])
    .describe('Choose configure_account for an existing administrator or accept_invitation for a one-time invitation.'),
  baseUrl: z
    .url()
    .optional()
    .describe('FeedbackServer URL from the invitation. Required only for accept_invitation.'),
  invitationToken: invitationToken.optional(),
  username: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('New administrator username. Required only for accept_invitation.'),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .optional()
    .describe('New administrator display name. Required only for accept_invitation.'),
  profile: profileIdSchema
    .optional()
    .describe('Global Keychain profile to configure; valid only for configure_account. Example: work.'),
}).superRefine((input, context) => {
  const invitationFields = ['baseUrl', 'invitationToken', 'username', 'displayName'] as const;
  if (input.flow === 'accept_invitation') {
    for (const field of invitationFields) {
      if (!input[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for accept_invitation`,
        });
      }
    }
    if (input.profile !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['profile'],
        message: 'profile is only valid for configure_account',
      });
    }
    return;
  }
  for (const field of invitationFields) {
    if (input[field] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is only valid for accept_invitation`,
      });
    }
  }
});

export type LocalSetupInput = z.infer<typeof localSetupInputSchema>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandFromArguments(arguments_: string[]): string {
  return arguments_.map(shellQuote).join(' ');
}

export function prepareLocalSetup(
  rawInput: LocalSetupInput,
  executablePath = fileURLToPath(new URL('../bin/feedback-server', import.meta.url)),
): {
  status: 'ready';
  flow: LocalSetupInput['flow'];
  command: string;
  executablePath: string;
  requiresVisibleTerminal: true;
  executesCommand: false;
  reloadAfterSuccess: false;
} {
  const input = localSetupInputSchema.parse(rawInput);
  let arguments_: string[];
  if (input.flow === 'configure_account') {
    arguments_ = [
      executablePath,
      'agent',
      'configure',
      ...(input.profile ? ['--profile', input.profile] : []),
    ];
  } else {
    const { baseUrl, invitationToken: token, username, displayName } = input;
    if (!baseUrl || !token || !username || !displayName) {
      throw new Error('Invitation setup input was not fully validated');
    }
    arguments_ = [
      executablePath,
      'admin',
      'accept-invite',
      '--url',
      normalizeBaseUrl(baseUrl),
      '--token',
      token,
      '--username',
      username,
      '--display-name',
      displayName,
    ];
  }
  return {
    status: 'ready',
    flow: input.flow,
    command: commandFromArguments(arguments_),
    executablePath,
    requiresVisibleTerminal: true,
    executesCommand: false,
    reloadAfterSuccess: false,
  };
}
