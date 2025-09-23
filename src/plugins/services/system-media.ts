import osascript from 'node-osascript';
import { promisify } from 'util';
import { exec } from 'child_process';

const executeScript = promisify(osascript.execute);
const execPromise = promisify(exec);

export interface MediaInfo {
  isPlaying: boolean;
  volume: number;
  app?: string;
  track?: {
    name: string;
    artist: string;
  };
}

export class SystemMediaService {
  private static instance: SystemMediaService;

  private constructor() {}

  public static getInstance(): SystemMediaService {
    if (!SystemMediaService.instance) {
      SystemMediaService.instance = new SystemMediaService();
    }
    return SystemMediaService.instance;
  }

  public async getMediaInfo(): Promise<MediaInfo> {
    try {
      // Return a pipe-delimited string: app|state|trackName|artist
      const mediaInfoScript = `
        try
          tell application "Music"
            set stateStr to (player state as string)
            if stateStr is "playing" then
              set t to current track
              return "Music|" & stateStr & "|" & (name of t) & "|" & (artist of t)
            else
              return "Music|" & stateStr & "||"
            end if
          end tell
        on error
          -- Music not available, continue
        end try
        
        tell application "System Events" to set spotifyRunning to (exists process "Spotify")
        if spotifyRunning then
          try
            tell application "Spotify"
              set stateStr to (player state as string)
              if stateStr is "playing" then
                return "Spotify|" & stateStr & "|" & (name of current track) & "|" & (artist of current track)
              else
                return "Spotify|" & stateStr & "||"
              end if
            end tell
          on error
            -- Spotify not available
          end try
        end if
        
        return "none|stopped||"
      `;

      const result = (await executeScript(mediaInfoScript)) as string;
      const [app, state, name, artist] = (typeof result === 'string' ? result : '').split('|');
      const isPlaying = state === 'playing';
      const volume = await this.getSystemVolume();

      return {
        isPlaying,
        volume,
        app: app && app !== 'none' ? app : undefined,
        track: name ? { name, artist: artist || '' } : undefined
      };
    } catch (error) {
      console.error('Failed to get media info:', error);
      return { isPlaying: false, volume: await this.getSystemVolume().catch(() => 0) };
    }
  }

  public async playPause(): Promise<void> {
    try {
      // Prefer controlling running apps directly
      const script = `
        tell application "System Events" to set musicRunning to (exists process "Music")
        if musicRunning then
          tell application "Music" to playpause
          return
        end if
        tell application "System Events" to set spotifyRunning to (exists process "Spotify")
        if spotifyRunning then
          tell application "Spotify" to playpause
          return
        end if
        -- Fallback to media key (no modifiers)
        tell application "System Events" to key code 100
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
        tell application "System Events" to set musicRunning to (exists process "Music")
        if musicRunning then
          tell application "Music" to next track
          return
        end if
        tell application "System Events" to set spotifyRunning to (exists process "Spotify")
        if spotifyRunning then
          tell application "Spotify" to next track
          return
        end if
        -- Fallback to media next key
        tell application "System Events" to key code 101
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
        tell application "System Events" to set musicRunning to (exists process "Music")
        if musicRunning then
          tell application "Music" to previous track
          return
        end if
        tell application "System Events" to set spotifyRunning to (exists process "Spotify")
        if spotifyRunning then
          tell application "Spotify" to previous track
          return
        end if
        -- Fallback to media previous key
        tell application "System Events" to key code 109
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to go to previous track:', error);
      throw error;
    }
  }

  public async getSystemVolume(): Promise<number> {
    try {
      const script = `
        output volume of (get volume settings)
      `;
      return await executeScript(script) as number;
    } catch (error) {
      console.error('Failed to get system volume:', error);
      return 0;
    }
  }

  public async setSystemVolume(volume: number): Promise<void> {
    try {
      const normalizedVolume = Math.max(0, Math.min(100, Math.round(volume)));
      const script = `
        set volume output volume ${normalizedVolume}
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to set system volume:', error);
      throw error;
    }
  }

  public async isMuted(): Promise<boolean> {
    try {
      const script = `
        output muted of (get volume settings)
      `;
      return await executeScript(script) as boolean;
    } catch (error) {
      console.error('Failed to get mute state:', error);
      return false;
    }
  }

  public async toggleMute(): Promise<void> {
    try {
      const script = `
        set volume output muted (not output muted of (get volume settings))
      `;
      await executeScript(script);
    } catch (error) {
      console.error('Failed to toggle mute:', error);
      throw error;
    }
  }
}


