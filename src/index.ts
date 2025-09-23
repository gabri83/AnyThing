import { AnyThingServer } from './core/server';
import { ServerConfig } from './types';
import { join } from 'path';

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  host: 'localhost',
  pluginDir: join(__dirname, 'plugins/registry')
};

async function main() {
  try {
    const server = new AnyThingServer(DEFAULT_CONFIG);
    
    await server.start();
    
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();



