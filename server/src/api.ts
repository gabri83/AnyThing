import express from 'express';
import type { AnythingConfig } from './config';
import type { PluginSummary } from './inventory';

/** Outcome of writing a new config. */
export interface ApplyResult {
  config: AnythingConfig;
  /**
   * True when something changed that cannot take effect without restarting the
   * process — in practice the listening host or port.
   */
  restartRequired: boolean;
}

/** What the API needs from the runtime. Keeps the router free of wiring. */
export interface ApiContext {
  getConfig(): AnythingConfig;
  applyConfig(next: unknown): Promise<ApplyResult>;
  reloadPlugins(): Promise<string[]>;
  inventory(): Promise<PluginSummary[]>;
  rotateToken(): Promise<AnythingConfig>;
  /** Invoke an action on a loaded plugin, for the editor's "test" button. */
  invoke(plugin: string, action: string): Promise<void>;
  deviceUrl(): string;
  paths: { config: string; plugins: string };
}

export const TOKEN_HEADER = 'x-anything-token';

/** Exported for tests: request.ip cannot be faked from a real socket. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const host = address.replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * Redact the config before it leaves the host.
 *
 * The device UI does not need the token to read settings — it already has one —
 * and echoing it into every response puts it in logs and browser history for no
 * benefit. It is returned only by the rotate endpoint, which exists to hand it
 * over once.
 */
function publicConfig(config: AnythingConfig): unknown {
  return {
    ...config,
    auth: { enabled: config.auth.enabled, token: config.auth.token ? '***' : '' }
  };
}

/**
 * The settings API.
 *
 * Editing macros means writing shell commands that the host will later run as
 * you, which is a strictly bigger capability than pressing a button someone
 * else configured. So writes are refused from off-machine unless explicitly
 * allowed: knowing the token is enough to *use* the controller, not to rewrite
 * what it does.
 */
export function createApiRouter(context: ApiContext): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  router.use((request, response, next) => {
    const config = context.getConfig();
    const local = isLoopback(request.ip);

    // A request from the machine itself needs no token. Anything running as
    // you can already read the config file, so demanding a credential for it
    // would only mean the settings page on the Mac could not open without one.
    if (config.auth.enabled && !local) {
      const provided =
        request.header(TOKEN_HEADER) ??
        (typeof request.query.token === 'string' ? request.query.token : undefined);
      if (provided !== config.auth.token) {
        response.status(401).json({ error: 'Bad or missing token' });
        return;
      }
    }

    if (request.method === 'GET') {
      next();
      return;
    }

    // Trusting loopback means a page in the browser could try to write here.
    // JSON bodies already force a CORS preflight that goes unanswered, and
    // rejecting a foreign Origin closes the rest of that gap.
    const origin = request.header('origin');
    if (origin && origin !== `http://${request.headers.host}`) {
      response.status(403).json({ error: `Cross-origin write refused from ${origin}` });
      return;
    }

    if (!config.auth.allowRemoteConfig && !local) {
      response.status(403).json({
        error:
          'Settings can only be changed from the Mac running the host. ' +
          'Set auth.allowRemoteConfig to true in the config file to allow this.'
      });
      return;
    }

    next();
  });

  router.get('/config', (_request, response) => {
    response.json({
      config: publicConfig(context.getConfig()),
      paths: context.paths,
      deviceUrl: context.deviceUrl(),
      platform: process.platform,
      arch: process.arch
    });
  });

  router.put('/config', async (request, response) => {
    try {
      const result = await context.applyConfig(request.body);
      response.json({
        config: publicConfig(result.config),
        restartRequired: result.restartRequired
      });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/plugins', async (_request, response) => {
    response.json({
      plugins: await context.inventory(),
      pluginDir: context.paths.plugins
    });
  });

  router.post('/plugins/reload', async (_request, response) => {
    try {
      response.json({ loaded: await context.reloadPlugins() });
    } catch (error) {
      response.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/rotate-token', async (_request, response) => {
    const config = await context.rotateToken();
    // The one place the token is returned in full: the caller needs it to keep
    // working, and to put on the device.
    response.json({ token: config.auth.token, deviceUrl: context.deviceUrl() });
  });

  router.post('/invoke/:plugin/:action', async (request, response) => {
    try {
      await context.invoke(request.params.plugin, request.params.action);
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  return router;
}
