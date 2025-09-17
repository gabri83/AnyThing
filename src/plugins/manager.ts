import { watch } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { EventEmitter } from 'events';
import { Plugin, PluginConfig } from '../types';

interface PluginMetadata {
  name: string;
  path: string;
  config?: PluginConfig;
  instance?: Plugin;
  enabled: boolean;
}

export class PluginManager extends EventEmitter {
  private plugins: Map<string, PluginMetadata>;
  private pluginDir: string;
  private watchers: Map<string, ReturnType<typeof watch>>;

  constructor(pluginDir: string) {
    super();
    this.plugins = new Map();
    this.watchers = new Map();
    this.pluginDir = pluginDir;
  }

  public async initialize(): Promise<void> {
    try {
      await this.loadAllPlugins();
      this.watchPluginDirectory();
    } catch (error) {
      console.error('Failed to initialize plugin manager:', error);
      throw error;
    }
  }

  private async loadAllPlugins(): Promise<void> {
    const files = await readdir(this.pluginDir);
    
    for (const file of files) {
      if (this.isPluginFile(file)) {
        await this.loadPlugin(join(this.pluginDir, file));
      }
    }
  }

  private isPluginFile(filename: string): boolean {
    const ext = extname(filename);
    return (ext === '.js' || ext === '.ts') && !filename.endsWith('.test.ts');
  }

  private async loadPlugin(pluginPath: string): Promise<void> {
    try {
      // Clear require cache to enable hot reloading
      delete require.cache[require.resolve(pluginPath)];

      const pluginModule = require(pluginPath);
      const plugin: Plugin = pluginModule.default || pluginModule;

      if (!this.validatePlugin(plugin)) {
        throw new Error(`Invalid plugin format in ${pluginPath}`);
      }

      const metadata: PluginMetadata = {
        name: plugin.name,
        path: pluginPath,
        instance: plugin,
        enabled: true,
        config: await this.loadPluginConfig(plugin.name)
      };

      this.plugins.set(plugin.name, metadata);
      
      // Initialize plugin if it has an initialize method
      if (plugin.initialize) {
        await plugin.initialize();
      }
      
      this.emit('pluginLoaded', plugin);
      console.log(`Loaded plugin: ${plugin.name} v${plugin.version}`);
    } catch (error) {
      console.error(`Failed to load plugin from ${pluginPath}:`, error);
    }
  }

  private validatePlugin(plugin: any): plugin is Plugin {
    return (
      typeof plugin === 'object' &&
      typeof plugin.name === 'string' &&
      typeof plugin.version === 'string' &&
      typeof plugin.actions === 'object'
    );
  }

  private async loadPluginConfig(pluginName: string): Promise<PluginConfig | undefined> {
    const configPath = join(this.pluginDir, `${pluginName}.config.json`);
    try {
      const config = require(configPath);
      return config as PluginConfig;
    } catch {
      return undefined;
    }
  }

  private async savePluginConfig(pluginName: string, config: PluginConfig): Promise<void> {
    const configPath = join(this.pluginDir, `${pluginName}.config.json`);
    const fs = require('fs').promises;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  private watchPluginDirectory(): void {
    const watcher = watch(
      this.pluginDir,
      { persistent: true },
      async (eventType, filename) => {
        if (!filename || !this.isPluginFile(filename)) return;

        const pluginPath = join(this.pluginDir, filename);
        
        try {
          const stats = await stat(pluginPath);
          if (stats.isFile()) {
            console.log(`Plugin file changed: ${filename}`);
            await this.loadPlugin(pluginPath);
          }
        } catch (error) {
          // File might have been deleted
          const pluginName = basename(filename, extname(filename));
          this.plugins.delete(pluginName);
          this.emit('pluginUnloaded', pluginName);
          console.log(`Plugin unloaded: ${pluginName}`);
        }
      }
    );

    this.watchers.set(this.pluginDir, watcher);
  }

  public getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)?.instance;
  }

  public getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
      .filter(meta => meta.enabled && meta.instance)
      .map(meta => meta.instance!);
  }

  public async enablePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = true;
      this.emit('pluginEnabled', name);
    }
  }

  public async disablePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = false;
      this.emit('pluginDisabled', name);
    }
  }

  public async updatePluginConfig(name: string, config: PluginConfig): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.config = config;
      await this.savePluginConfig(name, config);
      this.emit('pluginConfigUpdated', name, config);
    }
  }

  public async cleanup(): Promise<void> {
    // Cleanup plugins
    for (const plugin of this.plugins.values()) {
      if (plugin.instance?.cleanup) {
        await plugin.instance.cleanup();
      }
    }

    // Cleanup file watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}