import { execFile } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
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

/** systemd unit for Linux: a user service, so it needs no root either. */
export const UNIT_NAME = 'anything.service';

export function unitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', UNIT_NAME);
}

/** Quote one ExecStart argument the way systemd reads it. */
const unitArgument = (value: string) =>
  `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function serviceUnit(layout: ServiceLayout): string {
  const path = [dirname(layout.node), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(
    (entry, index, all) => all.indexOf(entry) === index
  );
  return `[Unit]
Description=AnyThing host
After=network-online.target

[Service]
ExecStart=${unitArgument(layout.node)} ${unitArgument(layout.entry)}
WorkingDirectory=${layout.workingDirectory.replace(/%/g, '%%')}
Environment=PATH=${path.join(':')}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

type Platform = 'mac' | 'linux';

function platform(): Platform {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return 'linux';
  throw new Error(
    'Running in the background is set up for macOS and Linux only. Start the host with: anything start'
  );
}

/** Where the installed service is described: the launchd plist or the systemd unit. */
export function definitionPath(): string {
  return platform() === 'mac' ? plistPath() : unitPath();
}

/** The command that follows the host's log on this platform. */
export function logCommand(): { command: string; args: string[] } {
  return platform() === 'mac'
    ? { command: 'tail', args: ['-n', '40', '-f', logPath()] }
    : { command: 'journalctl', args: ['--user', '-u', UNIT_NAME, '-n', '40', '-f'] };
}

const domain = () => `gui/${userInfo().uid}`;
const target = () => `${domain()}/${SERVICE_LABEL}`;

async function launchctl(...args: string[]): Promise<string> {
  const { stdout } = await run('launchctl', args);
  return stdout;
}

async function systemctl(...args: string[]): Promise<string> {
  try {
    const { stdout } = await run('systemctl', ['--user', ...args]);
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') throw new Error('systemd is not available on this machine');
    throw new Error((failure.stderr ?? failure.message).trim() || `systemctl ${args[0]} failed`);
  }
}

export async function serviceStatus(): Promise<ServiceStatus> {
  if (platform() === 'linux') {
    const installed = existsSync(unitPath());
    try {
      const text = await systemctl('show', UNIT_NAME, '-p', 'ActiveState', '-p', 'MainPID');
      const pid = Number(/^MainPID=(\d+)/m.exec(text)?.[1] ?? 0);
      const unit = installed ? await readFile(unitPath(), 'utf8') : '';
      return {
        installed,
        running: /^ActiveState=active/m.test(text),
        pid: pid > 0 ? pid : undefined,
        entry: /^ExecStart="[^"]*" "([^"]*)"/m.exec(unit)?.[1]
      };
    } catch {
      return { installed, running: false };
    }
  }

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

/**
 * Install (or replace) the service and start it. Resolves with a note for the
 * person when there is something left for them to do.
 */
export async function installService(
  layout: ServiceLayout = currentLayout()
): Promise<string | undefined> {
  const where = platform();
  if (!existsSync(layout.entry)) {
    throw new Error(`${layout.entry} does not exist. Build first: npm run build`);
  }

  if (where === 'linux') {
    await mkdir(dirname(unitPath()), { recursive: true });
    await writeFile(unitPath(), serviceUnit(layout), 'utf8');
    await systemctl('daemon-reload');
    await systemctl('enable', UNIT_NAME);
    await systemctl('restart', UNIT_NAME);
    // A user service stops when its user logs out unless lingering is on,
    // which is exactly wrong for a server nobody is logged in to.
    const user = userInfo().username;
    try {
      await run('loginctl', ['enable-linger', user]);
    } catch {
      return (
        'It will stop when you log out. To keep it running on a server, run once:\n' +
        `  sudo loginctl enable-linger ${user}`
      );
    }
    return undefined;
  }

  await mkdir(dirname(plistPath()), { recursive: true });
  await mkdir(dirname(layout.log), { recursive: true });
  await stopAgent();
  await writeFile(plistPath(), servicePlist(layout), 'utf8');
  await launchctl('bootstrap', domain(), plistPath());
  return undefined;
}

/** Whether the installed service runs this copy of AnyThing rather than another. */
export async function serviceIsOurs(layout: ServiceLayout = currentLayout()): Promise<boolean> {
  try {
    if (platform() === 'linux') {
      return (await readFile(unitPath(), 'utf8')).includes(unitArgument(layout.entry));
    }
    const plist = await readFile(plistPath(), 'utf8');
    return plist.includes(`<string>${escapeXml(layout.entry)}</string>`);
  } catch {
    return false;
  }
}

export async function uninstallService(): Promise<void> {
  if (platform() === 'linux') {
    if (existsSync(unitPath())) {
      await systemctl('disable', '--now', UNIT_NAME).catch(() => undefined);
      await rm(unitPath(), { force: true });
      await systemctl('daemon-reload');
    }
    return;
  }
  await stopAgent();
  await rm(plistPath(), { force: true });
}

export async function restartService(): Promise<void> {
  const where = platform();
  if (!existsSync(definitionPath())) {
    throw new Error('The background service is not installed. Run: anything service install');
  }
  if (where === 'linux') {
    await systemctl('restart', UNIT_NAME);
    return;
  }
  try {
    await launchctl('kickstart', '-k', target());
  } catch {
    await launchctl('bootstrap', domain(), plistPath());
  }
}
