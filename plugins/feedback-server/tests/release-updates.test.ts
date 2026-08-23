import { describe, expect, test } from 'bun:test';
import {
  compareVersions,
  createPluginUpdateNoticeProvider,
  fetchLatestGitHubRelease,
  normalizeStableVersion,
} from '../src/release-updates.js';

describe('release update checks', () => {
  test('normalizes stable release tags and compares versions', () => {
    expect(normalizeStableVersion('v0.6.8')).toBe('0.6.8');
    expect(normalizeStableVersion('0.1.33')).toBe('0.1.33');
    expect(normalizeStableVersion('v0.6.8-beta.1')).toBeUndefined();
    expect(compareVersions('0.6.10', '0.6.9')).toBeGreaterThan(0);
    expect(compareVersions('0.6.8-beta.1', '0.6.7')).toBeGreaterThan(0);
    expect(compareVersions('0.6.8', '0.6.8')).toBe(0);
  });

  test('reads the latest stable release from the GitHub Releases API', async () => {
    let request: Request | undefined;
    const release = await fetchLatestGitHubRelease(
      'Rabithua/FeedbackServerPlugin',
      ((input, init) => {
        request = new Request(input, init);
        return Promise.resolve(Response.json({
          tag_name: 'v0.6.8',
          html_url: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.8',
        }));
      }) as typeof fetch,
    );
    expect(request?.url).toBe(
      'https://api.github.com/repos/Rabithua/FeedbackServerPlugin/releases/latest',
    );
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(release).toEqual({
      version: '0.6.8',
      url: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.8',
    });
  });

  test('returns one actionable plugin update notice per process', async () => {
    let requests = 0;
    const provider = createPluginUpdateNoticeProvider({
      currentVersion: '0.6.7',
      fetchLatestRelease: () => {
        requests += 1;
        return Promise.resolve({
          version: '0.6.8',
          url: 'https://github.com/Rabithua/FeedbackServerPlugin/releases/tag/v0.6.8',
        });
      },
      waitMilliseconds: 10,
    });

    expect(await provider.takeNotice()).toMatchObject({
      kind: 'plugin_update_available',
      currentVersion: '0.6.7',
      latestVersion: '0.6.8',
      command: 'codex plugin marketplace upgrade feedback-server',
      commands: {
        codex: ['codex plugin marketplace upgrade feedback-server'],
        claudeCode: [
          'claude plugin marketplace update feedback-server',
          'claude plugin update feedback-server@feedback-server',
        ],
      },
      reloadRequired: true,
    });
    expect(await provider.takeNotice()).toBeUndefined();
    expect(requests).toBe(1);
  });

  test('silently completes when the installed plugin is current', async () => {
    const provider = createPluginUpdateNoticeProvider({
      currentVersion: '0.6.8',
      fetchLatestRelease: () => Promise.resolve({
        version: '0.6.8',
        url: 'https://example.com/release',
      }),
      waitMilliseconds: 10,
    });
    expect(await provider.takeNotice()).toBeUndefined();
    expect(await provider.takeNotice()).toBeUndefined();
  });
});
