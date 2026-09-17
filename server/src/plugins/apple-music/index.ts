import { definePlugin, type PluginApi, type Tile } from '@anything/shared';
import { AppleMusicService, EMPTY_SNAPSHOT, type MusicSnapshot } from './service';

const ACTIONS = {
  playPause: 'play-pause',
  next: 'next',
  previous: 'previous',
  seek: 'seek',
  volumeUp: 'volume-up',
  volumeDown: 'volume-down',
  shuffle: 'shuffle',
  open: 'open'
} as const;

interface Settings {
  /** How often to poll Music.app, in milliseconds. */
  pollMs: number;
  /** Percentage points per volume button press. */
  volumeStep: number;
  /** Export and serve album art. Set false to skip the extra AppleScript call. */
  artwork: boolean;
}

function readSettings(config: Record<string, unknown>): Settings {
  const pollMs = Number(config.pollMs);
  const volumeStep = Number(config.volumeStep);
  return {
    pollMs: Number.isFinite(pollMs) && pollMs >= 250 ? pollMs : 1500,
    volumeStep: Number.isFinite(volumeStep) && volumeStep > 0 ? volumeStep : 5,
    artwork: config.artwork !== false
  };
}

/** Build the tile set for a snapshot. Pure, so the layout is directly testable. */
export function buildTiles(
  snapshot: MusicSnapshot,
  artworkUrl: string | null
): Tile[] {
  return [
    {
      kind: 'now-playing',
      id: 'player',
      w: 6,
      h: 2,
      status: snapshot.status,
      title: snapshot.running ? snapshot.title : 'Music is not running',
      artist: snapshot.artist,
      album: snapshot.album,
      artwork: artworkUrl,
      position: snapshot.position,
      duration: snapshot.duration,
      actions: {
        playPause: ACTIONS.playPause,
        next: ACTIONS.next,
        previous: ACTIONS.previous,
        seek: ACTIONS.seek
      }
    },
    {
      kind: 'button',
      id: 'volume-down',
      label: 'Down',
      icon: '−',
      action: ACTIONS.volumeDown
    },
    {
      kind: 'gauge',
      id: 'volume',
      w: 2,
      label: 'Volume',
      value: snapshot.running ? snapshot.volume : null,
      max: 100,
      unit: '%',
      unavailableHint: 'Music closed'
    },
    {
      kind: 'button',
      id: 'volume-up',
      label: 'Up',
      icon: '+',
      action: ACTIONS.volumeUp
    },
    {
      kind: 'toggle',
      id: 'shuffle',
      label: 'Shuffle',
      icon: '⇄',
      on: snapshot.shuffle,
      action: ACTIONS.shuffle
    },
    {
      kind: 'button',
      id: 'open',
      label: 'Open Music',
      icon: '♪',
      color: 'pink',
      action: ACTIONS.open
    }
  ];
}

function seekPosition(payload: unknown): number | null {
  if (typeof payload === 'object' && payload !== null) {
    const value = (payload as { position?: unknown }).position;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export default definePlugin({
  manifest: {
    id: 'apple-music',
    name: 'Apple Music',
    version: '1.0.0',
    description: 'Transport controls, artwork and volume for Music.app',
    icon: '♫',
    platforms: ['darwin'],
    defaultConfig: { pollMs: 1500, volumeStep: 5, artwork: true }
  },

  async setup(api: PluginApi) {
    const settings = readSettings(api.config);
    const service = new AppleMusicService();

    let snapshot: MusicSnapshot = { ...EMPTY_SNAPSHOT };
    let artworkUrl: string | null = null;
    let artworkTrackId: string | null = null;

    const publish = () => api.setTiles(buildTiles(snapshot, artworkUrl));

    const refresh = async () => {
      snapshot = await service.snapshot();

      if (settings.artwork && snapshot.trackId !== artworkTrackId) {
        artworkTrackId = snapshot.trackId;
        const path = await service.artwork(snapshot.trackId);
        // The filename carries the track id, so the URL changes with the track
        // and the browser never shows the previous album's art from cache.
        artworkUrl = path ? api.serveFile(path.split('/').pop() as string, path) : null;
      }

      publish();
    };

    /** Refresh right after a command so the device does not wait for the next poll. */
    const act = (fn: () => Promise<void>) => async () => {
      await fn();
      await refresh();
    };

    api.onAction(ACTIONS.playPause, act(() => service.playPause()));
    api.onAction(ACTIONS.next, act(() => service.next()));
    api.onAction(ACTIONS.previous, act(() => service.previous()));
    api.onAction(ACTIONS.volumeUp, act(() => service.nudgeVolume(settings.volumeStep)));
    api.onAction(
      ACTIONS.volumeDown,
      act(() => service.nudgeVolume(-settings.volumeStep))
    );
    api.onAction(ACTIONS.shuffle, act(() => service.setShuffle(!snapshot.shuffle)));
    api.onAction(ACTIONS.open, act(() => service.activate()));

    api.onAction(ACTIONS.seek, async (payload) => {
      const position = seekPosition(payload);
      if (position === null) {
        api.warn('seek called without a numeric position');
        return;
      }
      await service.seek(position);
      await refresh();
    });

    api.every(settings.pollMs, refresh);
  }
});
