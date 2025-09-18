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
  private configPath: string;
  private globalConfigPath: string;

  constructor(baseDir: string) {
    // Try several likely locations for the plugin registry
    const candidates = [
      join(baseDir, 'plugins/registry'),
      join(baseDir, 'dist/plugins/registry'),
      join(baseDir, 'src/plugins/registry')
    ];

    const found = candidates.find(p => existsSync(p));
    this.configPath = found ?? candidates[candidates.length - 1];
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

  public async enablePlugin(pluginName: string): Promise<void> {
    try {
      const plugins = await this.getPluginsList();
      if (!plugins.includes(pluginName)) {
        console.error(chalk.red(`Plugin ${pluginName} not found`));
        return;
      }

      const config = await this.getPluginConfig(pluginName) || {};
      config.enabled = true;
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
      config.enabled = false;
      await this.savePluginConfig(pluginName, config);
      console.log(chalk.green(`Plugin ${pluginName} disabled`));
    } catch (error) {
      console.error(chalk.red(`Failed to disable plugin ${pluginName}:`), error);
    }
  }

  private async getPluginsList(): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    // Ensure directory exists
    if (!existsSync(this.configPath)) {
      await mkdir(this.configPath, { recursive: true });
    }
    const files = await readdir(this.configPath);
    return files
      .filter(file => file.endsWith('.config.json'))
      .map(file => file.replace(/\.config\.json$/, ''));
  }

  private async getPluginConfig(pluginName: string): Promise<PluginConfig | null> {
    try {
      const configPath = join(this.configPath, `${pluginName}.config.json`);
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async savePluginConfig(pluginName: string, config: PluginConfig): Promise<void> {
    const configPath = join(this.configPath, `${pluginName}.config.json`);
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