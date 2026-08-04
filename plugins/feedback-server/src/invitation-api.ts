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
}

export interface CreatedInvitation extends InvitationSummary {
  token: string;
}

export interface AcceptedInvitation extends LoginResponse {
  admin: AdminIdentity;
}

export async function createAdminInvitation(
  baseUrl: string,
  accessToken: string,
  expiresInDays: number,
): Promise<CreatedInvitation> {
  return adminSessionRequest<CreatedInvitation>(baseUrl, '/admin/auth/invitations', {
    method: 'POST',
    bearer: accessToken,
    body: { expiresInDays },
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

