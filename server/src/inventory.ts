import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import type { PluginManifest } from '@anything/shared';
import type { AnythingConfig } from './config';
import { builtinPlugins, loadPluginModule } from './loader';

/** A plugin the host knows about, whether or not it is currently loaded. */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  origin: 'built-in' | 'user';
  /** Enabled in config. A plugin can be enabled and still unavailable. */
  enabled: boolean;
  /** Why it cannot run here, or why it failed to load. */
  note?: string;
  /** False when this platform is not in the manifest's platform list. */
  supported: boolean;
}

function summarizeManifest(
  manifest: PluginManifest,
  origin: 'built-in' | 'user',
  config: AnythingConfig
): PluginSummary {
  const supported =
    !manifest.platforms || manifest.platforms.includes(process.platform);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    icon: manifest.icon,
    origin,
    enabled: config.plugins[manifest.id]?.enabled !== false,
    supported,
    note: supported
      ? undefined
      : `needs ${manifest.platforms?.join(' or ')}, host is ${process.platform}`
  };
}

/**
 * Every plugin available to the host: the bundled ones, plus each directory in
 * the user plugin folder. A directory that fails to load is reported with its
 * error rather than omitted — silently missing is the worst outcome for someone
 * who just dropped a folder in and is wondering where it went.
 */
export async function inventory(
  config: AnythingConfig,
  userDir: string
): Promise<PluginSummary[]> {
  const summaries = builtinPlugins.map((plugin) =>
    summarizeManifest(plugin.manifest, 'built-in', config)
  );

  if (!existsSync(userDir)) return summaries;

  let entries: string[];
  try {
    entries = await readdir(userDir);
  } catch {
    return summaries;
  }

  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue;
    const entryPath = join(userDir, entry, 'index.js');
    if (!existsSync(entryPath)) continue;

    try {
      summaries.push(
        summarizeManifest(loadPluginModule(entryPath).manifest, 'user', config)
      );
    } catch (error) {
      summaries.push({
        id: entry,
        name: entry,
        version: '?',
        origin: 'user',
        enabled: false,
        supported: false,
        note: (error as Error).message
      });
    }
  }

  return summaries;
}
