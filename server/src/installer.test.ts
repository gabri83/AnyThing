import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  cloneInto,
  installPlugin,
  listInstalled,
  parseSource,
  removePlugin,
  updatePlugin
} from './installer';

const PLUGIN = `module.exports = { manifest: { id: 'demo', name: 'Demo', version: '1.0.0' }, setup() {} };\n`;

let root: string;
let pluginDir: string;

function pluginFolder(name: string, body = PLUGIN): string {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'index.js'), body);
  return folder;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'anything-installer-'));
  pluginDir = join(root, 'plugins');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('parseSource', () => {
  it('reads owner/repo as a GitHub repository and trims the naming prefix', () => {
    expect(parseSource('someone/anything-plugin-weather')).toEqual({
      kind: 'git',
      url: 'https://github.com/someone/anything-plugin-weather.git',
      ref: undefined,
      name: 'weather',
      display: 'github.com/someone/anything-plugin-weather'
    });
  });

  it('takes a branch or tag after # or from a /tree/ URL', () => {
    expect(parseSource('someone/clock#v1.2')).toMatchObject({ ref: 'v1.2', name: 'clock' });
    expect(parseSource('https://github.com/someone/clock/tree/next')).toMatchObject({
      url: 'https://github.com/someone/clock.git',
      ref: 'next'
    });
    expect(parseSource('https://github.com/someone/clock.git')).toMatchObject({
      url: 'https://github.com/someone/clock.git',
      name: 'clock'
    });
  });

  it('accepts other git hosts over https and ssh', () => {
    expect(parseSource('https://gitlab.com/group/sub/Timer.git')).toMatchObject({
      kind: 'git',
      url: 'https://gitlab.com/group/sub/Timer.git',
      name: 'timer'
    });
    expect(parseSource('git@example.com:me/lights.git')).toMatchObject({ kind: 'git', name: 'lights' });
  });

  it('reads a path as a folder', () => {
    expect(parseSource('/tmp/my-plugin')).toEqual({
      kind: 'path',
      path: '/tmp/my-plugin',
      name: 'my-plugin',
      display: '/tmp/my-plugin'
    });
    expect(parseSource('./local').kind).toBe('path');
  });

  it('refuses options, odd transports and nonsense', () => {
    for (const bad of ['', '--upload-pack=x', 'ext::sh -c id', 'file:///etc', 'http://example.com/x.git', 'word', 'a/b#bad ref']) {
      expect(() => parseSource(bad)).toThrow();
    }
  });
});

describe('installPlugin', () => {
  it('copies a folder in and records where it came from', async () => {
    const source = pluginFolder('anything-plugin-demo');
    const installed = await installPlugin(parseSource(source), pluginDir);

    expect(installed.name).toBe('demo');
    expect(readFileSync(join(pluginDir, 'demo', 'index.js'), 'utf8')).toBe(PLUGIN);
    expect(await listInstalled(pluginDir)).toEqual([
      { name: 'demo', source, ref: undefined, commit: undefined }
    ]);
  });

  it('refuses a folder with no index.js and leaves nothing behind', async () => {
    const source = join(root, 'not-a-plugin');
    mkdirSync(source);
    writeFileSync(join(source, 'README.md'), 'hello');

    await expect(installPlugin(parseSource(source), pluginDir)).rejects.toThrow(/no index\.js/);
    expect(await listInstalled(pluginDir)).toEqual([]);
    expect(existsSync(join(pluginDir, 'not-a-plugin'))).toBe(false);
  });

  it('will not overwrite an installed plugin unless asked to', async () => {
    const source = pluginFolder('demo');
    await installPlugin(parseSource(source), pluginDir);
    await expect(installPlugin(parseSource(source), pluginDir)).rejects.toThrow(/already installed/);
  });

  it('updates from the recorded source', async () => {
    const source = pluginFolder('demo');
    await installPlugin(parseSource(source), pluginDir);

    writeFileSync(join(source, 'index.js'), PLUGIN + '// v2\n');
    await updatePlugin('demo', pluginDir);
    expect(readFileSync(join(pluginDir, 'demo', 'index.js'), 'utf8')).toContain('// v2');
  });

  it('cannot update a folder somebody dropped in by hand', async () => {
    mkdirSync(join(pluginDir, 'manual'), { recursive: true });
    writeFileSync(join(pluginDir, 'manual', 'index.js'), PLUGIN);
    await expect(updatePlugin('manual', pluginDir)).rejects.toThrow(/source is unknown/);
  });

  it('removes a plugin, and only a plugin', async () => {
    await installPlugin(parseSource(pluginFolder('demo')), pluginDir);
    await removePlugin('demo', pluginDir);
    expect(await listInstalled(pluginDir)).toEqual([]);

    await expect(removePlugin('../plugins', pluginDir)).rejects.toThrow(/not a plugin folder name/);
    await expect(removePlugin('..', pluginDir)).rejects.toThrow();
    await expect(removePlugin('ghost', pluginDir)).rejects.toThrow(/No plugin called/);
  });
});

describe('cloneInto', () => {
  it('clones a repository, drops its history and reports the commit', () => {
    const repo = pluginFolder('repo');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args]);
    git('init', '--quiet');
    git('add', '.');
    git('commit', '--quiet', '-m', 'first');
    const head = git('rev-parse', 'HEAD').toString().trim();

    const destination = join(root, 'cloned');
    return cloneInto(repo, undefined, destination).then((commit) => {
      expect(commit).toBe(head);
      expect(existsSync(join(destination, 'index.js'))).toBe(true);
      expect(existsSync(join(destination, '.git'))).toBe(false);
    });
  });

  it('says so when the repository cannot be fetched', async () => {
    await expect(cloneInto(join(root, 'nowhere'), undefined, join(root, 'out'))).rejects.toThrow(
      /Could not fetch/
    );
  });
});
