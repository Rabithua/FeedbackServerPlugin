import { createHash } from 'node:crypto';
import {
  type CallToolResult,
  type JSONObject,
  McpServer,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { FeedbackServerApiClient, FeedbackServerApiError } from './api-client.js';
import { ConfirmationStore, redactPreview } from './confirmation.js';
import { loadCredentials, type StoredCredentials } from './credentials.js';
import {
  createSetupNoticeProvider,
  deriveOnboardingStatus,
  type FeedbackServerSetupNotice,
  type SetupNoticeProvider,
} from './onboarding.js';
import {
  createPluginUpdateNoticeProvider,
  type PluginUpdateNotice,
  type UpdateNoticeProvider,
} from './release-updates.js';

const uuid = z.uuid();
const confirmation = {
  confirmationId: z
    .uuid()
    .optional()
    .describe(
    'Use only after showing the matching preview to the user and receiving explicit confirmation.',
  ),
};

const productCreateFields = {
  slug: z.string().min(2).max(80),
  name: z.string().min(1).max(160),
  defaultLocale: z.string().min(2).max(35).default('en'),
  defaultFeedbackVisibility: z.enum(['private', 'public']).default('private'),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  iconUrl: z.url().nullable().optional(),
  maxAttachments: z.number().int().min(1).max(5).default(5),
  maxImageBytes: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024)
    .default(15 * 1024 * 1024),
  maxVideoBytes: z
    .number()
    .int()
    .positive()
    .max(150 * 1024 * 1024)
    .default(150 * 1024 * 1024),
  diagnosticsEnabled: z.boolean().default(false),
  maxDiagnosticBytes: z.number().int().min(1024).max(1024 * 1024).default(256 * 1024),
};

const productUpdateFields = {
  slug: z.string().min(2).max(80).optional(),
  name: z.string().min(1).max(160).optional(),
  defaultLocale: z.string().min(2).max(35).optional(),
  defaultFeedbackVisibility: z.enum(['private', 'public']).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  iconUrl: z.url().nullable().optional(),
  maxAttachments: z.number().int().min(1).max(5).optional(),
  maxImageBytes: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024)
    .optional(),
  maxVideoBytes: z
    .number()
    .int()
    .positive()
    .max(150 * 1024 * 1024)
    .optional(),
  diagnosticsEnabled: z.boolean().optional(),
  maxDiagnosticBytes: z.number().int().min(1024).max(1024 * 1024).optional(),
};

const itemFields = {
  type: z.enum(['feature', 'improvement', 'bug']),
  canonicalTitle: z.string().min(1).max(240),
  canonicalBody: z.string().max(20_000),
  products: z
    .array(
      z.object({
        productId: uuid,
        visibility: z.enum(['private', 'public']).default('private'),
        roadmapStage: z.enum(['urgent', 'later', 'undecided']).default('undecided'),
        rank: z.number().int().min(0).default(0),
        archived: z.boolean().default(false),
      }),
    )
    .min(1),
};

const developerPostAction = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('external_url'),
      target: z.url().refine((value) => new URL(value).protocol === 'https:'),
      label: z.string().min(1).max(160).optional(),
    }),
    z.object({
      type: z.literal('app_route'),
      target: z.string().min(1).max(500).regex(/^\/(?!\/)/),
      label: z.string().min(1).max(160).optional(),
    }),
  ])
  .nullable();

const translationFields = {
  locale: z.string().min(2).max(35),
  title: z.string().min(1).max(240),
  body: z.string().max(20_000).default(''),
};

const releaseDateTime = z.iso.datetime({ offset: true });

const releaseFields = {
  version: z.string().min(1).max(80),
  status: z.enum(['draft', 'published']),
  releasedAt: releaseDateTime.nullable().optional(),
  itemIds: z.array(uuid),
};

const appStoreBindingFields = {
  appStoreId: z.string().regex(/^\d{1,20}$/),
  storefront: z.string().regex(/^[A-Za-z]{2}$/),
  locale: z.string().min(2).max(35),
};

const waitlistStatus = z.enum(['new', 'contacted', 'invited', 'converted', 'archived']);
const waitlistPlatform = z.enum(['ios_ipados', 'macos', 'android', 'web', 'other']);

interface ToolContext {
  credentials: StoredCredentials;
  client: FeedbackServerApiClient;
  identity: {
    baseUrl: string;
    tokenIdentity: string;
  };
}

type ObjectSchema = z.ZodObject<z.ZodRawShape>;

export function productUpdateProtectedEffects(input: {
  statusChanges: boolean;
  visibilityChanges: boolean;
  diagnosticsChanges: boolean;
}): string[] {
  return [
    ...(input.statusChanges ? ['Product clients may stop working'] : []),
    ...(input.visibilityChanges ? ['New user feedback will be published by default'] : []),
    ...(input.diagnosticsChanges
      ? ['Product clients may offer visitors a private diagnostic-log upload option']
      : []),
  ];
}

type RegisterToolBridge = (
  name: string,
  config: {
    description: string;
    inputSchema: ObjectSchema;
    annotations: ToolAnnotations;
  },
  callback: (input: Record<string, unknown>) => Promise<CallToolResult>,
) => unknown;

const updateNoticeProviders = new WeakMap<McpServer, UpdateNoticeProvider>();
const setupNoticeProviders = new WeakMap<McpServer, SetupNoticeProvider>();

function toolRegistrar(server: McpServer): RegisterToolBridge {
  return (name, config, callback) => {
    return server.registerTool(name, config, async (input) => {
      const result = await callback(input);
      if (result.isError) return result;
      const [updateNotice, setupNotice] = await Promise.all([
        updateNoticeProviders.get(server)?.takeNotice().catch(() => undefined),
        setupNoticeProviders.get(server)?.takeNotice().catch(() => undefined),
      ]);
      return updateNotice || setupNotice
        ? attachNotices(result, { updateNotice, setupNotice })
        : result;
    });
  };
}

