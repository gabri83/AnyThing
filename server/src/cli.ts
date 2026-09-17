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
import { inventory, type PluginSummary } from './inventory';

const USAGE = `AnyThing host CLI

  anything url                 print the URL to open on your device
  anything status              show config, token and plugin state
  anything plugins             list built-in and user plugins
  anything enable <plugin>     enable a plugin
  anything disable <plugin>    disable a plugin
  anything rotate-token        issue a new token (devices must reload)
  anything config              print the config file path

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

    case 'enable':
    case 'disable': {
      if (!argument) {
        console.error(`Usage: anything ${command} <plugin>`);
        return 1;
      }
      await setEnabled(argument, command === 'enable');
      return 0;
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
