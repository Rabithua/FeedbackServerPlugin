import {
  adminSessionRequest,
  type LoginResponse,
} from './admin-session.js';

export interface AdminIdentity {
  id: string;
  username: string;
  displayName: string;
  role: 'super_admin' | 'admin';
  disabled?: boolean;
}

export type InvitationSubscriptionGrant =
  | { plan: 'free' }
  | { plan: 'solo' | 'studio'; term: 'month' | 'year' | 'perpetual' };

export interface AppliedInvitationSubscription {
  plan: 'free' | 'solo' | 'studio';
  term: 'free' | 'fixed' | 'perpetual';
  expiresAt: string | null;
  graceEndsAt: string | null;
}

export function invitationSubscriptionGrantsMatch(
  actual: InvitationSubscriptionGrant | undefined,
  expected: InvitationSubscriptionGrant,
): boolean {
  if (!actual || actual.plan !== expected.plan) return false;
  if (expected.plan === 'free') return !('term' in actual);
  return actual.plan !== 'free' && actual.term === expected.term;
}

export function appliedSubscriptionMatchesGrant(
  applied: AppliedInvitationSubscription,
  grant: InvitationSubscriptionGrant,
): boolean {
  if (applied.plan !== grant.plan) return false;
  if (grant.plan === 'free') {
    return applied.term === 'free'
      && applied.expiresAt === null
      && applied.graceEndsAt === null;
  }
  if (grant.term === 'perpetual') {
    return applied.term === 'perpetual'
      && applied.expiresAt === null
      && applied.graceEndsAt === null;
  }
  return applied.term === 'fixed'
    && applied.expiresAt !== null
    && applied.graceEndsAt !== null;
}

export interface InvitationSummary {
  id: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  tokenPrefix: string;
  createdByAdminId: string;
  acceptedByAdminId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  subscriptionGrant?: InvitationSubscriptionGrant;
}

export interface CreatedInvitation extends InvitationSummary {
  token: string;
}

export interface AcceptedInvitation extends LoginResponse {
  admin: AdminIdentity;
  subscription?: AppliedInvitationSubscription;
}

export async function createAdminInvitation(
  baseUrl: string,
  accessToken: string,
  expiresInDays: number,
  subscriptionGrant: InvitationSubscriptionGrant = { plan: 'free' },
): Promise<CreatedInvitation> {
  return adminSessionRequest<CreatedInvitation>(baseUrl, '/admin/auth/invitations', {
    method: 'POST',
    bearer: accessToken,
    body: { expiresInDays, subscriptionGrant },
  });
}

export async function listAdminInvitations(
  baseUrl: string,
  accessToken: string,
): Promise<InvitationSummary[]> {
  return adminSessionRequest<InvitationSummary[]>(baseUrl, '/admin/auth/invitations', {
    bearer: accessToken,
  });
}

export async function revokeAdminInvitation(
  baseUrl: string,
  accessToken: string,
  invitationId: string,
): Promise<void> {
  await adminSessionRequest<null>(
    baseUrl,
    `/admin/auth/invitations/${encodeURIComponent(invitationId)}`,
    { method: 'DELETE', bearer: accessToken },
  );
}

export async function acceptAdminInvitation(
  baseUrl: string,
  input: { token: string; username: string; displayName: string; password: string },
): Promise<AcceptedInvitation> {
  return adminSessionRequest<AcceptedInvitation>(baseUrl, '/admin/auth/invitations/accept', {
    method: 'POST',
    body: input,
  });
}

export async function listOwnedProducts(
  baseUrl: string,
  accessToken: string,
): Promise<unknown[]> {
  return adminSessionRequest<unknown[]>(baseUrl, '/admin/products', {
    bearer: accessToken,
  });
}
