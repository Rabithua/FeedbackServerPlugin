import { FeedbackServerApiClient, FeedbackServerApiError } from './api-client.js';
import { loadCredentials, type StoredCredentials } from './credentials.js';

export type OnboardingStageStatus =
  | 'complete'
  | 'action_required'
  | 'recommended'
  | 'unavailable'
  | 'not_checked';

export interface OnboardingNextAction {
  id:
    | 'create_product'
    | 'select_product'
    | 'select_writable_product'
    | 'activate_product'
    | 'rebind_agent'
    | 'inspect_local_app'
    | 'configure_local_app'
    | 'configure_notification'
    | 'run_roundtrip'
    | 'enable_diagnostics'
    | 'configure_app_store';
  stage: 'connection' | 'product' | 'local_app' | 'notifications' | 'roundtrip' | 'diagnostics' | 'app_store';
  status: 'action_required' | 'recommended';
  priority: number;
  message: string;
  tool?: string | undefined;
}

export interface OnboardingProduct {
  id: string;
  slug: string;
  name: string;
  defaultLocale: string;
  status: string;
  access: 'read_write' | 'read_only';
}

export interface OnboardingSubscription {
  declaredPlan: 'free' | 'solo' | 'studio';
  effectivePlan: 'free' | 'solo' | 'studio';
  lifecycle: 'free' | 'active' | 'grace' | 'expired' | 'perpetual';
  term: 'free' | 'fixed' | 'perpetual';
  expiresAt: string | null;
  graceEndsAt: string | null;
  primaryProductId: string | null;
  revision: number;
  limits: {
    maxProducts: number;
    storageBytes: number;
  };
  features: {
    diagnostics: boolean;
    webhooks: boolean;
    appStoreImport: boolean;
    bark: boolean;
  };
  usage: {
    products: number;
    storage: {
      finalizedBytes: number;
      reservedBytes: number;
      totalBytes: number;
    };
  };
  products: Array<{
    id: string;
    name: string;
    access: 'read_write' | 'read_only';
  }>;
}

export interface OnboardingProductRecord {
  id: string;
  slug: string;
  name: string;
  defaultLocale: string;
  status: string;
  diagnosticsEnabled?: boolean;
  publishableKey?: string;
}

interface OptionalStageError {
  reason: 'missing_scope' | 'query_failed';
  code: string;
}

export interface FeedbackServerOnboardingStatus {
  connection: {
    status: 'complete';
    endpoint: string;
    username: string | null;
  };
  subscription: {
    declaredPlan: OnboardingSubscription['declaredPlan'];
    effectivePlan: OnboardingSubscription['effectivePlan'];
    lifecycle: OnboardingSubscription['lifecycle'];
    expiresAt: string | null;
    graceEndsAt: string | null;
    features: OnboardingSubscription['features'];
  };
  product: {
    status: OnboardingStageStatus;
    count: number;
    requiresExplicitSelection: boolean;
    selected: OnboardingProduct | null;
  };
  localApp: {
    status: OnboardingStageStatus;
    checked: boolean;
  };
  notifications: {
    status: OnboardingStageStatus;
    effective: boolean;
    bark: {
      status: OnboardingStageStatus;
      mode: 'inherit' | 'custom' | 'disabled' | 'unknown';
      configured: boolean | null;
      effective: boolean;
      error?: OptionalStageError;
    };
    webhook: {
      status: OnboardingStageStatus;
      configured: boolean | null;
      enabled: boolean | null;
      effective: boolean;
      configuredButUnavailable: boolean;
      error?: OptionalStageError;
    };
  };
  diagnostics: {
    status: OnboardingStageStatus;
    configured: boolean;
    available: boolean;
    configuredButUnavailable: boolean;
  };
  appStore: {
    status: OnboardingStageStatus;
    configured: boolean | null;
    available: boolean;
    configuredButUnavailable: boolean;
    error?: OptionalStageError;
  };
  roundtrip: {
    status: OnboardingStageStatus;
    checked: boolean;
  };
  coreReady: boolean;
  nextActions: OnboardingNextAction[];
}

