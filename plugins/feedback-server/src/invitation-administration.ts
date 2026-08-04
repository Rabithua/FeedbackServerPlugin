import {
  login,
  logout,
  type LoginResponse,
} from './admin-session.js';
import { normalizeBaseUrl } from './credentials.js';
import {
  createAdminInvitation,
  listAdminInvitations,
  revokeAdminInvitation,
  type CreatedInvitation,
  type InvitationSummary,
} from './invitation-api.js';
import { MacOSClipboard, type SecureClipboard } from './macos-clipboard.js';

export interface InvitationAdministrationDependencies {
  login: typeof login;
  logout: typeof logout;
  createInvitation: typeof createAdminInvitation;
  listInvitations: typeof listAdminInvitations;
  revokeInvitation: typeof revokeAdminInvitation;
  clipboard: SecureClipboard;
}

const defaultDependencies: InvitationAdministrationDependencies = {
  login,
  logout,
  createInvitation: createAdminInvitation,
  listInvitations: listAdminInvitations,
  revokeInvitation: revokeAdminInvitation,
  clipboard: new MacOSClipboard(),
};

function requireSuperAdmin(session: LoginResponse): void {
  if (session.admin?.role !== 'super_admin') {
    throw new Error('An enabled super administrator account is required');
  }
}

async function logoutWithWarning(
  baseUrl: string,
  refreshToken: string,
  logoutSession: typeof logout,
): Promise<void> {
  try {
    await logoutSession(baseUrl, refreshToken);
  } catch (error) {
    console.error(
      `Warning: unable to revoke the temporary refresh session: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

export async function createShareableInvitation(
  input: {
    baseUrl: string;
    superAdminUsername: string;
    superAdminPassword: string;
    expiresInDays: number;
  },
  onCopied: (invitation: CreatedInvitation) => Promise<void>,
  dependencies: InvitationAdministrationDependencies = defaultDependencies,
): Promise<{ invitation: CreatedInvitation; clipboardCleared: boolean }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const session = await dependencies.login(
    baseUrl,
    input.superAdminUsername,
    input.superAdminPassword,
  );
  let invitation: CreatedInvitation | undefined;
  let copied = false;
  let handoffCommitted = false;
  let clipboardCleared = false;
  const errors: unknown[] = [];

  try {
    requireSuperAdmin(session);
    invitation = await dependencies.createInvitation(
      baseUrl,
      session.accessToken,
      input.expiresInDays,
    );
    await dependencies.clipboard.write(invitation.token);
    copied = true;
    await onCopied(invitation);
    handoffCommitted = true;
  } catch (error) {
    errors.push(error);
    if (invitation && !handoffCommitted) {
      try {
        await dependencies.revokeInvitation(baseUrl, session.accessToken, invitation.id);
      } catch (revocationError) {
        errors.push(revocationError);
      }
    }
  }

  if (copied && invitation) {
    try {
      clipboardCleared = await dependencies.clipboard.clearIfUnchanged(invitation.token);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await dependencies.logout(baseUrl, session.refreshToken);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw errors.length === 1
      ? errors[0] instanceof Error
        ? errors[0]
        : new Error('Invitation operation failed', { cause: errors[0] })
      : new AggregateError(errors, 'Invitation operation or clipboard cleanup failed');
  }
  if (!invitation) throw new Error('Invitation creation did not return an invitation');
  return { invitation, clipboardCleared };
}

export async function getInvitations(
  input: { baseUrl: string; superAdminUsername: string; superAdminPassword: string },
  dependencies: InvitationAdministrationDependencies = defaultDependencies,
): Promise<InvitationSummary[]> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const session = await dependencies.login(
    baseUrl,
    input.superAdminUsername,
    input.superAdminPassword,
  );
  try {
    requireSuperAdmin(session);
    return await dependencies.listInvitations(baseUrl, session.accessToken);
  } finally {
    await logoutWithWarning(baseUrl, session.refreshToken, dependencies.logout);
  }
}

export async function revokeInvitationById(
  input: {
    baseUrl: string;
    superAdminUsername: string;
    superAdminPassword: string;
    invitationId: string;
  },
  dependencies: InvitationAdministrationDependencies = defaultDependencies,
): Promise<void> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const session = await dependencies.login(
    baseUrl,
    input.superAdminUsername,
    input.superAdminPassword,
  );
  try {
    requireSuperAdmin(session);
    await dependencies.revokeInvitation(baseUrl, session.accessToken, input.invitationId);
  } finally {
    await logoutWithWarning(baseUrl, session.refreshToken, dependencies.logout);
  }
}
