#!/usr/bin/env node
import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import {
  configPath,
  loadConfig,
  saveConfig,
  userPluginDir,
  type AnythingConfig
} from './config';
import {
  deviceInstallStatus,
  installOnDevice,
  uninstallFromDevice
} from './device/install';
import { createInterface } from 'readline';
import {
  installPlugin,
  listInstalled,
  parseSource,
  removePlugin,
  updatePlugin
} from './installer';
import { inventory, type PluginSummary } from './inventory';

const USAGE = `AnyThing host CLI

  anything url                 print the URL to open on your device
  anything status              show config, token and plugin state
  anything plugins             list built-in and user plugins
  anything enable <plugin>     enable a plugin
  anything disable <plugin>    disable a plugin
  anything rotate-token        issue a new token (devices must reload)

  anything plugin add <source> install a plugin: owner/repo on GitHub (add #tag for a
                               version), a git URL, or a folder. --yes skips the question
  anything plugin update <name>  fetch an installed plugin again
  anything plugin remove <name>  delete an installed plugin
  anything plugin list         installed plugins and where they came from
  anything config              print the config file path

  anything todo "Buy milk"     add an item to the to-do page (the host must be running)

  anything device              is a Car Thing attached, and does it start on AnyThing?
  anything device install      make the Car Thing start on AnyThing at power-on
  anything device uninstall    put its own start page back

Most settings, including the macro buttons, are easier to edit in the settings
page the host serves: http://localhost:<port>/#settings

Config lives at ${configPath()}
User plugins are loaded from ${userPluginDir()}
`;

function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

function deviceUrl(config: AnythingConfig): string {
  const base = `http://${lanAddress()}:${config.server.port}`;
  return config.auth.enabled ? `${base}/?token=${config.auth.token}` : `${base}/`;
}

async function summarize(config: AnythingConfig): Promise<PluginSummary[]> {
  return inventory(config, userPluginDir());
}

async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const config = await loadConfig();
  const known = (await summarize(config)).some((plugin) => plugin.id === id);
  if (!known) {
    throw new Error(`No plugin with id "${id}". Run: anything plugins`);
  }
  config.plugins[id] = { ...(config.plugins[id] ?? {}), enabled };
  await saveConfig(config);
  console.log(`${id} ${enabled ? 'enabled' : 'disabled'}. Restart the host to apply.`);
}

function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) => {
    prompt.question(question, (answer) => {
      prompt.close();
      done(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * Ask a running host to load its plugins again, and say what changed. The
 * host is optional: with none running the plugin is simply there next start.
 */
async function reloadHost(port: number, before: string[] | null): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/plugins/reload`, { method: 'POST' });
    if (!response.ok) throw new Error(`the host answered ${response.status}`);
    const { loaded } = (await response.json()) as { loaded: string[] };
    if (before) {
      const added = loaded.filter((id) => !before.includes(id));
      const gone = before.filter((id) => !loaded.includes(id));
      if (added.length > 0) console.log(`Now on the device: ${added.join(', ')}`);
      if (gone.length > 0) console.log(`No longer loaded: ${gone.join(', ')}`);
      if (added.length === 0 && gone.length === 0) console.log('The host reloaded its plugins.');
    } else {
      console.log('The host reloaded its plugins.');
    }
    const listing = (await (await fetch(`http://127.0.0.1:${port}/api/plugins`)).json()) as {
      plugins: PluginSummary[];
    };
    for (const plugin of listing.plugins) {
      if (plugin.origin === 'user' && plugin.note) console.log(`  ${plugin.id}: ${plugin.note}`);
    }
  } catch {
    console.log('The host is not running; it will pick this up when it starts.');
  }
}

async function loadedIds(port: number): Promise<string[] | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    const status = (await response.json()) as { plugins?: unknown };
    return Array.isArray(status.plugins)
      ? status.plugins.filter((id): id is string => typeof id === 'string')
      : null;
  } catch {
    return null;
  }
}

