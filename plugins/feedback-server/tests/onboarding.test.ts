import { describe, expect, test } from 'bun:test';
import { FeedbackServerApiError } from '../src/api-client.js';
import {
  createSetupNoticeProvider,
  deriveOnboardingStatus,
  type OnboardingApiClient,
  type OnboardingProductRecord,
  type OnboardingSubscription,
} from '../src/onboarding.js';
import type { StoredCredentials } from '../src/credentials.js';

const productId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const secretDeviceKey = 'bark-device-secret-value';
const secretWebhookKey = 'webhook-signing-secret-value';

const product: OnboardingProductRecord = {
  id: productId,
  slug: 'ios-app',
  name: 'iOS App',
  defaultLocale: 'zh-Hans',
  status: 'active',
  diagnosticsEnabled: false,
  publishableKey: 'pk_private_from_onboarding_output',
};

function subscription(
  plan: 'free' | 'solo' | 'studio' = 'studio',
  access: 'read_write' | 'read_only' = 'read_write',
): OnboardingSubscription {
  const paid = plan !== 'free';
  return {
    declaredPlan: plan,
    effectivePlan: plan,
    lifecycle: plan === 'free' ? 'free' : 'active',
    term: plan === 'free' ? 'free' : 'fixed',
    expiresAt: paid ? '2026-12-01T00:00:00.000Z' : null,
    graceEndsAt: paid ? '2026-12-08T00:00:00.000Z' : null,
    primaryProductId: productId,
    revision: 1,
    limits: {
      maxProducts: plan === 'studio' ? 10 : 1,
      storageBytes: plan === 'free' ? 250 * 1024 * 1024 : 2 * 1024 * 1024 * 1024,
    },
    features: {
      diagnostics: paid,
      webhooks: paid,
      appStoreImport: paid,
      bark: true,
    },
    usage: {
      products: 1,
      storage: { finalizedBytes: 0, reservedBytes: 0, totalBytes: 0 },
    },
    products: [{ id: productId, name: product.name, access }],
  };
}

function client(routes: Record<string, unknown>): OnboardingApiClient {
  return {
    request: <T>(path: string) => {
      const value = routes[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as T);
    },
  };
}

function completeOptionalRoutes(overrides: Record<string, unknown> = {}) {
  return {
    '/admin/bark/global': {
      enabled: true,
      serverUrl: 'https://api.day.app',
      deviceKey: secretDeviceKey,
    },
    [`/admin/bark/products/${productId}`]: {
      mode: 'inherit',
      serverUrl: null,
      deviceKey: null,
    },
    [`/admin/webhooks/products/${productId}`]: {
      enabled: true,
      endpointUrl: 'https://hooks.example.com/feedback',
      secret: secretWebhookKey,
    },
    [`/admin/products/${productId}/app-store`]: {
      appStoreId: '1234567890',
      storefront: 'US',
      locale: 'en-US',
    },
    ...overrides,
  };
}

const baseOptions = {
  endpoint: 'https://feedback.example.com/v1/api',
  username: 'owner',
  scopes: ['products:read', 'bark:read', 'webhooks:read'],
};

