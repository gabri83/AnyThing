import { readFile, rename } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PlaybackStatus } from '@anything/shared';
import {
  FIELD_SEPARATOR,
  FIELD_SEPARATOR_AS,
  runAppleScript
} from '../../osascript';

export interface MusicSnapshot {
  /** False when Music.app is not running. Everything else is then empty. */
  running: boolean;
  status: PlaybackStatus;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Seconds. Zero when unknown. */
  duration: number;
  /** Seconds. */
  position: number;
  /** Music's persistent id for the track, used to cache artwork. */
  trackId: string | null;
  shuffle: boolean;
  /** 0-100. */
  volume: number;
}

export const EMPTY_SNAPSHOT: MusicSnapshot = {
  running: false,
  status: 'stopped',
  title: null,
  artist: null,
  album: null,
  duration: 0,
  position: 0,
  trackId: null,
  shuffle: false,
  volume: 0
};

/**
 * `if not (application "Music" is running)` is the one check that neither
 * launches Music nor needs System Events, keeping the permission prompt on
 * first run to Music alone.
 */
const SNAPSHOT_SCRIPT = `
set sep to ${FIELD_SEPARATOR_AS}
if not (application "Music" is running) then return "stopped"
tell application "Music"
  set ps to (player state as string)
  set vol to (sound volume as integer)
  set shuf to (shuffle enabled as string)
  if ps is "playing" or ps is "paused" then
    try
      set t to current track
      return ps & sep & (get name of t) & sep & (get artist of t) & sep & ¬
        (get album of t) & sep & (get duration of t) & sep & ¬
        (get player position) & sep & (get persistent ID of t) & sep & ¬
        shuf & sep & vol
    on error
      return ps & sep & sep & sep & sep & "0" & sep & "0" & sep & sep & shuf & sep & vol
    end try
  end if
  return "stopped" & sep & sep & sep & sep & "0" & sep & "0" & sep & sep & shuf & sep & vol
end tell
`;

function toStatus(value: string): PlaybackStatus {
  return value === 'playing' || value === 'paused' ? value : 'stopped';
}

function toNumber(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function orNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse the snapshot script's output. Exported for tests. */
export function parseSnapshot(output: string): MusicSnapshot {
  const fields = output.split(FIELD_SEPARATOR);

  // The only short response is the bare "stopped" sentinel, meaning Music
  // is not running. A running-but-idle Music still returns all nine fields.
  if (fields.length < 9) {
    return { ...EMPTY_SNAPSHOT };
  }

  return {
    running: true,
    status: toStatus(fields[0].trim()),
    title: orNull(fields[1]),
    artist: orNull(fields[2]),
    album: orNull(fields[3]),
    duration: Math.max(0, Math.round(toNumber(fields[4]))),
    position: Math.max(0, toNumber(fields[5])),
    trackId: orNull(fields[6]),
    shuffle: fields[7].trim() === 'true',
    volume: Math.min(100, Math.max(0, Math.round(toNumber(fields[8]))))
  };
}

/** Pick a file extension from the image's magic bytes. */
export function imageExtension(data: Buffer): 'png' | 'jpg' {
  const isPng =
    data.length > 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47;
  return isPng ? 'png' : 'jpg';
}

/**
 * Control Music.app over AppleScript.
 *
 * Read paths swallow their errors and report "nothing playing": polling a
 * closed app is a normal state, not a fault. Write paths let errors through so
 * a failed press reaches the device as a notice.
 */
export class AppleMusicService {
  /** Absolute path of the artwork last written, keyed by track id. */
  private artworkCache = new Map<string, string>();

  public async snapshot(): Promise<MusicSnapshot> {
    try {
      const output = await runAppleScript(SNAPSHOT_SCRIPT);
      return parseSnapshot(output);
    } catch {
      return { ...EMPTY_SNAPSHOT };
    }
  }

  public async playPause(): Promise<void> {
    await runAppleScript('tell application "Music" to playpause');
  }

  public async next(): Promise<void> {
    await runAppleScript('tell application "Music" to next track');
  }

  public async previous(): Promise<void> {
    // Music's "previous track" restarts the current track when more than a few
    // seconds in, which is what a listener means by the button 90% of the time.
    await runAppleScript('tell application "Music" to back track');
  }

  public async seek(seconds: number): Promise<void> {
    const position = Math.max(0, Math.floor(seconds));
    await runAppleScript(
      `tell application "Music" to set player position to ${position}`
    );
  }

  public async nudgeVolume(delta: number): Promise<void> {
    const step = Math.round(delta);
    await runAppleScript(`
tell application "Music"
  set v to (sound volume as integer) + (${step})
  if v > 100 then set v to 100
  if v < 0 then set v to 0
  set sound volume to v
end tell
`);
  }

  public async setShuffle(on: boolean): Promise<void> {
    await runAppleScript(
      `tell application "Music" to set shuffle enabled to ${on ? 'true' : 'false'}`
    );
  }

  public async activate(): Promise<void> {
    await runAppleScript('tell application "Music" to activate');
  }

  /**
   * Write the current track's artwork to a temp file and return its path, or
   * null when the track has none. Cached per track id, so a 1-second poll does
   * not re-export the same image.
   */
  public async artwork(trackId: string | null): Promise<string | null> {
    if (!trackId) return null;

    const cached = this.artworkCache.get(trackId);
    if (cached) return cached;

    const staging = join(tmpdir(), `anything-artwork-${process.pid}.bin`);
    const script = `
tell application "Music"
  if not (exists current track) then return "none"
  try
    set imageData to raw data of artwork 1 of current track
  on error
    return "none"
  end try
end tell
set outFile to open for access (POSIX file "${staging}") with write permission
set eof outFile to 0
write imageData to outFile
close access outFile
return "ok"
`;

    try {
      const result = await runAppleScript(script, 8000);
      if (result !== 'ok') return null;

      const data = await readFile(staging);
      if (data.length === 0) return null;

      // Name the file by its real format so the browser gets a usable
      // Content-Type, and by track id so switching back is free.
      const safeId = trackId.replace(/[^A-Za-z0-9]/g, '');
      const finalPath = join(
        tmpdir(),
        `anything-artwork-${safeId}.${imageExtension(data)}`
      );
      await rename(staging, finalPath);
      this.artworkCache.set(trackId, finalPath);
      return finalPath;
    } catch {
      return null;
    }
  }

  /** Drop cached artwork paths. Called on teardown. */
  public clearArtworkCache(): void {
    this.artworkCache.clear();
  }
}
