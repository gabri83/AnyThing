import { EventEmitter } from 'events';
import { isAbsolute } from 'path';
import type {
  ActionHandler,
  Page,
  Plugin,
  PluginApi,
  Tile
} from '@anything/shared';
import { type AnythingConfig, pluginConfig } from './config';

type NoticeLevel = 'info' | 'warn' | 'error';

interface LoadedPlugin {
  plugin: Plugin;
  tiles: Tile[];
  /** Serialized tiles, kept to suppress no-op broadcasts. */
  tilesFingerprint: string;
  actions: Map<string, ActionHandler>;
  timers: NodeJS.Timeout[];
  /** Served file name -> absolute path on disk. */
  files: Map<string, string>;
}

/**
 * Owns the loaded plugins: their tiles, their action handlers, and everything
 * they schedule. The host knows nothing about music, macros or sensors — it
 * only moves tiles outward and invocations inward.
 *
 * Emits:
 *   'pages'  (pages: Page[])                  plugin set changed
 *   'tiles'  (pluginId: string, tiles: Tile[]) one plugin's tiles changed
 *   'notice' (level, message)                  transient message for devices
 */
export class PluginHost extends EventEmitter {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly config: AnythingConfig;

  constructor(config: AnythingConfig) {
    super();
    this.config = config;
  }

  /**
   * Load one plugin. Returns false with a logged reason when the plugin is
   * disabled in config or does not support this platform — neither is an error.
   * A plugin whose `setup` throws is rolled back so a bad plugin cannot leave
   * timers or half-registered actions behind.
   */
  public async register(plugin: Plugin): Promise<boolean> {
    const { manifest } = plugin;

    if (!manifest?.id) {
      throw new Error('Plugin manifest is missing an id');
    }
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Duplicate plugin id: ${manifest.id}`);
    }

    const settings = pluginConfig(this.config, manifest.id, manifest.defaultConfig);
    if (settings.enabled === false) {
      console.log(`[host] ${manifest.id} disabled in config, skipping`);
      return false;
    }
    if (manifest.platforms && !manifest.platforms.includes(process.platform)) {
      console.log(
        `[host] ${manifest.id} supports ${manifest.platforms.join(', ')} ` +
          `but this host is ${process.platform}, skipping`
      );
      return false;
    }

    const entry: LoadedPlugin = {
      plugin,
      tiles: [],
      tilesFingerprint: '[]',
      actions: new Map(),
      timers: [],
      files: new Map()
    };
    this.plugins.set(manifest.id, entry);

    try {
      await plugin.setup(this.makeApi(manifest.id, settings, entry));
    } catch (error) {
      this.clearResources(entry);
      this.plugins.delete(manifest.id);
      throw new Error(
        `Plugin ${manifest.id} failed to set up: ${(error as Error).message}`
      );
    }

    console.log(`[host] loaded ${manifest.id} v${manifest.version}`);
    this.emit('pages', this.pages());
    return true;
  }

  private makeApi(
    id: string,
    settings: Record<string, unknown>,
    entry: LoadedPlugin
  ): PluginApi {
    return {
      config: settings,
      platform: process.platform,
      arch: process.arch,

      log: (message, ...rest) => console.log(`[${id}] ${message}`, ...rest),
      warn: (message, ...rest) => console.warn(`[${id}] ${message}`, ...rest),

      setTiles: (tiles: Tile[]) => {
        const fingerprint = JSON.stringify(tiles);
        if (fingerprint === entry.tilesFingerprint) return;
        entry.tiles = tiles;
        entry.tilesFingerprint = fingerprint;
        this.emit('tiles', id, tiles);
      },

      onAction: (actionId: string, handler: ActionHandler) => {
        entry.actions.set(actionId, handler);
      },

      every: (ms: number, fn: () => void | Promise<void>) => {
        if (!Number.isFinite(ms) || ms < 50) {
          throw new Error(`every() interval must be >= 50ms, got ${ms}`);
        }
        let running = false;
        const tick = async () => {
          // Skip rather than queue: a poll slower than its interval must not
          // pile up behind itself.
          if (running) return;
          running = true;
          try {
            await fn();
          } catch (error) {
            console.warn(`[${id}] scheduled task failed:`, (error as Error).message);
          } finally {
            running = false;
          }
        };
        void tick();
        entry.timers.push(setInterval(tick, ms));
      },

      serveFile: (name: string, absolutePath: string | null) => {
        if (name.includes('/') || name.includes('..')) {
          throw new Error(`serveFile name must be a bare filename, got "${name}"`);
        }
        if (absolutePath === null) {
          entry.files.delete(name);
        } else {
          if (!isAbsolute(absolutePath)) {
            throw new Error(`serveFile needs an absolute path, got "${absolutePath}"`);
          }
          entry.files.set(name, absolutePath);
        }
        return `/files/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
      },

      notify: (level: NoticeLevel, message: string) => {
        this.emit('notice', level, message);
      }
    };
  }

  /** Every loaded plugin's current page, in load order. */
  public pages(): Page[] {
    return [...this.plugins.entries()].map(([id, entry]) => ({
      plugin: id,
      title: entry.plugin.manifest.name,
      icon: entry.plugin.manifest.icon,
      tiles: entry.tiles
    }));
  }

  public tilesFor(pluginId: string): Tile[] | undefined {
    return this.plugins.get(pluginId)?.tiles;
  }

  public has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  public ids(): string[] {
    return [...this.plugins.keys()];
  }

  /** Absolute path a plugin registered under `name`, if any. */
  public resolveFile(pluginId: string, name: string): string | undefined {
    return this.plugins.get(pluginId)?.files.get(name);
  }

  /**
   * Route an invocation to its plugin. Unknown plugins and actions are
   * reported rather than thrown: the caller is a network client, and a stale
   * device layout should not take the host down.
   */
  public async invoke(
    pluginId: string,
    actionId: string,
    payload?: unknown
  ): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) {
      this.emit('notice', 'warn', `No such plugin: ${pluginId}`);
      return;
    }
    const handler = entry.actions.get(actionId);
    if (!handler) {
      this.emit('notice', 'warn', `${pluginId} has no action "${actionId}"`);
      return;
    }
    try {
      await handler(payload);
    } catch (error) {
      const message = (error as Error).message;
      console.warn(`[${pluginId}] action ${actionId} failed:`, message);
      this.emit('notice', 'error', `${pluginId}: ${message}`);
    }
  }

  private clearResources(entry: LoadedPlugin): void {
    for (const timer of entry.timers) clearInterval(timer);
    entry.timers.length = 0;
    entry.actions.clear();
    entry.files.clear();
  }

  /** Tear down every plugin, clearing its timers first so none fire mid-exit. */
  public async teardown(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      this.clearResources(entry);
      try {
        await entry.plugin.teardown?.();
      } catch (error) {
        console.warn(`[${id}] teardown failed:`, (error as Error).message);
      }
    }
    this.plugins.clear();
  }
}