export interface OnboardingApiClient {
  request<T>(path: string, options?: { authenticated?: boolean }): Promise<T>;
}

export interface DeriveOnboardingOptions {
  client: OnboardingApiClient;
  endpoint: string;
  username?: string | undefined;
  scopes?: string[] | undefined;
  productId?: string | undefined;
  products?: OnboardingProductRecord[] | undefined;
  subscription?: OnboardingSubscription | undefined;
}

interface GlobalBarkConfig {
  enabled?: boolean;
  serverUrl?: string | null;
  deviceKey?: string | null;
}

interface ProductBarkConfig {
  mode?: 'inherit' | 'custom' | 'disabled';
  serverUrl?: string | null;
  deviceKey?: string | null;
}

interface ProductWebhookConfig {
  enabled?: boolean;
  endpointUrl?: string | null;
  secret?: string | null;
}

type OptionalConfig = GlobalBarkConfig
  & ProductBarkConfig
  & ProductWebhookConfig
  & { appStoreId?: string };

function optionalError(error: unknown): OptionalStageError {
  if (error instanceof FeedbackServerApiError && error.status === 403) {
    return { reason: 'missing_scope', code: error.code };
  }
  return {
    reason: 'query_failed',
    code: error instanceof FeedbackServerApiError ? error.code : 'optional_query_failed',
  };
}

function hasKnownScope(scopes: string[] | undefined, scope: string): boolean | undefined {
  return scopes ? scopes.includes(scope) : undefined;
}

async function optionalRead(
  client: OnboardingApiClient,
  path: string,
  scopes: string[] | undefined,
  requiredScope: string,
): Promise<{ data?: OptionalConfig; error?: OptionalStageError }> {
  if (hasKnownScope(scopes, requiredScope) === false) {
    return { error: { reason: 'missing_scope', code: 'admin_scope_required' } };
  }
  try {
    return { data: await client.request<OptionalConfig>(path) };
  } catch (error) {
    return { error: optionalError(error) };
  }
}

function selectedProduct(
  products: OnboardingProductRecord[],
  subscription: OnboardingSubscription,
  productId: string | undefined,
): {
  status: OnboardingStageStatus;
  selectedRecord?: OnboardingProductRecord;
  selected?: OnboardingProduct;
  requiresExplicitSelection: boolean;
} {
  if (productId) {
    const record = products.find(({ id }) => id === productId);
    if (!record) {
      throw new FeedbackServerApiError(
        404,
        'onboarding_product_not_found',
        'The requested Product is not visible to the connected account',
        null,
      );
    }
    const access = subscription.products.find(({ id }) => id === record.id)?.access;
    if (!access) {
      throw new FeedbackServerApiError(
        404,
        'onboarding_product_not_found',
        'The requested Product has no subscription access record',
        null,
      );
    }
    return {
      status: access === 'read_write' && record.status === 'active'
        ? 'complete'
        : 'action_required',
      selectedRecord: record,
      selected: { ...publicProduct(record), access },
      requiresExplicitSelection: false,
    };
  }
  if (products.length === 0) {
    return { status: 'action_required', requiresExplicitSelection: false };
  }
  if (products.length > 1) {
    return { status: 'action_required', requiresExplicitSelection: true };
  }
  const record = products[0];
  if (!record) {
    throw new Error('Product selection changed while deriving onboarding status');
  }
  const access = subscription.products.find(({ id }) => id === record.id)?.access;
  if (!access) {
    throw new FeedbackServerApiError(
      409,
      'onboarding_product_access_missing',
      'The selected Product has no subscription access record',
      null,
    );
  }
  return {
    status: access === 'read_write' && record.status === 'active'
      ? 'complete'
      : 'action_required',
    selectedRecord: record,
    selected: { ...publicProduct(record), access },
    requiresExplicitSelection: false,
  };
}

function publicProduct(product: OnboardingProductRecord): Omit<OnboardingProduct, 'access'> {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    defaultLocale: product.defaultLocale,
    status: product.status,
  };
}

function nextAction(
  action: OnboardingNextAction,
  actions: OnboardingNextAction[],
): void {
  if (!actions.some(({ id }) => id === action.id)) actions.push(action);
}

