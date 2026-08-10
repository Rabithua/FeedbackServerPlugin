import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { FeedbackServerApiClient } from './api-client.js';
import {
  KEYCHAIN_SERVICE,
  loadCredentials,
  readPendingTokenRevocations,
  type PendingTokenRevocation,
  type StoredCredentials,
} from './credentials.js';
import {
  compareVersions,
  fetchLatestGitHubRelease,
  type StableRelease,
} from './release-updates.js';
import { MINIMUM_FEEDBACK_KIT_VERSION, PLUGIN_VERSION } from './version.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorProduct {
  id: string;
  slug: string;
  name: string;
  publishableKey: string;
  defaultLocale: string;
  status: string;
}

export interface DoctorReport {
  ok: boolean;
  pluginVersion: string;
  endpoint: string | null;
  username: string | null;
  product: Pick<DoctorProduct, 'id' | 'slug' | 'name' | 'defaultLocale' | 'status'> | null;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  product?: string;
  appPath?: string;
}

export interface HostAppFile {
  path: string;
  content: string;
}

interface DoctorApiClient {
  request<T>(path: string, options?: { authenticated?: boolean }): Promise<T>;
}

export interface DoctorDependencies {
  loadCredentials: () => Promise<StoredCredentials>;
  readPendingRevocations: () => Promise<PendingTokenRevocation[]>;
  createClient: (credentials: StoredCredentials) => DoctorApiClient;
  readHostAppFiles: (path: string) => Promise<HostAppFile[]>;
  fetchLatestFeedbackKitRelease: () => Promise<StableRelease | undefined>;
  now: () => number;
}

const defaultDependencies: DoctorDependencies = {
  loadCredentials,
  readPendingRevocations: readPendingTokenRevocations,
  createClient: (credentials) => new FeedbackServerApiClient(credentials),
  readHostAppFiles,
  fetchLatestFeedbackKitRelease: () => fetchLatestGitHubRelease('Rabithua/FeedbackKit'),
  now: Date.now,
};

const relevantExtensions = new Set(['.json', '.pbxproj', '.plist', '.swift']);
const ignoredDirectories = new Set([
  '.build',
  '.git',
  '.swiftpm',
  'DerivedData',
  'Pods',
  'build',
  'node_modules',
]);
const maximumFiles = 1_000;
const maximumDepth = 8;
const maximumFileBytes = 768 * 1024;

