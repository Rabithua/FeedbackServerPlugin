import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

const repositoryRoot = new URL('../', import.meta.url);
const pluginRoot = new URL('../plugins/feedback-server/', import.meta.url);
const manifestPath = new URL('.codex-plugin/plugin.json', pluginRoot);
const marketplacePath = new URL('../.agents/plugins/marketplace.json', import.meta.url);

const manifest = await Bun.file(manifestPath).json() as Record<string, unknown>;
const marketplace = await Bun.file(marketplacePath).json() as {
  name?: unknown;
  plugins?: Array<{
    name?: unknown;
    source?: { source?: unknown; path?: unknown };
    policy?: { installation?: unknown; authentication?: unknown };
    category?: unknown;
  }>;
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

requireCondition(manifest.name === basename(pluginRoot.pathname), 'Plugin folder and manifest name differ');
requireCondition(
  typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version),
  'Plugin version must use strict semver',
);
requireCondition(manifest.license === 'MIT', 'Plugin manifest must declare MIT');
requireCondition(manifest.skills === './skills/', 'Plugin skills path is invalid');
requireCondition(manifest.mcpServers === './.mcp.json', 'Plugin MCP path is invalid');
requireCondition(marketplace.name === 'feedback-server', 'Marketplace name is invalid');
requireCondition(marketplace.plugins?.length === 1, 'Marketplace must contain exactly one plugin');
const entry = marketplace.plugins[0]!;
requireCondition(entry.name === 'feedback-server', 'Marketplace plugin name is invalid');
requireCondition(entry.source?.source === 'local', 'Marketplace source type is invalid');
requireCondition(entry.source.path === './plugins/feedback-server', 'Marketplace plugin path is invalid');
requireCondition(entry.policy?.installation === 'AVAILABLE', 'Marketplace installation policy is invalid');
requireCondition(entry.policy.authentication === 'ON_INSTALL', 'Marketplace authentication policy is invalid');
requireCondition(entry.category === 'Productivity', 'Marketplace category is invalid');

for (const relativePath of ['skills', '.mcp.json', 'dist/server.mjs']) {
  try {
    await stat(new URL(relativePath, pluginRoot));
  } catch {
    throw new Error(`Missing plugin component: ${relativePath}`);
  }
}

const allowedRootEntries = new Set([
  '.agents',
  '.git',
  '.github',
  '.gitignore',
  'LICENSE',
  'README.md',
  'package.json',
  'plugins',
  'scripts',
]);
const rootEntries = await readdir(repositoryRoot);
const unexpected = rootEntries.filter((entryName) => !allowedRootEntries.has(entryName));
requireCondition(
  unexpected.length === 0,
  `Unexpected public repository paths: ${unexpected.join(', ')}`,
);

const forbiddenNames = new Set([
  '.env',
  'docker-compose.yml',
  'drizzle.config.ts',
  'DOKPLOY.md',
]);

async function rejectForbiddenPaths(directory: string): Promise<void> {
  for (const entryName of await readdir(directory, { withFileTypes: true })) {
    if (entryName.name === '.git' || entryName.name === 'node_modules') continue;
    const path = join(directory, entryName.name);
    requireCondition(!forbiddenNames.has(entryName.name), `Forbidden public path: ${path}`);
    if (entryName.isDirectory()) await rejectForbiddenPaths(path);
  }
}

await rejectForbiddenPaths(repositoryRoot.pathname);
console.error(`FeedbackServer Codex distribution ${String(manifest.version)} is structurally valid.`);
