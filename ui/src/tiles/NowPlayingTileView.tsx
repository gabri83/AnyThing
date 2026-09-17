import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { NowPlayingTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Smooth the progress bar between host polls.
 *
 * The host reports position every second or two. Ticking locally in between
 * keeps the bar moving, but any real update from the host wins: the local clock
 * only ever fills the gap, so a seek or a pause is reflected immediately rather
 * than fought by the animation.
 */
function useSmoothPosition(reported: number, playing: boolean, duration: number): number {
  const [position, setPosition] = useState(reported);
  const reportedRef = useRef(reported);

  useEffect(() => {
    // Snap whenever the host's number moves at all; it is authoritative.
    if (reported !== reportedRef.current) {
      reportedRef.current = reported;
      setPosition(reported);
    }
  }, [reported]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setPosition((current) =>
        duration > 0 ? Math.min(duration, current + 1) : current + 1
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, duration]);

  return position;
}

export function NowPlayingTileView({ tile, invoke }: TileProps<NowPlayingTile>) {
  const playing = tile.status === 'playing';
  const position = useSmoothPosition(tile.position, playing, tile.duration);
  const progress = tile.duration > 0 ? (position / tile.duration) * 100 : 0;

  const seek = (event: MouseEvent<HTMLDivElement>) => {
    if (!tile.actions.seek || tile.duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left) / bounds.width;
    const target = Math.min(1, Math.max(0, fraction)) * tile.duration;
    invoke(tile.actions.seek, { position: target });
  };

  return (
    <div
      className="tile player"
      data-wide
      style={{ ...spanStyle(tile), ...accentStyle(tile) }}
    >
      <div
        className="artwork"
        style={tile.artwork ? { backgroundImage: `url(${tile.artwork})` } : undefined}
        aria-hidden={tile.artwork ? undefined : true}
      >
        {!tile.artwork && '♫'}
      </div>

      <div className="player-body">
        <span className="player-title">{tile.title ?? 'Nothing playing'}</span>
        {tile.artist && <span className="player-artist">{tile.artist}</span>}
        {tile.album && <span className="player-album">{tile.album}</span>}

        {tile.duration > 0 && (
          <div className="player-progress">
            <div className="progress-hit" onClick={seek}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="progress-times">
              <span>{formatTime(position)}</span>
              <span>{formatTime(tile.duration)}</span>
            </div>
          </div>
        )}

        <div className="transport">
          {tile.actions.previous && (
            <button
              type="button"
              aria-label="Previous track"
              onClick={() => invoke(tile.actions.previous as string)}
            >
              {'⏮'}
            </button>
          )}
          {tile.actions.playPause && (
            <button
              type="button"
              className="primary"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => invoke(tile.actions.playPause as string)}
            >
              {playing ? '⏸' : '▶'}
            </button>
          )}
          {tile.actions.next && (
            <button
              type="button"
              aria-label="Next track"
              onClick={() => invoke(tile.actions.next as string)}
            >
              {'⏭'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