describe('guided onboarding status', () => {
  test('requires Product creation for an empty account', async () => {
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client({}),
      products: [],
      subscription: { ...subscription(), products: [], usage: {
        products: 0,
        storage: { finalizedBytes: 0, reservedBytes: 0, totalBytes: 0 },
      } },
    });

    expect(status.product).toMatchObject({
      status: 'action_required',
      count: 0,
      selected: null,
      requiresExplicitSelection: false,
    });
    expect(status.coreReady).toBe(false);
    expect(status.nextActions.map(({ id }) => id)).toEqual(['create_product']);
  });

  test('auto-selects one Product and never serializes Product or notification secrets', async () => {
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client(completeOptionalRoutes()),
      products: [product],
      subscription: subscription(),
    });

    expect(status.product).toMatchObject({
      status: 'complete',
      count: 1,
      selected: { id: productId, slug: 'ios-app', access: 'read_write' },
    });
    expect(status.notifications).toMatchObject({
      status: 'complete',
      effective: true,
      bark: { status: 'complete', mode: 'inherit', effective: true },
      webhook: { status: 'complete', configured: true, effective: true },
    });
    expect(status.appStore.status).toBe('complete');
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(product.publishableKey);
    expect(serialized).not.toContain(secretDeviceKey);
    expect(serialized).not.toContain(secretWebhookKey);
  });

  test('requires an explicit Product ID when multiple Products are visible', async () => {
    const second = { ...product, id: secondId, slug: 'second', name: 'Second App' };
    const studio = subscription();
    studio.products.push({ id: secondId, name: second.name, access: 'read_write' });
    studio.usage.products = 2;
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client({}),
      products: [product, second],
      subscription: studio,
    });

    expect(status.product).toMatchObject({
      status: 'action_required',
      requiresExplicitSelection: true,
      selected: null,
    });
    expect(status.nextActions[0]?.id).toBe('select_product');
  });

  test('rejects an invalid or cross-tenant Product ID', async () => {
    let rejection: unknown;
    try {
      await deriveOnboardingStatus({
        ...baseOptions,
        client: client({}),
        productId: secondId,
        products: [product],
        subscription: subscription(),
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toMatchObject({ status: 404, code: 'onboarding_product_not_found' });
  });

  test('marks a selected read-only Product as blocking core readiness', async () => {
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client(completeOptionalRoutes()),
      productId,
      products: [product],
      subscription: subscription('studio', 'read_only'),
    });

    expect(status.product.selected?.access).toBe('read_only');
    expect(status.product.status).toBe('action_required');
    expect(status.coreReady).toBe(false);
    expect(status.nextActions[0]?.id).toBe('select_writable_product');
  });

  test('does not call an inactive Product core-ready', async () => {
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client(completeOptionalRoutes()),
      products: [{ ...product, status: 'inactive' }],
      subscription: subscription(),
    });

    expect(status.product.status).toBe('action_required');
    expect(status.coreReady).toBe(false);
    expect(status.nextActions[0]).toMatchObject({ id: 'activate_product', tool: 'update_product' });
  });

  test('distinguishes retained advanced configuration from effective Free capabilities', async () => {
    const retainedProduct = { ...product, diagnosticsEnabled: true };
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client(completeOptionalRoutes({
        '/admin/bark/global': { enabled: false, serverUrl: 'https://api.day.app', deviceKey: null },
        [`/admin/bark/products/${productId}`]: { mode: 'disabled' },
      })),
      products: [retainedProduct],
      subscription: subscription('free'),
    });

    expect(status.subscription.features).toEqual({
      diagnostics: false,
      webhooks: false,
      appStoreImport: false,
      bark: true,
    });
    expect(status.diagnostics).toMatchObject({
      status: 'unavailable',
      configured: true,
      configuredButUnavailable: true,
    });
    expect(status.notifications.webhook).toMatchObject({
      status: 'unavailable',
      configured: true,
      configuredButUnavailable: true,
      effective: false,
    });
    expect(status.appStore).toMatchObject({
      status: 'unavailable',
      configured: true,
      configuredButUnavailable: true,
    });
  });

  test('computes Bark inherit, custom, and disabled modes', async () => {
    for (const [mode, productConfig, expected] of [
      ['inherit', { mode: 'inherit' }, true],
      ['custom', { mode: 'custom', serverUrl: 'https://bark.example.com', deviceKey: secretDeviceKey }, true],
      ['disabled', { mode: 'disabled' }, false],
    ] as const) {
      const status = await deriveOnboardingStatus({
        ...baseOptions,
        client: client(completeOptionalRoutes({
          [`/admin/bark/products/${productId}`]: productConfig,
        })),
        products: [product],
        subscription: subscription('solo'),
      });
      expect(status.notifications.bark.mode, mode).toBe(mode);
      expect(status.notifications.bark.effective, mode).toBe(expected);
    }
  });

  test('marks incomplete Webhooks and missing App Store bindings as recommendations', async () => {
    const notFound = new FeedbackServerApiError(
      404,
      'app_store_binding_not_found',
      'not found',
      null,
    );
    const status = await deriveOnboardingStatus({
      ...baseOptions,
      client: client(completeOptionalRoutes({
        [`/admin/webhooks/products/${productId}`]: {
          enabled: true,
          endpointUrl: 'https://hooks.example.com/feedback',
          secret: null,
        },
        [`/admin/products/${productId}/app-store`]: notFound,
      })),
      products: [product],
      subscription: subscription('studio'),
    });

    expect(status.notifications.webhook).toMatchObject({
      status: 'recommended',
      configured: false,
      effective: false,
    });
    expect(status.appStore).toMatchObject({ status: 'recommended', configured: false });
  });

  test('contains optional 403 and query failures without breaking core status', async () => {
    const forbidden = new FeedbackServerApiError(403, 'admin_scope_required', 'missing scope', null);
    const failed = new FeedbackServerApiError(503, 'connection_failed', 'unavailable', null);
    const status = await deriveOnboardingStatus({
      endpoint: baseOptions.endpoint,
      username: baseOptions.username,
      client: client(completeOptionalRoutes({
        '/admin/bark/global': forbidden,
        [`/admin/bark/products/${productId}`]: forbidden,
        [`/admin/webhooks/products/${productId}`]: failed,
        [`/admin/products/${productId}/app-store`]: forbidden,
      })),
      products: [product],
      subscription: subscription(),
    });

    expect(status.coreReady).toBe(true);
    expect(status.notifications.bark).toMatchObject({
      status: 'unavailable',
      error: { reason: 'missing_scope', code: 'admin_scope_required' },
    });
    expect(status.notifications.webhook).toMatchObject({
      status: 'unavailable',
      error: { reason: 'query_failed', code: 'connection_failed' },
    });
    expect(status.appStore.error?.reason).toBe('missing_scope');
    expect(status.nextActions.some(({ id }) => id === 'rebind_agent')).toBe(true);
  });
});

