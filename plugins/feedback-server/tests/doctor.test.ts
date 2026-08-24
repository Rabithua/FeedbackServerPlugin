import { describe, expect, test } from 'bun:test';
import {
  diagnoseFeedbackServer,
  formatDoctorReport,
  inspectHostAppFiles,
  type DoctorDependencies,
  type DoctorProduct,
  type DoctorSubscription,
} from '../src/doctor.js';
import type { StoredCredentials } from '../src/credentials.js';
import { DEFAULT_BASE_URL, KEYCHAIN_SERVICE } from '../src/credentials.js';

const credentials: StoredCredentials = {
  baseUrl: 'https://feedback.example.com/v1/api',
  token: `fspat_${'a'.repeat(64)}`,
  username: 'owner',
  scopes: [
    'products:read',
    'feedback:read',
    'feedback:write',
    'waitlist:read',
    'waitlist:write',
    'waitlist:dangerous',
  ],
  expiresAt: '2027-08-07T00:00:00.000Z',
};

const product: DoctorProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'danci-ios',
  name: '单词',
  publishableKey: 'pk_danci_public_identifier',
  defaultLocale: 'zh-Hans',
  status: 'active',
};

const subscription: DoctorSubscription = {
  declaredPlan: 'studio',
  effectivePlan: 'studio',
  lifecycle: 'perpetual',
  term: 'perpetual',
  expiresAt: null,
  graceEndsAt: null,
  primaryProductId: product.id,
  revision: 1,
  limits: { maxProducts: 10, storageBytes: 25 * 1024 * 1024 * 1024 },
  features: { diagnostics: true, webhooks: true, appStoreImport: true, bark: true },
  usage: {
    products: 1,
    storage: {
      finalizedBytes: 1024 * 1024,
      reservedBytes: 256 * 1024,
      totalBytes: 1280 * 1024,
    },
  },
  products: [{ id: product.id, name: product.name, access: 'read_write' }],
};

function dependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    loadCredentials: () => Promise.resolve(credentials),
    readPendingRevocations: () => Promise.resolve([]),
    createClient: () => ({
      request: <T>(path: string) => Promise.resolve(
        (path === '/admin/products'
          ? [product]
          : path === '/admin/subscription'
            ? subscription
            : { database: 'ok' }) as T,
      ),
    }),
    readHostAppFiles: () => Promise.resolve([]),
    fetchLatestFeedbackKitRelease: () => Promise.resolve({
      version: '0.1.33',
      url: 'https://github.com/Rabithua/FeedbackKit/releases/tag/0.1.33',
    }),
    now: () => Date.parse('2026-08-07T00:00:00.000Z'),
    ...overrides,
  };
}

