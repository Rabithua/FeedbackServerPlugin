import {
  adminSessionRequest,
  assertInteractiveTerminal,
  login,
  logout,
} from './admin-session.js';
import { normalizeBaseUrl } from './credentials.js';

export interface EmailBindingResult {
  email: string;
  verifiedAt: string;
}

export async function bindAdministratorEmail(input: {
  baseUrl: string;
  identifier: string;
  password: string;
  email: string;
  readCode: (challenge: { challengeId: string; expiresAt: string }) => Promise<string>;
  warn?: (message: string) => void;
}): Promise<EmailBindingResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const session = await login(baseUrl, input.identifier, input.password);
  try {
    const challenge = await adminSessionRequest<{ challengeId: string; expiresAt: string }>(
      baseUrl,
      '/admin/auth/email/challenges',
      {
        method: 'POST',
        bearer: session.accessToken,
        body: { email: input.email, password: input.password },
      },
    );
    const code = (await input.readCode(challenge)).trim();
    if (!code) throw new Error('Email verification code is required');
    return await adminSessionRequest<EmailBindingResult>(
      baseUrl,
      '/admin/auth/email/verify',
      {
        method: 'POST',
        bearer: session.accessToken,
        body: { challengeId: challenge.challengeId, code },
      },
    );
  } finally {
    try {
      await logout(baseUrl, session.refreshToken);
    } catch {
      (input.warn ?? console.error)(
        'Warning: unable to revoke the temporary email-binding session; it will expire automatically.',
      );
    }
  }
}

export async function resetAdministratorPassword(input: {
  baseUrl: string;
  identifier: string;
  readCode: (request: { requestId: string; expiresAt: string }) => Promise<string>;
  readNewPassword: () => Promise<string>;
  ensureInteractive?: () => void;
}): Promise<void> {
  (input.ensureInteractive ?? assertInteractiveTerminal)();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const request = await adminSessionRequest<{ requestId: string; expiresAt: string }>(
    baseUrl,
    '/admin/auth/password-reset/request',
    { method: 'POST', body: { identifier: input.identifier } },
  );
  const code = (await input.readCode(request)).trim();
  if (!code) throw new Error('Password reset verification code is required');
  const newPassword = await input.readNewPassword();
  if (newPassword.length < 12 || newPassword.length > 200) {
    throw new Error('Administrator password must contain 12 through 200 characters');
  }
  await adminSessionRequest<null>(baseUrl, '/admin/auth/password-reset/confirm', {
    method: 'POST',
    body: { requestId: request.requestId, code, newPassword },
  });
}
