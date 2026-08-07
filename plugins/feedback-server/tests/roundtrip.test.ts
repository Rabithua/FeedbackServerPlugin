import { describe, expect, test } from 'bun:test';
import { FeedbackServerApiError } from '../src/api-client.js';
import type { StoredCredentials } from '../src/credentials.js';
import type { DoctorProduct } from '../src/doctor.js';
import {
  runFeedbackRoundTrip,
  type RoundTripDependencies,
} from '../src/roundtrip.js';

const credentials: StoredCredentials = {
  baseUrl: 'https://feedback.example.com/v1/api',
  token: `fspat_${'a'.repeat(64)}`,
};
const product: DoctorProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'acceptance-app',
  name: 'Acceptance App',
  publishableKey: 'pk_acceptance',
  defaultLocale: 'en',
  status: 'active',
};
const feedbackId = '22222222-2222-4222-8222-222222222222';

function dependencies(options: { failBootstrap?: boolean; failCreate?: boolean } = {}): {
  value: RoundTripDependencies;
  clientPaths: string[];
} {
  const clientPaths: string[] = [];
  let bootstrapCount = 0;
  const value: RoundTripDependencies = {
    loadCredentials: () => Promise.resolve(credentials),
    createAdminClient: () => ({
      request: <T>(path: string) => {
        if (path === '/admin/products') return Promise.resolve([product] as T);
        if (path === '/admin/feedback') {
          return Promise.resolve({ feedback: [{ feedback: { id: feedbackId } }] } as T);
        }
        if (path.endsWith('/update-context')) {
          return Promise.resolve({ precondition: 'feedback-precondition' } as T);
        }
        if (path.endsWith('/replies')) return Promise.resolve({ id: 'message-id' } as T);
        if (path === `/admin/feedback/${feedbackId}`) {
          return Promise.reject(new FeedbackServerApiError(404, 'not_found', 'Not found', null));
        }
        return Promise.reject(new Error(`Unexpected admin path ${path}`));
      },
    }),
    clientRequest: <T>(
      _credentials: StoredCredentials,
      _productKey: string,
      _visitorCredential: string,
      path: string,
    ) => {
      clientPaths.push(path);
      if (path.startsWith('/client/bootstrap')) {
        bootstrapCount += 1;
        if (bootstrapCount === 1 && options.failBootstrap) {
          return Promise.reject(new Error('bootstrap response lost'));
        }
        if (bootstrapCount === 1) return Promise.resolve({ inbox: { unreadCount: 0 } } as T);
        if (bootstrapCount === 2) {
          return Promise.resolve({
            inbox: {
              events: [{ type: 'admin.reply', feedbackId }],
              nextCursor: 7,
              unreadCount: 1,
            },
          } as T);
        }
        return Promise.resolve({ inbox: { unreadCount: 0 } } as T);
      }
      if (path === '/client/feedback') {
        return options.failCreate
          ? Promise.reject(new Error('create failed'))
          : Promise.resolve({ id: feedbackId } as T);
      }
      if (path === `/client/feedback/${feedbackId}`) {
        return Promise.resolve({
          messages: [{ actor: 'admin', body: 'Automated round-trip reply run-id' }],
        } as T);
      }
      if (path === '/client/inbox/ack' || path === '/client/me') {
        return Promise.resolve(null as T);
      }
      return Promise.reject(new Error(`Unexpected client path ${path}`));
    },
    createVisitorCredential: () => 'visitor-credential',
    createRunId: () => 'run-id',
  };
  return { value, clientPaths };
}

describe('Feedback round-trip acceptance', () => {
  test('covers submit, receive, reply, unread, read, and cleanup', async () => {
    const setup = dependencies();
    const result = await runFeedbackRoundTrip({
      product: product.slug,
      confirmProductSlug: product.slug,
    }, setup.value);
    expect(result.cleanedUp).toBe(true);
    expect(result.stages).toEqual([
      'client.bootstrap',
      'client.feedback.created',
      'admin.feedback.received',
      'admin.reply.created',
      'client.inbox.unread',
      'client.reply.visible',
      'client.inbox.acknowledged',
      'client.visitor.cleaned',
      'admin.cleanup.verified',
    ]);
    expect(setup.clientPaths.at(-1)).toBe('/client/me');
    expect(JSON.stringify(result)).not.toContain(product.publishableKey);
  });

  test('requires the Product slug to be repeated before writing', async () => {
    const setup = dependencies();
    let error: unknown;
    try {
      await runFeedbackRoundTrip({
        product: product.id,
        confirmProductSlug: 'wrong-app',
      }, setup.value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('must exactly match');
    expect(setup.clientPaths).toEqual([]);
  });

  test('cleans the Visitor after a mid-flow failure', async () => {
    const setup = dependencies({ failCreate: true });
    let error: unknown;
    try {
      await runFeedbackRoundTrip({
        product: product.slug,
        confirmProductSlug: product.slug,
      }, setup.value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('create failed');
    expect(setup.clientPaths.at(-1)).toBe('/client/me');
  });

  test('attempts cleanup when bootstrap may have committed before losing its response', async () => {
    const setup = dependencies({ failBootstrap: true });
    let error: unknown;
    try {
      await runFeedbackRoundTrip({
        product: product.slug,
        confirmProductSlug: product.slug,
      }, setup.value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('bootstrap response lost');
    expect(setup.clientPaths).toEqual([
      '/client/bootstrap?locale=en',
      '/client/me',
    ]);
  });
});
