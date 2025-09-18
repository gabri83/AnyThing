#!/usr/bin/env node
import { Command } from 'commander';
import { join } from 'path';
import chalk from 'chalk';
import { CLICommands } from './commands';

const program = new Command();
const commands = new CLICommands(process.cwd());

program
  .name('anything')
  .description('CLI to manage AnyThing server and plugins')
  .version('0.1.0');

program
  .command('plugins')
  .description('List all installed plugins')
  .action(async () => {
    await commands.listPlugins();
  });

program
  .command('plugin:enable <name>')
  .description('Enable a plugin')
  .action(async (name) => {
    await commands.enablePlugin(name);
  });

program
  .command('plugin:disable <name>')
  .description('Disable a plugin')
  .action(async (name) => {
    await commands.disablePlugin(name);
  });

program
  .command('plugin:configure <name>')
  .description('Configure a plugin')
  .action(async (name) => {
    await commands.configurePlugin(name);
  });

program
  .command('server:configure')
  .description('Configure server settings')
  .action(async () => {
    await commands.configureServer();
  });

// Custom help text with examples
program.addHelpText('after', `
Examples:
  $ anything plugins                 # List all plugins
  $ anything plugin:enable music     # Enable the music plugin
  $ anything plugin:configure media  # Configure the media plugin
  $ anything server:configure       # Configure server settings
`);

program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});