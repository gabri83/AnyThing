import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { dirname, join, sep } from 'path';
import type { Plugin } from '@anything/shared';
import type { PluginHost } from './host';

import appleMusic from './plugins/apple-music';
import calendar from './plugins/calendar';
import claudeCode from './plugins/claude-code';
import macros from './plugins/macros';
import prometheus from './plugins/prometheus';
import sysmon from './plugins/sysmon';
import todo from './plugins/todo';

/** Plugins that ship with the host. */
export const builtinPlugins: Plugin[] = [appleMusic, macros, todo, calendar, claudeCode, sysmon, prometheus];

function looksLikePlugin(value: unknown): value is Plugin {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Plugin>;
  return (
    typeof candidate.setup === 'function' &&
    typeof candidate.manifest === 'object' &&
    candidate.manifest !== null &&
    typeof candidate.manifest.id === 'string' &&
    typeof candidate.manifest.version === 'string'
  );
}

/**
 * Load a plugin module from disk. Accepts both `export default` and a bare
 * `module.exports =`, since plugin authors write plain CommonJS.
 */
export function loadPluginModule(entryPath: string): Plugin {
  // Forget the plugin's files first, so a reload after an update or an edit
  // runs the code that is on disk now rather than what was loaded at start-up.
  const folder = dirname(entryPath) + sep;
  for (const cached of Object.keys(require.cache)) {
    if (cached.startsWith(folder)) delete require.cache[cached];
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const module = require(entryPath);
  const candidate = module?.default ?? module;
  if (!looksLikePlugin(candidate)) {
    throw new Error(
      `${entryPath} does not export a plugin ` +
        `(need { manifest: { id, version }, setup() })`
    );
  }
  return candidate;
}

/**
 * Register the built-in plugins, then any user plugin in `dir`. One plugin
 * failing to load is logged and skipped — a broken third-party plugin must not
 * stop the host from starting.
 */
export async function loadAll(host: PluginHost, dir: string): Promise<void> {
  for (const plugin of builtinPlugins) {
    try {
      await host.register(plugin);
    } catch (error) {
      console.warn(`[loader] ${(error as Error).message}`);
    }
  }
  await loadUserPlugins(host, dir);
}

/**
 * Load every plugin in `dir`. A user plugin is a directory containing
 * `index.js` — see docs/PLUGINS.md.
 */
export async function loadUserPlugins(host: PluginHost, dir: string): Promise<void> {
  if (!existsSync(dir)) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    console.warn(`[loader] cannot read ${dir}: ${(error as Error).message}`);
    return;
  }

  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue;
    const entryPath = join(dir, entry, 'index.js');
    if (!existsSync(entryPath)) continue;
    try {
      await host.register(loadPluginModule(entryPath));
    } catch (error) {
      console.warn(`[loader] skipped ${entry}: ${(error as Error).message}`);
    }
  }
}
