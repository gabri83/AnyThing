import type { CSSProperties } from 'react';
import type { Tile } from '@anything/shared';
import { ButtonTileView } from './ButtonTileView';
import { GaugeTileView } from './GaugeTileView';
import { NowPlayingTileView } from './NowPlayingTileView';
import { TextTileView } from './TextTileView';
import { ToggleTileView } from './ToggleTileView';

export type Invoke = (action: string, payload?: unknown) => void;

export interface TileProps<T extends Tile = Tile> {
  tile: T;
  invoke: Invoke;
}

/** Grid placement, only emitted for tiles that actually span more than a cell. */
export function spanStyle(tile: Tile): CSSProperties | undefined {
  const width = Math.min(6, Math.max(1, tile.w ?? 1));
  const height = Math.min(3, Math.max(1, tile.h ?? 1));
  if (width === 1 && height === 1) return undefined;
  return { gridColumn: `span ${width}`, gridRow: `span ${height}` };
}

/** CSS custom property for the tile's accent, consumed by every tile style. */
export function accentStyle(tile: Tile): CSSProperties {
  return { ['--accent' as string]: `var(--accent-${tile.color ?? 'neutral'})` };
}

export function TileView({ tile, invoke }: TileProps) {
  switch (tile.kind) {
    case 'button':
      return <ButtonTileView tile={tile} invoke={invoke} />;
    case 'toggle':
      return <ToggleTileView tile={tile} invoke={invoke} />;
    case 'gauge':
      return <GaugeTileView tile={tile} invoke={invoke} />;
    case 'text':
      return <TextTileView tile={tile} invoke={invoke} />;
    case 'now-playing':
      return <NowPlayingTileView tile={tile} invoke={invoke} />;
  }
}
