import { describe, expect, test } from 'bun:test';
import {
  ensureRuntimeDependencies,
  installProductionDependencies,
  relaunchCurrentProcess,
} from '../scripts/ensure-runtime-dependencies.js';

describe('runtime dependency bootstrap', () => {
  test('does not install when the native keyring runtime exists', () => {
    let installs = 0;
    const installed = ensureRuntimeDependencies({
      root: '/plugin',
      exists: () => true,
      install: () => {
        installs += 1;
        return 0;
      },
    });
    expect(installs).toBe(0);
    expect(installed).toBe(false);
  });

  test('installs locked production dependencies before loading the plugin', () => {
    let installed = false;
    const result = ensureRuntimeDependencies({
      root: '/plugin',
      exists: () => installed,
      install: (root) => {
        expect(root).toBe('/plugin');
        installed = true;
        return 0;
      },
    });
    expect(installed).toBe(true);
    expect(result).toBe(true);
  });

  test('fails clearly when installation does not provide the native runtime', () => {
    expect(() => {
      ensureRuntimeDependencies({
        root: '/plugin',
        exists: () => false,
        install: () => 1,
      });
    }).toThrow(/locked native credential-store runtime/i);
  });

  test('redirects installer stdout to diagnostics instead of the MCP protocol stream', () => {
    const output = new TextEncoder().encode('installed dependencies\n');
    let diagnostic = '';
    const exitCode = installProductionDependencies('/plugin', {
      spawnSync: (root) => {
        expect(root).toBe('/plugin');
        return { exitCode: 0, stdout: output };
      },
      writeDiagnostic: (value) => {
        diagnostic = new TextDecoder().decode(value);
      },
    });
    expect(exitCode).toBe(0);
    expect(diagnostic).toBe('installed dependencies\n');
  });

  test('forwards termination signals to the relaunched process and removes listeners', async () => {
    const listeners = new Map<string, () => void>();
    const removed: string[] = [];
    const forwarded: string[] = [];
    let finish: ((value: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const relaunched = relaunchCurrentProcess({
      spawn: () => ({
        exited,
        kill: (signal) => {
          forwarded.push(signal);
        },
      }),
      onSignal: (signal, listener) => {
        listeners.set(signal, listener);
      },
      offSignal: (signal) => {
        removed.push(signal);
      },
    });
    listeners.get('SIGTERM')?.();
    finish?.(143);
    const exitCode = await relaunched;
    expect(exitCode).toBe(143);
    expect(forwarded).toEqual(['SIGTERM']);
    expect(removed).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
  });
});
