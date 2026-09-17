/**
 * The tile model.
 *
 * A tile is one cell of the grid on the device screen. Every plugin — a media
 * controller, a macro pad, a system monitor — expresses itself as a list of
 * tiles, so the UI needs no knowledge of any particular plugin.
 *
 * Tiles are data, never functions: they cross a WebSocket to the device. A tile
 * that should do something on press names an action by id, and the server routes
 * the invocation back to the plugin that registered it.
 */

/** Grid footprint. The grid is 6 columns x 3 rows on an 800x480 screen. */
export interface TileSpan {
  /** Columns to occupy (1-6). Default 1. */
  w?: number;
  /** Rows to occupy (1-3). Default 1. */
  h?: number;
}

/** Named accent colors, resolved to real values by the UI theme. */
export type TileColor =
  | 'neutral'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink';

interface TileBase extends TileSpan {
  /** Unique within the owning plugin. */
  id: string;
  color?: TileColor;
}

/** A press-and-forget button. The workhorse of a macro pad. */
export interface ButtonTile extends TileBase {
  kind: 'button';
  label: string;
  /** Single character or emoji shown above the label. */
  icon?: string;
  /** Action id to invoke on press. */
  action: string;
  /** Optional payload passed to the action handler. */
  payload?: unknown;
  /** Require a second confirming press before invoking. */
  confirm?: boolean;
}

/** A button with on/off state the plugin keeps up to date. */
export interface ToggleTile extends TileBase {
  kind: 'toggle';
  label: string;
  icon?: string;
  on: boolean;
  action: string;
  payload?: unknown;
}

/** A numeric reading with a bar: CPU load, memory, temperature, fan RPM. */
export interface GaugeTile extends TileBase {
  kind: 'gauge';
  label: string;
  /** Current value. Null renders the tile as unavailable rather than as zero. */
  value: number | null;
  /** Full-scale value for the bar. */
  max: number;
  /** Appended to the displayed number, e.g. '%', 'degC', 'RPM'. */
  unit?: string;
  /** Small line under the value, e.g. '3.2 / 16 GB'. */
  sublabel?: string;
  /** Value at or above which the bar turns warning-colored. */
  warnAt?: number;
  /** Shown instead of the bar when value is null. */
  unavailableHint?: string;
}

/** Free text. Useful for plugin status without inventing a tile kind. */
export interface TextTile extends TileBase {
  kind: 'text';
  label: string;
  value: string;
}

/** Transport controls plus track metadata. */
export interface NowPlayingTile extends TileBase {
  kind: 'now-playing';
  status: PlaybackStatus;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** URL the UI can load, served by the host. */
  artwork: string | null;
  /** Seconds. */
  position: number;
  /** Seconds. Zero means unknown, and hides the progress bar. */
  duration: number;
  /** Action ids. Omitted members hide their control. */
  actions: {
    playPause?: string;
    next?: string;
    previous?: string;
    /** Invoked with { position: number } in seconds. */
    seek?: string;
  };
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped';

export type Tile =
  | ButtonTile
  | ToggleTile
  | GaugeTile
  | TextTile
  | NowPlayingTile;

/** One screen of tiles, contributed by a single plugin. */
export interface Page {
  /** Owning plugin id. */
  plugin: string;
  /** Shown in the page switcher. */
  title: string;
  /** Single character or emoji for the page switcher. */
  icon?: string;
  tiles: Tile[];
}