function jsonSafe(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify({ data: value })) as JSONObject;
}

function success(value: unknown): CallToolResult {
  const structuredContent = jsonSafe(value);
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function attachNotices(
  result: CallToolResult,
  notices: {
    updateNotice?: PluginUpdateNotice | undefined;
    setupNotice?: FeedbackServerSetupNotice | undefined;
  },
): CallToolResult {
  const structuredContent = JSON.parse(JSON.stringify({
    ...(result.structuredContent ?? {}),
    ...(notices.updateNotice ? { updateNotice: notices.updateNotice } : {}),
    ...(notices.setupNotice ? { setupNotice: notices.setupNotice } : {}),
  })) as JSONObject;
  return {
    ...result,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function normalizeReleasedAt(value: string | null | undefined): string | null | undefined {
  return typeof value === 'string' ? new Date(value).toISOString() : value;
}

function failure(error: unknown): CallToolResult {
  const payload =
    error instanceof FeedbackServerApiError
      ? {
          status: error.status,
          code: error.code,
          message: error.message,
          data: redactPreview(error.data),
        }
      : {
          status: 500,
          code: 'agent_tool_error',
          message: error instanceof Error ? error.message : 'Unknown FeedbackServer Agent error',
          data: null,
        };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

async function context(): Promise<ToolContext> {
  const credentials = await loadCredentials();
  const tokenIdentity =
    credentials.tokenId ?? createHash('sha256').update(credentials.token).digest('hex');
  return {
    credentials,
    client: new FeedbackServerApiClient(credentials),
    identity: {
      baseUrl: credentials.baseUrl,
      tokenIdentity,
    },
  };
}

function registerRead<T extends ObjectSchema>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  handler: (input: z.infer<T>, toolContext: ToolContext) => Promise<unknown>,
): void {
  toolRegistrar(server)(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return success(await handler(inputSchema.parse(input), await context()));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerDirectWrite<T extends ObjectSchema>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  handler: (input: z.infer<T>, toolContext: ToolContext) => Promise<unknown>,
): void {
  toolRegistrar(server)(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return success(await handler(inputSchema.parse(input), await context()));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerRiskAwareWrite<T extends ObjectSchema>(
  server: McpServer,
  confirmations: ConfirmationStore,
  name: string,
  description: string,
  inputSchema: T,
  annotations: Pick<ToolAnnotations, 'destructiveHint' | 'idempotentHint'>,
  assessRisk: (
    input: Omit<z.infer<T>, 'confirmationId'>,
    toolContext: ToolContext,
  ) => Promise<{
    preview?: Record<string, unknown>;
    precondition?: string;
    result?: unknown;
  }>,
  handler: (
    input: Omit<z.infer<T>, 'confirmationId'>,
    toolContext: ToolContext,
    precondition?: string,
  ) => Promise<unknown>,
): void {
  toolRegistrar(server)(
    name,
    {
      description: `${description} Executes immediately when the current change has no protected effect; otherwise returns a confirmation preview.`,
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const toolContext = await context();
        const parsed = inputSchema.parse(input);
        const { confirmationId, ...payload } = parsed as z.infer<T> & {
          confirmationId?: string;
        };
        if (confirmationId) {
          const executionContext = confirmations.consume(
            confirmationId,
            name,
            payload,
            toolContext.identity,
          ) as { precondition?: string } | undefined;
          return success(
            await handler(payload, toolContext, executionContext?.precondition),
          );
        }
        const assessment = await assessRisk(payload, toolContext);
        if ('result' in assessment) {
          return success(assessment.result);
        }
        if (assessment.preview === undefined) {
          return success(
            await handler(payload, toolContext, assessment.precondition),
          );
        }
        const prepared = confirmations.prepare(
          name,
          payload,
          toolContext.identity,
          Date.now(),
          { precondition: assessment.precondition },
        );
        return success({
          status: 'confirmation_required',
          action: name,
          preview: redactPreview(assessment.preview),
          ...prepared,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerConfirmedWrite<T extends ObjectSchema>(
  server: McpServer,
  confirmations: ConfirmationStore,
  name: string,
  description: string,
  inputSchema: T,
  annotations: Pick<ToolAnnotations, 'destructiveHint' | 'idempotentHint'>,
  handler: (
    input: Omit<z.infer<T>, 'confirmationId'>,
    toolContext: ToolContext,
  ) => Promise<unknown>,
): void {
  toolRegistrar(server)(
    name,
    {
      description: `${description} Without confirmationId this only prepares a redacted preview. Execute only after explicit user confirmation.`,
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const toolContext = await context();
        const parsed = inputSchema.parse(input);
        const { confirmationId, ...payload } = parsed as z.infer<T> & {
          confirmationId?: string;
        };
        if (!confirmationId) {
          const prepared = confirmations.prepare(name, payload, toolContext.identity);
          return success({
            status: 'confirmation_required',
            action: name,
            preview: redactPreview(payload),
            ...prepared,
          });
        }
        confirmations.consume(confirmationId, name, payload, toolContext.identity);
        return success(await handler(payload, toolContext));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function withQuery(
  input: Record<string, unknown>,
  omittedKeys: string[] = [],
): Record<string, string | number | boolean | undefined> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => !omittedKeys.includes(key) && value !== undefined)
      .map(([key, value]) => [key, value as string | number | boolean]),
  );
}

export function registerFeedbackServerTools(
  server: McpServer,
  confirmations = new ConfirmationStore(),
  updateNotices: UpdateNoticeProvider = createPluginUpdateNoticeProvider(),
  setupNotices: SetupNoticeProvider = createSetupNoticeProvider(),
): void {
  updateNoticeProviders.set(server, updateNotices);
  setupNoticeProviders.set(server, setupNotices);
  registerRead(
    server,
    'health',
    'Check FeedbackServer and its production database health.',
    z.object({}),
    async (_input, { client }) => client.request('/health', { authenticated: false }),
  );

  registerRead(
    server,
    'connection_status',
    'Show the configured FeedbackServer endpoint and non-secret token metadata.',
    z.object({}),
    async (_input, { client, credentials }) => {
      const health = await client.request('/health', { authenticated: false });
      const products = await client.request<unknown[]>('/admin/products');
      const daysUntilExpiry = credentials.expiresAt
        ? Math.floor(
            (new Date(credentials.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          )
        : null;
      return {
        endpoint: credentials.baseUrl,
        username: credentials.username ?? null,
        tokenId: credentials.tokenId ?? null,
        scopes: credentials.scopes ?? null,
        expiresAt: credentials.expiresAt ?? null,
        daysUntilExpiry,
        rotationRecommended: daysUntilExpiry !== null && daysUntilExpiry <= 30,
        authenticated: true,
        visibleProductCount: Array.isArray(products) ? products.length : null,
        health,
      };
    },
  );

  registerRead(
    server,
    'list_products',
    'List every app Product owned by the connected account. Use this before selecting an app.',
    z.object({}),
    async (_input, { client }) => client.request('/admin/products'),
  );
  registerRead(
    server,
    'get_product',
    'Get one Product by its explicit ID.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}`),
  );
  registerRead(
    server,
    'get_subscription',
    'Get the server-computed subscription lifecycle, limits, features, aggregate storage usage, primary Product, and per-Product write access for the connected account.',
    z.object({}),
    async (_input, { client }) => client.request('/admin/subscription'),
  );
  registerRead(
    server,
    'get_onboarding_status',
    'Derive the current guided setup stages and prioritized next actions from live FeedbackServer configuration without returning secrets.',
    z.object({ productId: uuid.optional() }),
    async ({ productId }, { client, credentials }) => deriveOnboardingStatus({
      client,
      endpoint: credentials.baseUrl,
      username: credentials.username,
      scopes: credentials.scopes,
      productId,
    }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'set_primary_product',
    'Switch the account primary Product, which controls write priority when the effective plan cannot keep every Product writable.',
    z.object({ productId: uuid, ...confirmation }),
    { destructiveHint: false, idempotentHint: true },
    async ({ productId }, { client }) => {
      const current = await client.request<{
        currentPrimaryProductId: string | null;
        targetProductId: string;
        affectedProducts: Array<{
          id: string;
          name: string;
          currentAccess: 'read_write' | 'read_only';
          proposedAccess: 'read_write' | 'read_only';
        }>;
        precondition: string;
      }>('/admin/subscription/primary-product/update-context', {
        query: { productId },
      });
      if (current.currentPrimaryProductId === current.targetProductId) {
        return {
          result: {
            status: 'no_change',
            primaryProductId: current.currentPrimaryProductId,
          },
        };
      }
      const effects = current.affectedProducts.map((product) =>
        `${product.name} (${product.id}): ${product.currentAccess} -> ${product.proposedAccess}`
      );
      return {
        precondition: current.precondition,
        preview: {
          currentPrimaryProductId: current.currentPrimaryProductId,
          targetProductId: current.targetProductId,
          affectedProducts: current.affectedProducts,
          effect: effects.length > 0
            ? effects.join('; ')
            : 'Changes primary Product priority without changing current Product access.',
          effects,
        },
      };
    },
    async ({ productId }, { client }, precondition) =>
      client.request('/admin/subscription/primary-product', {
        method: 'PUT',
        body: { productId },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerDirectWrite(
    server,
    'create_product',
    'Create a Product for a new app.',
    z.object(productCreateFields),
    async (body, { client }) => client.request('/admin/products', { method: 'POST', body }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'update_product',
    'Update explicitly provided Product fields.',
    z.object({ productId: uuid, ...productUpdateFields, ...confirmation }),
    { destructiveHint: false, idempotentHint: true },
    async ({
      productId,
      status,
      defaultFeedbackVisibility,
      diagnosticsEnabled,
      ...otherFields
    }, { client }) => {
      const protectsStatus = status === 'inactive' || status === 'archived';
      const protectsVisibility = defaultFeedbackVisibility === 'public';
      const protectsDiagnostics = diagnosticsEnabled === true;
      if (!protectsStatus && !protectsVisibility && !protectsDiagnostics) return {};
      const current = await client.request<{
        product: {
          name: string;
          status: string;
          defaultFeedbackVisibility: string;
          diagnosticsEnabled: boolean;
        };
        precondition: string;
      }>(
        `/admin/products/${encodeURIComponent(productId)}/update-context`,
      );
      const statusChanges = protectsStatus && current.product.status !== status;
      const visibilityChanges =
        protectsVisibility
        && current.product.defaultFeedbackVisibility !== defaultFeedbackVisibility;
      const diagnosticsChanges =
        protectsDiagnostics && current.product.diagnosticsEnabled !== diagnosticsEnabled;
      if (!statusChanges && !visibilityChanges && !diagnosticsChanges) {
        const requestedStatusChanges =
          status !== undefined && current.product.status !== status;
        const requestedVisibilityChanges =
          defaultFeedbackVisibility !== undefined
          && current.product.defaultFeedbackVisibility !== defaultFeedbackVisibility;
        const requestedDiagnosticsChanges =
          diagnosticsEnabled !== undefined
          && current.product.diagnosticsEnabled !== diagnosticsEnabled;
        return !requestedStatusChanges
          && !requestedVisibilityChanges
          && !requestedDiagnosticsChanges
          && Object.keys(otherFields).length === 0
          ? {
              result: {
                status: 'no_change',
                productId,
                currentStatus: current.product.status,
                currentDefaultFeedbackVisibility: current.product.defaultFeedbackVisibility,
                diagnosticsEnabled: current.product.diagnosticsEnabled,
              },
            }
          : { precondition: current.precondition };
      }
      const effects = productUpdateProtectedEffects({
        statusChanges,
        visibilityChanges,
        diagnosticsChanges,
      });
      return {
        precondition: current.precondition,
        preview: {
          productId,
          productName: current.product.name,
          currentStatus: current.product.status,
          requestedStatus: status,
          currentDefaultFeedbackVisibility: current.product.defaultFeedbackVisibility,
          requestedDefaultFeedbackVisibility: defaultFeedbackVisibility,
          currentDiagnosticsEnabled: current.product.diagnosticsEnabled,
          requestedDiagnosticsEnabled: diagnosticsEnabled,
          effect: effects.join('; '),
          effects,
        },
      };
    },
    async ({ productId, ...body }, { client }, precondition) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        body,
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'rotate_product_key',
    'Rotate a Product publishable key; existing clients using the old key stop working.',
    z.object({ productId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ productId }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}/rotate-publishable-key`, {
        method: 'POST',
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_product',
    'Delete a Product and its Product-scoped data.',
    z.object({ productId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ productId }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      }),
  );

  registerRead(
    server,
    'get_product_app_store_binding',
    'Get the persisted App Store binding for one Product.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}/app-store`),
  );
  registerDirectWrite(
    server,
    'configure_product_app_store_binding',
    'Validate and persist an App Store ID, storefront, and target locale for one Product.',
    z.object({ productId: uuid, ...appStoreBindingFields }),
    async ({ productId, ...body }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}/app-store`, {
        method: 'PUT',
        body,
      }),
  );
  registerDirectWrite(
    server,
    'remove_product_app_store_binding',
    'Remove the reversible internal App Store binding from one Product.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request(`/admin/products/${encodeURIComponent(productId)}/app-store`, {
        method: 'DELETE',
      }),
  );

  registerRead(
    server,
    'list_waitlist_entries',
    'List owner-scoped FeedbackKit waitlist entries with lifecycle, platform, search, and stable cursor filters. Archived entries are hidden unless requested explicitly.',
    z.object({
      status: waitlistStatus.optional(),
      platform: waitlistPlatform.optional(),
      search: z.string().trim().min(1).max(160).optional(),
      cursor: z.string().max(1000).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async (input, { client }) =>
      client.request('/admin/waitlist', { query: withQuery(input) }),
  );
  registerRead(
    server,
    'get_waitlist_entry',
    'Get one owner-scoped waitlist entry and its append-only internal notes.',
    z.object({ entryId: uuid }),
    async ({ entryId }, { client }) =>
      client.request(`/admin/waitlist/${encodeURIComponent(entryId)}`),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'update_waitlist_status',
    'Update the internal follow-up status for one waitlist entry.',
    z.object({ entryId: uuid, status: waitlistStatus, ...confirmation }),
    { destructiveHint: false, idempotentHint: true },
    async ({ entryId, status }, { client }) => {
      const current = await client.request<{
        entry: { status: z.infer<typeof waitlistStatus> };
        precondition: string;
      }>(`/admin/waitlist/${encodeURIComponent(entryId)}/update-context`);
      return current.entry.status === status
        ? { result: { status: 'no_change', entryId, currentStatus: status } }
        : { precondition: current.precondition };
    },
    async ({ entryId, status }, { client }, precondition) =>
      client.request(`/admin/waitlist/${encodeURIComponent(entryId)}`, {
        method: 'PATCH',
        body: { status },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerDirectWrite(
    server,
    'add_waitlist_note',
    'Append an administrator-only internal note to one waitlist entry.',
    z.object({ entryId: uuid, body: z.string().trim().min(1).max(5_000) }),
    async ({ entryId, body }, { client }) =>
      client.request(`/admin/waitlist/${encodeURIComponent(entryId)}/notes`, {
        method: 'POST',
        body: { body },
      }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'delete_waitlist_entry',
    'Permanently delete a waitlist entry and all of its internal notes for a data-deletion request.',
    z.object({ entryId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ entryId }, { client }) => {
      const detail = await client.request<{
        entry: {
          appName: string;
          platform: z.infer<typeof waitlistPlatform>;
          email: string;
          createdAt: string;
        };
        notes: unknown[];
      }>(`/admin/waitlist/${encodeURIComponent(entryId)}`);
      return {
        preview: {
          entryId,
          appName: detail.entry.appName,
          platform: detail.entry.platform,
          email: detail.entry.email,
          createdAt: detail.entry.createdAt,
          noteCount: detail.notes.length,
          effect: 'Permanently deletes the signup email, App details, and all internal notes; this cannot be undone.',
        },
      };
    },
    async ({ entryId }, { client }) =>
      client.request(`/admin/waitlist/${encodeURIComponent(entryId)}`, { method: 'DELETE' }),
  );

  registerRead(
    server,
    'list_feedback',
    'List feedback with explicit filters and stable cursor pagination.',
    z.object({
      productId: uuid.optional(),
      status: z.enum(['open', 'resolved', 'closed']).optional(),
      type: z.enum(['bug', 'suggestion', 'praise', 'conversation']).optional(),
      visibility: z.enum(['private', 'public']).optional(),
      pinned: z.boolean().optional(),
      search: z.string().max(240).optional(),
      cursor: z.string().max(1000).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async (input, { client }) => client.request('/admin/feedback', { query: withQuery(input) }),
  );
  registerRead(
    server,
    'get_feedback',
    'Get feedback details, replies, internal notes, client context, attachments, private diagnostic metadata, and linked Items.',
    z.object({ feedbackId: uuid }),
    async ({ feedbackId }, { client }) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}`),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'update_feedback_status',
    'Change a feedback status; this can notify a visitor.',
    z.object({
      feedbackId: uuid,
      status: z.enum(['open', 'resolved', 'closed']),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ feedbackId, status }, { client }) => {
      const current = await client.request<{
        feedback: { status: string; displayTitle: string };
        product: { id: string; name: string };
        precondition: string;
      }>(`/admin/feedback/${encodeURIComponent(feedbackId)}/update-context`);
      if (current.feedback.status === status) {
        return {
          result: {
            status: 'no_change',
            feedbackId,
            currentStatus: current.feedback.status,
          },
        };
      }
      return {
        precondition: current.precondition,
        preview: {
          feedbackId,
          feedbackTitle: current.feedback.displayTitle,
          productId: current.product.id,
          productName: current.product.name,
          currentStatus: current.feedback.status,
          requestedStatus: status,
          effect: 'The visitor receives a status-change inbox event',
        },
      };
    },
    async ({ feedbackId, status }, { client }, precondition) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        method: 'PATCH',
        body: { status },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'reply_to_feedback',
    'Reply to open feedback. Private feedback replies execute directly; public replies require confirmation.',
    z.object({
      feedbackId: uuid,
      body: z.string().min(1).max(20_000),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: false },
    async ({ feedbackId, body }, { client }) => {
      const current = await client.request<{
        feedback: { status: string; visibility: string; displayTitle: string };
        product: { id: string; name: string };
        precondition: string;
      }>(`/admin/feedback/${encodeURIComponent(feedbackId)}/update-context`);
      if (current.feedback.status !== 'open') {
        return {
          result: {
            status: 'feedback_not_open',
            feedbackId,
            currentStatus: current.feedback.status,
            requiredStatus: 'open',
          },
        };
      }
      return current.feedback.visibility === 'public'
        ? {
            precondition: current.precondition,
            preview: {
              feedbackId,
              feedbackTitle: current.feedback.displayTitle,
              productName: current.product.name,
              body,
              effect: 'The reply will be publicly visible and notify the visitor',
            },
          }
        : { precondition: current.precondition };
    },
    async ({ feedbackId, body }, { client }, precondition) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}/replies`, {
        method: 'POST',
        body: { body },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'set_feedback_visibility',
    'Publish or unpublish feedback. Publishing private user content requires confirmation.',
    z.object({
      feedbackId: uuid,
      visibility: z.enum(['private', 'public']),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ feedbackId, visibility }, { client }) => {
      const current = await client.request<{
        feedback: { visibility: string; publishedAt: string | null; displayTitle: string };
        product: { id: string; name: string };
        precondition: string;
      }>(`/admin/feedback/${encodeURIComponent(feedbackId)}/update-context`);
      if (current.feedback.visibility === visibility) {
        return {
          result: {
            status: 'no_change',
            feedbackId,
            currentVisibility: current.feedback.visibility,
          },
        };
      }
      return visibility === 'public' && current.feedback.publishedAt === null
        ? {
            precondition: current.precondition,
            preview: {
              feedbackId,
              feedbackTitle: current.feedback.displayTitle,
              productName: current.product.name,
              requestedVisibility: visibility,
              effect: 'The feedback, attachments, and non-internal replies become public',
            },
          }
        : { precondition: current.precondition };
    },
    async ({ feedbackId, visibility }, { client }, precondition) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        method: 'PATCH',
        body: { visibility },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'set_feedback_pinned',
    'Pin or unpin public feedback in the activity feed.',
    z.object({ feedbackId: uuid, pinned: z.boolean() }),
    { destructiveHint: false, idempotentHint: true },
    async ({ feedbackId, pinned }, { client }) => {
      const current = await client.request<{
        feedback: { pinned: boolean };
        precondition: string;
      }>(`/admin/feedback/${encodeURIComponent(feedbackId)}/update-context`);
      return current.feedback.pinned === pinned
        ? { result: { status: 'no_change', feedbackId, pinned } }
        : { precondition: current.precondition };
    },
    async ({ feedbackId, pinned }, { client }, precondition) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        method: 'PATCH',
        body: { pinned },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerDirectWrite(
    server,
    'add_internal_note',
    'Add an administrator-only internal note after verifying the feedback target.',
    z.object({
      feedbackId: uuid,
      body: z.string().min(1).max(20_000),
    }),
    async ({ feedbackId, body }, { client }) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}/notes`, {
        method: 'POST',
        body: { body },
      }),
  );
  registerDirectWrite(
    server,
    'link_feedback_item',
    'Internally link feedback to an Item belonging to the same Product.',
    z.object({ feedbackId: uuid, itemId: uuid }),
    async ({ feedbackId, itemId }, { client }) =>
      client.request(`/admin/feedback/${encodeURIComponent(feedbackId)}/links`, {
        method: 'POST',
        body: { itemId },
      }),
  );
  registerDirectWrite(
    server,
    'unlink_feedback_item',
    'Remove an internal Feedback–Item link.',
    z.object({ feedbackId: uuid, itemId: uuid }),
    async ({ feedbackId, itemId }, { client }) =>
      client.request(
        `/admin/feedback/${encodeURIComponent(feedbackId)}/links/${encodeURIComponent(itemId)}`,
        { method: 'DELETE' },
      ),
  );
  registerRead(
    server,
    'get_attachment_url',
    'Create a short-lived private attachment URL. Call only after the user explicitly requests the attachment.',
    z.object({ attachmentId: uuid }),
    async ({ attachmentId }, { client }) =>
      client.request(`/admin/feedback/attachments/${encodeURIComponent(attachmentId)}/url`),
  );
  registerRead(
    server,
    'get_diagnostic_bundle_url',
    'Create a short-lived administrator-only diagnostic bundle URL. Call only after the user explicitly requests the diagnostic contents.',
    z.object({ diagnosticArtifactId: uuid }),
    async ({ diagnosticArtifactId }, { client }) =>
      client.request(
        `/admin/feedback/diagnostics/${encodeURIComponent(diagnosticArtifactId)}/url`,
      ),
  );

  registerRead(
    server,
    'list_developer_posts',
    'List Developer Posts, optionally filtered by Product and publication status.',
    z.object({
      productId: uuid.optional(),
      status: z.enum(['draft', 'published']).optional(),
    }),
    async (input, { client }) =>
      client.request('/admin/developer-posts', { query: withQuery(input) }),
  );
  registerRead(
    server,
    'get_developer_post',
    'Get a Developer Post, its CTA, translations, and publication state.',
    z.object({ postId: uuid }),
    async ({ postId }, { client }) =>
      client.request(`/admin/developer-posts/${encodeURIComponent(postId)}`),
  );
  registerDirectWrite(
    server,
    'create_developer_post',
    'Create a private draft Developer Post.',
    z.object({
      productId: uuid,
      canonicalTitle: z.string().min(1).max(240),
      canonicalBody: z.string().max(20_000).default(''),
      action: developerPostAction.default(null),
    }),
    async (body, { client }) =>
      client.request('/admin/developer-posts', { method: 'POST', body }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'update_developer_post',
    'Edit Developer Post content, CTA, or feed pinning. Published edits update public activity.',
    z
      .object({
        postId: uuid,
        canonicalTitle: z.string().min(1).max(240).optional(),
        canonicalBody: z.string().max(20_000).optional(),
        action: developerPostAction.optional(),
        pinned: z.boolean().optional(),
        ...confirmation,
      })
      .refine(
        (value) =>
          Object.entries(value).some(
            ([key, field]) => !['postId', 'confirmationId'].includes(key) && field !== undefined,
          ),
        { message: 'At least one update field is required' },
      ),
    { destructiveHint: false, idempotentHint: true },
    async ({ postId, ...body }, { client }) => {
      const current = await client.request<{
        post: { id: string; productId: string; title: string; status: string };
        product: { id: string; name: string };
        precondition: string;
      }>(`/admin/developer-posts/${encodeURIComponent(postId)}/update-context`);
      return current.post.status === 'published'
        ? {
            precondition: current.precondition,
            preview: {
              postId,
              productId: current.product.id,
              productName: current.product.name,
              title: current.post.title,
              requestedChanges: body,
              effect: 'Published activity content changes immediately',
            },
          }
        : { precondition: current.precondition };
    },
    async ({ postId, ...body }, { client }, precondition) =>
      client.request(`/admin/developer-posts/${encodeURIComponent(postId)}`, {
        method: 'PATCH',
        body,
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'set_developer_post_translation',
    'Create or replace a Developer Post translation, which may change published activity.',
    z.object({
      postId: uuid,
      locale: translationFields.locale,
      title: translationFields.title,
      body: translationFields.body,
      actionLabel: z.string().min(1).max(160).nullable().optional(),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ postId, locale, ...body }, { client }) =>
      client.request(
        `/admin/developer-posts/${encodeURIComponent(postId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'PUT', body },
      ),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'set_developer_post_publication',
    'Publish or unpublish a Developer Post. First publication requires confirmation.',
    z.object({
      postId: uuid,
      status: z.enum(['draft', 'published']),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ postId, status }, { client }) => {
      const current = await client.request<{
        post: { id: string; productId: string; title: string; status: string };
        product: { id: string; name: string };
        precondition: string;
      }>(`/admin/developer-posts/${encodeURIComponent(postId)}/update-context`);
      if (current.post.status === status) {
        return {
          result: { status: 'no_change', postId, currentStatus: current.post.status },
        };
      }
      return status === 'published'
        ? {
            precondition: current.precondition,
            preview: {
              postId,
              productId: current.product.id,
              productName: current.product.name,
              title: current.post.title,
              requestedStatus: status,
              effect: 'The Developer Post becomes visible in the public activity feed',
            },
          }
        : { precondition: current.precondition };
    },
    async ({ postId, status }, { client }, precondition) =>
      client.request(`/admin/developer-posts/${encodeURIComponent(postId)}/publication`, {
        method: 'PATCH',
        body: { status },
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_developer_post_translation',
    'Delete a Developer Post translation.',
    z.object({
      postId: uuid,
      locale: translationFields.locale,
      ...confirmation,
    }),
    { destructiveHint: true, idempotentHint: true },
    async ({ postId, locale }, { client }) =>
      client.request(
        `/admin/developer-posts/${encodeURIComponent(postId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'DELETE' },
      ),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_developer_post',
    'Delete a Developer Post and all translations.',
    z.object({ postId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ postId }, { client }) =>
      client.request(`/admin/developer-posts/${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      }),
  );

  registerRead(
    server,
    'list_items',
    'List all roadmap Items across Products.',
    z.object({}),
    async (_input, { client }) => client.request('/admin/items'),
  );
  registerRead(
    server,
    'get_item',
    'Get an Item, translations, and Product-specific roadmap associations.',
    z.object({ itemId: uuid }),
    async ({ itemId }, { client }) => client.request(`/admin/items/${encodeURIComponent(itemId)}`),
  );
  registerDirectWrite(
    server,
    'create_item',
    'Create a roadmap Item for explicit Products.',
    z.object({
      type: itemFields.type,
      canonicalTitle: itemFields.canonicalTitle,
      canonicalBody: itemFields.canonicalBody.default(''),
      products: itemFields.products,
    }),
    async (body, { client }) => client.request('/admin/items', { method: 'POST', body }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'update_item',
    'Update explicitly provided Item fields and Product associations.',
    z.object({
      itemId: uuid,
      type: itemFields.type.optional(),
      canonicalTitle: itemFields.canonicalTitle.optional(),
      canonicalBody: itemFields.canonicalBody.optional(),
      products: itemFields.products.optional(),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ itemId, products, ...otherFields }, { client }) => {
      const current = await client.request<{
        item: {
          canonicalTitle: string;
        };
        products: Array<{
          productId: string;
          visibility: string;
          roadmapStage: string;
          rank: number;
          archivedAt: string | null;
        }>;
        precondition: string;
      }>(`/admin/items/${encodeURIComponent(itemId)}/update-context`);
      const normalizedCurrent = current.products
        .map((association) => ({
          productId: association.productId,
          visibility: association.visibility,
          roadmapStage: association.roadmapStage,
          rank: association.rank,
          archived: association.archivedAt !== null,
        }))
        .sort((left, right) => left.productId.localeCompare(right.productId));
      const normalizedNext = products
        ? [...products].sort((left, right) => left.productId.localeCompare(right.productId))
        : normalizedCurrent;
      if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNext)) {
        if (Object.keys(otherFields).length === 0) {
          return { result: { status: 'no_change', itemId } };
        }
      }
      const affectsPublicRoadmap = [...normalizedCurrent, ...normalizedNext].some(
        ({ visibility }) => visibility === 'public',
      );
      if (!affectsPublicRoadmap) return { precondition: current.precondition };
      return {
        precondition: current.precondition,
        preview: {
          itemId,
          itemTitle: current.item.canonicalTitle,
          currentProducts: normalizedCurrent,
          requestedProducts: normalizedNext,
          requestedChanges: otherFields,
          effect: 'Public roadmap content or placement changes and linked visitors may be notified',
        },
      };
    },
    async ({ itemId, ...body }, { client }, precondition) =>
      client.request(`/admin/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        body,
        ...(precondition ? { ifMatch: precondition } : {}),
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'set_item_translation',
    'Create or replace an Item translation, which may change a public roadmap.',
    z.object({ itemId: uuid, ...translationFields, ...confirmation }),
    { destructiveHint: false, idempotentHint: true },
    async ({ itemId, locale, title, body }, { client }) =>
      client.request(
        `/admin/items/${encodeURIComponent(itemId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'PUT', body: { title, body } },
      ),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_item_translation',
    'Delete an Item translation.',
    z.object({
      itemId: uuid,
      locale: translationFields.locale,
      ...confirmation,
    }),
    { destructiveHint: true, idempotentHint: true },
    async ({ itemId, locale }, { client }) =>
      client.request(
        `/admin/items/${encodeURIComponent(itemId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'DELETE' },
      ),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_item',
    'Delete an Item and its translations, links, and Release associations.',
    z.object({ itemId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ itemId }, { client }) =>
      client.request(`/admin/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      }),
  );

  registerRead(
    server,
    'list_releases',
    'List Releases, optionally for one explicit Product.',
    z.object({ productId: uuid.optional() }),
    async (input, { client }) => client.request('/admin/releases', { query: withQuery(input) }),
  );
  registerRead(
    server,
    'get_release',
    'Get a Release with translations and ordered Item associations.',
    z.object({ releaseId: uuid }),
    async ({ releaseId }, { client }) =>
      client.request(`/admin/releases/${encodeURIComponent(releaseId)}`),
  );
  registerRead(
    server,
    'preview_latest_app_store_release',
    'Preview the latest App Store release and whether it will create a draft, add a locale, or make no change.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request('/admin/releases/imports/app-store/latest', {
        query: { productId },
      }),
  );
  registerDirectWrite(
    server,
    'import_latest_app_store_release',
    'Import the latest bound App Store release as a draft without overwriting existing content.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request('/admin/releases/imports/app-store/latest', {
        method: 'POST',
        body: { productId },
      }),
  );
  registerRiskAwareWrite(
    server,
    confirmations,
    'create_release',
    'Create a draft or published Release for one Product.',
    z.object({
      productId: uuid,
      version: releaseFields.version,
      status: releaseFields.status.default('draft'),
      releasedAt: releaseFields.releasedAt,
      itemIds: releaseFields.itemIds.default([]),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: false },
    (body) => Promise.resolve(body.status === 'published'
      ? {
          preview: {
            ...body,
            effect: 'The Release becomes visible in the public changelog',
          },
        }
      : {}),
    async (body, { client }) =>
      client.request('/admin/releases', {
        method: 'POST',
        body: { ...body, releasedAt: normalizeReleasedAt(body.releasedAt) },
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'update_release',
    'Update, publish, unpublish, or reorder a Release that may be public.',
    z.object({
      releaseId: uuid,
      version: releaseFields.version.optional(),
      status: releaseFields.status.optional(),
      releasedAt: releaseFields.releasedAt,
      itemIds: releaseFields.itemIds.optional(),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ releaseId, ...body }, { client }) =>
      client.request(`/admin/releases/${encodeURIComponent(releaseId)}`, {
        method: 'PATCH',
        body: { ...body, releasedAt: normalizeReleasedAt(body.releasedAt) },
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'set_release_translation',
    'Create or replace a Release translation that may be public.',
    z.object({
      releaseId: uuid,
      locale: translationFields.locale,
      body: translationFields.body,
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ releaseId, locale, body }, { client }) =>
      client.request(
        `/admin/releases/${encodeURIComponent(releaseId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'PUT', body: { body } },
      ),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_release_translation',
    'Delete a Release translation.',
    z.object({
      releaseId: uuid,
      locale: translationFields.locale,
      ...confirmation,
    }),
    { destructiveHint: true, idempotentHint: true },
    async ({ releaseId, locale }, { client }) =>
      client.request(
        `/admin/releases/${encodeURIComponent(releaseId)}/translations/${encodeURIComponent(locale)}`,
        { method: 'DELETE' },
      ),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'delete_release',
    'Delete a Release and its translations and Item associations.',
    z.object({ releaseId: uuid, ...confirmation }),
    { destructiveHint: true, idempotentHint: false },
    async ({ releaseId }, { client }) =>
      client.request(`/admin/releases/${encodeURIComponent(releaseId)}`, {
        method: 'DELETE',
      }),
  );

  registerRead(
    server,
    'get_global_bark_config',
    'Read the masked global Bark configuration.',
    z.object({}),
    async (_input, { client }) => client.request('/admin/bark/global'),
  );
  registerDirectWrite(
    server,
    'update_global_bark_config',
    'Update the global Bark configuration. Device keys are always redacted.',
    z.object({
      enabled: z.boolean().optional(),
      serverUrl: z.url().optional(),
      deviceKey: z.string().min(1).max(500).optional(),
      group: z.string().max(160).nullable().optional(),
      icon: z.url().nullable().optional(),
      sound: z.string().max(120).nullable().optional(),
    }),
    async (body, { client }) => client.request('/admin/bark/global', { method: 'PUT', body }),
  );
  registerRead(
    server,
    'get_product_bark_config',
    'Read the masked Bark configuration for one Product.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request(`/admin/bark/products/${encodeURIComponent(productId)}`),
  );
  registerDirectWrite(
    server,
    'update_product_bark_config',
    'Update one Product Bark mode or custom channel. Device keys are always redacted.',
    z.object({
      productId: uuid,
      mode: z.enum(['inherit', 'custom', 'disabled']),
      serverUrl: z.url().optional(),
      deviceKey: z.string().min(1).max(500).optional(),
      group: z.string().max(160).nullable().optional(),
      icon: z.url().nullable().optional(),
      sound: z.string().max(120).nullable().optional(),
    }),
    async ({ productId, ...body }, { client }) =>
      client.request(`/admin/bark/products/${encodeURIComponent(productId)}`, {
        method: 'PUT',
        body,
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'test_bark_channel',
    'Send a real Bark test notification through the selected channel.',
    z
      .object({
      target: z.enum(['global', 'product']),
      productId: uuid.optional(),
      ...confirmation,
      })
      .superRefine((value, issue) => {
      if (value.target === 'product' && !value.productId) {
        issue.addIssue({
          code: 'custom',
          path: ['productId'],
          message: 'productId is required for a Product Bark test',
        });
      }
    }),
    { destructiveHint: false, idempotentHint: false },
    async ({ target, productId }, { client }) => {
      if (target === 'global') {
        return client.request('/admin/bark/global/test', { method: 'POST' });
      }
      if (!productId) {
        throw new Error('productId is required for a Product Bark test');
      }
      return client.request(`/admin/bark/products/${encodeURIComponent(productId)}/test`, {
        method: 'POST',
      });
    },
  );
  registerRead(
    server,
    'list_bark_deliveries',
    'List Bark delivery attempts with optional Product and status filters.',
    z.object({
      productId: uuid.optional(),
      status: z.enum(['success', 'failed', 'skipped']).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async (input, { client }) =>
      client.request('/admin/bark/deliveries', { query: withQuery(input) }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'retry_bark_delivery',
    'Requeue a failed Bark Outbox delivery.',
    z.object({ outboxId: uuid, ...confirmation }),
    { destructiveHint: false, idempotentHint: false },
    async ({ outboxId }, { client }) =>
      client.request(`/admin/bark/deliveries/${encodeURIComponent(outboxId)}/retry`, {
        method: 'POST',
      }),
  );

  registerRead(
    server,
    'get_product_webhook_config',
    'Read the masked Webhook configuration for one Product.',
    z.object({ productId: uuid }),
    async ({ productId }, { client }) =>
      client.request(`/admin/webhooks/products/${encodeURIComponent(productId)}`),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'update_product_webhook_config',
    'Configure, enable, or disable one Product Webhook. Signing secrets are always redacted.',
    z.object({
      productId: uuid,
      enabled: z.boolean(),
      endpointUrl: z.url().max(2048).optional(),
      secret: z.string().trim().min(32).max(500).optional(),
      ...confirmation,
    }),
    { destructiveHint: false, idempotentHint: true },
    async ({ productId, ...body }, { client }) =>
      client.request(`/admin/webhooks/products/${encodeURIComponent(productId)}`, {
        method: 'PUT',
        body,
      }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'test_product_webhook',
    'Send one real webhook.test delivery through the configured Product channel.',
    z.object({ productId: uuid, ...confirmation }),
    { destructiveHint: false, idempotentHint: false },
    async ({ productId }, { client }) =>
      client.request(`/admin/webhooks/products/${encodeURIComponent(productId)}/test`, {
        method: 'POST',
      }),
  );
  registerRead(
    server,
    'list_webhook_deliveries',
    'List Webhook delivery attempts with optional Product and status filters.',
    z.object({
      productId: uuid.optional(),
      status: z.enum(['success', 'failed', 'skipped']).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    async (input, { client }) =>
      client.request('/admin/webhooks/deliveries', { query: withQuery(input) }),
  );
  registerConfirmedWrite(
    server,
    confirmations,
    'retry_webhook_delivery',
    'Requeue a failed Webhook Outbox delivery.',
    z.object({ outboxId: uuid, ...confirmation }),
    { destructiveHint: false, idempotentHint: false },
    async ({ outboxId }, { client }) =>
      client.request(`/admin/webhooks/deliveries/${encodeURIComponent(outboxId)}/retry`, {
        method: 'POST',
      }),
  );

  registerRead(
    server,
    'list_audit',
    'Read recent immutable administrator audit records.',
    z.object({ limit: z.number().int().min(1).max(100).default(100) }),
    async (input, { client }) => client.request('/admin/audit', { query: withQuery(input) }),
  );
}
