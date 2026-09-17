import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface AnythingConfig {
  server: {
    /** '0.0.0.0' so the device can reach it. '127.0.0.1' to keep it local. */
    host: string;
    port: number;
  };
  auth: {
    /**
     * When the server listens beyond loopback, anyone on the network can
     * invoke actions — and the macros plugin runs shell commands. Auth is on
     * by default for that reason.
     */
    enabled: boolean;
    token: string;
  };
  /** Per-plugin config. `enabled: false` skips the plugin at load time. */
  plugins: Record<string, Record<string, unknown> & { enabled?: boolean }>;
}

export const DEFAULT_CONFIG: AnythingConfig = {
  server: { host: '0.0.0.0', port: 3000 },
  auth: { enabled: true, token: '' },
  plugins: {}
};

export function configPath(): string {
  if (process.env.ANYTHING_CONFIG) return process.env.ANYTHING_CONFIG;
  return join(homedir(), '.anything', 'config.json');
}

/** Directory user-authored plugins are loaded from. */
export function userPluginDir(): string {
  if (process.env.ANYTHING_PLUGIN_DIR) return process.env.ANYTHING_PLUGIN_DIR;
  return join(homedir(), '.anything', 'plugins');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge a parsed config over the defaults. Unknown keys are preserved so a
 * plugin can read config the host knows nothing about; malformed known keys
 * fall back to their default rather than crashing the host.
 */
export function normalizeConfig(raw: unknown): AnythingConfig {
  const source = isRecord(raw) ? raw : {};
  const server = isRecord(source.server) ? source.server : {};
  const auth = isRecord(source.auth) ? source.auth : {};

  const port = Number(server.port);
  return {
    server: {
      host: typeof server.host === 'string' ? server.host : DEFAULT_CONFIG.server.host,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_CONFIG.server.port
    },
    auth: {
      enabled: typeof auth.enabled === 'boolean' ? auth.enabled : true,
      token: typeof auth.token === 'string' ? auth.token : ''
    },
    plugins: isRecord(source.plugins) ? (source.plugins as AnythingConfig['plugins']) : {}
  };
}

/**
 * Load the config, creating it with a fresh token on first run. A token is
 * generated whenever auth is enabled and none is stored, and written back so
 * the same URL keeps working across restarts.
 */
export async function loadConfig(path = configPath()): Promise<AnythingConfig> {
  let config: AnythingConfig;

  if (existsSync(path)) {
    try {
      config = normalizeConfig(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      throw new Error(
        `Config at ${path} is not valid JSON: ${(error as Error).message}`
      );
    }
  } else {
    config = normalizeConfig(DEFAULT_CONFIG);
  }

  if (config.auth.enabled && !config.auth.token) {
    config.auth.token = randomBytes(16).toString('hex');
    await saveConfig(config, path);
  }

  return config;
}

export async function saveConfig(
  config: AnythingConfig,
  path = configPath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/** Config for one plugin, with the plugin's own defaults merged underneath. */
export function pluginConfig(
  config: AnythingConfig,
  pluginId: string,
  defaults: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...defaults, ...(config.plugins[pluginId] ?? {}) };
}
