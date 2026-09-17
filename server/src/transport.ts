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
import type { AnythingConfig } from './config';
import type { PluginHost } from './host';

export interface TransportOptions {
  config: AnythingConfig;
  host: PluginHost;
  version: string;
  /** Directory of the built UI. Served at / when present. */
  uiDir?: string;
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
export class Transport {
  private readonly options: TransportOptions;
  private readonly clients = new Set<WebSocket>();
  private app!: express.Express;
  private server!: http.Server;
  private wss!: WebSocketServer;

  constructor(options: TransportOptions) {
    this.options = options;
  }

  public async start(): Promise<void> {
    const { config, host, version, uiDir } = this.options;

    this.app = express();

    this.app.get('/healthz', (_req, res) => {
      res.json({ status: 'ok', version, plugins: host.ids() });
    });

    this.app.get('/status', (_req, res) => {
      res.json({
        version,
        platform: process.platform,
        arch: process.arch,
        clients: this.clients.size,
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
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (socket) => this.handleConnection(socket));

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
  }

  private handleConnection(socket: WebSocket): void {
    const { config, host, version } = this.options;
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
        if (config.auth.enabled && !tokenMatches(config.auth.token, message.token)) {
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
        console.log(`[ws] ${message.client} connected (${this.clients.size} total)`);

        this.send(socket, {
          t: 'welcome',
          protocol: PROTOCOL_VERSION,
          host: {
            name: hostname(),
            version,
            platform: process.platform,
            arch: process.arch
          },
          input: config.input
        });
        this.send(socket, { t: 'pages', pages: host.pages() });
        return;
      }

      if (!authenticated) return;

      if (message.t === 'invoke') {
        await host.invoke(message.plugin, message.action, message.payload);
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (this.clients.delete(socket)) {
        console.log(`[ws] client disconnected (${this.clients.size} remaining)`);
      }
    });

    socket.on('error', (error) => {
      console.warn('[ws] socket error:', error.message);
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

  /** The port actually bound. Differs from config when port 0 was requested. */
  public port(): number {
    const address = this.server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  public async stop(): Promise<void> {
    for (const client of this.clients) client.close(1001, 'Host shutting down');
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
