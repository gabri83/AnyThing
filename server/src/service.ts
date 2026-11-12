import { execFile } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { homedir, userInfo } from 'os';
import { delimiter, dirname, join, resolve } from 'path';
import { promisify } from 'util';

/**
 * Running the host in the background on macOS: a per-user launchd agent that
 * starts at login and is restarted if it stops. Nothing here needs sudo.
 */

const run = promisify(execFile);

export const SERVICE_LABEL = 'local.anything';

export interface ServiceLayout {
  /** The node binary that will run the host. */
  node: string;
  /** Absolute path of the host's entry file. */
  entry: string;
  /** Where the host is started from. */
  workingDirectory: string;
  log: string;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  /** The entry file the installed agent runs, when it can be read back. */
  entry?: string;
}

export function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

export function logPath(): string {
  return join(homedir(), 'Library', 'Logs', 'anything.log');
}

/**
 * A path to the running node that survives an upgrade. `process.execPath` is
 * the real file, which for Homebrew sits in a versioned folder that the next
 * `brew upgrade` deletes; the `node` on PATH that points at it does not move.
 */
export function stableNode(
  execPath: string = process.execPath,
  searchPath: string = process.env.PATH ?? ''
): string {
  let real: string;
  try {
    real = realpathSync(execPath);
  } catch {
    return execPath;
  }
  for (const folder of searchPath.split(delimiter)) {
    if (!folder) continue;
    const candidate = join(folder, 'node');
    try {
      if (realpathSync(candidate) === real) return candidate;
    } catch {
      // not there
    }
  }
  return execPath;
}

/** The layout for the copy of AnyThing this file is part of. */
export function currentLayout(): ServiceLayout {
  return {
    node: stableNode(),
    entry: join(__dirname, 'index.js'),
    workingDirectory: resolve(__dirname, '..', '..'),
    log: logPath()
  };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function servicePlist(layout: ServiceLayout): string {
  // launchd starts agents with a bare PATH. Plugins shell out (osascript, ssh,
  // shortcuts, whatever a macro names), so give them the usual places plus
  // wherever this node lives.
  const path = [
    dirname(layout.node),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].filter((entry, index, all) => all.indexOf(entry) === index);

  const string = (value: string) => `<string>${escapeXml(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    ${string(SERVICE_LABEL)}
    <key>ProgramArguments</key>
    <array>
        ${string(layout.node)}
        ${string(layout.entry)}
    </array>
    <key>WorkingDirectory</key>
    ${string(layout.workingDirectory)}
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        ${string(path.join(':'))}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    ${string(layout.log)}
    <key>StandardErrorPath</key>
    ${string(layout.log)}
</dict>
</plist>
`;
}

function requireMac(): void {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Running in the background is set up for macOS only. Start the host with: anything start'
    );
  }
}

const domain = () => `gui/${userInfo().uid}`;
const target = () => `${domain()}/${SERVICE_LABEL}`;

async function launchctl(...args: string[]): Promise<string> {
  const { stdout } = await run('launchctl', args);
  return stdout;
}

export async function serviceStatus(): Promise<ServiceStatus> {
  requireMac();
  const installed = existsSync(plistPath());
  try {
    const text = await launchctl('print', target());
    const pid = /^\s*pid = (\d+)/m.exec(text);
    const args = /arguments = \{\s*([\s\S]*?)\}/.exec(text);
    const entry = args ? args[1].trim().split('\n').map((line) => line.trim())[1] : undefined;
    return {
      installed,
      running: /^\s*state = running/m.test(text),
      pid: pid ? Number(pid[1]) : undefined,
      entry
    };
  } catch {
    return { installed, running: false };
  }
}

async function stopAgent(): Promise<void> {
  try {
    await launchctl('bootout', target());
  } catch {
    return; // not loaded
  }
  // bootout returns before the process is gone, and bootstrapping the same
  // label while it is still exiting fails.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await launchctl('print', target());
    } catch {
      return;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** Install (or replace) the agent and start it. */
export async function installService(layout: ServiceLayout = currentLayout()): Promise<void> {
  requireMac();
  if (!existsSync(layout.entry)) {
    throw new Error(`${layout.entry} does not exist. Build first: npm run build`);
  }
  await mkdir(dirname(plistPath()), { recursive: true });
  await mkdir(dirname(layout.log), { recursive: true });
  await stopAgent();
  await writeFile(plistPath(), servicePlist(layout), 'utf8');
  await launchctl('bootstrap', domain(), plistPath());
}

export async function uninstallService(): Promise<void> {
  requireMac();
  await stopAgent();
  await rm(plistPath(), { force: true });
}

export async function restartService(): Promise<void> {
  requireMac();
  if (!existsSync(plistPath())) {
    throw new Error('The background service is not installed. Run: anything service install');
  }
  try {
    await launchctl('kickstart', '-k', target());
  } catch {
    await launchctl('bootstrap', domain(), plistPath());
  }
}
