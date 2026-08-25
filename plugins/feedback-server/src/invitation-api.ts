import { normalizeBaseUrl } from './credentials.js';

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
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

export interface AcceptedInvitation {
  enrollmentId: string;
  admin: {
    id: string;
    email: string;
    emailVerifiedAt: string;
    role: 'admin' | 'super_admin';
  };
  subscription: AppliedInvitationSubscription;
  credential: {
    id: string;
    name: string;
    token: string;
    scopes: string[];
    expiresAt: string;
  };
}

export class InvitationApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvitationApiError';
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  input: { body?: unknown; bearer?: string; method?: 'POST' | 'DELETE' },
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method: input.method ?? 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(input.bearer ? { Authorization: `Bearer ${input.bearer}` } : {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new InvitationApiError(503, 'connection_failed', 'Unable to reach FeedbackKit');
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new InvitationApiError(response.status, 'invalid_response', 'FeedbackKit returned an invalid response');
  }
  if (!response.ok || envelope.code !== 'ok') {
    throw new InvitationApiError(
      response.status,
      envelope.code || 'request_failed',
      envelope.message || 'FeedbackKit request failed',
    );
  }
  return envelope.data;
}

export async function revokeCurrentAgentCredential(
  baseUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request<null>(
    baseUrl,
    '/admin/auth/api-tokens/current',
    { bearer: token, method: 'DELETE' },
    fetcher,
  );
}

export async function acceptAdminInvitation(
  baseUrl: string,
  input: { token: string; enrollmentId: string; credentialName: string },
  fetcher: typeof fetch = fetch,
): Promise<AcceptedInvitation> {
  return request(baseUrl, '/admin/auth/invitations/accept', { body: input }, fetcher);
}

export async function acknowledgeInvitationEnrollment(
  baseUrl: string,
  input: { enrollmentId: string; token: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request<null>(
    baseUrl,
    '/admin/auth/invitations/enrollments/ack',
    { body: { enrollmentId: input.enrollmentId }, bearer: input.token },
    fetcher,
  );
}
