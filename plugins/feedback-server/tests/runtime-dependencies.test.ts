import { describe, expect, test } from 'bun:test';
import { ensureRuntimeDependencies } from '../scripts/ensure-runtime-dependencies.js';

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
});
