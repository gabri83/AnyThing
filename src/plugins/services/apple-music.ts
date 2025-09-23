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

  public async setPosition(seconds: number): Promise<void> {
    try {
      const pos = Math.max(0, Math.floor(seconds));
      const script = `
        tell application "Music"
          set player position to ${pos}
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to set player position:', error);
      throw error;
    }
  }

  public async getCurrentTrack(): Promise<Track | null> {
    try {
      const script = `
        tell application "Music"
          set ps to (player state as string)
          if ps is "playing" or ps is "paused" then
            if (exists current track) then
              set t to current track
              set nm to (get name of t)
              set ar to (get artist of t)
              set al to (get album of t)
              set du to (get duration of t)
              set pos to (get player position)
              return {name:nm, artist:ar, album:al, duration:du, position:pos}
            else
              return missing value
            end if
          else
            return missing value
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
      // Swallow frequent AppleScript polling errors; treat as no track
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
      const s = await executeScript(script) as string;
      if (s === 'playing' || s === 'paused') return s;
      return 'stopped';
    } catch (error) {
      // Treat failures as stopped to reduce log noise
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


