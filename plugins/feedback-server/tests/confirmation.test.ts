import { describe, expect, test } from 'bun:test';
import {
  CONFIRMATION_TTL_MS,
  ConfirmationStore,
  redactPreview,
} from '../src/confirmation.js';

async function capturedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('confirmation store', () => {
  test('binds a single-use confirmation to the exact action, payload, and identity', () => {
    const store = new ConfirmationStore();
    const prepared = store.prepare(
      'update_product',
      { productId: 'one', fields: { name: 'Next' } },
      { baseUrl: 'https://example.test', tokenIdentity: 'actor' },
      1_000,
    );
    expect(() => {
      store.consume(
        prepared.confirmationId,
        'update_product',
        { fields: { name: 'Changed' }, productId: 'one' },
        { baseUrl: 'https://example.test', tokenIdentity: 'actor' },
        2_000,
      );
    }).toThrow('does not match');
    store.consume(
      prepared.confirmationId,
      'update_product',
      { fields: { name: 'Next' }, productId: 'one' },
      { tokenIdentity: 'actor', baseUrl: 'https://example.test' },
      2_000,
    );
    expect(() => {
      store.consume(
        prepared.confirmationId,
        'update_product',
        { productId: 'one', fields: { name: 'Next' } },
        { baseUrl: 'https://example.test', tokenIdentity: 'actor' },
        2_000,
      );
    }).toThrow('already used');
    expect(() => {
      new ConfirmationStore().consume(
        prepared.confirmationId,
        'update_product',
        { productId: 'one', fields: { name: 'Next' } },
        { baseUrl: 'https://example.test', tokenIdentity: 'actor' },
        2_000,
      );
    }).toThrow('missing');
  });

  test('expires and redacts sensitive preview fields', () => {
    const store = new ConfirmationStore();
    const prepared = store.prepare('bark', {}, {}, 1_000);
    expect(() => {
      store.consume(
        prepared.confirmationId,
        'bark',
        {},
        {},
        1_000 + CONFIRMATION_TTL_MS,
      );
    }).toThrow('expired');
    expect(
      redactPreview({
        serverUrl: 'https://api.day.app',
        deviceKey: 'private',
        nested: { accessToken: 'private', title: 'Visible' },
      }),
    ).toEqual({
      serverUrl: 'https://api.day.app',
      deviceKey: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', title: 'Visible' },
    });
  });

  test('returns the stored execution context only for an exact confirmation', () => {
    const store = new ConfirmationStore();
    const context = { precondition: '"state-at-preview"' };
    const prepared = store.prepare('update_item', { itemId: 'one' }, {}, 1_000, context);
    expect(
      store.consume(
        prepared.confirmationId,
        'update_item',
        { itemId: 'one' },
        {},
        2_000,
      ),
    ).toEqual(context);
  });

  test('executes a stored payload generically once and binds it to profile and endpoint', async () => {
    const store = new ConfirmationStore();
    let executions = 0;
    const identity = {
      baseUrl: 'https://example.test/v1/api',
      tokenIdentity: 'actor',
      activeProfile: 'work',
    };
    const prepared = store.prepare(
      'delete_item',
      { itemId: 'one' },
      identity,
      1_000,
      { precondition: 'state-at-preview' },
      (payload, executionContext, runtimeContext) => {
        executions += 1;
        return Promise.resolve({ payload, executionContext, runtimeContext });
      },
    );

    expect(await capturedError(store.execute(
      prepared.confirmationId,
      { ...identity, activeProfile: 'personal' },
      {},
      2_000,
    ))).toMatchObject({ message: expect.stringContaining('active account, profile, or endpoint') });
    const executed = await store.execute(
      prepared.confirmationId,
      identity,
      { client: 'current' },
      2_000,
    );
    expect(executed).toEqual({
      payload: { itemId: 'one' },
      executionContext: { precondition: 'state-at-preview' },
      runtimeContext: { client: 'current' },
    });
    expect(executions).toBe(1);
    expect(await capturedError(store.execute(prepared.confirmationId, identity, {}, 2_000)))
      .toMatchObject({ message: expect.stringContaining('already used') });
  });

  test('expires generic confirmations and consumes them before a failed handler', async () => {
    const identity = { baseUrl: 'https://example.test', tokenIdentity: 'actor' };
    const expiredStore = new ConfirmationStore();
    const expired = expiredStore.prepare(
      'delete_item',
      { itemId: 'one' },
      identity,
      1_000,
      undefined,
      () => Promise.resolve(null),
    );
    expect(await capturedError(expiredStore.execute(
      expired.confirmationId,
      identity,
      {},
      1_000 + CONFIRMATION_TTL_MS,
    ))).toMatchObject({ message: expect.stringContaining('expired') });

    const failedStore = new ConfirmationStore();
    const failed = failedStore.prepare(
      'delete_item',
      { itemId: 'one' },
      identity,
      1_000,
      undefined,
      () => Promise.reject(new Error('stale precondition')),
    );
    expect(await capturedError(failedStore.execute(failed.confirmationId, identity, {}, 2_000)))
      .toMatchObject({ message: 'stale precondition' });
    expect(await capturedError(failedStore.execute(failed.confirmationId, identity, {}, 2_000)))
      .toMatchObject({ message: expect.stringContaining('already used') });
  });
});