describe('feedback-server doctor', () => {
  test('checks the live account and auto-selects its only Product', async () => {
    const report = await diagnoseFeedbackServer({}, dependencies());
    expect(report.ok).toBe(true);
    expect(report.product?.slug).toBe('danci-ios');
    expect(report.checks.map(({ id }) => id)).toEqual([
      'plugin',
      'credentials',
      'scopes',
      'expiry',
      'pending-revocations',
      'health',
      'subscription',
      'subscription.usage',
      'subscription.product-access',
      'product',
    ]);
    expect(report.subscription).toEqual(subscription);
    expect(report.onboarding).toMatchObject({
      coreReady: true,
      product: { selected: { id: product.id, access: 'read_write' } },
    });
    expect(report.nextActions.map(({ id }) => id)).toContain('configure_notification');
    expect(formatDoctorReport(report)).toContain('Studio; perpetual; no expiry.');
    expect(formatDoctorReport(report)).toContain('Next actions:');
    expect(formatDoctorReport(report)).not.toContain(credentials.token);
    expect(JSON.stringify(report)).not.toContain(product.publishableKey);
  });

  test('warns about grace, near quota, and read-only Products', async () => {
    const constrained: DoctorSubscription = {
      ...subscription,
      declaredPlan: 'solo',
      effectivePlan: 'solo',
      lifecycle: 'grace',
      term: 'fixed',
      expiresAt: '2026-08-01T00:00:00.000Z',
      graceEndsAt: '2026-08-08T00:00:00.000Z',
      limits: { maxProducts: 1, storageBytes: 2 * 1024 * 1024 * 1024 },
      usage: {
        products: 2,
        storage: {
          finalizedBytes: 1_800_000_000,
          reservedBytes: 100_000_000,
          totalBytes: 1_900_000_000,
        },
      },
      products: [
        { id: product.id, name: product.name, access: 'read_write' },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Read-only App',
          access: 'read_only',
        },
      ],
    };
    const report = await diagnoseFeedbackServer({}, dependencies({
      createClient: () => ({
        request: <T>(path: string) => Promise.resolve(
          (path === '/admin/products'
            ? [product]
            : path === '/admin/subscription'
              ? constrained
              : { database: 'ok' }) as T,
        ),
      }),
    }));

    expect(report.ok).toBe(true);
    expect(report.checks.find(({ id }) => id === 'subscription')).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('grace ends 2026-08-08'),
    });
    expect(report.checks.find(({ id }) => id === 'subscription.usage')?.status).toBe('warn');
    expect(report.checks.find(({ id }) => id === 'subscription.product-access')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('Read-only App'),
    });
  });

  test('fails safely when Agent credentials cannot be loaded', async () => {
    const report = await diagnoseFeedbackServer({}, dependencies({
      loadCredentials: () => Promise.reject(new Error('Agent is not configured')),
    }));
    expect(report.ok).toBe(false);
    expect(report.endpoint).toBeNull();
    expect(report.checks.at(-1)).toMatchObject({ id: 'credentials', status: 'fail' });
  });

  test('audits an iOS host without exposing its Product key', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{
            identity: 'feedbackkit',
            location: 'https://github.com/Rabithua/FeedbackKit',
            state: { version: '0.1.29' },
          }],
        }),
      },
      {
        path: '/App/FeedbackCenter.swift',
        content: `
          let configuration = FeedbackCenterConfiguration(
            baseURL: URL(string: "https://feedback.example.com/v1/api")!,
            productKey: "pk_danci_public_identifier",
            keychainService: "com.example.danci.feedback.visitor",
            languagePolicy: .fixed(Locale(identifier: "zh-Hans"))
          )
        `,
      },
    ], credentials, product);
    expect(checks.every(({ status }) => status === 'pass')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(product.publishableKey);
  });

  test('accepts the FeedbackKit 0.2 README-minimal defaults', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.2.0' } }],
        }),
      },
      {
        path: '/App/Info.plist',
        content: `<key>FeedbackProductKey</key><string>${product.publishableKey}</string>`,
      },
    ], { ...credentials, baseUrl: DEFAULT_BASE_URL }, product);
    expect(checks.every(({ status }) => status === 'pass')).toBe(true);
    expect(checks.find(({ id }) => id === 'app.url')?.message).toContain('fixed production');
    expect(checks.find(({ id }) => id === 'app.keychain-service')?.message)
      .toContain('bundle identifier');
    expect(checks.find(({ id }) => id === 'app.language')?.message)
      .toContain('host App language by default');
  });

  test('warns for an unresolved dynamic Product key without rejecting 0.2 defaults', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.2.0' } }],
        }),
      },
      {
        path: '/App/Info.plist',
        content: '<key>FeedbackProductKey</key><string>$(FEEDBACK_PRODUCT_KEY)</string>',
      },
    ], { ...credentials, baseUrl: DEFAULT_BASE_URL }, product);
    expect(checks.find(({ id }) => id === 'app.product-key')?.status).toBe('warn');
    expect(checks.filter(({ status }) => status === 'fail')).toEqual([]);
  });

  test('rejects a conflicting 0.2 endpoint and the Agent credential Keychain service', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.2.0' } }],
        }),
      },
      {
        path: '/App/FeedbackCenter.swift',
        content: `
          let configuration = try FeedbackConfiguration(
            baseURL: URL(string: "https://other.example.com/v1/api")!,
            productKey: "${product.publishableKey}",
            keychainService: "${KEYCHAIN_SERVICE}"
          )
        `,
      },
    ], { ...credentials, baseUrl: DEFAULT_BASE_URL }, product);
    expect(checks.find(({ id }) => id === 'app.url')?.status).toBe('fail');
    expect(checks.find(({ id }) => id === 'app.keychain-service')?.status).toBe('fail');
    expect(JSON.stringify(checks)).not.toContain(credentials.token);
  });

  test('ignores unrelated API endpoints outside FeedbackKit configuration', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.2.0' } }],
        }),
      },
      {
        path: '/App/FeedbackCenter.swift',
        content: `
          let appBackend = APIClient(
            baseURL: URL(string: "https://backend.example.com/v1/api")!
          )
          let feedback = try FeedbackConfiguration(
            productKey: "${product.publishableKey}"
          )
        `,
      },
    ], { ...credentials, baseUrl: DEFAULT_BASE_URL }, product);

    expect(checks.find(({ id }) => id === 'app.url')).toMatchObject({ status: 'pass' });
  });

  test('warns for unresolved endpoint, Keychain, and language overrides', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.2.0' } }],
        }),
      },
      {
        path: '/App/Info.plist',
        content: '<key>FeedbackServerBaseURL</key><string>$(FEEDBACK_SERVER_URL)</string>',
      },
      {
        path: '/App/FeedbackCenter.swift',
        content: `
          let configuration = try FeedbackConfiguration(
            productKey: "${product.publishableKey}",
            keychainService: visitorService,
            languagePolicy: configuredLanguagePolicy
          )
        `,
      },
    ], { ...credentials, baseUrl: DEFAULT_BASE_URL }, product);

    expect(checks.find(({ id }) => id === 'app.url')).toMatchObject({ status: 'warn' });
    expect(checks.find(({ id }) => id === 'app.keychain-service')).toMatchObject({
      status: 'warn',
    });
    expect(checks.find(({ id }) => id === 'app.language')).toMatchObject({ status: 'warn' });
    expect(checks.filter(({ status }) => status === 'fail')).toEqual([]);
  });

  test('marks a verified host App complete in shared onboarding output', async () => {
    const report = await diagnoseFeedbackServer({ appPath: '/App' }, dependencies({
      readHostAppFiles: () => Promise.resolve([
        {
          path: '/App/Package.resolved',
          content: JSON.stringify({
            pins: [{ identity: 'feedbackkit', state: { version: '0.1.33' } }],
          }),
        },
        {
          path: '/App/FeedbackCenter.swift',
          content: `
            let configuration = FeedbackCenterConfiguration(
              baseURL: URL(string: "https://feedback.example.com/v1/api")!,
              productKey: "pk_danci_public_identifier",
              keychainService: "com.example.danci.feedback.visitor",
              languagePolicy: .fixed(Locale(identifier: "zh-Hans"))
            )
          `,
        },
      ]),
    }));

    expect(report.onboarding?.localApp).toEqual({ status: 'complete', checked: true });
    expect(report.nextActions.some(({ id }) => id === 'inspect_local_app')).toBe(false);
  });

  test('surfaces unresolved settings and an implicit language policy', () => {
    const checks = inspectHostAppFiles([
      {
        path: '/App/Package.resolved',
        content: JSON.stringify({
          pins: [{ identity: 'feedbackkit', state: { version: '0.1.28' } }],
        }),
      },
      {
        path: '/App/Info.plist',
        content: '<key>FeedbackServerBaseURL</key><key>FeedbackProductKey</key>',
      },
    ], credentials, product);
    expect(checks.find(({ id }) => id === 'app.sdk')?.status).toBe('fail');
    expect(checks.find(({ id }) => id === 'app.url')?.status).toBe('warn');
    expect(checks.find(({ id }) => id === 'app.product-key')?.status).toBe('warn');
    expect(checks.find(({ id }) => id === 'app.keychain-service')?.status).toBe('fail');
    expect(checks.find(({ id }) => id === 'app.language')?.status).toBe('warn');
  });

  test('warns when doctor finds a newer stable FeedbackKit release', async () => {
    const report = await diagnoseFeedbackServer({ appPath: '/App' }, dependencies({
      readHostAppFiles: () => Promise.resolve([
        {
          path: '/App/Package.resolved',
          content: JSON.stringify({
            pins: [{ identity: 'feedbackkit', state: { version: '0.1.32' } }],
          }),
        },
        {
          path: '/App/FeedbackCenter.swift',
          content: `
            let configuration = FeedbackCenterConfiguration(
              baseURL: URL(string: "https://feedback.example.com/v1/api")!,
              productKey: "pk_danci_public_identifier",
              keychainService: "com.example.danci.feedback.visitor",
              languagePolicy: .fixed(Locale(identifier: "zh-Hans"))
            )
          `,
        },
      ]),
    }));

    expect(report.ok).toBe(true);
    expect(report.checks.find(({ id }) => id === 'app.sdk-update')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('0.1.33'),
    });
  });

  test('passes the latest FeedbackKit release check when current', async () => {
    const report = await diagnoseFeedbackServer({ appPath: '/App' }, dependencies({
      readHostAppFiles: () => Promise.resolve([
        {
          path: '/App/Package.resolved',
          content: JSON.stringify({
            pins: [{ identity: 'feedbackkit', state: { version: '0.1.33' } }],
          }),
        },
      ]),
    }));

    expect(report.checks.find(({ id }) => id === 'app.sdk-update')).toMatchObject({
      status: 'pass',
      message: 'FeedbackKit 0.1.33 is the latest stable release.',
    });
  });
});
