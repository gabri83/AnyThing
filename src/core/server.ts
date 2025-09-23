import { EventEmitter } from 'events';
import { Plugin, DeviceState, ServerConfig, DeviceEvent } from '../types';
import { DeviceWebSocketServer } from '../server/websocket';
import { PluginManager } from '../plugins/manager';
import { join } from 'path';
import type { PlayerState as SharedPlayerState } from '@anything/shared/dist/types/protocol';
import { AppleMusicService } from '../plugins/services/apple-music';
import { SystemMediaService } from '../plugins/services/system-media';

export class AnyThingServer extends EventEmitter {
  private pluginManager: PluginManager;
  private deviceState: DeviceState;
  private config: ServerConfig;
  private wsServer: DeviceWebSocketServer;
  private activePluginName: string | null = null;
  private stateUpdateInterval: NodeJS.Timeout | null = null;

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
    // Handle protocol-level messages (from UI or device runtime)
    this.wsServer.on('protocolMessage', (msg: any) => {
      if (msg?.type === 'command' && msg?.target === 'music') {
        void this.handleMusicCommand(msg.data);
      }
    });
  }

  private handleDeviceEvent(event: DeviceEvent): void {
    switch (event.type) {
      case 'CONNECT':
        this.deviceState.connected = true;
        this.emit('deviceConnected');
        this.ensureActivePlugin();
        this.pushDisplay();
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

  private async handleMusicCommand(data: any): Promise<void> {
    try {
      const active = this.activePluginName;
      if (!active) return;
      if (active === 'apple-music') {
        const svc = AppleMusicService.getInstance();
        switch (data?.action) {
          case 'play': await svc.playPause(); break; // toggle for MVP
          case 'pause': await svc.playPause(); break; // toggle for MVP
          case 'next': await svc.nextTrack(); break;
          case 'previous': await svc.previousTrack(); break;
          case 'seek': if (typeof data.position === 'number') { await svc.setPosition(data.position); }
        }
        await this.pushMusicState();
        return;
      }
      if (active === 'system-media') {
        const svc = SystemMediaService.getInstance();
        switch (data?.action) {
          case 'play':
          case 'pause':
            await svc.playPause();
            break;
          case 'next':
            await svc.nextTrack();
            break;
          case 'previous':
            await svc.previousTrack();
            break;
          case 'seek':
            // Not supported via generic system media for MVP
            break;
        }
        await this.pushMusicState();
        return;
      }
    } catch (err) {
      console.error('Failed to handle music command:', err);
    }
  }

  private handleButtonPress(buttonId: string): void {
    console.log(`Button pressed: ${buttonId}`);
    const plugin = this.getActivePlugin();
    plugin?.actions.onPress?.();
    this.pushDisplay();
    void this.pushMusicState();
  }

  private handleDialRotate(direction: 'clockwise' | 'counterclockwise'): void {
    console.log(`Dial rotated: ${direction}`);
    const plugin = this.getActivePlugin();
    plugin?.actions.onRotate?.(direction);
    this.pushDisplay();
    void this.pushMusicState();
  }

  private handleTouch(x: number, y: number): void {
    console.log(`Touch event at (${x}, ${y})`);
    const plugin = this.getActivePlugin();
    plugin?.actions.onTouch?.(x, y);
    this.pushDisplay();
    void this.pushMusicState();
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
    this.ensureActivePlugin();

    // Start WebSocket server
    await this.wsServer.start();
    void this.pushMusicState();
    // Periodically broadcast music state to keep UI in sync
    this.stateUpdateInterval = setInterval(() => {
      void this.pushMusicState();
    }, 1000);
  }

  public async stop(): Promise<void> {
    console.log('AnyThing server stopping');
    await this.wsServer.stop();
    await this.pluginManager.cleanup();
    if (this.stateUpdateInterval) {
      clearInterval(this.stateUpdateInterval);
      this.stateUpdateInterval = null;
    }
  }

  private ensureActivePlugin(): void {
    if (this.activePluginName && this.getActivePlugin()) return;
    const plugins = this.getAllPlugins();
    if (plugins.length > 0) {
      // Prefer apple-music if available, else system-media, else first
      const preferredApple = plugins.find(p => p.name === 'apple-music');
      const preferredSystem = plugins.find(p => p.name === 'system-media');
      this.activePluginName = (preferredApple ?? preferredSystem ?? plugins[0]).name;
      console.log(`Active plugin set to: ${this.activePluginName}`);
    } else {
      this.activePluginName = null;
    }
  }

  private getActivePlugin(): Plugin | undefined {
    if (!this.activePluginName) return undefined;
    return this.getPlugin(this.activePluginName);
  }

  private pushDisplay(): void {
    const plugin = this.getActivePlugin();
    if (plugin && plugin.display) {
      this.wsServer.updateDisplay(plugin.display.content, plugin.display.type);
    }
  }

  private async pushMusicState(): Promise<void> {
    try {
      // Dynamically select Apple Music if running
      const am = AppleMusicService.getInstance();
      if (await am.isRunning()) {
        if (this.activePluginName !== 'apple-music') {
          this.activePluginName = 'apple-music';
          console.log('Active plugin switched to apple-music');
        }
      }

      const active = this.activePluginName;
      if (!active) return;

      if (active === 'apple-music') {
        const svc = AppleMusicService.getInstance();
        const [track, state] = await Promise.all([
          svc.getCurrentTrack(),
          svc.getPlayerState()
        ]);
        const payload: SharedPlayerState = {
          status: state,
          track: track
            ? {
                title: track.name,
                artist: track.artist,
                album: track.album,
                duration: track.duration,
                position: track.position
              }
            : null
        };
        this.wsServer.broadcastMusicState(payload);
        return;
      }

      if (active === 'system-media') {
        const svc = SystemMediaService.getInstance();
        const info = await svc.getMediaInfo();
        const payload: SharedPlayerState = {
          status: info.isPlaying ? 'playing' : 'paused',
          track: info.track
            ? {
                title: info.track.name,
                artist: info.track.artist,
                album: '',
                duration: 0,
                position: 0
              }
            : null
        };
        this.wsServer.broadcastMusicState(payload);
        return;
      }
    } catch (err) {
      // Non-fatal; just log
      console.error('Failed to push music state:', err);
    }
  }
}


