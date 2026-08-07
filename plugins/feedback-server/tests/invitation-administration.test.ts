import { describe, expect, test } from 'bun:test';
import {
  buildInvitationHandoffMessage,
  createInvitationHandoffMessage,
  createShareableInvitation,
  getInvitations,
  revokeInvitationById,
  type InvitationAdministrationDependencies,
} from '../src/invitation-administration.js';
import type { CreatedInvitation, InvitationSummary } from '../src/invitation-api.js';

const baseUrl = 'https://feedback.example.com/v1/api';
const token = `fsinv_${'x'.repeat(48)}`;
const invitation: CreatedInvitation = {
  id: '11111111-1111-4111-8111-111111111111',
  token,
  tokenPrefix: token.slice(0, 18),
  status: 'pending',
  createdByAdminId: '22222222-2222-4222-8222-222222222222',
  acceptedByAdminId: null,
  expiresAt: '2026-08-11T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-08-04T00:00:00.000Z',
};
const handoffMessage = buildInvitationHandoffMessage({ baseUrl, invitation });

function dependencies(
  events: string[],
  overrides: Partial<InvitationAdministrationDependencies> = {},
): InvitationAdministrationDependencies {
  return {
    login: () => {
      events.push('login');
      return Promise.resolve({
        accessToken: 'access',
        refreshToken: 'refresh',
        admin: {
          id: 'admin-id',
          username: 'owner',
          displayName: 'Owner',
          role: 'super_admin',
        },
      });
    },
    logout: () => {
      events.push('logout');
      return Promise.resolve();
    },
    createInvitation: (_url, _access, expiresInDays) => {
      events.push(`create:${expiresInDays}`);
      return Promise.resolve(invitation);
    },
    listInvitations: () => {
      events.push('list');
      return Promise.resolve([invitation]);
    },
    revokeInvitation: (_url, _access, invitationId) => {
      events.push(`revoke:${invitationId}`);
      return Promise.resolve();
    },
    clipboard: {
      write: (value) => {
        expect(value).toBe(handoffMessage);
        expect(value).toContain(token);
        expect(value).toContain(`admin accept-invite --url ${baseUrl}`);
        expect(value).toContain('可以把这整段消息直接发给 Codex 或 Claude Code');
        expect(value).toContain('cd FeedbackServerPlugin');
        expect(value).toContain('真实绝对路径');
        expect(value).toContain('不要在 Agent 进程、私有 PTY 或其他不可见终端中运行');
        expect(value).toContain('自己可见、可控制的交互式终端');
        expect(value).toContain('保留原账号');
        expect(value).toContain('切换到受邀账号');
        expect(value).toContain('这台 Mac 上所有启用 FeedbackServer');
        expect(value).toContain('自动尝试恢复原账号');
        expect(value).toContain('当前任务中亲自批准');
        expect(value).toContain('codex plugin marketplace list --json');
        expect(value).toContain('codex plugin marketplace upgrade feedback-server');
        expect(value).toContain('已经安装时不要重复 add');
        expect(value).toContain('只有我明确输入 switch 才会继续');
        expect(value).toContain(`--token ${token}`);
        events.push('copy');
        return Promise.resolve();
      },
      clearIfUnchanged: (value) => {
        expect(value).toBe(handoffMessage);
        events.push('clear');
        return Promise.resolve(true);
      },
    },
    ...overrides,
  };
}

