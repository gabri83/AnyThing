import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { promisify } from 'util';

/**
 * Installing user plugins from GitHub, any git URL, or a folder on disk.
 *
 * A plugin is a folder with an `index.js` at its top level, so installing one
 * is fetching that folder into the user plugin directory. Nothing in here runs
 * the plugin's code: the host does that when it loads it, which is why the CLI
 * asks before installing.
 */

const run = promisify(execFile);

/** Written into each installed plugin so `update` knows where it came from. */
const SOURCE_FILE = '.anything-source.json';

export type PluginSource =
  | { kind: 'git'; url: string; ref?: string; name: string; display: string }
  | { kind: 'path'; path: string; name: string; display: string };

export interface InstalledPlugin {
  /** Folder name under the plugin directory. */
  name: string;
  /** Where it was installed from, when the installer put it there. */
  source?: string;
  ref?: string;
  commit?: string;
}

interface SourceRecord {
  source: string;
  ref?: string;
  commit?: string;
  installedAt: string;
}

/** `anything-plugin-weather.git` → `weather`. */
function folderName(text: string): string {
  const name = basename(text)
    .replace(/\.git$/i, '')
    .replace(/^anything-(plugin-)?/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!name) throw new Error(`Cannot work out a plugin name from "${text}"`);
  return name;
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

/**
 * Understand what the user typed:
 *
 *   owner/repo            a GitHub repository
 *   owner/repo#v1.2       ...at a branch or tag
 *   https://github.com/owner/repo[/tree/branch]
 *   https://host/some/repo.git, git@host:owner/repo.git
 *   ./folder, /abs/folder, ~/folder
 */
export function parseSource(input: string): PluginSource {
  const text = input.trim();
  if (!text || text.startsWith('-')) throw new Error('Give a GitHub repository, a git URL or a folder');

  const hash = text.indexOf('#');
  const body = hash === -1 ? text : text.slice(0, hash);
  const ref = hash === -1 ? undefined : text.slice(hash + 1) || undefined;
  if (ref !== undefined && !/^[\w./-]+$/.test(ref)) throw new Error(`"${ref}" is not a branch or tag name`);

  if (/^(\.{1,2}|~)?\//.test(body) || body === '.' || body === '..' || body === '~') {
    const path = resolve(expandHome(body));
    return { kind: 'path', path, name: folderName(path), display: path };
  }

  const github = /^(?:github:|https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+?))?\/?$/i.exec(
    body
  );
  if (github && !/^https?:$/i.test(github[1])) {
    const [, owner, repo, tree] = github;
    return {
      kind: 'git',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref ?? tree,
      name: folderName(repo),
      display: `github.com/${owner}/${repo}`
    };
  }

  if (/^https:\/\/[\w.-]+\/[\w./~-]+$/i.test(body) || /^git@[\w.-]+:[\w./~-]+$/i.test(body)) {
    return { kind: 'git', url: body, ref, name: folderName(body.replace(/\/$/, '')), display: body };
  }

  throw new Error(
    `Do not know how to install "${input}". Use owner/repo, an https or git@ URL, or a folder path.`
  );
}

/** Shallow-clone `url` into `destination` and return the commit it is at. */
export async function cloneInto(url: string, ref: string | undefined, destination: string): Promise<string> {
  const args = ['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, destination];
  try {
    await run('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') throw new Error('git is not installed');
    const reason = (failure.stderr ?? failure.message).trim().split('\n').pop();
    throw new Error(`Could not fetch ${url}${ref ? ` at ${ref}` : ''}: ${reason}`);
  }
  const { stdout } = await run('git', ['-C', destination, 'rev-parse', 'HEAD']);
  await rm(join(destination, '.git'), { recursive: true, force: true });
  return stdout.trim();
}

async function hasDependencies(folder: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(manifest.dependencies ?? {}).length > 0;
  } catch {
    return false;
  }
}

/**
 * Fetch a plugin into `pluginDir`. It is built in a hidden folder beside its
 * final place and moved in whole, so a failed install never leaves half a
 * plugin for the host to trip over.
 */
