import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/create-server.js';
import type { PluginUpdateNotice } from '../src/release-updates.js';
import type { FeedbackServerSetupNotice } from '../src/onboarding.js';
import { productUpdateProtectedEffects } from '../src/tools.js';

const token = `fspat_${'b'.repeat(64)}`;
const productId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const mutationPrecondition = `"${'a'.repeat(64)}"`;

interface ToolScenario {
  name: string;
  arguments: Record<string, unknown>;
  path: string;
  method?: string;
  confirmation?: 'always' | 'risk';
}

const productAssociation = {
  productId,
  visibility: 'public',
  roadmapStage: 'urgent',
  rank: 0,
  archived: false,
};

const toolScenarios: ToolScenario[] = [
  { name: 'health', arguments: {}, path: '/v1/api/health' },
  { name: 'connection_status', arguments: {}, path: '/v1/api/admin/auth/email' },
  { name: 'list_products', arguments: {}, path: '/v1/api/admin/products' },
  { name: 'get_product', arguments: { productId }, path: `/v1/api/admin/products/${productId}` },
  { name: 'get_subscription', arguments: {}, path: '/v1/api/admin/subscription' },
  {
    name: 'set_primary_product',
    arguments: { productId: secondId },
    path: '/v1/api/admin/subscription/primary-product',
    method: 'PUT',
    confirmation: 'risk',
  },
  {
    name: 'create_product',
    arguments: { slug: 'agent-app', name: 'Agent App' },
    path: '/v1/api/admin/products',
    method: 'POST',
  },
  {
    name: 'update_product',
    arguments: { productId, name: 'Renamed' },
    path: `/v1/api/admin/products/${productId}`,
    method: 'PATCH',
  },
  {
    name: 'rotate_product_key',
    arguments: { productId },
    path: `/v1/api/admin/products/${productId}/rotate-publishable-key`,
    method: 'POST',
    confirmation: 'always',
  },
  {
    name: 'delete_product',
    arguments: { productId },
    path: `/v1/api/admin/products/${productId}`,
    method: 'DELETE',
    confirmation: 'always',
  },
  {
    name: 'get_product_app_store_binding',
    arguments: { productId },
    path: `/v1/api/admin/products/${productId}/app-store`,
  },
  {
    name: 'configure_product_app_store_binding',
    arguments: { productId, appStoreId: '1234567890', storefront: 'US', locale: 'en-US' },
    path: `/v1/api/admin/products/${productId}/app-store`,
    method: 'PUT',
  },
  {
    name: 'remove_product_app_store_binding',
    arguments: { productId },
    path: `/v1/api/admin/products/${productId}/app-store`,
    method: 'DELETE',
  },
  {
    name: 'list_waitlist_entries',
    arguments: { status: 'new', platform: 'ios_ipados', search: 'Example', limit: 25 },
    path: '/v1/api/admin/waitlist?status=new&platform=ios_ipados&search=Example&limit=25',
  },
  {
    name: 'get_waitlist_entry',
    arguments: { entryId: productId },
    path: `/v1/api/admin/waitlist/${productId}`,
  },
  {
    name: 'update_waitlist_status',
    arguments: { entryId: productId, status: 'contacted' },
    path: `/v1/api/admin/waitlist/${productId}`,
    method: 'PATCH',
  },
  {
    name: 'add_waitlist_note',
    arguments: { entryId: productId, body: 'Followed up.' },
    path: `/v1/api/admin/waitlist/${productId}/notes`,
    method: 'POST',
  },
  {
    name: 'delete_waitlist_entry',
    arguments: { entryId: productId },
    path: `/v1/api/admin/waitlist/${productId}`,
    method: 'DELETE',
    confirmation: 'risk',
  },
  {
    name: 'invite_waitlist_entry',
    arguments: { entryId: productId, subscriptionGrant: { plan: 'free' }, expiresInDays: 7 },
    path: `/v1/api/admin/waitlist/${productId}/invitations`,
    method: 'POST',
    confirmation: 'risk',
  },
  {
    name: 'retry_waitlist_invitation_email',
    arguments: { entryId: productId, invitationId: secondId },
    path: `/v1/api/admin/waitlist/${productId}/invitations/${secondId}/retry`,
    method: 'POST',
    confirmation: 'risk',
  },
  {
    name: 'revoke_waitlist_invitation',
    arguments: { entryId: productId, invitationId: secondId },
    path: `/v1/api/admin/waitlist/${productId}/invitations/${secondId}`,
    method: 'DELETE',
    confirmation: 'risk',
  },
  {
    name: 'list_feedback',
    arguments: { productId, type: 'suggestion', status: 'open', limit: 25 },
    path: `/v1/api/admin/feedback?productId=${productId}&status=open&type=suggestion&limit=25`,
  },
  {
    name: 'get_feedback',
    arguments: { feedbackId: productId },
    path: `/v1/api/admin/feedback/${productId}`,
  },
  {
    name: 'update_feedback_status',
    arguments: { feedbackId: productId, status: 'resolved' },
    path: `/v1/api/admin/feedback/${productId}`,
    method: 'PATCH',
    confirmation: 'risk',
  },
  {
    name: 'reply_to_feedback',
    arguments: { feedbackId: productId, body: 'Thanks for the report.' },
    path: `/v1/api/admin/feedback/${productId}/replies`,
    method: 'POST',
    confirmation: 'risk',
  },
  {
    name: 'set_feedback_visibility',
    arguments: { feedbackId: productId, visibility: 'public' },
    path: `/v1/api/admin/feedback/${productId}`,
    method: 'PATCH',
    confirmation: 'risk',
  },
  {
    name: 'set_feedback_pinned',
    arguments: { feedbackId: productId, pinned: true },
    path: `/v1/api/admin/feedback/${productId}`,
    method: 'PATCH',
  },
  {
    name: 'add_internal_note',
    arguments: { feedbackId: productId, body: 'Internal note.' },
    path: `/v1/api/admin/feedback/${productId}/notes`,
    method: 'POST',
  },
  {
    name: 'link_feedback_item',
    arguments: { feedbackId: productId, itemId: secondId },
    path: `/v1/api/admin/feedback/${productId}/links`,
    method: 'POST',
  },
  {
    name: 'unlink_feedback_item',
    arguments: { feedbackId: productId, itemId: secondId },
    path: `/v1/api/admin/feedback/${productId}/links/${secondId}`,
    method: 'DELETE',
  },
  {
    name: 'get_attachment_url',
    arguments: { attachmentId: productId },
    path: `/v1/api/admin/feedback/attachments/${productId}/url`,
  },
  {
    name: 'get_diagnostic_bundle_url',
    arguments: { diagnosticArtifactId: productId },
    path: `/v1/api/admin/feedback/diagnostics/${productId}/url`,
  },
  {
    name: 'list_developer_posts',
    arguments: { productId, status: 'draft' },
    path: `/v1/api/admin/developer-posts?productId=${productId}&status=draft`,
  },
  {
    name: 'get_developer_post',
    arguments: { postId: productId },
    path: `/v1/api/admin/developer-posts/${productId}`,
  },
  {
    name: 'create_developer_post',
    arguments: { productId, canonicalTitle: 'News' },
    path: '/v1/api/admin/developer-posts',
    method: 'POST',
  },
  {
    name: 'update_developer_post',
    arguments: { postId: productId, canonicalBody: 'Updated' },
    path: `/v1/api/admin/developer-posts/${productId}`,
    method: 'PATCH',
  },
  {
    name: 'set_developer_post_translation',
    arguments: { postId: productId, locale: 'zh-Hans', title: '动态' },
    path: `/v1/api/admin/developer-posts/${productId}/translations/zh-Hans`,
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'set_developer_post_publication',
    arguments: { postId: productId, status: 'published' },
    path: `/v1/api/admin/developer-posts/${productId}/publication`,
    method: 'PATCH',
    confirmation: 'risk',
  },
  {
    name: 'delete_developer_post_translation',
    arguments: { postId: productId, locale: 'zh-Hans' },
    path: `/v1/api/admin/developer-posts/${productId}/translations/zh-Hans`,
    method: 'DELETE',
    confirmation: 'always',
  },
  {
    name: 'delete_developer_post',
    arguments: { postId: productId },
    path: `/v1/api/admin/developer-posts/${productId}`,
    method: 'DELETE',
    confirmation: 'always',
  },
  { name: 'list_items', arguments: {}, path: '/v1/api/admin/items' },
  { name: 'get_item', arguments: { itemId: productId }, path: `/v1/api/admin/items/${productId}` },
  {
    name: 'create_item',
    arguments: { type: 'feature', canonicalTitle: 'Agent Item', products: [productAssociation] },
    path: '/v1/api/admin/items',
    method: 'POST',
  },
  {
    name: 'update_item',
    arguments: { itemId: productId, canonicalTitle: 'Updated Item' },
    path: `/v1/api/admin/items/${productId}`,
    method: 'PATCH',
    confirmation: 'risk',
  },
  {
    name: 'set_item_translation',
    arguments: { itemId: productId, locale: 'zh-Hans', title: '功能' },
    path: `/v1/api/admin/items/${productId}/translations/zh-Hans`,
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'delete_item_translation',
    arguments: { itemId: productId, locale: 'zh-Hans' },
    path: `/v1/api/admin/items/${productId}/translations/zh-Hans`,
    method: 'DELETE',
    confirmation: 'always',
  },
  {
    name: 'delete_item',
    arguments: { itemId: productId },
    path: `/v1/api/admin/items/${productId}`,
    method: 'DELETE',
    confirmation: 'always',
  },
  {
    name: 'list_releases',
    arguments: { productId },
    path: `/v1/api/admin/releases?productId=${productId}`,
  },
  {
    name: 'get_release',
    arguments: { releaseId: productId },
    path: `/v1/api/admin/releases/${productId}`,
  },
  {
    name: 'preview_latest_app_store_release',
    arguments: { productId },
    path: `/v1/api/admin/releases/imports/app-store/latest?productId=${productId}`,
  },
  {
    name: 'import_latest_app_store_release',
    arguments: { productId },
    path: '/v1/api/admin/releases/imports/app-store/latest',
    method: 'POST',
  },
  {
    name: 'create_release',
    arguments: { productId, version: '1.0.0' },
    path: '/v1/api/admin/releases',
    method: 'POST',
  },
  {
    name: 'update_release',
    arguments: { releaseId: productId, version: '1.0.1' },
    path: `/v1/api/admin/releases/${productId}`,
    method: 'PATCH',
    confirmation: 'always',
  },
  {
    name: 'set_release_translation',
    arguments: { releaseId: productId, locale: 'zh-Hans', body: '更新内容' },
    path: `/v1/api/admin/releases/${productId}/translations/zh-Hans`,
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'delete_release_translation',
    arguments: { releaseId: productId, locale: 'zh-Hans' },
    path: `/v1/api/admin/releases/${productId}/translations/zh-Hans`,
    method: 'DELETE',
    confirmation: 'always',
  },
  {
    name: 'delete_release',
    arguments: { releaseId: productId },
    path: `/v1/api/admin/releases/${productId}`,
    method: 'DELETE',
    confirmation: 'always',
  },
  { name: 'get_global_bark_config', arguments: {}, path: '/v1/api/admin/bark/global' },
  {
    name: 'update_global_bark_config',
    arguments: { enabled: false },
    path: '/v1/api/admin/bark/global',
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'get_product_bark_config',
    arguments: { productId },
    path: `/v1/api/admin/bark/products/${productId}`,
  },
  {
    name: 'update_product_bark_config',
    arguments: { productId, mode: 'disabled' },
    path: `/v1/api/admin/bark/products/${productId}`,
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'test_bark_channel',
    arguments: { target: 'global' },
    path: '/v1/api/admin/bark/global/test',
    method: 'POST',
    confirmation: 'always',
  },
  {
    name: 'list_bark_deliveries',
    arguments: { limit: 25 },
    path: '/v1/api/admin/bark/deliveries?limit=25',
  },
  {
    name: 'retry_bark_delivery',
    arguments: { outboxId: productId },
    path: `/v1/api/admin/bark/deliveries/${productId}/retry`,
    method: 'POST',
    confirmation: 'always',
  },
  {
    name: 'get_product_webhook_config',
    arguments: { productId },
    path: `/v1/api/admin/webhooks/products/${productId}`,
  },
  {
    name: 'update_product_webhook_config',
    arguments: { productId, enabled: false },
    path: `/v1/api/admin/webhooks/products/${productId}`,
    method: 'PUT',
    confirmation: 'always',
  },
  {
    name: 'test_product_webhook',
    arguments: { productId },
    path: `/v1/api/admin/webhooks/products/${productId}/test`,
    method: 'POST',
    confirmation: 'always',
  },
  {
    name: 'list_webhook_deliveries',
    arguments: { productId, status: 'failed', limit: 25 },
    path: `/v1/api/admin/webhooks/deliveries?productId=${productId}&status=failed&limit=25`,
  },
  {
    name: 'retry_webhook_delivery',
    arguments: { outboxId: productId },
    path: `/v1/api/admin/webhooks/deliveries/${productId}/retry`,
    method: 'POST',
    confirmation: 'always',
  },
  { name: 'list_audit', arguments: { limit: 25 }, path: '/v1/api/admin/audit?limit=25' },
];

