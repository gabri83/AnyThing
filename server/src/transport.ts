import { timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import http from 'http';
import { join } from 'path';
import { hostname } from 'os';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ControlBindings,
  type Page,
  type ServerMessage,
  type Tile
} from '@anything/shared';
import { isLoopback } from './api';
import type { AnythingConfig } from './config';
import type { ActivePrompt, PluginHost } from './host';

export interface TransportOptions {
  config: AnythingConfig;
  host: PluginHost;
  version: string;
  /** Directory of the built UI. Served at / when present. */
  uiDir?: string;
  /** Settings API, mounted at /api. Omitted in tests that do not need it. */
  api?: express.Router;
}

/** Constant-time token comparison, so a wrong token leaks no timing signal. */
function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * HTTP server for the UI and plugin files, plus the WebSocket the devices talk
 * over. A socket counts as a client only once it has sent an accepted `hello`,
 * so an unauthenticated connection never receives tiles.
 */
/** What a connected device told us about itself. */
export interface ClientInfo {
  /** The name the client sent in `hello`. */
  name: string;
  /** Browser user agent from the upgrade request, or null if it sent none. */
  userAgent: string | null;
  address: string | null;
  connectedAt: string;
}

export class Transport {
  private options: TransportOptions;
  private readonly clients = new Set<WebSocket>();
  /**
   * Per-socket details, kept so `/status` can report what is actually
   * connected. The Car Thing's browser version decides what the UI may use,
   * and reading it off the real device beats assuming.
   */
  private readonly clientInfo = new Map<WebSocket, ClientInfo>();
  private app!: express.Express;
  private server!: http.Server;
  /**
   * A second listener, loopback only, that a tethered device reaches through
   * the connector's tunnel. Arriving here is the credential — only the device
   * we tunnelled to can — so it needs no token; but it is still "the device",
   * not "this Mac", so it may not change settings or call webhooks.
   */
  private deviceServer!: http.Server;
  private wss!: WebSocketServer;

  constructor(options: TransportOptions) {
    this.options = options;
  }

  /**
   * Adopt a new config for auth and input. A changed host or port is not
   * applied — the socket is already bound — so the caller must report that a
   * restart is needed rather than pretending it took effect.
   */
  public setConfig(config: AnythingConfig): void {
    this.options = { ...this.options, config };
  }

