export const PBCOPY_EXECUTABLE = '/usr/bin/pbcopy';
export const PBPASTE_EXECUTABLE = '/usr/bin/pbpaste';

export interface ClipboardCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ClipboardCommandRunner = (
  executable: string,
  input?: string,
) => Promise<ClipboardCommandResult>;

async function runClipboardCommand(
  executable: string,
  input?: string,
): Promise<ClipboardCommandResult> {
  const subprocess = Bun.spawn({
    cmd: [executable],
    stdin: input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (input !== undefined) {
    const stdin = subprocess.stdin;
    if (!stdin) throw new Error('Unable to open clipboard input pipe');
    await stdin.write(input);
    await stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

export interface SecureClipboard {
  write(value: string): Promise<void>;
  clearIfUnchanged(expectedValue: string): Promise<boolean>;
}

export class MacOSClipboard implements SecureClipboard {
  public constructor(
    private readonly runner: ClipboardCommandRunner = runClipboardCommand,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  public async write(value: string): Promise<void> {
    if (this.platform !== 'darwin') {
      throw new Error('Secure invitation clipboard delivery currently requires macOS');
    }
    const result = await this.runner(PBCOPY_EXECUTABLE, value);
    if (result.exitCode !== 0) {
      throw new Error(`Unable to copy invitation to clipboard: ${result.stderr.trim()}`);
    }
  }

  public async clearIfUnchanged(expectedValue: string): Promise<boolean> {
    const current = await this.runner(PBPASTE_EXECUTABLE);
    if (current.exitCode !== 0) {
      throw new Error(`Unable to read clipboard: ${current.stderr.trim()}`);
    }
    if (current.stdout !== expectedValue) return false;
    const cleared = await this.runner(PBCOPY_EXECUTABLE, '');
    if (cleared.exitCode !== 0) {
      throw new Error(`Unable to clear clipboard: ${cleared.stderr.trim()}`);
    }
    return true;
  }
}