async function pluginCommand(argv: string[]): Promise<number> {
  const flags = argv.filter((entry) => entry.startsWith('--'));
  const [action, target] = argv.filter((entry) => !entry.startsWith('--'));
  const dir = userPluginDir();
  const { port } = (await loadConfig()).server;

  switch (action) {
    case undefined:
    case 'list': {
      const installed = await listInstalled(dir);
      if (installed.length === 0) {
        console.log(`No plugins installed in ${dir}`);
        console.log('Install one with: anything plugin add <owner>/<repo>');
        return 0;
      }
      for (const plugin of installed) {
        const origin = plugin.source
          ? `${plugin.source}${plugin.ref ? `#${plugin.ref}` : ''}${plugin.commit ? ` @ ${plugin.commit.slice(0, 7)}` : ''}`
          : 'added by hand';
        console.log(`${plugin.name.padEnd(18)} ${origin}`);
      }
      return 0;
    }

    case 'add':
    case 'install': {
      if (!target) {
        console.error('Usage: anything plugin add <owner>/<repo> | <git URL> | <folder>');
        return 1;
      }
      const source = parseSource(target);
      if (!flags.includes('--yes')) {
        console.log(`Install "${source.name}" from ${source.display}?`);
        console.log('A plugin is a program: it runs on this Mac with the same access you have.');
        console.log('Only install one you trust, or have read.');
        if (!process.stdin.isTTY) {
          console.error('Not installed: run this in a terminal, or pass --yes.');
          return 1;
        }
        if (!(await confirm('Install it? [y/N] '))) {
          console.log('Not installed.');
          return 1;
        }
      }
      const before = await loadedIds(port);
      const installed = await installPlugin(source, dir);
      console.log(`Installed ${installed.name} in ${dir}/${installed.name}`);
      await reloadHost(port, before);
      return 0;
    }

    case 'update': {
      if (!target) {
        console.error('Usage: anything plugin update <name>');
        return 1;
      }
      const updated = await updatePlugin(target, dir);
      console.log(
        `Updated ${updated.name}${updated.commit ? ` to ${updated.commit.slice(0, 7)}` : ''}`
      );
      await reloadHost(port, null);
      return 0;
    }

    case 'remove':
    case 'uninstall': {
      if (!target) {
        console.error('Usage: anything plugin remove <name>');
        return 1;
      }
      const before = await loadedIds(port);
      await removePlugin(target, dir);
      console.log(`Removed ${target}`);
      await reloadHost(port, before);
      return 0;
    }

    default:
      console.error('Usage: anything plugin [list|add <source>|update <name>|remove <name>]');
      return 1;
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, argument] = argv;

  switch (command) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;

    case 'url':
      console.log(deviceUrl(await loadConfig()));
      return 0;

    case 'config':
      console.log(configPath());
      return 0;

    case 'status': {
      const config = await loadConfig();
      const plugins = await summarize(config);
      console.log(`config     ${configPath()}`);
      console.log(`listening  ${config.server.host}:${config.server.port}`);
      console.log(`auth       ${config.auth.enabled ? 'on' : 'OFF'}`);
      console.log(`device URL ${deviceUrl(config)}`);
      console.log('');
      console.log(`plugins    ${plugins.filter((p) => p.enabled).length} enabled of ${plugins.length}`);
      return 0;
    }

    case 'plugins': {
      const plugins = await summarize(await loadConfig());
      for (const plugin of plugins) {
        const mark = plugin.enabled ? '+' : '-';
        const note = plugin.note ? `  (${plugin.note})` : '';
        console.log(
          `${mark} ${plugin.id.padEnd(14)} v${plugin.version.padEnd(8)} ${plugin.origin}${note}`
        );
      }
      return 0;
    }

    case 'plugin':
      return pluginCommand(argv.slice(1));

    case 'enable':
    case 'disable': {
      if (!argument) {
        console.error(`Usage: anything ${command} <plugin>`);
        return 1;
      }
      await setEnabled(argument, command === 'enable');
      return 0;
    }

    case 'todo': {
      const title = argv.slice(1).join(' ').trim();
      if (!title) {
        console.error('Usage: anything todo "Buy milk"');
        return 1;
      }
      const { port } = (await loadConfig()).server;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/hooks/todo/add`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title })
        });
        if (!response.ok) throw new Error(`the host answered ${response.status}`);
      } catch (error) {
        console.error(`Could not add it: ${(error as Error).message}. Is the host running?`);
        return 1;
      }
      console.log(`Added: ${title}`);
      return 0;
    }

    case 'device': {
      const { address } = (await loadConfig()).device.carThing;
      const before = await deviceInstallStatus(address);
      if (!before.reachable) {
        console.error(
          `No Car Thing answering at ${address}. Plug it in and let it finish booting.`
        );
        return 1;
      }

      if (argument === undefined || argument === 'status') {
        console.log(`device     ${before.firmware ?? 'unknown firmware'} at ${address}`);
        console.log(
          before.installed
            ? 'starts on  AnyThing (splash, then the host once it is reachable)'
            : "starts on  the firmware's own page; the host takes the screen over after boot"
        );
        return 0;
      }
      if (argument === 'install') {
        await installOnDevice(address);
        console.log('Installed. From its next power-on the Car Thing starts on AnyThing.');
        console.log('Undo with: anything device uninstall');
        return 0;
      }
      if (argument === 'uninstall') {
        await uninstallFromDevice(address);
        console.log("Removed. The Car Thing starts on its firmware's own page again.");
        return 0;
      }
      console.error('Usage: anything device [status|install|uninstall]');
      return 1;
    }

    case 'rotate-token': {
      const config = await loadConfig();
      config.auth.token = randomBytes(16).toString('hex');
      config.auth.enabled = true;
      await saveConfig(config);
      console.log('New token issued. Restart the host, then open:');
      console.log(`  ${deviceUrl(config)}`);
      return 0;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

void main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
