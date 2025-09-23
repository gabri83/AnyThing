import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { DeviceEvent, ServerConfig } from '../types';
import type { MusicStateMessage, PlayerState } from '@anything/shared/dist/types/protocol';
import express from 'express';
import http from 'http';

interface WSMessage {
  type: string;
  payload: any;
}
type ProtocolMessage = { type: 'command'|'event'|'state'; target?: string; data: any };

export class DeviceWebSocketServer extends EventEmitter {
  private wss!: WebSocket.Server;
  private clients: Set<WebSocket>;
  private config: ServerConfig;
  private app!: express.Express;
  private httpServer!: http.Server;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
    this.clients = new Set();
  }

  public async start(): Promise<void> {
    // Create HTTP server with basic status endpoints
    this.app = express();
    this.app.get('/', (_req, res) => {
      res.type('html').send(
        '<html><body><h1>AnyThing Server</h1><p>Status: running</p><p>WebSocket endpoint: ws://' +
        `${this.config.host}:${this.config.port}` +
        '</p></body></html>'
      );
    });
    this.app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
    this.app.get('/status', (_req, res) => res.json({ clients: this.clients.size }));

    this.httpServer = http.createServer(this.app);

    // Attach WebSocket server to the same HTTP server
    this.wss = new WebSocket.Server({ server: this.httpServer, path: '/ws' });
    this.wss.on('connection', this.handleConnection.bind(this));

    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => resolve());
    });

    console.log(`Server listening on http://${this.config.host}:${this.config.port}`);
    console.log(`WebSocket endpoint ws://${this.config.host}:${this.config.port}/ws`);
  }

  public async stop(): Promise<void> {
    // Close WebSocket and HTTP servers
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleConnection(ws: WebSocket): void {
    console.log('New device connected');
    this.clients.add(ws);

    // Emit connect event
    const connectEvent: DeviceEvent = { type: 'CONNECT' };
    this.emit('deviceEvent', connectEvent);

    ws.on('message', (data: string) => {
      try {
        const message: WSMessage = JSON.parse(data);
        this.handleMessage(message);
        // Also emit protocol messages if shape matches
        if (message && (message as any).type && (message as any).data) {
          const pm = message as unknown as ProtocolMessage;
          if (pm.type === 'command' || pm.type === 'event' || pm.type === 'state') {
            this.emit('protocolMessage', pm);
          }
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.on('close', () => {
      console.log('Device disconnected');
      this.clients.delete(ws);
      const disconnectEvent: DeviceEvent = { type: 'DISCONNECT' };
      this.emit('deviceEvent', disconnectEvent);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.clients.delete(ws);
    });
  }

  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'BUTTON_PRESS':
        this.emit('deviceEvent', {
          type: 'BUTTON_PRESS',
          buttonId: message.payload.buttonId
        } as DeviceEvent);
        break;

      case 'DIAL_ROTATE':
        this.emit('deviceEvent', {
          type: 'DIAL_ROTATE',
          direction: message.payload.direction
        } as DeviceEvent);
        break;

      case 'TOUCH':
        this.emit('deviceEvent', {
          type: 'TOUCH',
          x: message.payload.x,
          y: message.payload.y
        } as DeviceEvent);
        break;

      default:
        // ignore, handled above as protocolMessage possibly
        break;
    }
  }

  public broadcast(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload });
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public updateDisplay(content: string, type: 'text' | 'image'): void {
    this.broadcast('DISPLAY_UPDATE', { content, type });
  }

  public broadcastMusicState(state: PlayerState): void {
    const msg: MusicStateMessage = {
      type: 'state',
      target: 'music',
      data: state
    };
    const json = JSON.stringify(msg);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }
}