export async function deriveOnboardingStatus(
  options: DeriveOnboardingOptions,
): Promise<FeedbackServerOnboardingStatus> {
  const [products, subscription] = await Promise.all([
    options.products
      ? Promise.resolve(options.products)
      : options.client.request<OnboardingProductRecord[]>('/admin/products'),
    options.subscription
      ? Promise.resolve(options.subscription)
      : options.client.request<OnboardingSubscription>('/admin/subscription'),
  ]);
  const product = selectedProduct(products, subscription, options.productId);
  const actions: OnboardingNextAction[] = [];

  if (products.length === 0) {
    nextAction({
      id: 'create_product',
      stage: 'product',
      status: 'action_required',
      priority: 10,
      message: 'Create the first Product with an explicit name, slug, and default language.',
      tool: 'create_product',
    }, actions);
  } else if (product.requiresExplicitSelection) {
    nextAction({
      id: 'select_product',
      stage: 'product',
      status: 'action_required',
      priority: 10,
      message: 'Choose one Product ID explicitly before continuing setup.',
      tool: 'get_onboarding_status',
    }, actions);
  } else if (product.selected?.access === 'read_only') {
    nextAction({
      id: 'select_writable_product',
      stage: 'product',
      status: 'action_required',
      priority: 10,
      message: 'Select a Product with read-write subscription access.',
      tool: 'get_subscription',
    }, actions);
  } else if (product.selected && product.selected.status !== 'active') {
    nextAction({
      id: 'activate_product',
      stage: 'product',
      status: 'action_required',
      priority: 10,
      message: `Activate the selected Product before using it for feedback (current status: ${product.selected.status}).`,
      tool: 'update_product',
    }, actions);
  }

  const coreReady = product.status === 'complete' && Boolean(product.selected);
  const notCheckedBark = {
    status: 'not_checked' as const,
    mode: 'unknown' as const,
    configured: null,
    effective: false,
  };
  const notCheckedWebhook = {
    status: 'not_checked' as const,
    configured: null,
    enabled: null,
    effective: false,
    configuredButUnavailable: false,
  };
  let bark: FeedbackServerOnboardingStatus['notifications']['bark'] = notCheckedBark;
  let webhook: FeedbackServerOnboardingStatus['notifications']['webhook'] = notCheckedWebhook;
  let appStore: FeedbackServerOnboardingStatus['appStore'] = {
    status: 'not_checked',
    configured: null,
    available: subscription.features.appStoreImport,
    configuredButUnavailable: false,
  };

  if (product.selected) {
    const encodedId = encodeURIComponent(product.selected.id);
    const [globalBark, productBark, webhookConfig, appStoreBinding] = await Promise.all([
      optionalRead(options.client, '/admin/bark/global', options.scopes, 'bark:read'),
      optionalRead(
        options.client,
        `/admin/bark/products/${encodedId}`,
        options.scopes,
        'bark:read',
      ),
      optionalRead(
        options.client,
        `/admin/webhooks/products/${encodedId}`,
        options.scopes,
        'webhooks:read',
      ),
      optionalRead(
        options.client,
        `/admin/products/${encodedId}/app-store`,
        options.scopes,
        'products:read',
      ),
    ]);

    const barkError = globalBark.error ?? productBark.error;
    if (barkError) {
      bark = {
        status: 'unavailable',
        mode: 'unknown',
        configured: null,
        effective: false,
        error: barkError,
      };
    } else {
      const mode = productBark.data?.mode ?? 'inherit';
      const configured = mode === 'custom'
        ? Boolean(productBark.data?.serverUrl && productBark.data.deviceKey)
        : mode === 'inherit'
          ? Boolean(globalBark.data?.enabled && globalBark.data.serverUrl && globalBark.data.deviceKey)
          : false;
      const effective = subscription.features.bark && mode !== 'disabled' && configured;
      bark = {
        status: effective ? 'complete' : 'recommended',
        mode,
        configured,
        effective,
      };
    }

    if (webhookConfig.error) {
      webhook = {
        ...notCheckedWebhook,
        status: 'unavailable',
        error: webhookConfig.error,
      };
    } else {
      const configured = Boolean(webhookConfig.data?.endpointUrl && webhookConfig.data.secret);
      const enabled = webhookConfig.data?.enabled === true;
      const configuredButUnavailable = configured && enabled && !subscription.features.webhooks;
      const effective = configured && enabled && subscription.features.webhooks;
      webhook = {
        status: !subscription.features.webhooks
          ? 'unavailable'
          : effective
            ? 'complete'
            : 'recommended',
        configured,
        enabled,
        effective,
        configuredButUnavailable,
      };
    }

    if (appStoreBinding.error) {
      const missingBinding = appStoreBinding.error.code === 'app_store_binding_not_found';
      appStore = missingBinding
        ? {
            status: subscription.features.appStoreImport ? 'recommended' : 'unavailable',
            configured: false,
            available: subscription.features.appStoreImport,
            configuredButUnavailable: false,
          }
        : {
            status: 'unavailable',
            configured: null,
            available: subscription.features.appStoreImport,
            configuredButUnavailable: false,
            error: appStoreBinding.error,
          };
    } else {
      const configured = typeof appStoreBinding.data?.appStoreId === 'string';
      appStore = {
        status: !subscription.features.appStoreImport
          ? 'unavailable'
          : configured
            ? 'complete'
            : 'recommended',
        configured,
        available: subscription.features.appStoreImport,
        configuredButUnavailable: configured && !subscription.features.appStoreImport,
      };
    }
  }

  const notificationsEffective = bark.effective || webhook.effective;
  const notificationsStatus: OnboardingStageStatus = !product.selected
    ? 'not_checked'
    : notificationsEffective
      ? 'complete'
      : bark.status === 'unavailable' && webhook.status === 'unavailable'
        ? 'unavailable'
        : 'recommended';
  const diagnosticsConfigured = product.selectedRecord?.diagnosticsEnabled === true;
  const diagnosticsAvailable = subscription.features.diagnostics;
  const diagnostics: FeedbackServerOnboardingStatus['diagnostics'] = {
    status: !product.selected
      ? 'not_checked'
      : !diagnosticsAvailable
        ? 'unavailable'
        : diagnosticsConfigured
          ? 'complete'
          : 'recommended',
    configured: diagnosticsConfigured,
    available: diagnosticsAvailable,
    configuredButUnavailable: diagnosticsConfigured && !diagnosticsAvailable,
  };

  if (coreReady) {
    nextAction({
      id: 'inspect_local_app',
      stage: 'local_app',
      status: 'recommended',
      priority: 20,
      message: 'Inspect the current workspace and continue only if it clearly contains the matching iOS App.',
    }, actions);
    if (!notificationsEffective) {
      nextAction({
        id: 'configure_notification',
        stage: 'notifications',
        status: 'recommended',
        priority: 30,
        message: 'Choose Bark, Product Webhook, or explicitly defer notification setup.',
      }, actions);
    }
    const missingReadScope = [bark.error, webhook.error, appStore.error]
      .some((error) => error?.reason === 'missing_scope');
    if (missingReadScope) {
      nextAction({
        id: 'rebind_agent',
        stage: 'connection',
        status: 'recommended',
        priority: 25,
        message: 'Rebind the Agent connection to grant the missing read scopes used by setup checks.',
      }, actions);
    }
    nextAction({
      id: 'run_roundtrip',
      stage: 'roundtrip',
      status: 'recommended',
      priority: 40,
      message: 'Optionally run a confirmed end-to-end roundtrip for the selected Product slug.',
    }, actions);
    if (diagnostics.status === 'recommended') {
      nextAction({
        id: 'enable_diagnostics',
        stage: 'diagnostics',
        status: 'recommended',
        priority: 50,
        message: 'Optionally enable Diagnostics after the core feedback path is ready.',
        tool: 'update_product',
      }, actions);
    }
    if (appStore.status === 'recommended') {
      nextAction({
        id: 'configure_app_store',
        stage: 'app_store',
        status: 'recommended',
        priority: 60,
        message: 'Optionally bind the Product to App Store metadata after core setup.',
        tool: 'configure_product_app_store_binding',
      }, actions);
    }
  }

  actions.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return {
    connection: {
      status: 'complete',
      endpoint: options.endpoint,
      username: options.username ?? null,
    },
    subscription: {
      declaredPlan: subscription.declaredPlan,
      effectivePlan: subscription.effectivePlan,
      lifecycle: subscription.lifecycle,
      expiresAt: subscription.expiresAt,
      graceEndsAt: subscription.graceEndsAt,
      features: subscription.features,
    },
    product: {
      status: product.status,
      count: products.length,
      requiresExplicitSelection: product.requiresExplicitSelection,
      selected: product.selected ?? null,
    },
    localApp: { status: 'not_checked', checked: false },
    notifications: {
      status: notificationsStatus,
      effective: notificationsEffective,
      bark,
      webhook,
    },
    diagnostics,
    appStore,
    roundtrip: { status: 'not_checked', checked: false },
    coreReady,
    nextActions: actions,
  };
}

