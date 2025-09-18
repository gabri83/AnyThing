import { Plugin, PluginConfig } from '../../types';
import { AppleMusicService, Track } from '../services/apple-music';

interface AppleMusicPluginConfig extends PluginConfig {
  volumeStep: number;
  refreshInterval: number;
  showAlbumArt: boolean;
}

interface PluginState {
  currentTrack: Track | null;
  currentPlaylist: string | null;
  volume: number;
  playlists: string[];
  isPlaying: boolean;
}

class AppleMusicPlugin implements Plugin {
  public readonly name = 'apple-music';
  public readonly version = '0.1.0';

  private service: AppleMusicService;
  private config: AppleMusicPluginConfig;
  private state: PluginState;
  private updateInterval: NodeJS.Timeout | null;

  constructor() {
    this.service = AppleMusicService.getInstance();
    this.config = {
      volumeStep: 5,
      refreshInterval: 1000,
      showAlbumArt: true
    };
    this.state = {
      currentTrack: null,
      currentPlaylist: null,
      volume: 0,
      playlists: [],
      isPlaying: false
    };
    this.updateInterval = null;
  }

  public get display() {
    if (!this.state.currentTrack) {
      return {
        type: 'text' as const,
        content: 'No track playing'
      };
    }

    const track = this.state.currentTrack;
    return {
      type: 'text' as const,
      content: `${track.name}\nby ${track.artist}\n${this.state.isPlaying ? '▶️' : '⏸️'}`
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
      const currentVolume = await this.service.getVolume();
      const newVolume = direction === 'clockwise'
        ? Math.min(100, currentVolume + this.config.volumeStep)
        : Math.max(0, currentVolume - this.config.volumeStep);
      
      await this.service.setVolume(newVolume);
      this.state.volume = newVolume;
    } catch (error) {
      console.error('Failed to handle rotation:', error);
    }
  }

  private async handleTouch(x: number, y: number) {
    try {
      // Top half of screen: next track
      // Bottom half of screen: previous track
      if (y < 50) {
        await this.service.nextTrack();
      } else {
        await this.service.previousTrack();
      }
      await this.updateState();
    } catch (error) {
      console.error('Failed to handle touch:', error);
    }
  }

  private async updateState() {
    try {
      const [track, playerState, volume, playlists] = await Promise.all([
        this.service.getCurrentTrack(),
        this.service.getPlayerState(),
        this.service.getVolume(),
        this.service.getPlaylists()
      ]);

      this.state = {
        currentTrack: track,
        currentPlaylist: null, // TODO: Implement current playlist detection
        volume,
        playlists,
        isPlaying: playerState === 'playing'
      };
    } catch (error) {
      console.error('Failed to update state:', error);
    }
  }

  public async initialize() {
    try {
      if (!await this.service.isRunning()) {
        await this.service.launch();
      }

      await this.updateState();
      
      // Start periodic state updates
      this.updateInterval = setInterval(
        () => this.updateState(),
        this.config.refreshInterval
      );
    } catch (error) {
      console.error('Failed to initialize Apple Music plugin:', error);
    }
  }

  public async cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export default new AppleMusicPlugin();