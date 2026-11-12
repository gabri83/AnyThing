import { useEffect, useRef } from 'react';
import type { ListTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

/**
 * A scrolling list of rows. Touch scrolls it directly; the dial moves the
 * plugin's `selected` id, and the selected row is kept in view here.
 */
export function ListTileView({ tile, invoke }: TileProps<ListTile>) {
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = selectedRef.current;
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [tile.selected, tile.items.length]);

  return (
    <div className="tile list-tile" style={{ ...spanStyle(tile), ...accentStyle(tile) }}>
      {tile.label && <div className="tile-label">{tile.label}</div>}
      {tile.items.length === 0 ? (
        <div className="list-empty">{tile.emptyHint ?? 'Nothing here'}</div>
      ) : (
        <div className="list-rows">
          {tile.items.map((item) => {
            const selected = item.id === tile.selected;
            return (
              <div
                key={item.id}
                ref={selected ? selectedRef : undefined}
                className="list-row"
                data-selected={selected || undefined}
                data-done={item.done || undefined}
                onClick={
                  tile.action ? () => invoke(tile.action as string, { id: item.id }) : undefined
                }
              >
                <div className="list-row-head">
                  {item.icon && <span className="list-icon">{item.icon}</span>}
                  <span className="list-title">{item.title}</span>
                  {item.badge && (
                    <span
                      className="list-badge"
                      style={{
                        ['--badge' as string]: `var(--accent-${item.badgeColor ?? 'neutral'})`
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.subtitle && <div className="list-subtitle">{item.subtitle}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
