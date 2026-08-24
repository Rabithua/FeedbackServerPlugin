import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export interface RuntimeDependencyOptions {
  root?: string;
  exists?: (path: string) => boolean;
  install?: (root: string) => number;
}

interface InstallResult {
  exitCode: number;
  stdout: Uint8Array;
}

export interface RuntimeInstallOptions {
  spawnSync?: (root: string) => InstallResult;
  writeDiagnostic?: (output: Uint8Array) => void;
}

export function installProductionDependencies(
  root: string,
  options: RuntimeInstallOptions = {},
): number {
  const spawnSync = options.spawnSync ?? ((cwd: string) => Bun.spawnSync({
    cmd: [process.execPath, 'install', '--production', '--frozen-lockfile'],
    cwd,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'inherit',
  }));
  const result = spawnSync(root);
  if (result.stdout.length > 0) {
    (options.writeDiagnostic ?? ((output) => {
      process.stderr.write(output);
    }))(result.stdout);
  }
  return result.exitCode;
}

type RuntimeSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

interface RuntimeChild {
  exited: Promise<number>;
  kill(signal: RuntimeSignal): void;
}

export interface RelaunchOptions {
  spawn?: () => RuntimeChild;
  onSignal?: (signal: RuntimeSignal, listener: () => void) => void;
  offSignal?: (signal: RuntimeSignal, listener: () => void) => void;
}

export async function relaunchCurrentProcess(options: RelaunchOptions = {}): Promise<number> {
  const child = (options.spawn ?? (() => Bun.spawn({
    cmd: [process.execPath, ...Bun.argv.slice(1)],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })))();
  const onSignal = options.onSignal ?? ((signal, listener) => {
    process.on(signal, listener);
  });
  const offSignal = options.offSignal ?? ((signal, listener) => {
    process.off(signal, listener);
  });
  const signals: RuntimeSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const forwarders = signals.map((signal) => {
    const forward = () => {
      child.kill(signal);
    };
    onSignal(signal, forward);
    return { signal, forward };
  });
  try {
    return await child.exited;
  } finally {
    for (const { signal, forward } of forwarders) offSignal(signal, forward);
  }
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