function resultData(result: { structuredContent?: unknown }) {
  return (result.structuredContent as { data: Record<string, unknown> }).data;
}

function missingParameterDescriptions(schema: unknown, path = 'input'): string[] {
  if (schema === null || typeof schema !== 'object') return [];
  const value = schema as Record<string, unknown>;
  const missing: string[] = [];
  if (value.properties && typeof value.properties === 'object') {
    for (const [name, property] of Object.entries(value.properties as Record<string, unknown>)) {
      const propertyPath = `${path}.${name}`;
      if (
        property === null
        || typeof property !== 'object'
        || typeof (property as Record<string, unknown>).description !== 'string'
      ) missing.push(propertyPath);
      missing.push(...missingParameterDescriptions(property, propertyPath));
    }
  }
  for (const keyword of ['items', 'anyOf', 'oneOf', 'allOf'] as const) {
    const nested = value[keyword];
    if (Array.isArray(nested)) {
      nested.forEach((entry, index) => {
        missing.push(...missingParameterDescriptions(entry, `${path}.${keyword}[${index}]`));
      });
    } else if (nested) {
      missing.push(...missingParameterDescriptions(nested, `${path}.${keyword}`));
    }
  }
  return missing;
}

describe('MCP server 0.10.2', () => {
  const originalFetch = globalThis.fetch;
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let updateNotice: PluginUpdateNotice | undefined;
  let updateNoticeDelivered: boolean;
  let setupNotice: FeedbackServerSetupNotice | undefined;
  let setupNoticeDelivered: boolean;

  beforeEach(async () => {
    process.env.FEEDBACK_SERVER_BASE_URL = 'https://feedback.example.com/v1/api';
    process.env.FEEDBACK_SERVER_API_TOKEN = token;
    updateNotice = undefined;
    updateNoticeDelivered = false;
    setupNotice = undefined;
    setupNoticeDelivered = false;
    server = createServer({
      updateNoticeProvider: {
        takeNotice: () => {
          if (updateNoticeDelivered) return Promise.resolve(undefined);
          updateNoticeDelivered = true;
          return Promise.resolve(updateNotice);
        },
      },
      setupNoticeProvider: {
        takeNotice: () => {
          if (setupNoticeDelivered) return Promise.resolve(undefined);
          setupNoticeDelivered = true;
          return Promise.resolve(setupNotice);
        },
      },
    });
    client = new Client({ name: 'feedback-server-tests', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.FEEDBACK_SERVER_BASE_URL;
    delete process.env.FEEDBACK_SERVER_API_TOKEN;
    await client.close();
    await server.close();
  });

  test('exposes the new surface and removes legacy Feedback and Item fields', async () => {
    const tools = (await client.listTools()).tools;
    const names = tools.map(({ name }) => name);
    expect(names).toHaveLength(72);
    expect(names).toContain('prepare_local_setup');
    expect(names).toContain('execute_confirmation');
    expect(names).toContain('get_subscription');
    expect(names).toContain('get_onboarding_status');
    expect(names).toContain('set_primary_product');
    expect(names).toContain('set_feedback_visibility');
    expect(names).toContain('set_feedback_pinned');
    expect(names).toContain('create_developer_post');
    expect(names).toContain('set_developer_post_publication');
    expect(names).toContain('get_product_webhook_config');
    expect(names).toContain('retry_webhook_delivery');
    expect(names).toContain('list_waitlist_entries');
    expect(names).toContain('delete_waitlist_entry');
    expect(names).toContain('invite_waitlist_entry');
    expect(names).toContain('retry_waitlist_invitation_email');
    expect(names).toContain('revoke_waitlist_invitation');
    const serialized = JSON.stringify(tools);
    expect(serialized).toContain('conversation');
    expect(serialized).toContain('roadmapStage');
    expect(serialized).not.toContain('wantsReply');
    expect(serialized).not.toContain('votingEnabled');
    expect(serialized).not.toContain('productIds');
    expect(names).not.toContain('create_admin');
    const releaseTranslationTool = tools.find(({ name }) => name === 'set_release_translation');
    expect(JSON.stringify(releaseTranslationTool?.inputSchema)).not.toContain('title');
    const createProduct = tools.find(({ name }) => name === 'create_product');
    expect(JSON.stringify(createProduct?.inputSchema)).toContain('Stable lowercase Product slug');
    expect(tools.find(({ name }) => name === 'list_products')?.annotations?.openWorldHint).toBe(false);
    expect(createProduct?.annotations?.openWorldHint).toBe(false);
    expect(tools.find(({ name }) => name === 'test_bark_channel')?.annotations?.openWorldHint).toBe(true);
    expect(tools.find(({ name }) => name === 'delete_waitlist_entry')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(tools.find(({ name }) => name === 'remove_product_app_store_binding')?.annotations)
      .toMatchObject({ destructiveHint: false, idempotentHint: true });
    expect(tools.find(({ name }) => name === 'add_waitlist_note')?.annotations)
      .toMatchObject({ destructiveHint: false, idempotentHint: false, openWorldHint: false });
    const missingDescriptions = tools.flatMap((tool) =>
      missingParameterDescriptions(tool.inputSchema, tool.name));
    expect(missingDescriptions).toEqual([]);
  });

  test('prepares local setup without loading Agent credentials', async () => {
    delete process.env.FEEDBACK_SERVER_BASE_URL;
    delete process.env.FEEDBACK_SERVER_API_TOKEN;
    const result = await client.callTool({
      name: 'prepare_local_setup',
      arguments: { flow: 'configure_account' },
    });
    if (process.platform === 'darwin') {
      expect(result.isError).not.toBe(true);
      expect(resultData(result)).toMatchObject({
        status: 'ready',
        flow: 'configure_account',
        requiresVisibleTerminal: true,
        executesCommand: false,
      });
    } else {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('FEEDBACK_SERVER_BASE_URL');
      expect(JSON.stringify(result)).toContain('FEEDBACK_SERVER_API_TOKEN');
    }
  });

  test('reports environment credentials without an active Keychain profile', async () => {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const data = url.pathname.endsWith('/admin/products') ? [] : { status: 'ok' };
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;
    const result = await client.callTool({ name: 'connection_status', arguments: {} });
    expect(resultData(result)).toMatchObject({
      credentialSource: 'environment',
      activeProfile: null,
      endpoint: 'https://feedback.example.com/v1/api',
      authenticated: true,
    });
  });

  test('reports Product protected effects in deterministic order for combined changes', () => {
    const status = 'Product clients may stop working';
    const visibility = 'New user feedback will be published by default';
    const diagnostics = 'Product clients may offer visitors a private diagnostic-log upload option';
    expect(productUpdateProtectedEffects({
      statusChanges: true,
      visibilityChanges: true,
      diagnosticsChanges: false,
    })).toEqual([status, visibility]);
    expect(productUpdateProtectedEffects({
      statusChanges: true,
      visibilityChanges: false,
      diagnosticsChanges: true,
    })).toEqual([status, diagnostics]);
    expect(productUpdateProtectedEffects({
      statusChanges: false,
      visibilityChanges: true,
      diagnosticsChanges: true,
    })).toEqual([visibility, diagnostics]);
    expect(productUpdateProtectedEffects({
      statusChanges: true,
      visibilityChanges: true,
      diagnosticsChanges: true,
    })).toEqual([status, visibility, diagnostics]);
  });

  test('adds an available update to the first successful tool result only', async () => {
    updateNotice = {
      kind: 'plugin_update_available',
      component: 'feedback-server-plugin',
      currentVersion: '0.6.7',
      latestVersion: '0.6.8',
      releaseUrl: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.8',
      command: 'codex plugin marketplace upgrade feedback-server',
      commands: {
        codex: ['codex plugin marketplace upgrade feedback-server'],
        claudeCode: [
          'claude plugin marketplace update feedback-server',
          'claude plugin update feedback-server@feedback-server',
        ],
      },
      reloadRequired: true,
    };
    globalThis.fetch = (() => Promise.resolve(Response.json({
      code: 'ok',
      message: 'success',
      data: { status: 'ok' },
    }))) as unknown as typeof fetch;

    const first = await client.callTool({ name: 'health', arguments: {} });
    const second = await client.callTool({ name: 'health', arguments: {} });
    expect(first.structuredContent).toMatchObject({ updateNotice });
    expect(JSON.parse(first.content[0]?.type === 'text' ? first.content[0].text : '{}'))
      .toMatchObject({ updateNotice });
    expect(second.structuredContent).not.toHaveProperty('updateNotice');
  });

  test('returns setup and update notices together without changing tool data', async () => {
    updateNotice = {
      kind: 'plugin_update_available',
      component: 'feedback-server-plugin',
      currentVersion: '0.6.10',
      latestVersion: '0.6.11',
      releaseUrl: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.11',
      command: 'codex plugin marketplace upgrade feedback-server',
      commands: {
        codex: ['codex plugin marketplace upgrade feedback-server'],
        claudeCode: [
          'claude plugin marketplace update feedback-server',
          'claude plugin update feedback-server@feedback-server',
        ],
      },
      reloadRequired: true,
    };
    setupNotice = {
      kind: 'feedback_server_setup',
      message: 'Account connection is complete, but app setup still has a next step.',
      prompt: '帮我完成 FeedbackServer 初始配置',
      nextAction: {
        id: 'configure_notification',
        stage: 'notifications',
        status: 'recommended',
        priority: 30,
        message: 'Choose Bark, Product Webhook, or explicitly defer notification setup.',
      },
    };
    globalThis.fetch = (() => Promise.resolve(Response.json({
      code: 'ok',
      message: 'success',
      data: { status: 'ok' },
    }))) as unknown as typeof fetch;

    const result = await client.callTool({ name: 'health', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      data: { status: 'ok' },
      updateNotice,
      setupNotice,
    });
  });

  test('derives onboarding status through its documented read routes', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname.replace('/v1/api', '');
      const data = path === '/admin/products'
        ? [{
            id: productId,
            slug: 'agent-app',
            name: 'Agent App',
            defaultLocale: 'en',
            status: 'active',
            diagnosticsEnabled: false,
            publishableKey: 'pk_must_not_be_returned',
          }]
        : path === '/admin/subscription'
          ? {
              declaredPlan: 'studio',
              effectivePlan: 'studio',
              lifecycle: 'perpetual',
              term: 'perpetual',
              expiresAt: null,
              graceEndsAt: null,
              primaryProductId: productId,
              revision: 1,
              limits: { maxProducts: 10, storageBytes: 25 * 1024 * 1024 * 1024 },
              features: { diagnostics: true, webhooks: true, appStoreImport: true, bark: true },
              usage: {
                products: 1,
                storage: { finalizedBytes: 0, reservedBytes: 0, totalBytes: 0 },
              },
              products: [{ id: productId, name: 'Agent App', access: 'read_write' }],
            }
          : path === '/admin/bark/global'
            ? { enabled: false, serverUrl: 'https://api.day.app', deviceKey: null }
            : path === `/admin/bark/products/${productId}`
              ? { productId, mode: 'inherit', serverUrl: null, deviceKey: null }
              : path === `/admin/webhooks/products/${productId}`
                ? { productId, enabled: false, endpointUrl: null, secret: null }
                : {};
      if (path === `/admin/products/${productId}/app-store`) {
        return Promise.resolve(Response.json({
          code: 'app_store_binding_not_found',
          message: 'not found',
          data: null,
        }, { status: 404 }));
      }
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const result = await client.callTool({ name: 'get_onboarding_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(resultData(result)).toMatchObject({
      connection: { status: 'complete', endpoint: 'https://feedback.example.com/v1/api' },
      product: { status: 'complete', selected: { id: productId, access: 'read_write' } },
      notifications: { status: 'recommended', effective: false },
      coreReady: true,
    });
    expect(requests.map((request) => new URL(request.url).pathname).sort()).toEqual([
      '/v1/api/admin/bark/global',
      `/v1/api/admin/bark/products/${productId}`,
      `/v1/api/admin/products/${productId}/app-store`,
      '/v1/api/admin/products',
      '/v1/api/admin/subscription',
      `/v1/api/admin/webhooks/products/${productId}`,
    ].sort());
    expect(JSON.stringify(result)).not.toContain('pk_must_not_be_returned');
  });

  test('routes every tool scenario through its documented API contract', async () => {
    const requests: Request[] = [];
    let activeScenario = '';
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      let data: unknown = {};
      if (url.pathname.endsWith('/invite-context')) {
        data = {
          entry: {
            id: productId,
            appName: 'Example App',
            platform: 'ios_ipados',
            email: 'owner@example.com',
            locale: 'en',
            status: 'new',
          },
          precondition: mutationPrecondition,
          invitation: {
            id: secondId,
            status: 'failed',
            subscriptionGrant: { plan: 'free' },
            expiresAt: '2026-09-01T00:00:00.000Z',
          },
        };
      } else if (url.pathname.endsWith('/update-context')) {
        if (url.pathname.includes('/subscription/primary-product/')) {
          data = {
            currentPrimaryProductId: productId,
            targetProductId: secondId,
            affectedProducts: [{
              id: secondId,
              name: 'Second App',
              currentAccess: 'read_only',
              proposedAccess: 'read_write',
            }],
            precondition: mutationPrecondition,
          };
        } else if (url.pathname.includes('/waitlist/')) {
          data = {
            entry: { id: productId, status: 'new' },
            precondition: mutationPrecondition,
          };
        } else if (url.pathname.includes('/developer-posts/')) {
          data = {
            post: { id: productId, productId, title: 'News', status: 'draft' },
            product: { id: productId, name: 'Agent App' },
            precondition: mutationPrecondition,
          };
        } else if (url.pathname.includes('/items/')) {
          data = {
            item: { id: productId, canonicalTitle: 'Agent Item', type: 'feature' },
            products: [{
              productId,
              visibility: 'public',
              roadmapStage: 'urgent',
              rank: 0,
              archivedAt: null,
            }],
            precondition: mutationPrecondition,
          };
        } else {
          data = {
            feedback: {
              status: 'open',
              visibility: activeScenario === 'reply_to_feedback' ? 'public' : 'private',
              publishedAt: null,
              pinned: false,
              displayTitle: 'Feedback',
            },
            product: { id: productId, name: 'Agent App' },
            precondition: mutationPrecondition,
          };
        }
      } else if (
        url.pathname.includes(`/admin/waitlist/${productId}`)
        && request.method === 'GET'
      ) {
        data = {
          entry: {
            id: productId,
            appName: 'Example App',
            platform: 'ios_ipados',
            email: 'owner@example.com',
            createdAt: '2026-08-24T00:00:00.000Z',
          },
          notes: [{ id: secondId }],
        };
      }
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    for (const scenario of toolScenarios) {
      activeScenario = scenario.name;
      requests.length = 0;
      let result = await client.callTool({ name: scenario.name, arguments: scenario.arguments });
      if (scenario.confirmation) {
        if (
          scenario.name === 'invite_waitlist_entry'
          || scenario.name === 'retry_waitlist_invitation_email'
        ) {
          expect(resultData(result)).toMatchObject({
            status: 'confirmation_required',
            preview: {
              recipient: 'owner@example.com',
              locale: 'en',
              subscriptionGrant: { plan: 'free' },
            },
          });
          expect(resultData(result).preview).toHaveProperty('emailSummary');
          expect(requests.every(({ method }) => method === 'GET')).toBe(true);
        }
        const confirmationId = resultData(result).confirmationId as string;
        expect(confirmationId, scenario.name).toBeString();
        result = await client.callTool({
          name: scenario.name,
          arguments: { ...scenario.arguments, confirmationId },
        });
      }
      expect(result.isError, scenario.name).not.toBe(true);
      const request = requests.at(-1);
      expect(request, scenario.name).toBeDefined();
      const url = new URL(request!.url);
      expect(`${url.pathname}${url.search}`, scenario.name).toBe(scenario.path);
      expect(request!.method, scenario.name).toBe(scenario.method ?? 'GET');
      expect(request!.headers.get('authorization'), scenario.name).toBe(
        scenario.name === 'health' ? null : `Bearer ${token}`,
      );
      if (scenario.name === 'set_release_translation') {
        expect(await request!.clone().json()).toEqual({ body: '更新内容' });
      }
      if (scenario.name === 'update_product_webhook_config') {
        expect(await request!.clone().json()).toEqual({ enabled: false });
      }
      if (scenario.name === 'set_primary_product') {
        expect(request!.headers.get('if-match')).toBe(mutationPrecondition);
        expect(await request!.clone().json()).toEqual({ productId: secondId });
      }
      if (scenario.name === 'update_waitlist_status') {
        expect(request!.headers.get('if-match')).toBe(mutationPrecondition);
        expect(await request!.clone().json()).toEqual({ status: 'contacted' });
      }
      if (scenario.name === 'add_waitlist_note') {
        expect(await request!.clone().json()).toEqual({ body: 'Followed up.' });
      }
      if (scenario.name === 'invite_waitlist_entry') {
        expect(request!.headers.get('if-match')).toBe(mutationPrecondition);
        expect(await request!.clone().json()).toEqual({
          expiresInDays: 7,
          subscriptionGrant: { plan: 'free' },
        });
      }
    }
  });

  test('updates waitlist status with a fresh precondition and skips same-state writes', async () => {
    const requests: Request[] = [];
    let currentStatus: 'new' | 'contacted' = 'new';
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.method === 'GET'
        ? { entry: { id: productId, status: currentStatus }, precondition: mutationPrecondition }
        : { id: productId, status: 'contacted' };
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const changed = await client.callTool({
      name: 'update_waitlist_status',
      arguments: { entryId: productId, status: 'contacted' },
    });
    expect(changed.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);

    requests.length = 0;
    currentStatus = 'contacted';
    const unchanged = await client.callTool({
      name: 'update_waitlist_status',
      arguments: { entryId: productId, status: 'contacted' },
    });
    expect(resultData(unchanged)).toEqual({
      status: 'no_change',
      entryId: productId,
      currentStatus: 'contacted',
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);
  });

  test('requires an explicit single-use confirmation before permanent waitlist deletion', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.method === 'GET'
        ? {
            entry: {
              id: productId,
              appName: 'Example App',
              platform: 'web',
              email: 'hello@example.com',
              createdAt: '2026-08-24T00:00:00.000Z',
            },
            notes: [{ id: secondId }],
          }
        : null;
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const preview = await client.callTool({
      name: 'delete_waitlist_entry',
      arguments: { entryId: productId },
    });
    expect(resultData(preview)).toMatchObject({
      status: 'confirmation_required',
      executeTool: 'execute_confirmation',
      preview: {
        entryId: productId,
        appName: 'Example App',
        platform: 'web',
        noteCount: 1,
      },
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    const executed = await client.callTool({
      name: 'delete_waitlist_entry',
      arguments: {
        entryId: productId,
        confirmationId: resultData(preview).confirmationId,
      },
    });
    expect(executed.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'DELETE']);

    const replay = await client.callTool({
      name: 'delete_waitlist_entry',
      arguments: {
        entryId: productId,
        confirmationId: resultData(preview).confirmationId,
      },
    });
    expect(replay.isError).toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'DELETE']);
  });

  test('executes a prepared deletion through the generic confirmation tool', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.method === 'GET'
        ? {
            entry: {
              id: productId,
              appName: 'Example App',
              platform: 'web',
              createdAt: '2026-08-24T00:00:00.000Z',
            },
            notes: [],
          }
        : null;
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const preview = await client.callTool({
      name: 'delete_waitlist_entry',
      arguments: { entryId: productId },
    });
    const confirmationId = resultData(preview).confirmationId as string;

    process.env.FEEDBACK_SERVER_API_TOKEN = `fspat_${'c'.repeat(64)}`;
    const wrongAccount = await client.callTool({
      name: 'execute_confirmation',
      arguments: { confirmationId },
    });
    process.env.FEEDBACK_SERVER_API_TOKEN = token;
    expect(wrongAccount.isError).toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    const executed = await client.callTool({
      name: 'execute_confirmation',
      arguments: { confirmationId },
    });
    expect(executed.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'DELETE']);

    const replay = await client.callTool({
      name: 'execute_confirmation',
      arguments: { confirmationId },
    });
    expect(replay.isError).toBe(true);
    expect(requests).toHaveLength(2);
  });

  test('binds primary Product confirmation to target, identity, and precondition', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.method === 'GET'
        ? {
            currentPrimaryProductId: productId,
            targetProductId: secondId,
            affectedProducts: [
              {
                id: productId,
                name: 'Primary App',
                currentAccess: 'read_write',
                proposedAccess: 'read_only',
              },
              {
                id: secondId,
                name: 'Second App',
                currentAccess: 'read_only',
                proposedAccess: 'read_write',
              },
            ],
            precondition: mutationPrecondition,
          }
        : { primaryProductId: secondId };
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const payload = { productId: secondId };
    const preview = await client.callTool({ name: 'set_primary_product', arguments: payload });
    expect(resultData(preview)).toMatchObject({
      status: 'confirmation_required',
      preview: {
        currentPrimaryProductId: productId,
        targetProductId: secondId,
        affectedProducts: [
          { id: productId, currentAccess: 'read_write', proposedAccess: 'read_only' },
          { id: secondId, currentAccess: 'read_only', proposedAccess: 'read_write' },
        ],
      },
    });
    const confirmationId = resultData(preview).confirmationId as string;

    process.env.FEEDBACK_SERVER_API_TOKEN = `fspat_${'c'.repeat(64)}`;
    const wrongIdentity = await client.callTool({
      name: 'set_primary_product',
      arguments: { ...payload, confirmationId },
    });
    process.env.FEEDBACK_SERVER_API_TOKEN = token;
    expect(wrongIdentity.isError).toBe(true);
    expect(requests).toHaveLength(1);

    const mismatched = await client.callTool({
      name: 'set_primary_product',
      arguments: { productId, confirmationId },
    });
    expect(mismatched.isError).toBe(true);
    expect(requests).toHaveLength(1);

    const executed = await client.callTool({
      name: 'set_primary_product',
      arguments: { ...payload, confirmationId },
    });
    expect(executed.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PUT']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);
  });

  test('preserves a stale primary Product precondition error', async () => {
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') {
        return Promise.resolve(Response.json({
          code: 'ok',
          message: 'success',
          data: {
            currentPrimaryProductId: productId,
            targetProductId: secondId,
            affectedProducts: [],
            precondition: mutationPrecondition,
          },
        }));
      }
      return Promise.resolve(Response.json({
        code: 'mutation_precondition_failed',
        message: 'The subscription changed after preview',
        data: { expected: mutationPrecondition },
      }, { status: 409 }));
    }) as typeof fetch;

    const payload = { productId: secondId };
    const preview = await client.callTool({ name: 'set_primary_product', arguments: payload });
    const result = await client.callTool({
      name: 'execute_confirmation',
      arguments: { confirmationId: resultData(preview).confirmationId },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('mutation_precondition_failed');
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test('uses current state for direct, confirmation, and no-op decisions', async () => {
    const requests: Request[] = [];
    let feedbackStatus = 'open';
    let feedbackVisibility = 'private';
    let feedbackPublishedAt: string | null = null;
    let feedbackPinned = false;
    let productStatus = 'active';
    let productDefault = 'private';
    let postStatus = 'draft';
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      let data: unknown = {};
      if (url.pathname.endsWith('/update-context')) {
        if (url.pathname.includes('/products/')) {
          data = {
            product: {
              name: 'Agent App',
              status: productStatus,
              defaultFeedbackVisibility: productDefault,
            },
            precondition: mutationPrecondition,
          };
        } else if (url.pathname.includes('/developer-posts/')) {
          data = {
            post: { id: productId, productId, title: 'News', status: postStatus },
            product: { id: productId, name: 'Agent App' },
            precondition: mutationPrecondition,
          };
        } else if (url.pathname.includes('/items/')) {
          data = {
            item: { id: productId, canonicalTitle: 'Public Item', type: 'feature' },
            products: [{
              productId,
              visibility: 'public',
              roadmapStage: 'urgent',
              rank: 0,
              archivedAt: null,
            }],
            precondition: mutationPrecondition,
          };
        } else {
          data = {
            feedback: {
              status: feedbackStatus,
              visibility: feedbackVisibility,
              publishedAt: feedbackPublishedAt,
              pinned: feedbackPinned,
              displayTitle: 'Feedback',
            },
            product: { id: productId, name: 'Agent App' },
            precondition: mutationPrecondition,
          };
        }
      }
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    const privateReply = await client.callTool({
      name: 'reply_to_feedback',
      arguments: { feedbackId: productId, body: 'Private reply' },
    });
    expect(privateReply.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'POST']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);

    requests.length = 0;
    feedbackVisibility = 'public';
    const publicReply = await client.callTool({
      name: 'reply_to_feedback',
      arguments: { feedbackId: productId, body: 'Public reply shown in full' },
    });
    expect(resultData(publicReply)).toMatchObject({
      status: 'confirmation_required',
      preview: { body: 'Public reply shown in full' },
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    feedbackStatus = 'resolved';
    const resolvedReply = await client.callTool({
      name: 'reply_to_feedback',
      arguments: { feedbackId: productId, body: 'Reply after resolution' },
    });
    expect(resultData(resolvedReply)).toMatchObject({
      status: 'feedback_not_open',
      currentStatus: 'resolved',
      requiredStatus: 'open',
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    feedbackStatus = 'open';
    const unchangedStatus = await client.callTool({
      name: 'update_feedback_status',
      arguments: { feedbackId: productId, status: 'open' },
    });
    expect(resultData(unchangedStatus)).toMatchObject({ status: 'no_change', currentStatus: 'open' });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const statusChange = await client.callTool({
      name: 'update_feedback_status',
      arguments: { feedbackId: productId, status: 'resolved' },
    });
    expect(resultData(statusChange).status).toBe('confirmation_required');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const unpublishFeedback = await client.callTool({
      name: 'set_feedback_visibility',
      arguments: { feedbackId: productId, visibility: 'private' },
    });
    expect(unpublishFeedback.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);

    requests.length = 0;
    feedbackVisibility = 'private';
    const publishFeedback = await client.callTool({
      name: 'set_feedback_visibility',
      arguments: { feedbackId: productId, visibility: 'public' },
    });
    expect(resultData(publishFeedback).status).toBe('confirmation_required');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    feedbackPublishedAt = '2026-08-01T00:00:00.000Z';
    const republishFeedback = await client.callTool({
      name: 'set_feedback_visibility',
      arguments: { feedbackId: productId, visibility: 'public' },
    });
    expect(republishFeedback.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);

    requests.length = 0;
    feedbackVisibility = 'public';
    const pinFeedback = await client.callTool({
      name: 'set_feedback_pinned',
      arguments: { feedbackId: productId, pinned: true },
    });
    expect(pinFeedback.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);

    requests.length = 0;
    feedbackPinned = true;
    const unchangedPin = await client.callTool({
      name: 'set_feedback_pinned',
      arguments: { feedbackId: productId, pinned: true },
    });
    expect(resultData(unchangedPin)).toMatchObject({ status: 'no_change', pinned: true });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const publicDefault = await client.callTool({
      name: 'update_product',
      arguments: { productId, defaultFeedbackVisibility: 'public' },
    });
    expect(resultData(publicDefault).status).toBe('confirmation_required');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    productDefault = 'public';
    const sameDefault = await client.callTool({
      name: 'update_product',
      arguments: { productId, defaultFeedbackVisibility: 'public' },
    });
    expect(resultData(sameDefault).status).toBe('no_change');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const publishPost = await client.callTool({
      name: 'set_developer_post_publication',
      arguments: { postId: productId, status: 'published' },
    });
    expect(resultData(publishPost).status).toBe('confirmation_required');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    postStatus = 'published';
    const publishedPostEdit = await client.callTool({
      name: 'update_developer_post',
      arguments: { postId: productId, canonicalBody: 'Visible update' },
    });
    expect(resultData(publishedPostEdit)).toMatchObject({
      status: 'confirmation_required',
      preview: { effect: 'Published activity content changes immediately' },
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const unpublishPost = await client.callTool({
      name: 'set_developer_post_publication',
      arguments: { postId: productId, status: 'draft' },
    });
    expect(unpublishPost.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);

    requests.length = 0;
    const publicItemEdit = await client.callTool({
      name: 'update_item',
      arguments: { itemId: productId, canonicalTitle: 'Visible roadmap update' },
    });
    expect(resultData(publicItemEdit)).toMatchObject({
      status: 'confirmation_required',
      preview: { effect: 'Public roadmap content or placement changes and linked visitors may be notified' },
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const publishedRelease = await client.callTool({
      name: 'create_release',
      arguments: { productId, version: '2.1.0', status: 'published' },
    });
    expect(resultData(publishedRelease)).toMatchObject({
      status: 'confirmation_required',
      preview: { effect: 'The Release becomes visible in the public changelog' },
    });
    expect(requests).toHaveLength(0);

    requests.length = 0;
    productStatus = 'inactive';
    const unchangedProduct = await client.callTool({
      name: 'update_product',
      arguments: { productId, status: 'inactive' },
    });
    expect(resultData(unchangedProduct).status).toBe('no_change');
    expect(requests.map(({ method }) => method)).toEqual(['GET']);

    requests.length = 0;
    const reactivateWithSamePublicDefault = await client.callTool({
      name: 'update_product',
      arguments: {
        productId,
        status: 'active',
        defaultFeedbackVisibility: 'public',
      },
    });
    expect(reactivateWithSamePublicDefault.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
  });

  test('binds a protected confirmation to the assessed precondition and rejects replay', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === 'GET') {
        return Promise.resolve(
          Response.json({
            code: 'ok',
            message: 'success',
            data: {
              feedback: { status: 'open', visibility: 'private', displayTitle: 'Feedback' },
              product: { id: productId, name: 'Agent App' },
              precondition: mutationPrecondition,
            },
          }),
        );
      }
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data: {} }));
    }) as typeof fetch;

    const payload = { feedbackId: productId, status: 'resolved' };
    const preview = await client.callTool({ name: 'update_feedback_status', arguments: payload });
    const confirmationId = resultData(preview).confirmationId as string;
    const executed = await client.callTool({
      name: 'update_feedback_status',
      arguments: { ...payload, confirmationId },
    });
    expect(executed.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
    expect(requests[1]?.headers.get('if-match')).toBe(mutationPrecondition);

    const replay = await client.callTool({
      name: 'update_feedback_status',
      arguments: { ...payload, confirmationId },
    });
    expect(replay.isError).toBe(true);
    expect(requests).toHaveLength(2);
  });

  test('accepts offset release timestamps and normalizes them to UTC', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data: {} }));
    }) as typeof fetch;

    const create = await client.callTool({
      name: 'create_release',
      arguments: {
        productId,
        version: '2.0.3',
        releasedAt: '2026-08-03T16:30:00+08:00',
      },
    });
    const updateArguments = {
      releaseId: productId,
      releasedAt: '2026-08-03T01:30:00-07:00',
    };
    const updatePreview = await client.callTool({
      name: 'update_release',
      arguments: updateArguments,
    });
    const update = await client.callTool({
      name: 'update_release',
      arguments: {
        ...updateArguments,
        confirmationId: resultData(updatePreview).confirmationId,
      },
    });

    expect(create.isError).not.toBe(true);
    expect(update.isError).not.toBe(true);
    expect(requests).toHaveLength(2);
    expect(await requests[0]!.json()).toMatchObject({
      version: '2.0.3',
      releasedAt: '2026-08-03T08:30:00.000Z',
    });
    expect(await requests[1]!.json()).toMatchObject({
      releasedAt: '2026-08-03T08:30:00.000Z',
    });
  });

  test('previews Bark configuration safely before applying it', async () => {
    const requests: Request[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data: null }));
    }) as typeof fetch;
    const deviceKey = 'private-bark-device-key';

    const preview = await client.callTool({
      name: 'update_global_bark_config',
      arguments: { enabled: true, deviceKey },
    });
    expect(requests).toHaveLength(0);
    expect(resultData(preview)).toMatchObject({
      status: 'confirmation_required',
      executeTool: 'execute_confirmation',
      preview: { enabled: true, deviceKey: '[REDACTED]' },
    });
    expect(JSON.stringify(preview)).not.toContain(deviceKey);

    const executed = await client.callTool({
      name: 'execute_confirmation',
      arguments: { confirmationId: resultData(preview).confirmationId },
    });
    expect(executed.isError).not.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('PUT');
    expect(await requests[0]!.json()).toEqual({ enabled: true, deviceKey });
  });

  test('returns environment-specific remediation for invalid environment credentials', async () => {
    globalThis.fetch = (() => Promise.resolve(Response.json({
      code: 'invalid_token',
      message: 'The API token is invalid',
      data: null,
    }, { status: 401 }))) as unknown as typeof fetch;

    const result = await client.callTool({ name: 'list_products', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        status: 401,
        remediation: expect.stringContaining('FEEDBACK_SERVER_API_TOKEN'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('Reconnect the active FeedbackServer profile');
  });

  test('preserves API error codes without leaking credentials', async () => {
    updateNotice = {
      kind: 'plugin_update_available',
      component: 'feedback-server-plugin',
      currentVersion: '0.6.10',
      latestVersion: '0.6.11',
      releaseUrl: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.11',
      command: 'codex plugin marketplace upgrade feedback-server',
      commands: {
        codex: ['codex plugin marketplace upgrade feedback-server'],
        claudeCode: [
          'claude plugin marketplace update feedback-server',
          'claude plugin update feedback-server@feedback-server',
        ],
      },
      reloadRequired: true,
    };
    setupNotice = {
      kind: 'feedback_server_setup',
      message: 'Account connection is complete, but app setup still has a next step.',
      prompt: '帮我完成 FeedbackServer 初始配置',
      nextAction: {
        id: 'create_product',
        stage: 'product',
        status: 'action_required',
        priority: 10,
        message: 'Create the first Product.',
      },
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json(
          {
            code: 'admin_scope_required',
            message: 'Administrator API token requires scope feedback:write',
            data: null,
          },
          {
            status: 403,
            headers: { 'X-Request-ID': 'request-test-123', 'Retry-After': '17' },
          },
        ),
      )) as unknown as typeof fetch;
    const result = await client.callTool({
      name: 'add_internal_note',
      arguments: { feedbackId: productId, body: 'Internal only' },
    });
    expect(result.isError).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('admin_scope_required');
    expect(result.structuredContent).toMatchObject({
      error: {
        status: 403,
        code: 'admin_scope_required',
        requestId: 'request-test-123',
        retryAfterSeconds: 17,
        remediation: expect.any(String),
        data: null,
      },
    });
    expect(serialized).not.toContain(token);
    expect(result.structuredContent).not.toHaveProperty('updateNotice');
    expect(result.structuredContent).not.toHaveProperty('setupNotice');
  });
});
