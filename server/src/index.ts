import { networkInterfaces } from 'os';
import { resolve } from 'path';
import { loadConfig, userPluginDir } from './config';
import { PluginHost } from './host';
import { loadAll } from './loader';
import { Transport } from './transport';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

/** First non-loopback IPv4 address, for the URL to open on the device. */
function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const host = new PluginHost(config);

  await loadAll(host, userPluginDir());

  const transport = new Transport({
    config,
    host,
    version,
    uiDir: resolve(__dirname, '..', '..', 'ui', 'dist')
  });
  await transport.start();

  const address = lanAddress() ?? config.server.host;
  const query = config.auth.enabled ? `/?token=${config.auth.token}` : '/';
  console.log('');
  console.log(`  AnyThing host v${version} ready`);
  console.log(`  Open on your device:  http://${address}:${config.server.port}${query}`);
  if (!config.auth.enabled) {
    console.log('  Auth is DISABLED: anyone on this network can trigger your macros.');
  }
  console.log('');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down`);
    await transport.stop();
    await host.teardown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error: Error) => {
  console.error(`Failed to start: ${error.message}`);
  process.exit(1);
});
