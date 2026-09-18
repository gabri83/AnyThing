import type { TextTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

export function TextTileView({ tile }: TileProps<TextTile>) {
  return (
    <div
      className="tile text-tile"
      data-wide={(tile.w ?? 1) > 1 || undefined}
      data-color={tile.color ?? 'neutral'}
      style={{ ...spanStyle(tile), ...accentStyle(tile) }}
    >
      <span className="tile-label">{tile.label}</span>
      <span className="text-value">{tile.value}</span>
    </div>
  );
}
