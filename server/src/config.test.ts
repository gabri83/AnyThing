import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig, normalizeConfig, pluginConfig, saveConfig } from './config';

async function scratchFile(name = 'config.json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'anything-config-'));
  return join(dir, name);
}

describe('normalizeConfig', () => {
  it('fills in defaults for an empty object', () => {
    expect(normalizeConfig({})).toEqual({
      server: { host: '0.0.0.0', port: 3000 },
      auth: { enabled: true, token: '' },
      plugins: {}
    });
  });

  it('keeps valid values', () => {
    const config = normalizeConfig({
      server: { host: '127.0.0.1', port: 8080 },
      auth: { enabled: false, token: 'abc' },
      plugins: { sysmon: { pollMs: 500 } }
    });
    expect(config.server).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(config.auth).toEqual({ enabled: false, token: 'abc' });
    expect(config.plugins.sysmon).toEqual({ pollMs: 500 });
  });

  it('falls back on a malformed port rather than binding to nonsense', () => {
    expect(normalizeConfig({ server: { port: 'http' } }).server.port).toBe(3000);
    expect(normalizeConfig({ server: { port: 0 } }).server.port).toBe(3000);
    expect(normalizeConfig({ server: { port: 70_000 } }).server.port).toBe(3000);
    expect(normalizeConfig({ server: { port: 3.5 } }).server.port).toBe(3000);
  });

  it('defaults auth to on when the value is not a boolean', () => {
    // A typo like "enabled": "no" must not silently open the host up.
    expect(normalizeConfig({ auth: { enabled: 'no' } }).auth.enabled).toBe(true);
    expect(normalizeConfig({ auth: {} }).auth.enabled).toBe(true);
  });

  it('survives a non-object config', () => {
    expect(normalizeConfig(null).server.port).toBe(3000);
    expect(normalizeConfig('nope').auth.enabled).toBe(true);
    expect(normalizeConfig([1, 2]).plugins).toEqual({});
  });
});

describe('pluginConfig', () => {
  it('layers user config over plugin defaults', () => {
    const config = normalizeConfig({ plugins: { sysmon: { pollMs: 5000 } } });
    expect(pluginConfig(config, 'sysmon', { pollMs: 2000, sensors: true })).toEqual({
      pollMs: 5000,
      sensors: true
    });
  });

  it('returns the defaults for a plugin with no user config', () => {
    expect(pluginConfig(normalizeConfig({}), 'ghost', { a: 1 })).toEqual({ a: 1 });
  });
});

describe('loadConfig', () => {
  it('generates and persists a token on first run', async () => {
    const path = await scratchFile();
    const config = await loadConfig(path);

    expect(config.auth.token).toMatch(/^[0-9a-f]{32}$/);

    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.auth.token).toBe(config.auth.token);
  });

  it('keeps an existing token across loads', async () => {
    const path = await scratchFile();
    const first = await loadConfig(path);
    const second = await loadConfig(path);
    expect(second.auth.token).toBe(first.auth.token);
  });

  it('does not mint a token when auth is disabled', async () => {
    const path = await scratchFile();
    await saveConfig(
      { ...normalizeConfig({}), auth: { enabled: false, token: '' } },
      path
    );
    expect((await loadConfig(path)).auth.token).toBe('');
  });

  it('names the file when the JSON is broken', async () => {
    const path = await scratchFile();
    await writeFile(path, '{ "server": ', 'utf8');
    await expect(loadConfig(path)).rejects.toThrow(
      new RegExp(`Config at ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not valid JSON`)
    );
  });

  it('round-trips through saveConfig', async () => {
    const path = await scratchFile('nested/config.json');
    const config = normalizeConfig({
      server: { host: '10.0.0.5', port: 4000 },
      plugins: { macros: { enabled: false } }
    });
    await saveConfig(config, path);
    expect(await loadConfig(path)).toMatchObject({
      server: { host: '10.0.0.5', port: 4000 },
      plugins: { macros: { enabled: false } }
    });
  });
});
