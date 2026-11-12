/**
 * The plugin contract.
 *
 * A plugin is a module whose default export is a `Plugin`. The host calls
 * `setup` once with an API object, and the plugin uses it to publish tiles and
 * register action handlers. Everything a plugin schedules through the API is
 * cleaned up for it when the host tears it down, so `teardown` is optional.
 *
 * See docs/PLUGINS.md for a walkthrough.
 */

import type { ControlBindings } from './controls';
import type { PromptSpec } from './protocol';
import type { Tile } from './tiles';

export interface PluginManifest {
  /** Stable, unique, kebab-case. Used in action routing and config keys. */
  id: string;
  /** Shown in the page switcher and the CLI. */
  name: string;
  version: string;
  /** Shown in the CLI listing. */
  description?: string;
  /** Single character or emoji for the page switcher. */
  icon?: string;
  /**
   * Platforms the plugin can run on, as `process.platform` values. A plugin
   * listing platforms it does not match is skipped with a logged reason
   * instead of failing to load.
   */
  platforms?: string[];
  /** Defaults merged under any user config for this plugin. */
  defaultConfig?: Record<string, unknown>;
}

/** What the host hands a plugin at setup time. */
export interface PluginApi {
  /** User config for this plugin, with `defaultConfig` merged underneath. */
  readonly config: Record<string, unknown>;

  /** Host platform, for plugins that support several. */
  readonly platform: string;
  readonly arch: string;

  /** Namespaced logger. Prefer this over console so output stays attributable. */
  log(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;

  /**
   * Publish this plugin's tiles, replacing any previous set. Cheap to call
   * often — the host diffs and only broadcasts real changes.
   */
  setTiles(tiles: Tile[]): void;

  /**
   * Register a handler for an action id referenced by a tile. Registering the
   * same id twice replaces the handler.
   */
  onAction(id: string, handler: ActionHandler): void;

  /**
   * Bind the device's physical controls — dial, back button, presets — to your
   * action ids. They apply only while your page is the active one, so each
   * plugin can give the dial its own meaning.
   *
   * The `rotate` action is invoked with `{ delta }`: signed dial steps, several
   * at a time when the dial is spun quickly. Scale by delta rather than
   * treating each call as one click, or a fast spin will feel unresponsive.
   */
  setControls(bindings: ControlBindings): void;

  /**
   * Run `fn` every `ms` milliseconds until teardown. The first run happens
   * immediately. Overlapping runs are skipped rather than queued, so a slow
   * poll cannot pile up.
   */
  every(ms: number, fn: () => void | Promise<void>): void;

  /**
   * Serve a file at `/files/<plugin id>/<name>`, for artwork and the like.
   * Returns the URL the tile should use. Passing null unregisters it.
   */
  serveFile(name: string, absolutePath: string | null): string;

  /** Show a transient message on connected devices. */
  notify(level: 'info' | 'warn' | 'error', message: string): void;

  /**
   * Ask the user something that takes over the device screen until answered.
   * Resolves with the id of the chosen choice, or null if nobody answered
   * within `timeoutMs`, the prompt was dismissed, or the plugin was torn down.
   */
  prompt(spec: PromptSpec, options?: PromptOptions): Promise<string | null>;

  /** Withdraw a prompt early, e.g. because it was answered somewhere else. */
  dismissPrompt(id: string): void;

  /**
   * Receive HTTP requests at `/hooks/<plugin id>/<path>` — a webhook for other
   * programs on this Mac to push events to your plugin. Only requests from the
   * Mac itself are accepted; the device and the network cannot reach it.
   * The handler may take its time: the response is sent when it resolves.
   */
  onRequest(path: string, handler: RequestHandler): void;

  /** Bring this plugin's page to the front on connected devices. */
  focus(): void;
}

export interface PromptOptions {
  /** Your own id for the prompt, for `dismissPrompt`. Generated when omitted. */
  id?: string;
  /** Give up and resolve null after this long. Default: wait indefinitely. */
  timeoutMs?: number;
}

/** What a webhook handler receives. */
export interface HookRequest {
  method: string;
  /** Query string parameters. */
  query: Record<string, string>;
  /** Parsed JSON body, or undefined when there was none. */
  body: unknown;
}

/** What a webhook handler returns. Return nothing for an empty 200. */
export interface HookResponse {
  status?: number;
  /** Sent as JSON. */
  body?: unknown;
}

export type RequestHandler = (
  request: HookRequest
) => HookResponse | void | Promise<HookResponse | void>;

export type ActionHandler = (payload: unknown) => void | Promise<void>;

export interface Plugin {
  manifest: PluginManifest;
  /** Called once when the plugin loads. Throwing here fails the load cleanly. */
  setup(api: PluginApi): void | Promise<void>;
  /** Called before unload. Timers and files registered via the API are already handled. */
  teardown?(): void | Promise<void>;
}

/** Convenience for plugin authors: `export default definePlugin({ ... })`. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
