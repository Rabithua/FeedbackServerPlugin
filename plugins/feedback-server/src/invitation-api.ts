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

export interface InvitationAcceptanceWindow {
  earliest: Date;
  latest: Date;
}

const SUBSCRIPTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const ACCEPTANCE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function addUtcCalendarMonthsClamped(value: Date, months: 1 | 12): Date {
  const targetMonthIndex = value.getUTCMonth() + months;
  const targetYear = value.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(value.getUTCDate(), lastTargetDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
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
  acceptanceWindow?: InvitationAcceptanceWindow,
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
  if (
    applied.term !== 'fixed'
    || applied.expiresAt === null
    || applied.graceEndsAt === null
    || !acceptanceWindow
  ) return false;

  const expiresAt = Date.parse(applied.expiresAt);
  const graceEndsAt = Date.parse(applied.graceEndsAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(graceEndsAt)) return false;
  if (graceEndsAt !== expiresAt + SUBSCRIPTION_GRACE_MS) return false;

  const earliestAcceptedAt = acceptanceWindow.earliest.getTime() - ACCEPTANCE_CLOCK_SKEW_MS;
  const latestAcceptedAt = acceptanceWindow.latest.getTime() + ACCEPTANCE_CLOCK_SKEW_MS;
  if (
    !Number.isFinite(earliestAcceptedAt)
    || !Number.isFinite(latestAcceptedAt)
    || earliestAcceptedAt > latestAcceptedAt
  ) return false;
  const durationMonths = grant.term === 'month' ? 1 : 12;
  const earliestExpiry = addUtcCalendarMonthsClamped(
    new Date(earliestAcceptedAt),
    durationMonths,
  ).getTime();
  const latestExpiry = addUtcCalendarMonthsClamped(
    new Date(latestAcceptedAt),
    durationMonths,
  ).getTime();
  return expiresAt >= earliestExpiry && expiresAt <= latestExpiry;
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
