import { adminSessionRequest, login, logout } from './admin-session.js';

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
}): Promise<EmailBindingResult> {
  const session = await login(input.baseUrl, input.identifier, input.password);
  try {
    const challenge = await adminSessionRequest<{ challengeId: string; expiresAt: string }>(
      input.baseUrl,
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
      input.baseUrl,
      '/admin/auth/email/verify',
      {
        method: 'POST',
        bearer: session.accessToken,
        body: { challengeId: challenge.challengeId, code },
      },
    );
  } finally {
    await logout(input.baseUrl, session.refreshToken).catch(() => undefined);
  }
}

export async function resetAdministratorPassword(input: {
  baseUrl: string;
  identifier: string;
  readCode: (request: { requestId: string; expiresAt: string }) => Promise<string>;
  readNewPassword: () => Promise<string>;
}): Promise<void> {
  const request = await adminSessionRequest<{ requestId: string; expiresAt: string }>(
    input.baseUrl,
    '/admin/auth/password-reset/request',
    { method: 'POST', body: { identifier: input.identifier } },
  );
  const code = (await input.readCode(request)).trim();
  if (!code) throw new Error('Password reset verification code is required');
  const newPassword = await input.readNewPassword();
  if (newPassword.length < 12 || newPassword.length > 200) {
    throw new Error('Administrator password must contain 12 through 200 characters');
  }
  await adminSessionRequest<null>(input.baseUrl, '/admin/auth/password-reset/confirm', {
    method: 'POST',
    body: { requestId: request.requestId, code, newPassword },
  });
}
