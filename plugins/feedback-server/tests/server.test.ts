import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/create-server.js';

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
  { name: 'connection_status', arguments: {}, path: '/v1/api/admin/products' },
  { name: 'list_products', arguments: {}, path: '/v1/api/admin/products' },
  { name: 'get_product', arguments: { productId }, path: `/v1/api/admin/products/${productId}` },
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
  },
  {
    name: 'set_item_translation',
    arguments: { itemId: productId, locale: 'zh-Hans', title: '功能' },
    path: `/v1/api/admin/items/${productId}/translations/zh-Hans`,
    method: 'PUT',
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
  },
  {
    name: 'set_release_translation',
    arguments: { releaseId: productId, locale: 'zh-Hans', title: '版本' },
    path: `/v1/api/admin/releases/${productId}/translations/zh-Hans`,
    method: 'PUT',
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
  { name: 'list_audit', arguments: { limit: 25 }, path: '/v1/api/admin/audit?limit=25' },
];

function resultData(result: { structuredContent?: unknown }) {
  return (result.structuredContent as { data: Record<string, unknown> }).data;
}

describe('MCP server 0.5.1', () => {
  const originalFetch = globalThis.fetch;
  let client: Client;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    process.env.FEEDBACK_SERVER_BASE_URL = 'https://feedback.example.com/v1/api';
    process.env.FEEDBACK_SERVER_API_TOKEN = token;
    server = createServer();
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
    expect(names).toHaveLength(54);
    expect(names).toContain('set_feedback_visibility');
    expect(names).toContain('set_feedback_pinned');
    expect(names).toContain('create_developer_post');
    expect(names).toContain('set_developer_post_publication');
    const serialized = JSON.stringify(tools);
    expect(serialized).toContain('conversation');
    expect(serialized).toContain('roadmapStage');
    expect(serialized).not.toContain('wantsReply');
    expect(serialized).not.toContain('votingEnabled');
    expect(serialized).not.toContain('productIds');
    expect(names).not.toContain('create_admin');
  });

  test('routes all 54 tools through their documented API contracts', async () => {
    const requests: Request[] = [];
    let activeScenario = '';
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      let data: unknown = {};
      if (url.pathname.endsWith('/update-context')) {
        if (url.pathname.includes('/developer-posts/')) {
          data = {
            post: { id: productId, productId, title: 'News', status: 'draft' },
            product: { id: productId, name: 'Agent App' },
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
      }
      return Promise.resolve(Response.json({ code: 'ok', message: 'success', data }));
    }) as typeof fetch;

    for (const scenario of toolScenarios) {
      activeScenario = scenario.name;
      requests.length = 0;
      let result = await client.callTool({ name: scenario.name, arguments: scenario.arguments });
      if (scenario.confirmation) {
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
    }
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
    const unpublishPost = await client.callTool({
      name: 'set_developer_post_publication',
      arguments: { postId: productId, status: 'draft' },
    });
    expect(unpublishPost.isError).not.toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'PATCH']);

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
    const update = await client.callTool({
      name: 'update_release',
      arguments: {
        releaseId: productId,
        releasedAt: '2026-08-03T01:30:00-07:00',
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

  test('preserves API error codes without leaking credentials', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json(
          {
            code: 'admin_scope_required',
            message: 'Administrator API token requires scope feedback:write',
            data: null,
          },
          { status: 403 },
        ),
      )) as unknown as typeof fetch;
    const result = await client.callTool({
      name: 'add_internal_note',
      arguments: { feedbackId: productId, body: 'Internal only' },
    });
    expect(result.isError).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('admin_scope_required');
    expect(serialized).not.toContain(token);
  });
});