const input = {
  baseUrl,
  superAdminUsername: 'owner',
  superAdminPassword: 'not-logged',
  expiresInDays: 7,
};

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('administrator invitation lifecycle', () => {
  test('creates a chat-ready handoff without clipboard delivery or rollback ceremony', async () => {
    const events: string[] = [];
    const result = await createInvitationHandoffMessage(input, dependencies(events));
    expect(result.invitation).toEqual(invitation);
    expect(result.handoffMessage).toBe(handoffMessage);
    expect(result.handoffMessage).toContain(token);
    expect(result.handoffMessage).toContain('可以把这整段消息直接发给 Codex 或 Claude Code');
    expect(result.handoffMessage).toContain('cd FeedbackServerPlugin');
    expect(result.handoffMessage).toContain('真实绝对路径');
    expect(result.handoffMessage).toContain(
      '不要在 Agent 进程、私有 PTY 或其他不可见终端中运行',
    );
    expect(result.handoffMessage).toContain('自己可见、可控制的交互式终端');
    expect(result.handoffMessage).toContain('保留原账号');
    expect(result.handoffMessage).toContain('切换到受邀账号');
    expect(result.handoffMessage).toContain('这台 Mac 上所有启用 FeedbackServer');
    expect(result.handoffMessage).toContain('自动尝试恢复原账号');
    expect(result.handoffMessage).toContain('当前任务中亲自批准');
    expect(result.handoffMessage).toContain('codex plugin marketplace list --json');
    expect(result.handoffMessage).toContain('codex plugin marketplace upgrade feedback-server');
    expect(result.handoffMessage).toContain('已经安装时不要重复 add');
    expect(result.handoffMessage).toContain('只有我明确输入 switch 才会继续');
    expect(result.handoffMessage).toContain(`--token ${token}`);
    expect(events).toEqual(['login', 'create:7', 'logout']);
  });

  test('copies once, waits for sharing, clears if unchanged, and logs out', async () => {
    const events: string[] = [];
    const result = await createShareableInvitation(
      input,
      () => {
        events.push('shared');
        return Promise.resolve();
      },
      dependencies(events),
    );
    expect(result).toEqual({ invitation, clipboardCleared: true });
    expect(events).toEqual(['login', 'create:7', 'copy', 'shared', 'clear', 'logout']);
  });

  test('revokes a new invitation when clipboard delivery fails', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createShareableInvitation(
        input,
        () => Promise.resolve(),
        dependencies(events, {
          clipboard: {
            write: () => {
              events.push('copy-failed');
              return Promise.reject(new Error('clipboard unavailable'));
            },
            clearIfUnchanged: () => Promise.resolve(false),
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('clipboard unavailable');
    expect(events).toEqual([
      'login',
      'create:7',
      'copy-failed',
      `revoke:${invitation.id}`,
      'logout',
    ]);
  });

  test('revokes an invitation when the sharing handoff aborts', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createShareableInvitation(
        input,
        () => Promise.reject(new Error('cancelled after sharing')),
        dependencies(events),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('cancelled after sharing');
    expect(events).toEqual([
      'login',
      'create:7',
      'copy',
      `revoke:${invitation.id}`,
      'clear',
      'logout',
    ]);
  });

  test('aggregates handoff rollback, clipboard cleanup, and logout failures', async () => {
    const events: string[] = [];
    const error = await capturedError(
      createShareableInvitation(
        input,
        () => Promise.reject(new Error('handoff closed')),
        dependencies(events, {
          revokeInvitation: () => Promise.reject(new Error('rollback unavailable')),
          clipboard: {
            write: () => Promise.resolve(),
            clearIfUnchanged: () => Promise.reject(new Error('clipboard cleanup unavailable')),
          },
          logout: () => Promise.reject(new Error('logout unavailable')),
        }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(4);
  });

  test('lists metadata and revokes by id through temporary sessions', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const listed: InvitationSummary[] = await getInvitations(input, deps);
    expect(listed).toEqual([invitation]);
    await revokeInvitationById({ ...input, invitationId: invitation.id }, deps);
    expect(events).toEqual([
      'login',
      'list',
      'logout',
      'login',
      `revoke:${invitation.id}`,
      'logout',
    ]);
  });

  test('rejects an ordinary administrator before invitation access', async () => {
    const events: string[] = [];
    const error = await capturedError(
      getInvitations(
        input,
        dependencies(events, {
          login: () => {
            events.push('login');
            return Promise.resolve({
              accessToken: 'access',
              refreshToken: 'refresh',
              admin: {
                id: 'admin-id',
                username: 'owner',
                displayName: 'Owner',
                role: 'admin',
              },
            });
          },
        }),
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('super administrator');
    expect(events).toEqual(['login', 'logout']);
  });
});
