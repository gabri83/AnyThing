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
      console.log('Checking if Apple Music is running...');
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
      console.log('Launching Apple Music...');
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
      console.log('Toggling play/pause...');
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
      console.log('Skipping to next track...');
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
      console.log('Going to previous track...');
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
    console.log('Getting current track information...');
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

  public async seekTo(position: number): Promise<void> {
    try {
      console.log('Seeking to position:', position);
      const script = `
        tell application "Music"
          set player position to ${position}
        end tell
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to seek:', error);
      throw error;
    }
  }

  public async getArtwork(): Promise<string | null> {
    try {
      console.log('Getting artwork...');
      const script = `
        tell application "Music"
          if player state is playing or player state is paused then
            set currentTrack to current track
            if exists (artwork 1 of currentTrack) then
              set artworkData to data of artwork 1 of currentTrack
              set tmpPath to (path to temporary items as text) & "current_artwork.jpg"
              
              try
                set fileRef to open for access POSIX path of tmpPath with write permission
                write artworkData to fileRef
                close access fileRef
                return POSIX path of tmpPath
              on error
                try
                  close access fileRef
                end try
                return missing value
              end try
            end if
          end if
        end tell
      `;
      const artworkPath = await executeScript(script) as string | null;
      return artworkPath;
    } catch (error) {
      console.error('Failed to get artwork:', error);
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
}