import { Plugin, PluginConfig } from '../../types';
import { SystemMediaService, MediaInfo } from '../services/system-media';

interface SystemMediaConfig extends PluginConfig {
  volumeStep: number;
  refreshInterval: number;
  showMuteButton: boolean;
}

interface PluginState {
  mediaInfo: MediaInfo;
  lastVolume: number;
}

class SystemMediaPlugin implements Plugin {
  public readonly name = 'system-media';
  public readonly version = '0.1.0';

  private service: SystemMediaService;
  private config: SystemMediaConfig;
  private state: PluginState;
  private updateInterval: NodeJS.Timeout | null;

  constructor() {
    this.service = SystemMediaService.getInstance();
    this.config = {
      volumeStep: 5,
      refreshInterval: 1000,
      showMuteButton: true
    };
    this.state = {
      mediaInfo: { isPlaying: false, volume: 0 },
      lastVolume: 0
    };
    this.updateInterval = null;
  }

  public get display() {
    const { mediaInfo } = this.state;
    let content = '';

    if (mediaInfo.track) {
      content = `${mediaInfo.track.name}\nby ${mediaInfo.track.artist}\n`;
    }

    content += `${mediaInfo.isPlaying ? '▶️' : '⏸️'} Vol: ${mediaInfo.volume}%`;
    if (mediaInfo.app) {
      content += `\nvia ${mediaInfo.app}`;
    }

    return {
      type: 'text' as const,
      content
    };
  }

  public get actions() {
    return {
      onPress: this.handlePress.bind(this),
      onRotate: this.handleRotate.bind(this),
      onTouch: this.handleTouch.bind(this)
    };
  }

  private async handlePress() {
    try {
      await this.service.playPause();
      await this.updateState();
    } catch (error) {
      console.error('Failed to handle press:', error);
    }
  }

  private async handleRotate(direction: 'clockwise' | 'counterclockwise') {
    try {
      const currentVolume = this.state.mediaInfo.volume;
      const newVolume = direction === 'clockwise'
        ? Math.min(100, currentVolume + this.config.volumeStep)
        : Math.max(0, currentVolume - this.config.volumeStep);
      
      await this.service.setSystemVolume(newVolume);
      await this.updateState();
    } catch (error) {
      console.error('Failed to handle rotation:', error);
    }
  }

  private async handleTouch(x: number, y: number) {
    try {
      // Top third: next track
      // Middle third: mute/unmute
      // Bottom third: previous track
      const section = Math.floor(y / 33.33);
      
      switch (section) {
        case 0:
          await this.service.nextTrack();
          break;
        case 1:
          if (this.config.showMuteButton) {
            await this.service.toggleMute();
          }
          break;
        case 2:
          await this.service.previousTrack();
          break;
      }
      
      await this.updateState();
    } catch (error) {
      console.error('Failed to handle touch:', error);
    }
  }

  private async updateState() {
    try {
      const mediaInfo = await this.service.getMediaInfo();
      this.state.mediaInfo = mediaInfo;
    } catch (error) {
      console.error('Failed to update state:', error);
    }
  }

  public async initialize() {
    await this.updateState();
    
    // Start periodic state updates
    this.updateInterval = setInterval(
      () => this.updateState(),
      this.config.refreshInterval
    );
  }

  public async cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export default new SystemMediaPlugin();
