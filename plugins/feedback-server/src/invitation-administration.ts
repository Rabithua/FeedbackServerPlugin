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

export function buildInvitationHandoffMessage(input: {
  baseUrl: string;
  invitation: CreatedInvitation;
}): string {
  return `FeedbackServer 管理员邀请

你收到的是一个一次性管理员邀请码。请不要把整段消息直接发给 Agent；只复制下面“给 Codex 或 Claude Code 的任务文本”那一段。邀请码不要发到 Agent 聊天、工单、代码仓库、截图或共享文档里，只在终端隐藏输入提示里粘贴它。

服务地址：
${input.baseUrl}

邀请码：
${input.invitation.token}

邀请码 ID：
${input.invitation.id}

过期时间：
${input.invitation.expiresAt}

给 Codex 或 Claude Code 的任务文本：

请帮我完成 FeedbackServer 受邀管理员接入。

要求：
1. 不要让我把邀请码、密码、PAT 或任何 token 发到聊天里。
2. 如果当前是 Codex，先运行 codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main，然后运行 codex plugin add feedback-server@feedback-server。
3. 如果当前是 Claude Code，先运行 claude plugin marketplace add Rabithua/FeedbackServerPlugin，然后运行 claude plugin install feedback-server@feedback-server --scope user。
4. 克隆 https://github.com/Rabithua/FeedbackServerPlugin.git，然后运行 plugins/feedback-server/bin/feedback-server admin accept-invite --url ${input.baseUrl}
5. 运行命令时让我在终端输入用户名和显示名，并通过隐藏输入填写一次性邀请码和密码；邀请码只由我粘贴进隐藏终端提示。
6. 成功后打开或提醒我打开新的 Agent 会话，检查 FeedbackServer connection_status，并列出我的 Products。
7. 如果 Product 列表为空，告诉我这是正常的；新管理员默认没有 Product，也不能访问邀请人的 Product。

完整说明：
https://github.com/Rabithua/FeedbackServerPlugin/blob/main/docs/invited-admin-onboarding.zh-Hans.md
`;
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
    const handoffMessage = buildInvitationHandoffMessage({ baseUrl, invitation });
    await dependencies.clipboard.write(handoffMessage);
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
      clipboardCleared = await dependencies.clipboard.clearIfUnchanged(
        buildInvitationHandoffMessage({ baseUrl, invitation }),
      );
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
