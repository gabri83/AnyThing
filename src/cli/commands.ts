import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { PluginConfig } from '../types';

interface GlobalConfig {
  serverPort: number;
  serverHost: string;
  pluginDir: string;
  autoStart: boolean;
}

export class CLICommands {
  private configPaths: string[];
  private globalConfigPath: string;

  constructor(baseDir: string) {
    // Try several likely locations for the plugin registry
    const candidates = [
      join(baseDir, 'plugins/registry'),
      join(baseDir, 'dist/plugins/registry'),
      join(baseDir, 'src/plugins/registry')
    ];
    this.configPaths = candidates.filter(p => existsSync(p));
    if (this.configPaths.length === 0) {
      // Ensure at least one default path for writes
      this.configPaths = [candidates[candidates.length - 1]];
    }
    this.globalConfigPath = join(baseDir, 'config.json');
  }

  public async listPlugins(): Promise<void> {
    try {
      const plugins = await this.getPluginsList();
      console.log(chalk.bold('\nInstalled Plugins:'));
      
      for (const plugin of plugins) {
        const config = await this.getPluginConfig(plugin);
        const status = config ? chalk.green('●') : chalk.gray('○');
        console.log(`${status} ${plugin}`);
      }
    } catch (error) {
      console.error(chalk.red('Failed to list plugins:'), error);
    }
  }

  public async configurePlugin(pluginName: string): Promise<void> {
    try {
      const config = await this.getPluginConfig(pluginName);
      if (!config) {
        console.error(chalk.red(`Plugin ${pluginName} not found or has no configuration`));
        return;
      }

      const newConfig = await this.promptForConfig(config);
      await this.savePluginConfig(pluginName, newConfig);
      console.log(chalk.green(`Configuration for ${pluginName} updated successfully`));
    } catch (error) {
      console.error(chalk.red(`Failed to configure plugin ${pluginName}:`), error);
    }
  }

  public async configureServer(): Promise<void> {
    try {
      const config = await this.getGlobalConfig();
      const questions = [
        {
          type: 'input',
          name: 'serverPort',
          message: 'Server port:',
          default: config.serverPort || 3000
        },
        {
          type: 'input',
          name: 'serverHost',
          message: 'Server host:',
          default: config.serverHost || 'localhost'
        },
        {
          type: 'confirm',
          name: 'autoStart',
          message: 'Start server automatically on system startup?',
          default: config.autoStart || false
        }
      ];

      const answers = await inquirer.prompt(questions as any);
      await this.saveGlobalConfig({ ...config, ...answers });
      console.log(chalk.green('Server configuration updated successfully'));
    } catch (error) {
      console.error(chalk.red('Failed to configure server:'), error);
    }
  }

  public async showServerStatus(): Promise<void> {
    try {
      const cfg = await this.getGlobalConfig();
      const base = `http://${cfg.serverHost || 'localhost'}:${cfg.serverPort || 3000}`;
      const res = await fetch(`${base}/status`).catch(() => null as any);
      if (!res || !res.ok) {
        console.log(chalk.yellow('Server not reachable at'), chalk.cyan(base));
        return;
      }
      const json = await res.json();
      console.log(chalk.bold('Server Status'));
      console.log('URL:', base);
      console.log('Connected clients:', json.clients ?? 0);
    } catch (err) {
      console.error(chalk.red('Failed to fetch server status:'), err);
    }
  }

  public async enablePlugin(pluginName: string): Promise<void> {
    try {
      const plugins = await this.getPluginsList();
      if (!plugins.includes(pluginName)) {
        console.error(chalk.red(`Plugin ${pluginName} not found`));
        return;
      }

      const config = await this.getPluginConfig(pluginName) || {};
      (config as any).enabled = true;
      await this.savePluginConfig(pluginName, config);
      console.log(chalk.green(`Plugin ${pluginName} enabled`));
    } catch (error) {
      console.error(chalk.red(`Failed to enable plugin ${pluginName}:`), error);
    }
  }

  public async disablePlugin(pluginName: string): Promise<void> {
    try {
      const plugins = await this.getPluginsList();
      if (!plugins.includes(pluginName)) {
        console.error(chalk.red(`Plugin ${pluginName} not found`));
        return;
      }

      const config = await this.getPluginConfig(pluginName) || {};
      (config as any).enabled = false;
      await this.savePluginConfig(pluginName, config);
      console.log(chalk.green(`Plugin ${pluginName} disabled`));
    } catch (error) {
      console.error(chalk.red(`Failed to disable plugin ${pluginName}:`), error);
    }
  }

  private async getPluginsList(): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    const names = new Set<string>();
    for (const p of this.configPaths) {
      if (!existsSync(p)) continue;
      const files = await readdir(p);
      files
        .filter(file => file.endsWith('.config.json'))
        .map(file => file.replace(/\.config\.json$/, ''))
        .forEach(n => names.add(n));
    }
    // If nothing found, ensure default dir exists for future writes
    if (names.size === 0) {
      const defaultPath = this.configPaths[0];
      if (!existsSync(defaultPath)) {
        await mkdir(defaultPath, { recursive: true });
      }
    }
    return Array.from(names.values()).sort();
  }

  private async getPluginConfig(pluginName: string): Promise<PluginConfig | null> {
    for (const base of this.configPaths) {
      try {
        const configPath = join(base, `${pluginName}.config.json`);
        const content = await readFile(configPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // continue
      }
    }
    return null;
  }

  private async savePluginConfig(pluginName: string, config: PluginConfig): Promise<void> {
    // Prefer first path in list for writes
    const base = this.configPaths[0];
    if (!existsSync(base)) {
      await mkdir(base, { recursive: true });
    }
    const configPath = join(base, `${pluginName}.config.json`);
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }

  private async getGlobalConfig(): Promise<GlobalConfig> {
    try {
      const content = await readFile(this.globalConfigPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        serverPort: 3000,
        serverHost: 'localhost',
        pluginDir: 'plugins/registry',
        autoStart: false
      };
    }
  }

  private async saveGlobalConfig(config: GlobalConfig): Promise<void> {
    await writeFile(this.globalConfigPath, JSON.stringify(config, null, 2));
  }

  private async promptForConfig(currentConfig: PluginConfig): Promise<PluginConfig> {
    const questions = Object.entries(currentConfig).map(([key, value]) => ({
      type: typeof value === 'boolean' ? 'confirm' : 'input',
      name: key,
      message: `${key}:`,
      default: value
    }));

    return await inquirer.prompt(questions as any);
  }
}