function check(
  id: string,
  label: string,
  status: DoctorStatus,
  message: string,
): DoctorCheck {
  return { id, label, status, message };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function feedbackKitVersions(files: HostAppFile[]): string[] {
  const versions: string[] = [];
  for (const file of files.filter(({ path }) => basename(path) === 'Package.resolved')) {
    try {
      const parsed = JSON.parse(file.content) as {
        pins?: Array<{ identity?: string; location?: string; state?: { version?: string } }>;
        object?: { pins?: Array<{ package?: string; repositoryURL?: string; state?: { version?: string } }> };
      };
      const pins = parsed.pins ?? parsed.object?.pins ?? [];
      for (const pin of pins) {
        const compatiblePin = pin as {
          identity?: string;
          location?: string;
          package?: string;
          repositoryURL?: string;
          state?: { version?: string };
        };
        const identity = compatiblePin.identity ?? compatiblePin.package;
        const location = compatiblePin.location ?? compatiblePin.repositoryURL;
        if (`${identity ?? ''} ${location ?? ''}`.toLowerCase().includes('feedbackkit')) {
          const version = compatiblePin.state?.version;
          if (version) versions.push(version);
        }
      }
    } catch {
      // A malformed unrelated Package.resolved should not stop the remaining checks.
    }
  }
  return versions;
}

function newestFeedbackKitVersion(files: HostAppFile[]): string | undefined {
  return [...feedbackKitVersions(files)].sort(compareVersions).at(-1);
}

function localeLanguage(value: string): string {
  return (value.split(/[-_]/, 1)[0] ?? value).toLowerCase();
}

export function inspectHostAppFiles(
  files: HostAppFile[],
  credentials: StoredCredentials,
  product: DoctorProduct | undefined,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const combined = files.map(({ content }) => content).join('\n');
  const newest = newestFeedbackKitVersion(files);
  if (!newest) {
    checks.push(check(
      'app.sdk',
      'FeedbackKit SDK',
      'fail',
      'FeedbackKit was not found in Package.resolved.',
    ));
  } else {
    const supported = compareVersions(newest, MINIMUM_FEEDBACK_KIT_VERSION) >= 0;
    checks.push(check(
      'app.sdk',
      'FeedbackKit SDK',
      supported ? 'pass' : 'fail',
      supported
        ? `FeedbackKit ${newest} satisfies the ${MINIMUM_FEEDBACK_KIT_VERSION} minimum.`
        : `FeedbackKit ${newest} is older than the ${MINIMUM_FEEDBACK_KIT_VERSION} minimum.`,
    ));
  }

  const normalizedEndpoint = credentials.baseUrl.replace(/\/+$/, '');
  const endpointWithoutApi = normalizedEndpoint.replace(/\/v1\/api$/, '');
  const hasUrl = combined.includes(normalizedEndpoint) || combined.includes(endpointWithoutApi);
  const hasUrlSetting = combined.includes('FeedbackServerBaseURL');
  checks.push(check(
    'app.url',
    'Server URL',
    hasUrl ? 'pass' : hasUrlSetting ? 'warn' : 'fail',
    hasUrl
      ? 'The host App references the connected FeedbackServer endpoint.'
      : hasUrlSetting
        ? 'A FeedbackServerBaseURL setting exists, but its resolved value could not be verified.'
        : 'No FeedbackServer URL configuration was found.',
  ));

  if (product) {
    const hasProductKey = combined.includes(product.publishableKey);
    const hasProductSetting = combined.includes('FeedbackProductKey');
    checks.push(check(
      'app.product-key',
      'Product key',
      hasProductKey ? 'pass' : hasProductSetting ? 'warn' : 'fail',
      hasProductKey
        ? `The host App references Product ${product.slug}.`
        : hasProductSetting
          ? `A FeedbackProductKey setting exists, but Product ${product.slug} could not be verified.`
          : `No Product key configuration was found for ${product.slug}.`,
    ));
  } else {
    checks.push(check(
      'app.product-key',
      'Product key',
      'warn',
      'Select a Product with --product to verify the host App binding.',
    ));
  }

  const keychainMatch = combined.match(/keychainService\s*:\s*"([^"]+)"/);
  checks.push(check(
    'app.keychain-service',
    'Keychain service',
    keychainMatch ? 'pass' : 'fail',
    keychainMatch
      ? `A dedicated visitor credential service is configured (${keychainMatch[1]}).`
      : `No explicit FeedbackKit keychainService was found; do not reuse ${KEYCHAIN_SERVICE}.`,
  ));

  const fixedLocale = combined.match(
    /languagePolicy\s*:\s*\.fixed\(\s*Locale\(identifier\s*:\s*"([^"]+)"\)\s*\)/,
  )?.[1];
  const followsHost = /languagePolicy\s*:\s*\.followHost\b/.test(combined);
  if (fixedLocale) {
    const matchesProduct = !product
      || localeLanguage(fixedLocale) === localeLanguage(product.defaultLocale);
    checks.push(check(
      'app.language',
      'Language policy',
      matchesProduct ? 'pass' : 'warn',
      matchesProduct
        ? `FeedbackKit uses fixed locale ${fixedLocale}.`
        : `FeedbackKit uses ${fixedLocale}, while Product ${product.slug} defaults to ${product.defaultLocale}.`,
    ));
  } else if (followsHost) {
    checks.push(check(
      'app.language',
      'Language policy',
      'pass',
      'FeedbackKit explicitly follows the host App language.',
    ));
  } else {
    checks.push(check(
      'app.language',
      'Language policy',
      'warn',
      'No explicit FeedbackKit languagePolicy was found; confirm whether the host language or a fixed locale is intended.',
    ));
  }
  return checks;
}

async function readHostAppFiles(rootPath: string): Promise<HostAppFile[]> {
  const root = resolve(rootPath);
  const files: HostAppFile[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maximumDepth || files.length >= maximumFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maximumFiles) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== 'Package.resolved' && !relevantExtensions.has(extname(entry.name))) {
        continue;
      }
      const handle = Bun.file(path);
      if (handle.size > maximumFileBytes) continue;
      files.push({ path, content: await readFile(path, 'utf8') });
    }
  }

  await visit(root, 0);
  return files;
}

function publicProduct(product: DoctorProduct): DoctorReport['product'] {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    defaultLocale: product.defaultLocale,
    status: product.status,
  };
}

function selectProduct(
  products: DoctorProduct[],
  selector: string | undefined,
): { product?: DoctorProduct; check: DoctorCheck } {
  if (selector) {
    const matches = products.filter(({ id, slug }) => id === selector || slug === selector);
    const product = matches.length === 1 ? matches[0] : undefined;
    if (product) {
      return {
        product,
        check: check(
          'product',
          'Product',
          product.status === 'active' ? 'pass' : 'warn',
          `Selected ${product.slug} (${product.status}, default locale ${product.defaultLocale}).`,
        ),
      };
    }
    return {
      check: check('product', 'Product', 'fail', `No visible Product matches ${selector}.`),
    };
  }
  const onlyProduct = products.length === 1 ? products[0] : undefined;
  if (onlyProduct) {
    return {
      product: onlyProduct,
      check: check(
        'product',
        'Product',
        onlyProduct.status === 'active' ? 'pass' : 'warn',
        `Auto-selected the only visible Product, ${onlyProduct.slug} (${onlyProduct.status}).`,
      ),
    };
  }
  if (products.length === 0) {
    return { check: check('product', 'Product', 'warn', 'The account owns no Products.') };
  }
  return {
    check: check(
      'product',
      'Product',
      'warn',
      `${products.length} Products are visible; pass --product with an ID or slug to verify one.`,
    ),
  };
}

