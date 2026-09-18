import type { GaugeTile } from '@anything/shared';
import { accentStyle, spanStyle, type TileProps } from './TileView';

/** Percentage of the bar to fill, clamped so a bad `max` cannot overflow it. */
export function fillPercent(value: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * Whole numbers print whole: a volume of 62 is "62", not "62.0". One decimal
 * is kept for genuinely fractional readings like a 7.9% CPU load, and dropped
 * again above 100 where it is noise ("1183 RPM").
 */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

export function GaugeTileView({ tile }: TileProps<GaugeTile>) {
  const unavailable = tile.value === null;
  const warn = tile.warnAt !== undefined && tile.value !== null && tile.value >= tile.warnAt;

  return (
    <div
      className={`tile gauge-tile${unavailable ? ' gauge-empty' : ''}`}
      data-wide={(tile.w ?? 1) > 1 || undefined}
      style={{
        ...spanStyle(tile),
        ...accentStyle(tile),
        // An uncolored gauge reads better in blue than in grey.
        ...(tile.color ? {} : { ['--accent' as string]: 'var(--accent-blue)' })
      }}
    >
      <span className="tile-label">{tile.label}</span>

      <div className="gauge-value">
        <span className="gauge-number">
          {unavailable ? '--' : formatValue(tile.value as number)}
        </span>
        {!unavailable && tile.unit && <span className="gauge-unit">{tile.unit}</span>}
      </div>

      {unavailable ? (
        <span className="gauge-unavailable">{tile.unavailableHint ?? 'No reading'}</span>
      ) : (
        <>
          <div className="gauge-track">
            <div
              className="gauge-fill"
              data-warn={warn || undefined}
              style={{ width: `${fillPercent(tile.value as number, tile.max)}%` }}
            />
          </div>
          {tile.sublabel && <span className="gauge-sublabel">{tile.sublabel}</span>}
        </>
      )}
    </div>
  );
}
