import { Runtime, defaultUiDir } from './runtime';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

async function main(): Promise<void> {
  const runtime = await Runtime.start({
    version,
    uiDir: defaultUiDir(),
    connectDevices: true
  });
  const config = runtime.currentConfig();

  console.log('');
  console.log(`  AnyThing host v${version} ready`);
  if (config.device.carThing.enabled) {
    console.log('  Car Thing:            plug it in and AnyThing appears on its screen');
  }
  console.log(`  Any other browser:    ${runtime.deviceUrl()}`);
  console.log(
    `  Settings on this Mac: http://localhost:${config.server.port}/#settings`
  );
  if (!config.auth.enabled) {
    console.log('  Auth is DISABLED: anyone on this network can trigger your macros.');
  }
  console.log('');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down`);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error: Error) => {
  console.error(`Failed to start: ${error.message}`);
  process.exit(1);
});
