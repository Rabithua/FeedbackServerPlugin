import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export interface RuntimeDependencyOptions {
  root?: string;
  exists?: (path: string) => boolean;
  install?: (root: string) => number;
}

function installProductionDependencies(root: string): number {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'install', '--production', '--frozen-lockfile'],
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return result.exitCode;
}

export function ensureRuntimeDependencies(options: RuntimeDependencyOptions = {}): boolean {
  const root = options.root ?? pluginRoot;
  const exists = options.exists ?? existsSync;
  const marker = join(root, 'node_modules', '@napi-rs', 'keyring', 'package.json');
  if (exists(marker)) return false;

  const exitCode = (options.install ?? installProductionDependencies)(root);
  if (exitCode !== 0 || !exists(marker)) {
    throw new Error(
      'FeedbackKit could not install its locked native credential-store runtime. '
      + 'Check network access and rerun the command.',
    );
  }
  return true;
}
