import { useEffect, useState } from 'react';
import type { ButtonTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

/**
 * A `confirm: true` button arms on first press and fires on the second, which
 * matters on a touchscreen mounted where a sleeve can brush it. The armed state
 * lapses after three seconds so it cannot be triggered much later by accident.
 */
export function ButtonTileView({ tile, invoke }: TileProps<ButtonTile>) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const press = () => {
    if (tile.confirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    invoke(tile.action, tile.payload);
  };

  return (
    <button
      type="button"
      className="tile button-tile"
      data-wide={(tile.w ?? 1) > 1 || undefined}
      data-armed={armed || undefined}
      style={{ ...spanStyle(tile), ...accentStyle(tile) }}
      onClick={press}
    >
      {tile.icon && <span className="button-icon">{tile.icon}</span>}
      <span className="button-label">{tile.label}</span>
      {tile.confirm && (
        <span className="button-hint">{armed ? 'Press again' : 'Confirm'}</span>
      )}
    </button>
  );
}