export async function installPlugin(
  source: PluginSource,
  pluginDir: string,
  options: { replace?: boolean } = {}
): Promise<InstalledPlugin> {
  const target = join(pluginDir, source.name);
  if (existsSync(target) && !options.replace) {
    throw new Error(
      `A plugin called "${source.name}" is already installed. ` +
        `Use: anything plugin update ${source.name}`
    );
  }

  await mkdir(pluginDir, { recursive: true });
  const staging = join(pluginDir, `.installing-${randomBytes(4).toString('hex')}`);

  try {
    let commit: string | undefined;
    if (source.kind === 'git') {
      commit = await cloneInto(source.url, source.ref, staging);
    } else {
      const info = await stat(source.path).catch(() => null);
      if (!info || !info.isDirectory()) throw new Error(`${source.path} is not a folder`);
      await cp(source.path, staging, {
        recursive: true,
        filter: (entry) => basename(entry) !== '.git'
      });
    }

    if (!existsSync(join(staging, 'index.js'))) {
      throw new Error(
        `${source.display} is not an AnyThing plugin: there is no index.js at its top level`
      );
    }

    if ((await hasDependencies(staging)) && !existsSync(join(staging, 'node_modules'))) {
      try {
        // Packages' install scripts are not run: fetching a plugin should not
        // execute anything.
        await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
          cwd: staging,
          timeout: 300_000
        });
      } catch (error) {
        const failure = error as { stderr?: string; message: string };
        throw new Error(
          `Could not install its dependencies: ${(failure.stderr ?? failure.message).trim().split('\n').pop()}`
        );
      }
    }

    const record: SourceRecord = {
      source: source.kind === 'git' ? source.url : source.path,
      ref: source.kind === 'git' ? source.ref : undefined,
      commit,
      installedAt: new Date().toISOString()
    };
    await writeFile(join(staging, SOURCE_FILE), JSON.stringify(record, null, 2) + '\n', 'utf8');

    if (existsSync(target)) {
      const retired = join(pluginDir, `.replaced-${randomBytes(4).toString('hex')}`);
      await rename(target, retired);
      await rename(staging, target);
      await rm(retired, { recursive: true, force: true });
    } else {
      await rename(staging, target);
    }

    return { name: source.name, source: record.source, ref: record.ref, commit };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function checkName(name: string): void {
  if (!/^[\w-][\w.-]*$/.test(name)) throw new Error(`"${name}" is not a plugin folder name`);
}

async function readRecord(folder: string): Promise<SourceRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(join(folder, SOURCE_FILE), 'utf8')) as SourceRecord;
    return typeof parsed.source === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Every plugin folder in `pluginDir`, with where it came from if known. */
export async function listInstalled(pluginDir: string): Promise<InstalledPlugin[]> {
  if (!existsSync(pluginDir)) return [];
  const found: InstalledPlugin[] = [];
  for (const name of (await readdir(pluginDir)).sort()) {
    if (name.startsWith('.') || !existsSync(join(pluginDir, name, 'index.js'))) continue;
    const record = await readRecord(join(pluginDir, name));
    found.push({ name, source: record?.source, ref: record?.ref, commit: record?.commit });
  }
  return found;
}

/** Fetch an installed plugin again from wherever it was installed from. */
export async function updatePlugin(name: string, pluginDir: string): Promise<InstalledPlugin> {
  checkName(name);
  const folder = join(pluginDir, name);
  if (!existsSync(folder)) throw new Error(`No plugin called "${name}" is installed`);
  const record = await readRecord(folder);
  if (!record) {
    throw new Error(`"${name}" was not installed with "anything plugin add", so its source is unknown`);
  }
  const source = parseSource(record.ref ? `${record.source}#${record.ref}` : record.source);
  return installPlugin({ ...source, name }, pluginDir, { replace: true });
}

export async function removePlugin(name: string, pluginDir: string): Promise<void> {
  checkName(name);
  const folder = join(pluginDir, name);
  if (!existsSync(folder)) throw new Error(`No plugin called "${name}" is installed`);
  await rm(folder, { recursive: true, force: true });
}
