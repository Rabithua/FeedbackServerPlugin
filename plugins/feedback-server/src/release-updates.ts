import { PLUGIN_VERSION } from './version.js';

const githubApiBaseUrl = 'https://api.github.com';
const releaseRequestTimeoutMilliseconds = 2_000;
const noticeWaitMilliseconds = 250;

export interface StableRelease {
  version: string;
  url: string;
}

export interface PluginUpdateNotice {
  kind: 'plugin_update_available';
  component: 'feedback-server-plugin';
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  command: string;
}

export interface UpdateNoticeProvider {
  takeNotice(): Promise<PluginUpdateNotice | undefined>;
}

export type LatestReleaseFetcher = (repository: string) => Promise<StableRelease | undefined>;

export function normalizeStableVersion(value: string): string | undefined {
  const normalized = value.trim().replace(/^v/, '');
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : undefined;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => (value.replace(/^v/, '').split('-', 1)[0] ?? '0')
    .split('.')
    .map((part) => Number(part));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function fetchLatestGitHubRelease(
  repository: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<StableRelease | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, releaseRequestTimeoutMilliseconds);
  try {
    const response = await fetcher(
      `${githubApiBaseUrl}/repos/${repository}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `FeedbackServer-Plugin/${PLUGIN_VERSION}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return undefined;
    const payload = await response.json() as { tag_name?: unknown; html_url?: unknown };
    if (typeof payload.tag_name !== 'string' || typeof payload.html_url !== 'string') {
      return undefined;
    }
    const version = normalizeStableVersion(payload.tag_name);
    return version ? { version, url: payload.html_url } : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

class GitHubPluginUpdateNoticeProvider implements UpdateNoticeProvider {
  private lookup: Promise<PluginUpdateNotice | undefined> | undefined;
  private completed = false;

  constructor(
    private readonly currentVersion: string,
    private readonly fetchLatestRelease: LatestReleaseFetcher,
    private readonly waitMilliseconds: number,
  ) {}

  async takeNotice(): Promise<PluginUpdateNotice | undefined> {
    if (this.completed) return undefined;
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
    if (result === pending) return undefined;
    this.completed = true;
    return result;
  }

  private async resolveNotice(): Promise<PluginUpdateNotice | undefined> {
    const latest = await this.fetchLatestRelease('Rabithua/FeedbackServerPlugin');
    if (!latest || compareVersions(latest.version, this.currentVersion) <= 0) return undefined;
    return {
      kind: 'plugin_update_available',
      component: 'feedback-server-plugin',
      currentVersion: this.currentVersion,
      latestVersion: latest.version,
      releaseUrl: latest.url,
      command: 'codex plugin marketplace upgrade feedback-server',
    };
  }
}

export function createPluginUpdateNoticeProvider(options: {
  currentVersion?: string;
  fetchLatestRelease?: LatestReleaseFetcher;
  waitMilliseconds?: number;
} = {}): UpdateNoticeProvider {
  return new GitHubPluginUpdateNoticeProvider(
    options.currentVersion ?? PLUGIN_VERSION,
    options.fetchLatestRelease ?? fetchLatestGitHubRelease,
    options.waitMilliseconds ?? noticeWaitMilliseconds,
  );
}
