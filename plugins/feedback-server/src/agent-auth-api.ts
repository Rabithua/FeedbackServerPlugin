import { FeedbackServerApiError } from './api-client.js';
import { normalizeBaseUrl, type StoredCredentials } from './credentials.js';
import { PLUGIN_VERSION } from './version.js';

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    bearer?: string;
    reauthToken?: string;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
    'User-Agent': `FeedbackServer-MCP/${PLUGIN_VERSION}`,
  });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
  if (options.reauthToken) headers.set('X-FeedbackKit-Reauth', options.reauthToken);
  let response: Response;
  try {
    response = await fetcher(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method: options.method ?? 'POST',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FeedbackServerApiError(503, 'connection_failed', 'Unable to reach FeedbackKit', null);
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new FeedbackServerApiError(
      response.status,
      'invalid_response',
      'FeedbackKit returned an invalid response',
      null,
    );
  }
  if (!response.ok || envelope.code !== 'ok') {
    throw new FeedbackServerApiError(
      response.status,
      envelope.code || 'request_failed',
      envelope.message || 'FeedbackKit request failed',
      envelope.data,
    );
  }
  return envelope.data;
}

export interface AgentEnrollmentCredentialResult {
  enrollmentId: string;
  admin: {
    id: string;
    email: string;
    emailVerifiedAt: string;
    role: 'admin' | 'super_admin';
  };
  credential: {
    id: string;
    name: string;
    token: string;
    scopes: string[];
    expiresAt: string;
  };
}

export function requestEmailAgentEnrollment(
  baseUrl: string,
  input: {
    email: string;
    enrollmentId: string;
    enrollmentSecret: string;
    credentialName: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<{ challengeId: string; expiresAt: string }> {
  return request(baseUrl, '/admin/auth/agent-enrollments/email/challenges', {
    body: input,
  }, fetcher);
}

export function confirmEmailAgentEnrollment(
  baseUrl: string,
  input: {
    enrollmentId: string;
    enrollmentSecret: string;
    challengeId: string;
    code: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<AgentEnrollmentCredentialResult> {
  return request(
    baseUrl,
    `/admin/auth/agent-enrollments/${encodeURIComponent(input.enrollmentId)}/email/confirm`,
    {
      bearer: input.enrollmentSecret,
      body: { challengeId: input.challengeId, code: input.code },
    },
    fetcher,
  );
}

export function acknowledgeEmailAgentEnrollment(
  baseUrl: string,
  input: { enrollmentId: string; token: string },
  fetcher: typeof fetch = fetch,
): Promise<null> {
  return request(
    baseUrl,
    `/admin/auth/agent-enrollments/${encodeURIComponent(input.enrollmentId)}/ack`,
    { bearer: input.token },
    fetcher,
  );
}

export function requestEmailReauthentication(
  credentials: StoredCredentials,
  fetcher: typeof fetch = fetch,
): Promise<{ challengeId: string; expiresAt: string }> {
  return request(credentials.baseUrl, '/admin/auth/reauth/email/challenges', {
    bearer: credentials.token,
  }, fetcher);
}

export function confirmEmailReauthentication(
  credentials: StoredCredentials,
  input: { challengeId: string; code: string },
  fetcher: typeof fetch = fetch,
): Promise<{ reauthToken: string; expiresAt: string }> {
  return request(credentials.baseUrl, '/admin/auth/reauth/email/confirm', {
    bearer: credentials.token,
    body: input,
  }, fetcher);
}

export function requestEmailChange(
  credentials: StoredCredentials,
  reauthToken: string,
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<{ challengeId: string; expiresAt: string }> {
  return request(credentials.baseUrl, '/admin/auth/email/change/challenges', {
    bearer: credentials.token,
    reauthToken,
    body: { email },
  }, fetcher);
}

export function confirmEmailChange(
  credentials: StoredCredentials,
  reauthToken: string,
  input: { challengeId: string; code: string },
  fetcher: typeof fetch = fetch,
): Promise<{ email: string; verifiedAt: string }> {
  return request(credentials.baseUrl, '/admin/auth/email/change/verify', {
    bearer: credentials.token,
    reauthToken,
    body: input,
  }, fetcher);
}

export interface AgentCredentialMetadata {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function listAgentCredentials(
  credentials: StoredCredentials,
  reauthToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentCredentialMetadata[]> {
  return request(credentials.baseUrl, '/admin/auth/api-tokens', {
    method: 'GET',
    bearer: credentials.token,
    reauthToken,
  }, fetcher);
}

export function revokeAgentCredential(
  credentials: StoredCredentials,
  reauthToken: string,
  tokenId: string,
  fetcher: typeof fetch = fetch,
): Promise<null> {
  return request(
    credentials.baseUrl,
    `/admin/auth/api-tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE', bearer: credentials.token, reauthToken },
    fetcher,
  );
}