  public async start(): Promise<void> {
    const { config, host, version, uiDir } = this.options;

    this.app = express();
    // Behind no proxy, but this makes request.ip honest if one is added.
    this.app.set('trust proxy', 'loopback');

    if (this.options.api) this.app.use('/api', this.options.api);

    // Plugin webhooks: other programs on this Mac pushing events to a plugin.
    // Loopback on the main listener only, so neither the network nor the
    // tethered device can drive them.
    this.app.use('/hooks', express.json({ limit: '2mb' }), async (request, response) => {
      if (!isLoopback(request.ip) || this.isDeviceRequest(request)) {
        response.status(403).json({ error: 'Webhooks are only accepted from this Mac' });
        return;
      }
      const [plugin, ...rest] = request.path.split('/').filter(Boolean);
      const query: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.query)) {
        if (typeof value === 'string') query[key] = value;
      }
      const hasBody = request.body !== undefined && request.headers['content-length'] !== '0';
      const result = plugin
        ? await host.handleRequest(decodeURIComponent(plugin), rest.join('/'), {
            method: request.method,
            query,
            body: hasBody ? request.body : undefined
          })
        : null;
      if (!result) {
        response.status(404).json({ error: 'No plugin handles this path' });
        return;
      }
      response.status(result.status ?? 200).json(result.body ?? {});
    });

    this.app.get('/healthz', (_req, res) => {
      res.json({ status: 'ok', version, plugins: host.ids() });
    });

    this.app.get('/status', (_req, res) => {
      res.json({
        version,
        platform: process.platform,
        arch: process.arch,
        clients: this.clients.size,
        connected: this.connectedClients(),
        plugins: host.ids(),
        authRequired: config.auth.enabled
      });
    });

    // Plugin-served files (artwork and the like). Only paths a plugin
    // explicitly registered are resolvable, so there is nothing to traverse.
    this.app.get('/files/:plugin/:name', (req, res) => {
      const path = host.resolveFile(req.params.plugin, req.params.name);
      if (!path || !existsSync(path)) {
        res.status(404).send('Not found');
        return;
      }
      res.sendFile(path);
    });

    if (uiDir && existsSync(uiDir)) {
      this.app.use(express.static(uiDir));
      // Single-page fallback as middleware rather than a wildcard route:
      // Express 5's path-to-regexp rejects a bare '*' pattern.
      this.app.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }
        response.sendFile(join(uiDir, 'index.html'));
      });
    } else {
      this.app.get('/', (_req, res) => {
        res
          .type('html')
          .send(
            `<!doctype html><meta charset="utf-8"><title>AnyThing</title>` +
              `<body style="font:16px system-ui;padding:2rem;max-width:40rem">` +
              `<h1>AnyThing host v${version}</h1>` +
              `<p>Running, but the UI is not built. From the repo root:</p>` +
              `<pre>npm run build</pre>` +
              `<p>Plugins loaded: ${host.ids().join(', ') || 'none'}</p>`
          );
      });
    }

    this.server = http.createServer(this.app);
    this.deviceServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ noServer: true });
    for (const listener of [this.server, this.deviceServer]) {
      listener.on('upgrade', (request, socket, head) => {
        if ((request.url ?? '').split('?')[0] !== '/ws') {
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(request, socket, head, (ws) =>
          this.wss.emit('connection', ws, request)
        );
      });
    }
    this.wss.on('connection', (socket, request) =>
      this.handleConnection(socket, {
        userAgent: request.headers['user-agent'] ?? null,
        address: request.socket.remoteAddress ?? null,
        tethered: request.socket.localPort === this.devicePort()
      })
    );

    // The WebSocket server re-emits the HTTP server's errors. Without a
    // listener here, a failure to bind surfaces as an unhandled 'error' event
    // and a stack trace instead of something a person can act on.
    this.wss.on('error', (error) => console.warn('[ws] server error:', error.message));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        reject(
          error.code === 'EADDRINUSE'
            ? new Error(
                `Port ${config.server.port} is already in use. ` +
                  'Another AnyThing host may still be running, or something ' +
                  'else has the port. Stop it, or set server.port in the config.'
              )
            : error
        );
      };
      this.server.once('error', onError);
      this.server.listen(config.server.port, config.server.host, () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });

    // Any free port: only the connector's tunnel needs to know which.
    await new Promise<void>((resolve, reject) => {
      this.deviceServer.once('error', reject);
      this.deviceServer.listen(0, '127.0.0.1', () => {
        this.deviceServer.removeListener('error', reject);
        resolve();
      });
    });

    host.on('pages', (pages: Page[]) => this.broadcast({ t: 'pages', pages }));
    host.on('tiles', (plugin: string, tiles: Tile[]) =>
      this.broadcast({ t: 'tiles', plugin, tiles })
    );
    host.on('controls', (plugin: string, controls: ControlBindings) =>
      this.broadcast({ t: 'controls', plugin, controls })
    );
    host.on('notice', (level: 'info' | 'warn' | 'error', message: string) =>
      this.broadcast({ t: 'notice', level, message })
    );
    host.on('prompts', (prompts: ActivePrompt[]) =>
      this.broadcast({ t: 'prompts', prompts })
    );
    host.on('focus', (plugin: string) => this.broadcast({ t: 'focus', plugin }));
  }

  /** True when the request came in through the tethered-device listener. */
  public isDeviceRequest(request: { socket: { localPort?: number } }): boolean {
    return request.socket.localPort === this.devicePort();
  }

  private handleConnection(
    socket: WebSocket,
    origin: { userAgent: string | null; address: string | null; tethered?: boolean }
  ): void {
    const { host, version } = this.options;
    let authenticated = false;

    // Drop a socket that never introduces itself, so a port scan cannot hold
    // a connection open indefinitely.
    const helloTimer = setTimeout(() => {
      if (!authenticated) socket.close(1008, 'No hello');
    }, 10_000);

    socket.on('message', async (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) return;

      if (message.t === 'hello') {
        if (message.protocol !== PROTOCOL_VERSION) {
          this.send(socket, {
            t: 'denied',
            reason: 'protocol-mismatch',
            message: `Host speaks protocol ${PROTOCOL_VERSION}, client sent ${message.protocol}`
          });
          socket.close(1008, 'Protocol mismatch');
          return;
        }
        const { config } = this.options;
        if (
          config.auth.enabled &&
          !origin.tethered &&
          !tokenMatches(config.auth.token, message.token)
        ) {
          console.warn(`[ws] rejected ${message.client}: bad token`);
          this.send(socket, {
            t: 'denied',
            reason: 'bad-token',
            message: 'Wrong or missing token. Check the URL the host printed at startup.'
          });
          socket.close(1008, 'Bad token');
          return;
        }

        authenticated = true;
        clearTimeout(helloTimer);
        this.clients.add(socket);
        this.clientInfo.set(socket, {
          name: message.client,
          userAgent: origin.userAgent,
          address: origin.address,
          connectedAt: new Date().toISOString()
        });
        console.log(`[ws] ${message.client} connected (${this.clients.size} total)`);
        if (origin.userAgent) {
          // Printed once per connection: this is how you find out which
          // Chromium the device is really running.
          console.log(`[ws]   ${origin.userAgent}`);
        }

        this.send(socket, {
          t: 'welcome',
          protocol: PROTOCOL_VERSION,
          host: {
            name: hostname(),
            version,
            platform: process.platform,
            arch: process.arch
          },
          input: this.options.config.input
        });
        this.send(socket, { t: 'pages', pages: host.pages() });
        this.send(socket, { t: 'prompts', prompts: host.pendingPrompts() });
        return;
      }

      if (!authenticated) return;

      if (message.t === 'invoke') {
        await host.invoke(message.plugin, message.action, message.payload);
      } else if (message.t === 'answer') {
        host.answerPrompt(message.prompt, message.choice);
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      this.clientInfo.delete(socket);
      if (this.clients.delete(socket)) {
        console.log(`[ws] client disconnected (${this.clients.size} remaining)`);
      }
    });

    socket.on('error', (error) => {
      console.warn('[ws] socket error:', error.message);
      this.clientInfo.delete(socket);
      this.clients.delete(socket);
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  public broadcast(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  }

  public clientCount(): number {
    return this.clients.size;
  }

  /** Details of every authenticated client, for `/status` and the CLI. */
  public connectedClients(): ClientInfo[] {
    return [...this.clientInfo.values()];
  }

  /** The port actually bound. Differs from config when port 0 was requested. */
  public port(): number {
    const address = this.server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** Port of the tethered-device listener, for the connector's tunnel. */
  public devicePort(): number {
    const address = this.deviceServer?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  public async stop(): Promise<void> {
    for (const client of this.clients) client.close(1001, 'Host shutting down');
    this.clients.clear();
    this.clientInfo.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    this.server.closeAllConnections?.();
    this.deviceServer.closeAllConnections?.();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await new Promise<void>((resolve) => this.deviceServer.close(() => resolve()));
  }
}