export interface FeedbackServerSetupNotice {
  kind: 'feedback_server_setup';
  message: string;
  prompt: '帮我完成 FeedbackServer 初始配置';
  nextAction: OnboardingNextAction;
}

export interface SetupNoticeProvider {
  takeNotice(): Promise<FeedbackServerSetupNotice | undefined>;
}

function shouldTriggerSetupNotice(status: FeedbackServerOnboardingStatus): boolean {
  if (status.nextActions.some(({ status: actionStatus }) => actionStatus === 'action_required')) {
    return true;
  }
  const missingReadScope = [
    status.notifications.bark.error,
    status.notifications.webhook.error,
    status.appStore.error,
  ].some((error) => error?.reason === 'missing_scope');
  return missingReadScope || (
    status.product.selected !== null
    && !status.notifications.effective
  );
}

class DerivedSetupNoticeProvider implements SetupNoticeProvider {
  private lookup: Promise<FeedbackServerSetupNotice | undefined> | undefined;
  private completed = false;
  private checking = false;

  public constructor(
    private readonly load: () => Promise<StoredCredentials>,
    private readonly createClient: (credentials: StoredCredentials) => OnboardingApiClient,
    private readonly waitMilliseconds: number,
  ) {}

  public async takeNotice(): Promise<FeedbackServerSetupNotice | undefined> {
    if (this.completed || this.checking) return undefined;
    this.checking = true;
    try {
      this.lookup ??= this.resolveNotice();
      const pending = Symbol('pending');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.lookup,
        new Promise<typeof pending>((resolve) => {
          timer = setTimeout(() => {
            resolve(pending);
          }, this.waitMilliseconds);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result === pending) {
        this.completed = true;
        return undefined;
      }
      this.completed = true;
      return result;
    } finally {
      this.checking = false;
    }
  }

  private async resolveNotice(): Promise<FeedbackServerSetupNotice | undefined> {
    try {
      const credentials = await this.load();
      const status = await deriveOnboardingStatus({
        client: this.createClient(credentials),
        endpoint: credentials.baseUrl,
        username: credentials.username,
        scopes: credentials.scopes,
      });
      if (!shouldTriggerSetupNotice(status)) return undefined;
      const nextAction = status.nextActions.find(({ id }) => id !== 'inspect_local_app')
        ?? status.nextActions[0];
      if (!nextAction) return undefined;
      return {
        kind: 'feedback_server_setup',
        message: 'Account connection is complete, but app setup still has a next step.',
        prompt: '帮我完成 FeedbackServer 初始配置',
        nextAction,
      };
    } catch {
      return undefined;
    }
  }
}

export function createSetupNoticeProvider(options: {
  loadCredentials?: () => Promise<StoredCredentials>;
  createClient?: (credentials: StoredCredentials) => OnboardingApiClient;
  waitMilliseconds?: number;
} = {}): SetupNoticeProvider {
  return new DerivedSetupNoticeProvider(
    options.loadCredentials ?? loadCredentials,
    options.createClient ?? ((credentials) => new FeedbackServerApiClient(credentials)),
    options.waitMilliseconds ?? 250,
  );
}
