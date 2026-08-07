import { randomBytes, randomUUID } from 'node:crypto';
import {
  FeedbackServerApiClient,
  FeedbackServerApiError,
  type ApiRequestOptions,
} from './api-client.js';
import { loadCredentials, type StoredCredentials } from './credentials.js';
import type { DoctorProduct } from './doctor.js';
import { PLUGIN_VERSION } from './version.js';

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

interface AdminClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
}

interface ClientRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

export interface RoundTripOptions {
  product: string;
  confirmProductSlug: string;
  locale?: string;
}

export interface RoundTripResult {
  product: Pick<DoctorProduct, 'id' | 'slug' | 'name'>;
  feedbackId: string;
  stages: string[];
  cleanedUp: boolean;
}

export interface RoundTripDependencies {
  loadCredentials: () => Promise<StoredCredentials>;
  createAdminClient: (credentials: StoredCredentials) => AdminClient;
  clientRequest: <T>(
    credentials: StoredCredentials,
    productKey: string,
    visitorCredential: string,
    path: string,
    options?: ClientRequestOptions,
  ) => Promise<T>;
  createVisitorCredential: () => string;
  createRunId: () => string;
}

class ClientApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function clientRequest<T>(
  credentials: StoredCredentials,
  productKey: string,
  visitorCredential: string,
  path: string,
  options: ClientRequestOptions = {},
): Promise<T> {
  const url = new URL(
    `${credentials.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`,
  );
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${visitorCredential}`,
    'User-Agent': `FeedbackServer-RoundTrip/${PLUGIN_VERSION}`,
    'X-Product-Key': productKey,
  });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    throw new ClientApiError(
      503,
      'connection_failed',
      error instanceof Error ? error.message : 'Unable to reach FeedbackServer',
    );
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ClientApiError(response.status, 'invalid_response', 'Server returned non-JSON');
  }
  if (!response.ok || envelope.code !== 'ok') {
    throw new ClientApiError(
      response.status,
      envelope.code || 'request_failed',
      envelope.message || `Request failed with HTTP ${response.status}`,
    );
  }
  return envelope.data;
}

const defaultDependencies: RoundTripDependencies = {
  loadCredentials,
  createAdminClient: (credentials) => new FeedbackServerApiClient(credentials),
  clientRequest,
  createVisitorCredential: () => randomBytes(32).toString('base64url'),
  createRunId: randomUUID,
};

function selectProduct(products: DoctorProduct[], selector: string): DoctorProduct {
  const matches = products.filter(({ id, slug }) => id === selector || slug === selector);
  const product = matches.length === 1 ? matches[0] : undefined;
  if (!product) throw new Error(`No visible Product matches ${selector}`);
  if (product.status !== 'active') {
    throw new Error(`Product ${product.slug} is ${product.status}; round-trip requires active`);
  }
  return product;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runFeedbackRoundTrip(
  options: RoundTripOptions,
  dependencies: RoundTripDependencies = defaultDependencies,
): Promise<RoundTripResult> {
  const credentials = await dependencies.loadCredentials();
  const admin = dependencies.createAdminClient(credentials);
  const products = await admin.request<DoctorProduct[]>('/admin/products');
  const product = selectProduct(products, options.product);
  if (options.confirmProductSlug !== product.slug) {
    throw new Error(
      `--confirm must exactly match the selected Product slug (${product.slug})`,
    );
  }

  const visitorCredential = dependencies.createVisitorCredential();
  const runId = dependencies.createRunId();
  const marker = `FeedbackServer round-trip ${runId}`;
  const replyBody = `Automated round-trip reply ${runId}`;
  const locale = options.locale ?? product.defaultLocale;
  const stages: string[] = [];
  let visitorTouched = false;
  let feedbackId: string | undefined;
  let operationError: unknown;
  let cleanupError: unknown;

  try {
    visitorTouched = true;
    await dependencies.clientRequest(
      credentials,
      product.publishableKey,
      visitorCredential,
      `/client/bootstrap?locale=${encodeURIComponent(locale)}`,
    );
    stages.push('client.bootstrap');

    const created = await dependencies.clientRequest<{ id: string }>(
      credentials,
      product.publishableKey,
      visitorCredential,
      '/client/feedback',
      {
        method: 'POST',
        idempotencyKey: `roundtrip-${runId}`,
        body: {
          type: 'conversation',
          title: marker,
          body: 'Automated FeedbackServer integration acceptance. This Visitor is deleted after the test.',
          clientContext: {
            appVersion: PLUGIN_VERSION,
            buildNumber: PLUGIN_VERSION,
            osVersion: process.platform,
            deviceCategory: 'desktop',
            locale,
          },
          attachmentIds: [],
        },
      },
    );
    feedbackId = created.id;
    stages.push('client.feedback.created');

    const listed = await admin.request<{
      feedback: Array<{ feedback: { id: string; title: string | null } }>;
    }>('/admin/feedback', {
      query: { productId: product.id, search: marker, limit: 10 },
    });
    assert(
      listed.feedback.some(({ feedback }) => feedback.id === feedbackId),
      'Administrator list did not receive the submitted Feedback',
    );
    stages.push('admin.feedback.received');

    const context = await admin.request<{ precondition: string }>(
      `/admin/feedback/${encodeURIComponent(feedbackId)}/update-context`,
    );
    await admin.request(`/admin/feedback/${encodeURIComponent(feedbackId)}/replies`, {
      method: 'POST',
      body: { body: replyBody },
      ifMatch: context.precondition,
    });
    stages.push('admin.reply.created');

    const unread = await dependencies.clientRequest<{
      inbox: {
        events: Array<{ type: string; feedbackId: string }>;
        nextCursor: number;
        unreadCount: number;
      };
    }>(
      credentials,
      product.publishableKey,
      visitorCredential,
      `/client/bootstrap?locale=${encodeURIComponent(locale)}`,
    );
    assert(unread.inbox.unreadCount > 0, 'Client inbox did not become unread after reply');
    assert(
      unread.inbox.events.some(
        (event) => event.type === 'admin.reply' && event.feedbackId === feedbackId,
      ),
      'Client inbox did not contain the administrator reply event',
    );
    stages.push('client.inbox.unread');

    const detail = await dependencies.clientRequest<{
      messages: Array<{ actor: string; body: string }>;
    }>(
      credentials,
      product.publishableKey,
      visitorCredential,
      `/client/feedback/${encodeURIComponent(feedbackId)}`,
    );
    assert(
      detail.messages.some(({ actor, body }) => actor === 'admin' && body === replyBody),
      'Client Feedback detail did not contain the administrator reply',
    );
    stages.push('client.reply.visible');

    await dependencies.clientRequest(
      credentials,
      product.publishableKey,
      visitorCredential,
      '/client/inbox/ack',
      { method: 'POST', body: { cursor: unread.inbox.nextCursor } },
    );
    const acknowledged = await dependencies.clientRequest<{ inbox: { unreadCount: number } }>(
      credentials,
      product.publishableKey,
      visitorCredential,
      `/client/bootstrap?after=${unread.inbox.nextCursor}&locale=${encodeURIComponent(locale)}`,
    );
    assert(acknowledged.inbox.unreadCount === 0, 'Client inbox remained unread after ack');
    stages.push('client.inbox.acknowledged');
  } catch (error) {
    operationError = error;
  }

  if (visitorTouched) {
    try {
      await dependencies.clientRequest(
        credentials,
        product.publishableKey,
        visitorCredential,
        '/client/me',
        { method: 'DELETE' },
      );
      stages.push('client.visitor.cleaned');
      if (feedbackId) {
        try {
          await admin.request(`/admin/feedback/${encodeURIComponent(feedbackId)}`);
          throw new Error('Feedback still exists after Visitor cleanup');
        } catch (error) {
          if (!(error instanceof FeedbackServerApiError) || error.status !== 404) throw error;
        }
        stages.push('admin.cleanup.verified');
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      'Feedback round-trip failed and automatic Visitor cleanup also failed',
    );
  }
  if (operationError) throw asError(operationError);
  if (cleanupError) throw asError(cleanupError);
  assert(feedbackId, 'Feedback round-trip did not create Feedback');
  return {
    product: { id: product.id, slug: product.slug, name: product.name },
    feedbackId,
    stages,
    cleanedUp: true,
  };
}
