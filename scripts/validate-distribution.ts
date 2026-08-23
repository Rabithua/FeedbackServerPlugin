import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

const repositoryRoot = new URL('../', import.meta.url);
const pluginRoot = new URL('../plugins/feedback-server/', import.meta.url);
const codexManifestPath = new URL('.codex-plugin/plugin.json', pluginRoot);
const codexMarketplacePath = new URL('../.agents/plugins/marketplace.json', import.meta.url);
const claudeManifestPath = new URL('.claude-plugin/plugin.json', pluginRoot);
const claudeMarketplacePath = new URL('../.claude-plugin/marketplace.json', import.meta.url);
const packagePath = new URL('package.json', pluginRoot);
const cursorExamplePath = new URL('../examples/cursor.mcp.json', import.meta.url);
const openCodeExamplePath = new URL('../examples/opencode.json', import.meta.url);

const codexManifest = await Bun.file(codexManifestPath).json() as Record<string, unknown>;
const claudeManifest = await Bun.file(claudeManifestPath).json() as Record<string, unknown>;
const pluginPackage = await Bun.file(packagePath).json() as Record<string, unknown>;
const cursorExample = await Bun.file(cursorExamplePath).json() as Record<string, unknown>;
const openCodeExample = await Bun.file(openCodeExamplePath).json() as Record<string, unknown>;
const codexMarketplace = await Bun.file(codexMarketplacePath).json() as {
  name?: unknown;
  plugins?: Array<{
    name?: unknown;
    source?: { source?: unknown; path?: unknown };
    policy?: { installation?: unknown; authentication?: unknown };
    category?: unknown;
  }>;
};
const claudeMarketplace = await Bun.file(claudeMarketplacePath).json() as {
  name?: unknown;
  plugins?: Array<{
    name?: unknown;
    source?: unknown;
    version?: unknown;
    strict?: unknown;
  }>;
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

requireCondition(codexManifest.name === basename(pluginRoot.pathname), 'Plugin folder and Codex manifest name differ');
requireCondition(claudeManifest.name === codexManifest.name, 'Agent manifest names differ');
requireCondition(
  typeof codexManifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(codexManifest.version),
  'Plugin version must use strict semver',
);
requireCondition(claudeManifest.version === codexManifest.version, 'Agent manifest versions differ');
requireCondition(pluginPackage.version === codexManifest.version, 'Package and manifest versions differ');
requireCondition(codexManifest.license === 'MIT' && claudeManifest.license === 'MIT', 'Plugin manifests must declare MIT');
requireCondition(codexManifest.skills === './skills/', 'Codex skills path is invalid');
requireCondition(
  typeof codexManifest.mcpServers === 'object'
  && codexManifest.mcpServers !== null
  && 'feedback-server' in codexManifest.mcpServers,
  'Codex MCP configuration is invalid',
);
requireCondition(!('mcpServers' in claudeManifest), 'Claude must use the canonical root .mcp.json');
requireCondition(codexMarketplace.name === 'feedback-server', 'Codex marketplace name is invalid');
requireCondition(codexMarketplace.plugins?.length === 1, 'Codex marketplace must contain exactly one plugin');
const entry = codexMarketplace.plugins[0]!;
requireCondition(entry.name === 'feedback-server', 'Marketplace plugin name is invalid');
requireCondition(entry.source?.source === 'local', 'Marketplace source type is invalid');
requireCondition(entry.source.path === './plugins/feedback-server', 'Marketplace plugin path is invalid');
requireCondition(entry.policy?.installation === 'AVAILABLE', 'Marketplace installation policy is invalid');
requireCondition(entry.policy.authentication === 'ON_INSTALL', 'Marketplace authentication policy is invalid');
requireCondition(entry.category === 'Productivity', 'Marketplace category is invalid');
requireCondition(claudeMarketplace.name === 'feedback-server', 'Claude marketplace name is invalid');
requireCondition(claudeMarketplace.plugins?.length === 1, 'Claude marketplace must contain exactly one plugin');
const claudeEntry = claudeMarketplace.plugins[0]!;
requireCondition(claudeEntry.name === 'feedback-server', 'Claude marketplace plugin name is invalid');
requireCondition(claudeEntry.source === './plugins/feedback-server', 'Claude marketplace source is invalid');
requireCondition(claudeEntry.version === codexManifest.version, 'Claude marketplace version differs');
requireCondition(claudeEntry.strict === true, 'Claude marketplace must use strict plugin metadata');
requireCondition(
  typeof cursorExample.mcpServers === 'object' && cursorExample.mcpServers !== null,
  'Cursor MCP example is invalid',
);
requireCondition(
  typeof openCodeExample.mcp === 'object' && openCodeExample.mcp !== null,
  'OpenCode MCP example is invalid',
);

for (const relativePath of [
  'skills',
  '.claude-plugin/plugin.json',
  '.mcp.json',
  'bin/feedback-server',
  'dist/server.mjs',
  'dist/cli.mjs',
]) {
  try {
    await stat(new URL(relativePath, pluginRoot));
  } catch {
    throw new Error(`Missing plugin component: ${relativePath}`);
  }
}

const allowedRootEntries = new Set([
  '.agents',
  '.claude-plugin',
  '.git',
  '.github',
  '.gitignore',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
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
console.error(`FeedbackServer Plugin ${String(codexManifest.version)} is structurally valid for Codex and Claude Code.`);