export async function diagnoseFeedbackServer(
  options: DoctorOptions,
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [check(
    'plugin',
    'Plugin version',
    'pass',
    `FeedbackServer Plugin ${PLUGIN_VERSION} is running.`,
  )];
  let credentials: StoredCredentials;
  try {
    credentials = await dependencies.loadCredentials();
    checks.push(check(
      'credentials',
      'Agent credentials',
      'pass',
      `Configured for ${credentials.username ?? 'an administrator'} at ${credentials.baseUrl}.`,
    ));
  } catch (error) {
    checks.push(check('credentials', 'Agent credentials', 'fail', safeMessage(error)));
    return {
      ok: false,
      pluginVersion: PLUGIN_VERSION,
      endpoint: null,
      username: null,
      product: null,
      checks,
    };
  }

  const requiredScopes = ['products:read', 'feedback:read', 'feedback:write'];
  if (credentials.scopes) {
    const scopes = credentials.scopes;
    const missing = requiredScopes.filter((scope) => !scopes.includes(scope));
    checks.push(check(
      'scopes',
      'PAT scopes',
      missing.length === 0 ? 'pass' : 'warn',
      missing.length === 0
        ? 'PAT includes Product read and Feedback round-trip scopes.'
        : `PAT is missing recommended scopes: ${missing.join(', ')}.`,
    ));
  } else {
    checks.push(check(
      'scopes',
      'PAT scopes',
      'warn',
      'Stored credentials do not include scope metadata; live authorization is checked below.',
    ));
  }

  if (credentials.expiresAt) {
    const days = Math.floor(
      (new Date(credentials.expiresAt).getTime() - dependencies.now()) / 86_400_000,
    );
    checks.push(check(
      'expiry',
      'PAT expiry',
      days < 0 ? 'fail' : days <= 30 ? 'warn' : 'pass',
      days < 0
        ? 'The configured PAT has expired.'
        : `The configured PAT expires in ${days} day${days === 1 ? '' : 's'}.`,
    ));
  } else {
    checks.push(check('expiry', 'PAT expiry', 'warn', 'No PAT expiry metadata is stored.'));
  }

  try {
    const pending = await dependencies.readPendingRevocations();
    checks.push(check(
      'pending-revocations',
      'Pending token cleanup',
      pending.length === 0 ? 'pass' : 'warn',
      pending.length === 0
        ? 'No pending PAT revocations are recorded.'
        : `${pending.length} PAT revocation${pending.length === 1 ? ' is' : 's are'} pending.`,
    ));
  } catch (error) {
    checks.push(check(
      'pending-revocations',
      'Pending token cleanup',
      'warn',
      `Could not inspect cleanup metadata: ${safeMessage(error)}`,
    ));
  }

  const client = dependencies.createClient(credentials);
  try {
    await client.request('/health', { authenticated: false });
    checks.push(check('health', 'Server health', 'pass', 'FeedbackServer health check passed.'));
  } catch (error) {
    checks.push(check('health', 'Server health', 'fail', safeMessage(error)));
  }

  let selectedProduct: DoctorProduct | undefined;
  try {
    const products = await client.request<DoctorProduct[]>('/admin/products');
    const selection = selectProduct(products, options.product);
    selectedProduct = selection.product;
    checks.push(selection.check);
  } catch (error) {
    checks.push(check('product', 'Product', 'fail', safeMessage(error)));
  }

  if (options.appPath) {
    try {
      const files = await dependencies.readHostAppFiles(options.appPath);
      checks.push(...inspectHostAppFiles(files, credentials, selectedProduct));
      const installedVersion = newestFeedbackKitVersion(files);
      if (installedVersion) {
        const latest = await dependencies.fetchLatestFeedbackKitRelease().catch(() => undefined);
        if (latest) {
          const updateAvailable = compareVersions(installedVersion, latest.version) < 0;
          checks.push(check(
            'app.sdk-update',
            'FeedbackKit update',
            updateAvailable ? 'warn' : 'pass',
            updateAvailable
              ? `FeedbackKit ${latest.version} is available (installed ${installedVersion}): ${latest.url}`
              : `FeedbackKit ${installedVersion} is the latest stable release.`,
          ));
        }
      }
    } catch (error) {
      checks.push(check('app', 'Host App', 'fail', `Unable to inspect App: ${safeMessage(error)}`));
    }
  }

  return {
    ok: !checks.some(({ status }) => status === 'fail'),
    pluginVersion: PLUGIN_VERSION,
    endpoint: credentials.baseUrl,
    username: credentials.username ?? null,
    product: selectedProduct ? publicProduct(selectedProduct) : null,
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const symbol: Record<DoctorStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  const lines = report.checks.map(
    ({ status, label, message }) => `[${symbol[status]}] ${label}: ${message}`,
  );
  lines.push(report.ok ? 'Doctor completed without failures.' : 'Doctor found blocking failures.');
  return `${lines.join('\n')}\n`;
}
