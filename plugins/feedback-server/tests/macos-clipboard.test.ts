import { describe, expect, test } from 'bun:test';
import {
  MacOSClipboard,
  PBCOPY_EXECUTABLE,
  PBPASTE_EXECUTABLE,
  type ClipboardCommandRunner,
} from '../src/macos-clipboard.js';

describe('secure macOS clipboard', () => {
  async function capturedError(operation: Promise<unknown>): Promise<unknown> {
    try {
      await operation;
      return undefined;
    } catch (error) {
      return error;
    }
  }

  test('passes secrets only through stdin and clears an unchanged value', async () => {
    const calls: Array<{ executable: string; input?: string }> = [];
    const token = `fsinv_${'x'.repeat(48)}`;
    const runner: ClipboardCommandRunner = (executable, input) => {
      calls.push({ executable, ...(input === undefined ? {} : { input }) });
      return Promise.resolve({
        exitCode: 0,
        stdout: executable === PBPASTE_EXECUTABLE ? token : '',
        stderr: '',
      });
    };
    const clipboard = new MacOSClipboard(runner, 'darwin');

    await clipboard.write(token);
    expect(await clipboard.clearIfUnchanged(token)).toBe(true);
    expect(calls).toEqual([
      { executable: PBCOPY_EXECUTABLE, input: token },
      { executable: PBPASTE_EXECUTABLE },
      { executable: PBCOPY_EXECUTABLE, input: '' },
    ]);
  });

  test('leaves changed clipboard content untouched', async () => {
    const calls: string[] = [];
    const clipboard = new MacOSClipboard((executable) => {
      calls.push(executable);
      return Promise.resolve({ exitCode: 0, stdout: 'different', stderr: '' });
    }, 'darwin');

    expect(await clipboard.clearIfUnchanged('original')).toBe(false);
    expect(calls).toEqual([PBPASTE_EXECUTABLE]);
  });

  test('rejects secure delivery on unsupported platforms before spawning', async () => {
    let called = false;
    const clipboard = new MacOSClipboard(() => {
      called = true;
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    }, 'linux');

    const error = await capturedError(clipboard.write('secret'));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('requires macOS');
    expect(called).toBe(false);
  });
});
