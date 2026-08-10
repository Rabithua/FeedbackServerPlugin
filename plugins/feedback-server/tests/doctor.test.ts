import { describe, expect, test } from 'bun:test';
import {
  diagnoseFeedbackServer,
  formatDoctorReport,
  inspectHostAppFiles,
  type DoctorDependencies,
  type DoctorProduct,
} from '../src/doctor.js';
import type { StoredCredentials } from '../src/credentials.js';

const credentials: StoredCredentials = {
  baseUrl: 'https://feedback.example.com/v1/api',
  token: `fspat_${'a'.repeat(64)}`,
  username: 'owner',
  scopes: ['products:read', 'feedback:read', 'feedback:write'],
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

function dependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    loadCredentials: () => Promise.resolve(credentials),
    readPendingRevocations: () => Promise.resolve([]),
    createClient: () => ({
      request: <T>(path: string) => Promise.resolve(
        (path === '/admin/products' ? [product] : { database: 'ok' }) as T,
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
      'product',
    ]);
    expect(formatDoctorReport(report)).not.toContain(credentials.token);
    expect(JSON.stringify(report)).not.toContain(product.publishableKey);
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
