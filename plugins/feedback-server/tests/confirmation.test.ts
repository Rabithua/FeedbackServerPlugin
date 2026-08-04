import { describe, expect, test } from 'bun:test';
import {
  CONFIRMATION_TTL_MS,
  ConfirmationStore,
  redactPreview,
} from '../src/confirmation.js';

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
});
