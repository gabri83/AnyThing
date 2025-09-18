import { EventEmitter } from 'events';
import { Plugin, DeviceState, ServerConfig, DeviceEvent } from '../types';
import { DeviceWebSocketServer } from '../server/websocket';
import { PluginManager } from '../plugins/manager';
import { join } from 'path';

export class AnyThingServer extends EventEmitter {
  private pluginManager: PluginManager;
  private deviceState: DeviceState;
  private config: ServerConfig;
  private wsServer: DeviceWebSocketServer;

  constructor(config: ServerConfig) {
    super();
    this.pluginManager = new PluginManager(join(config.pluginDir));
    this.config = config;
    this.deviceState = {
      connected: false
    };

    this.wsServer = new DeviceWebSocketServer(config);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wsServer.on('deviceEvent', this.handleDeviceEvent.bind(this));
  }

  private handleDeviceEvent(event: DeviceEvent): void {
    switch (event.type) {
      case 'CONNECT':
        this.deviceState.connected = true;
        this.emit('deviceConnected');
        break;
      case 'DISCONNECT':
        this.deviceState.connected = false;
        this.emit('deviceDisconnected');
        break;
      case 'BUTTON_PRESS':
        this.handleButtonPress(event.buttonId);
        break;
      case 'DIAL_ROTATE':
        this.handleDialRotate(event.direction);
        break;
      case 'TOUCH':
        this.handleTouch(event.x, event.y);
        break;
    }
  }

  private handleButtonPress(buttonId: string): void {
    // TODO: Implement button mapping to plugins
    console.log(`Button pressed: ${buttonId}`);
  }

  private handleDialRotate(direction: 'clockwise' | 'counterclockwise'): void {
    // TODO: Implement dial mapping to plugins
    console.log(`Dial rotated: ${direction}`);
  }

  private handleTouch(x: number, y: number): void {
    // TODO: Implement touch handling and routing to appropriate plugin
    console.log(`Touch event at (${x}, ${y})`);
  }

  public getPlugin(pluginName: string): Plugin | undefined {
    return this.pluginManager.getPlugin(pluginName);
  }

  public getAllPlugins(): Plugin[] {
    return this.pluginManager.getAllPlugins();
  }

  public getDeviceState(): DeviceState {
    return { ...this.deviceState };
  }

  public async start(): Promise<void> {
    console.log(`AnyThing server starting on ${this.config.host}:${this.config.port}`);
    
    // Initialize plugin manager
    await this.pluginManager.initialize();

    // Start WebSocket server
    await this.wsServer.start();
  }

  public async stop(): Promise<void> {
    console.log('AnyThing server stopping');
    await this.wsServer.stop();
    await this.pluginManager.cleanup();
  }
}