describe('setup notice', () => {
  const credentials: StoredCredentials = {
    baseUrl: baseOptions.endpoint,
    token: `fspat_${'a'.repeat(64)}`,
    username: baseOptions.username,
    scopes: baseOptions.scopes,
  };

  test('returns at most one non-secret notice when notification setup is missing', async () => {
    const provider = createSetupNoticeProvider({
      loadCredentials: () => Promise.resolve(credentials),
      createClient: () => client({
        '/admin/products': [product],
        '/admin/subscription': subscription(),
        ...completeOptionalRoutes({
          '/admin/bark/global': { enabled: false, serverUrl: 'https://api.day.app', deviceKey: null },
          [`/admin/bark/products/${productId}`]: { mode: 'inherit' },
          [`/admin/webhooks/products/${productId}`]: {
            enabled: false,
            endpointUrl: null,
            secret: null,
          },
        }),
      }),
    });

    const first = await provider.takeNotice();
    expect(first).toMatchObject({
      kind: 'feedback_server_setup',
      prompt: '帮我完成 FeedbackServer 初始配置',
      nextAction: { id: 'configure_notification' },
    });
    expect(await provider.takeNotice()).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain(secretDeviceKey);
    expect(JSON.stringify(first)).not.toContain(secretWebhookKey);
  });

  test('does not duplicate a notice across concurrent successful tool results', async () => {
    const provider = createSetupNoticeProvider({
      loadCredentials: () => Promise.resolve(credentials),
      createClient: () => client({
        '/admin/products': [],
        '/admin/subscription': { ...subscription(), products: [] },
      }),
    });
    const notices = await Promise.all([provider.takeNotice(), provider.takeNotice()]);
    expect(notices.filter(Boolean)).toHaveLength(1);
    expect(await provider.takeNotice()).toBeUndefined();
  });

  test('delivers a prefetched notice after a slow lookup without repeatedly delaying tools', async () => {
    let resolveProducts: ((products: OnboardingProductRecord[]) => void) | undefined;
    const products = new Promise<OnboardingProductRecord[]>((resolve) => {
      resolveProducts = resolve;
    });
    const provider = createSetupNoticeProvider({
      loadCredentials: () => Promise.resolve(credentials),
      createClient: () => ({
        request: <T>(path: string) => path === '/admin/products'
          ? products as Promise<T>
          : Promise.resolve({ ...subscription(), products: [] } as T),
      }),
      waitMilliseconds: 100,
    });

    expect(await provider.takeNotice()).toBeUndefined();
    const secondStartedAt = performance.now();
    expect(await provider.takeNotice()).toBeUndefined();
    expect(performance.now() - secondStartedAt).toBeLessThan(50);

    resolveProducts?.([]);
    await Bun.sleep(1);
    expect(await provider.takeNotice()).toMatchObject({
      kind: 'feedback_server_setup',
      nextAction: { id: 'create_product' },
    });
    expect(await provider.takeNotice()).toBeUndefined();
  });

  test('does not trigger only for unchecked local App or roundtrip stages', async () => {
    const provider = createSetupNoticeProvider({
      loadCredentials: () => Promise.resolve(credentials),
      createClient: () => client({
        '/admin/products': [product],
        '/admin/subscription': subscription(),
        ...completeOptionalRoutes(),
      }),
    });
    expect(await provider.takeNotice()).toBeUndefined();
  });

  test('silently skips a failed status check and does not retry in the same process', async () => {
    let loads = 0;
    const provider = createSetupNoticeProvider({
      loadCredentials: () => {
        loads += 1;
        return Promise.reject(new Error('Keychain unavailable'));
      },
    });
    expect(await provider.takeNotice()).toBeUndefined();
    expect(await provider.takeNotice()).toBeUndefined();
    expect(loads).toBe(1);
  });
});
