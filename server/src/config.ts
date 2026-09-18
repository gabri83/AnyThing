import { randomBytes } from 'crypto';
import {
  DEFAULT_INPUT_CONFIG,
  INPUT_GESTURES,
  type InputConfig,
  type InputGesture
} from '@anything/shared';
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
    /**
     * Allow settings writes from other machines. Off by default: editing
     * macros writes shell commands the host will run, which is a bigger
     * capability than triggering one someone already configured.
     */
    allowRemoteConfig: boolean;
  };
  /**
   * How the device's physical controls are read. Sent to every client, so the
   * mapping lives in one place rather than being baked into the UI.
   */
  input: InputConfig;
  /** Per-plugin config. `enabled: false` skips the plugin at load time. */
  plugins: Record<string, Record<string, unknown> & { enabled?: boolean }>;
}

export const DEFAULT_CONFIG: AnythingConfig = {
  server: { host: '0.0.0.0', port: 3000 },
  auth: { enabled: true, token: '', allowRemoteConfig: false },
  input: DEFAULT_INPUT_CONFIG,
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
 * Validate an input config, keeping only bindings that name a real gesture.
 *
 * A keymap is the thing a user hand-edits after watching the input inspector,
 * so a typo is likely. One bad entry drops that key rather than the whole
 * mapping, and a keymap that ends up empty falls back to the defaults so the
 * device is never left with no controls at all.
 */
export function normalizeInput(raw: unknown): InputConfig {
  if (!isRecord(raw)) return DEFAULT_INPUT_CONFIG;

  const keymap: Record<string, InputGesture> = {};
  if (isRecord(raw.keymap)) {
    for (const [key, gesture] of Object.entries(raw.keymap)) {
      if (typeof gesture === 'string' && INPUT_GESTURES.includes(gesture as InputGesture)) {
        keymap[key] = gesture as InputGesture;
      }
    }
  }

  const flush = Number(raw.rotateFlushMs);
  return {
    keymap: Object.keys(keymap).length > 0 ? keymap : DEFAULT_INPUT_CONFIG.keymap,
    wheel: typeof raw.wheel === 'boolean' ? raw.wheel : DEFAULT_INPUT_CONFIG.wheel,
    wheelInvert:
      typeof raw.wheelInvert === 'boolean'
        ? raw.wheelInvert
        : DEFAULT_INPUT_CONFIG.wheelInvert,
    rotateFlushMs:
      Number.isFinite(flush) && flush >= 0 && flush <= 1000
        ? flush
        : DEFAULT_INPUT_CONFIG.rotateFlushMs
  };
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

  // Port 0 is kept as-is and means "any free port", the usual convention. The
  // real port is then only knowable after binding, which is why the printed
  // URL comes from the listener rather than from this value.
  const port = Number(server.port);
  return {
    server: {
      host: typeof server.host === 'string' ? server.host : DEFAULT_CONFIG.server.host,
      port:
        Number.isInteger(port) && port >= 0 && port < 65536
          ? port
          : DEFAULT_CONFIG.server.port
    },
    auth: {
      enabled: typeof auth.enabled === 'boolean' ? auth.enabled : true,
      token: typeof auth.token === 'string' ? auth.token : '',
      allowRemoteConfig:
        typeof auth.allowRemoteConfig === 'boolean' ? auth.allowRemoteConfig : false
    },
    input: normalizeInput(source.input),
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
