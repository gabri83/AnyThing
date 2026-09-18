import { execFile } from 'child_process';

export class OsascriptUnavailableError extends Error {
  constructor(platform: string) {
    super(`AppleScript is only available on macOS (this host is ${platform})`);
    this.name = 'OsascriptUnavailableError';
  }
}

/**
 * Field separator for scripts returning several values in one string. ASCII
 * unit separator, so a track title containing a tab or pipe cannot split a
 * record.
 */
export const FIELD_SEPARATOR = String.fromCharCode(31);

/** AppleScript expression producing the same separator. */
export const FIELD_SEPARATOR_AS = '(ASCII character 31)';

/**
 * Run an AppleScript and return its trimmed stdout.
 *
 * This deliberately spawns `osascript` directly rather than going through a
 * wrapper library: `execFile` surfaces a missing binary as a rejected promise,
 * where a library that emits an 'error' event on the child process takes the
 * whole host down with an unhandled error when osascript is absent.
 */
export async function runAppleScript(
  script: string,
  timeoutMs = 5000
): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new OsascriptUnavailableError(process.platform);
  }

  return new Promise<string>((resolvePromise, reject) => {
    const child = execFile(
      'osascript',
      ['-'],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolvePromise(stdout.trim());
      }
    );
    child.on('error', reject);
    child.stdin?.end(script);
  });
}

/** Run a script whose fields are joined by FIELD_SEPARATOR, and split them. */
export async function runAppleScriptFields(
  script: string,
  timeoutMs = 5000
): Promise<string[]> {
  const output = await runAppleScript(script, timeoutMs);
  return output.split(FIELD_SEPARATOR);
}

/** True when `command` resolves on PATH. Used to probe optional helper tools. */
export async function commandExists(command: string): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    execFile('/usr/bin/which', [command], { timeout: 2000 }, (error, stdout) => {
      resolvePromise(!error && stdout.trim().length > 0);
    });
  });
}

/** Run an arbitrary command, resolving with its stdout. */
export async function run(
  command: string,
  args: string[],
  timeoutMs = 5000
): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolvePromise(stdout.trim());
      }
    );
  });
}
