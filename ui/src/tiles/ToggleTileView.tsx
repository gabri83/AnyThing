import type { ToggleTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

export function ToggleTileView({ tile, invoke }: TileProps<ToggleTile>) {
  return (
    <button
      type="button"
      className="tile button-tile toggle-tile"
      role="switch"
      aria-checked={tile.on}
      data-wide={(tile.w ?? 1) > 1 || undefined}
      data-on={tile.on}
      style={{
        ...spanStyle(tile),
        ...accentStyle(tile),
        // An uncolored toggle needs a visible "on", and grey is not one.
        ...(tile.color ? {} : { ['--accent' as string]: 'var(--accent-green)' })
      }}
      onClick={() => invoke(tile.action, tile.payload)}
    >
      {tile.icon && <span className="button-icon">{tile.icon}</span>}
      <span className="button-label">{tile.label}</span>
      <span className="toggle-state">{tile.on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
