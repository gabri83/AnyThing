import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { isAbsolute } from 'path';
import type {
  ActionHandler,
  ControlBindings,
  HookRequest,
  HookResponse,
  Page,
  Plugin,
  PluginApi,
  PromptOptions,
  PromptSpec,
  RequestHandler,
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
  /** Physical control bindings, active while this plugin's page is showing. */
  controls: ControlBindings;
  timers: NodeJS.Timeout[];
  /** Served file name -> absolute path on disk. */
  files: Map<string, string>;
  /** Webhook path -> handler. */
  requests: Map<string, RequestHandler>;
}

/** A prompt on screen, as sent to devices. */
export type ActivePrompt = PromptSpec & { id: string; plugin: string };

interface PendingPrompt {
  prompt: ActivePrompt;
  resolve: (choice: string | null) => void;
  timer: NodeJS.Timeout | null;
}

/** Webhook paths are compared without leading or trailing slashes. */
function normalizeHookPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Owns the loaded plugins: their tiles, their action handlers, and everything
 * they schedule. The host knows nothing about music, macros or sensors — it
 * only moves tiles outward and invocations inward.
 *
 * Emits:
 *   'pages'    (pages: Page[])                    plugin set changed
 *   'tiles'    (pluginId: string, tiles: Tile[])   one plugin's tiles changed
 *   'controls' (pluginId: string, ControlBindings) one plugin's bindings changed
 *   'notice'   (level, message)                    transient message for devices
 *   'prompts'  (prompts: ActivePrompt[])           the set awaiting an answer changed
 *   'focus'    (pluginId: string)                  a plugin wants its page in front
 */
export class PluginHost extends EventEmitter {
  private readonly plugins = new Map<string, LoadedPlugin>();
  /** Prompts awaiting an answer, in the order they were asked. */
  private readonly prompts = new Map<string, PendingPrompt>();
  private config: AnythingConfig;

  constructor(config: AnythingConfig) {
    super();
    this.config = config;
  }

  /**
   * Swap the config used for subsequent registrations. Already-loaded plugins
   * keep the config they were set up with, so this is only meaningful together
   * with a teardown and reload.
   */
  public setConfig(config: AnythingConfig): void {
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
      controls: {},
      timers: [],
      files: new Map(),
      requests: new Map()
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

      setControls: (bindings: ControlBindings) => {
        entry.controls = bindings;
        this.emit('controls', id, bindings);
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
      },

      prompt: (spec: PromptSpec, options: PromptOptions = {}) => {
        if (!spec || typeof spec.title !== 'string' || !Array.isArray(spec.choices)) {
          throw new Error('prompt() needs a title and a choices array');
        }
        if (spec.choices.length === 0) {
          throw new Error('prompt() needs at least one choice');
        }
        const promptId = options.id ?? randomBytes(6).toString('hex');
        // Re-asking under the same id replaces the earlier prompt.
        this.settlePrompt(promptId, null);

        return new Promise<string | null>((resolve) => {
          const timeout = options.timeoutMs;
          const timer =
            typeof timeout === 'number' && timeout > 0
              ? setTimeout(() => this.settlePrompt(promptId, null), timeout)
              : null;
          this.prompts.set(promptId, {
            prompt: { ...spec, id: promptId, plugin: id },
            resolve,
            timer
          });
          this.emit('prompts', this.pendingPrompts());
        });
      },

      dismissPrompt: (promptId: string) => {
        if (this.prompts.get(promptId)?.prompt.plugin === id) {
          this.settlePrompt(promptId, null);
        }
      },

      onRequest: (path: string, handler: RequestHandler) => {
        entry.requests.set(normalizeHookPath(path), handler);
      },

      focus: () => {
        this.emit('focus', id);
      }
    };
  }

  /** Resolve a prompt and take it off the screens. Unknown ids are ignored. */
  private settlePrompt(promptId: string, choice: string | null): boolean {
    const pending = this.prompts.get(promptId);
    if (!pending) return false;
    this.prompts.delete(promptId);
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(choice);
    this.emit('prompts', this.pendingPrompts());
    return true;
  }

  /** Prompts awaiting an answer, oldest first. */
  public pendingPrompts(): ActivePrompt[] {
    return [...this.prompts.values()].map((pending) => pending.prompt);
  }

  /**
   * A device answered a prompt. Returns false when the prompt is gone or the
   * choice is not one it offered — a stale screen must not answer for the user.
   */
  public answerPrompt(promptId: string, choice: string): boolean {
    const pending = this.prompts.get(promptId);
    if (!pending) return false;
    if (!pending.prompt.choices.some((candidate) => candidate.id === choice)) {
      return false;
    }
    return this.settlePrompt(promptId, choice);
  }

  /**
   * Route a webhook request to the plugin that registered the path. Returns
   * null when no plugin did, so the caller can answer 404.
   */
  public async handleRequest(
    pluginId: string,
    path: string,
    request: HookRequest
  ): Promise<HookResponse | null> {
    const handler = this.plugins.get(pluginId)?.requests.get(normalizeHookPath(path));
    if (!handler) return null;
    try {
      return (await handler(request)) ?? {};
    } catch (error) {
      const message = (error as Error).message;
      console.warn(`[${pluginId}] webhook ${path} failed:`, message);
      return { status: 500, body: { error: message } };
    }
  }

  /** Every loaded plugin's current page, in load order. */
  public pages(): Page[] {
    return [...this.plugins.entries()].map(([id, entry]) => ({
      plugin: id,
      title: entry.plugin.manifest.name,
      icon: entry.plugin.manifest.icon,
      tiles: entry.tiles,
      controls: entry.controls
    }));
  }

  public tilesFor(pluginId: string): Tile[] | undefined {
    return this.plugins.get(pluginId)?.tiles;
  }

  public controlsFor(pluginId: string): ControlBindings | undefined {
    return this.plugins.get(pluginId)?.controls;
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
    entry.requests.clear();
    // Nobody is left to hear the answer, so take the plugin's prompts down.
    const id = entry.plugin.manifest.id;
    for (const [promptId, pending] of [...this.prompts]) {
      if (pending.prompt.plugin === id) this.settlePrompt(promptId, null);
    }
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
