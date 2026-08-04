import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const repositoryRoot = new URL('../', import.meta.url).pathname;
const excludedDirectories = new Set(['.git', 'dist', 'node_modules']);
const excludedFiles = new Set(['bun.lock']);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opsu]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
  /\bfspat_[A-Za-z0-9_-]{32,}\b/,
  /\bfsinv_[A-Za-z0-9_-]{32,}\b/,
  /\b(?:DATABASE_URL|POSTGRES_PASSWORD|S3_SECRET_ACCESS_KEY|DOKPLOY_API_KEY)\s*=/i,
  /https?:\/\/[^\s/:]+:[^\s/@]+@[^\s/]+/,
];

const findings: string[] = [];

async function scanDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const content = await Bun.file(path).text();
    for (const [index, line] of content.split('\n').entries()) {
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push(`${relative(repositoryRoot, path)}:${index + 1}`);
      }
    }
  }
}

await scanDirectory(repositoryRoot);
if (findings.length > 0) {
  throw new Error(`Potential sensitive content found at ${findings.join(', ')}`);
}
console.error('No sensitive credential material detected in the public source tree.');

