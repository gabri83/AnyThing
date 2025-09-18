import osascript from 'node-osascript';
import { promisify } from 'util';

const executeScript = promisify(osascript.execute);

export interface Track {
  name: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
}

export class AppleMusicService {
  private static instance: AppleMusicService;

  private constructor() {}

  public static getInstance(): AppleMusicService {
    if (!AppleMusicService.instance) {
      AppleMusicService.instance = new AppleMusicService();
    }
    return AppleMusicService.instance;
  }

  public async isRunning(): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          return (exists process "Music")
        end tell
      `;
      return await executeScript(script) as boolean;
    } catch (error) {
      console.error('Failed to check Music app status:', error);
      return false;
    }
  }

  public async launch(): Promise<void> {
    try {
      const script = `
        tell application "Music"
          activate
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to launch Music app:', error);
      throw error;
    }
  }

  public async playPause(): Promise<void> {
    try {
      const script = `
        tell application "Music"
          playpause
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to toggle play/pause:', error);
      throw error;
    }
  }

  public async nextTrack(): Promise<void> {
    try {
      const script = `
        tell application "Music"
          next track
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to skip to next track:', error);
      throw error;
    }
  }

  public async previousTrack(): Promise<void> {
    try {
      const script = `
        tell application "Music"
          previous track
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to go to previous track:', error);
      throw error;
    }
  }

  public async getCurrentTrack(): Promise<Track | null> {
    try {
      const script = `
        tell application "Music"
          if player state is playing or player state is paused then
            set currentTrack to current track
            return {name:name of currentTrack, artist:artist of currentTrack, album:album of currentTrack, duration:duration of currentTrack, position:player position}
          end if
        end tell
      `;
      const result = await executeScript(script) as any;
      if (!result) return null;
      
      return {
        name: result.name,
        artist: result.artist,
        album: result.album,
        duration: result.duration,
        position: result.position
      };
    } catch (error) {
      console.error('Failed to get current track:', error);
      return null;
    }
  }

  public async getPlayerState(): Promise<'playing' | 'paused' | 'stopped'> {
    try {
      const script = `
        tell application "Music"
          return player state as string
        end tell
      `;
      return await executeScript(script) as 'playing' | 'paused' | 'stopped';
    } catch (error) {
      console.error('Failed to get player state:', error);
      return 'stopped';
    }
  }

  public async setVolume(volume: number): Promise<void> {
    try {
      const normalizedVolume = Math.max(0, Math.min(100, volume));
      const script = `
        tell application "Music"
          set sound volume to ${normalizedVolume}
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to set volume:', error);
      throw error;
    }
  }

  public async getVolume(): Promise<number> {
    try {
      const script = `
        tell application "Music"
          return sound volume
        end tell
      `;
      return await executeScript(script) as number;
    } catch (error) {
      console.error('Failed to get volume:', error);
      return 0;
    }
  }

  public async getPlaylists(): Promise<string[]> {
    try {
      const script = `
        tell application "Music"
          return name of playlists
        end tell
      `;
      return await executeScript(script) as string[];
    } catch (error) {
      console.error('Failed to get playlists:', error);
      return [];
    }
  }

  public async playPlaylist(playlistName: string): Promise<void> {
    try {
      const script = `
        tell application "Music"
          play playlist "${playlistName}"
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to play playlist:', error);
      throw error;
    }
  }
}