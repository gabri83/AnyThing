import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { DeviceEvent, ServerConfig } from '../types';

interface WSMessage {
  type: string;
  payload: any;
}

export class DeviceWebSocketServer extends EventEmitter {
  private wss!: WebSocket.Server;
  private clients: Set<WebSocket>;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    super();
    this.config = config;
    this.clients = new Set();
  }

  public async start(): Promise<void> {
    this.wss = new WebSocket.Server({
      port: this.config.port,
      host: this.config.host
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log(`WebSocket server listening on ws://${this.config.host}:${this.config.port}`);
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
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
        console.warn(`Unknown message type: ${message.type}`);
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
}