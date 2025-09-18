import { exec } from 'child_process';
import { promisify } from 'util';
import { MusicState } from '@anything/shared/src/types/protocol';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export class AppleMusicAdapter {
  private artworkCachePath: string;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(cachePath: string = './cache/art') {
    this.artworkCachePath = cachePath;
  }

  async init() {
    await fs.mkdir(this.artworkCachePath, { recursive: true });
  }

  private async runAppleScript(script: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      return stdout.trim();
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`AppleScript error: ${err.message}`);
      }
      throw err;
    }
  }

  async getState(): Promise<MusicState> {
    const script = `
      tell application "Music"
        set s to (player state as text)
        if exists current track then
          set t to name of current track
          set ar to artist of current track
          set al to album of current track
          set d to duration of current track
          set p to player position
          set sh to shuffle enabled
          set rp to song repeat as text
          return {s, t, ar, al, d, p, sh, rp}
        else
          return {"stopped", "", "", "", "0", "0", "false", "off"}
        end if
      end tell
    `;

    const result = await this.runAppleScript(script);
    const [state, title, artist, album, duration, position, shuffle, repeat] = result.split(', ');

    // Get artwork if available
    let artworkUrl: string | undefined;
    if (title && artist && album) {
      artworkUrl = await this.getArtwork(title, artist, album);
    }

    return {
      state: state as 'playing' | 'paused' | 'stopped',
      title: title || undefined,
      artist: artist || undefined,
      album: album || undefined,
      artworkUrl,
      positionMs: Math.round(parseFloat(position) * 1000),
      durationMs: Math.round(parseFloat(duration) * 1000),
      shuffle: shuffle === 'true',
      repeat: repeat as 'off' | 'one' | 'all'
    };
  }

  private async getArtwork(title: string, artist: string, album: string): Promise<string | undefined> {
    const hash = createHash('md5')
      .update(`${artist}${album}${title}`)
      .digest('hex');
    const artworkPath = path.join(this.artworkCachePath, `${hash}.jpg`);

    try {
      // Check if artwork exists in cache
      await fs.access(artworkPath);
      return `/art/${hash}.jpg`;
    } catch {
      // Get artwork from Music.app
      const script = `
        tell application "Music"
          tell current track
            if exists artwork 1 then
              set d to raw data of artwork 1
              return d
            end if
          end tell
        end tell
      `;

      try {
        const result = await this.runAppleScript(script);
        if (result) {
          await fs.writeFile(artworkPath, Buffer.from(result, 'hex'));
          return `/art/${hash}.jpg`;
        }
      } catch (err) {
        console.error('Failed to get artwork:', err);
      }
    }
  }

  async play(): Promise<void> {
    await this.runAppleScript('tell application "Music" to play');
  }

  async pause(): Promise<void> {
    await this.runAppleScript('tell application "Music" to pause');
  }

  async playPause(): Promise<void> {
    await this.runAppleScript('tell application "Music" to playpause');
  }

  async nextTrack(): Promise<void> {
    await this.runAppleScript('tell application "Music" to next track');
  }

  async previousTrack(): Promise<void> {
    await this.runAppleScript('tell application "Music" to previous track');
  }

  async seek(positionSeconds: number): Promise<void> {
    await this.runAppleScript(`tell application "Music" to set player position to ${positionSeconds}`);
  }

  async setShuffle(enabled: boolean): Promise<void> {
    await this.runAppleScript(`tell application "Music" to set shuffle enabled to ${enabled}`);
  }

  async setRepeat(mode: 'off' | 'one' | 'all'): Promise<void> {
    await this.runAppleScript(`tell application "Music" to set song repeat to ${mode}`);
  }

  startPolling(intervalMs: number = 1000, callback: (state: MusicState) => void) {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    const poll = async () => {
      try {
        const state = await this.getState();
        callback(state);
      } catch (err) {
        console.error('Failed to poll Music.app:', err);
      }
    };

    // Initial poll
    poll();

    // Start polling
    this.pollInterval = setInterval(poll, intervalMs);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}