import { readFile } from 'fs/promises';
import { definePlugin, rotateDelta, type ListItem, type PluginApi } from '@anything/shared';
import { occurrencesBetween, type Occurrence } from './ics';

/**
 * What is coming up, from one or more iCalendar (.ics) feeds.
 *
 * Every calendar service can publish one: iCloud ("Public Calendar"), Google
 * ("Secret address in iCal format"), Outlook ("Publish calendar"). List the
 * URLs — or paths to local .ics files — under `plugins.calendar.feeds`.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function loadFeed(source: string): Promise<string> {
  const location = source.trim().replace(/^webcal:\/\//i, 'https://');
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  return readFile(location.replace(/^file:\/\//i, ''), 'utf8');
}

const time = (date: Date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today", "Tomorrow", or a short weekday and date. */
function dayName(date: Date, now: Date): string {
  if (sameDay(date, now)) return 'Today';
  if (sameDay(date, new Date(now.getTime() + DAY_MS))) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function countdown(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

function setup(api: PluginApi): void {
  const feeds = strings(api.config.feeds);
  const days = number(api.config.days, 7, 1, 60);
  const refreshMinutes = number(api.config.refreshMinutes, 10, 1, 720);

  let events: Occurrence[] = [];
  let problem: string | null = null;
  let loaded = false;
  let selected: string | null = null;

  const key = (event: Occurrence) => `${event.uid}@${event.start.getTime()}`;

  const render = () => {
    const now = new Date();
    // Drop what has finished since the last fetch, so the list stays current
    // between refreshes.
    const upcoming = events.filter((event) =>
      event.end.getTime() === event.start.getTime()
        ? event.start.getTime() >= now.getTime() - 5 * 60_000
        : event.end.getTime() > now.getTime()
    );
    if (!selected || !upcoming.some((event) => key(event) === selected)) {
      selected = upcoming[0] ? key(upcoming[0]) : null;
    }

    const items: ListItem[] = upcoming.map((event) => {
      const running = event.start.getTime() <= now.getTime();
      const today = sameDay(event.start, now) || running;
      const when = event.allDay ? 'all day' : `${time(event.start)}–${time(event.end)}`;
      const chosen = key(event) === selected;
      return {
        id: key(event),
        title: event.title,
        subtitle: chosen
          ? `${dayName(event.start, now)} · ${when}${event.location ? `\n${event.location}` : ''}`
          : `${dayName(event.start, now)}${event.location ? ` · ${event.location}` : ''}`,
        badge: running && !event.allDay ? 'now' : event.allDay ? 'all day' : time(event.start),
        badgeColor: running && !event.allDay ? 'green' : today ? 'blue' : 'neutral'
      };
    });

    const next = upcoming.find((event) => !event.allDay && event.start.getTime() > now.getTime());

    api.setTiles([
      {
        kind: 'list',
        id: 'events',
        w: 6,
        h: 2,
        items,
        selected: selected ?? undefined,
        action: 'select',
        emptyHint:
          feeds.length === 0
            ? 'No calendar connected. Add an .ics feed URL to plugins.calendar.feeds in the config.'
            : !loaded
              ? 'Loading your calendar'
              : `Nothing in the next ${days} days`
      },
      {
        kind: 'text',
        id: 'next',
        w: 4,
        label: problem ? 'Calendar' : 'Next',
        color: problem ? 'red' : undefined,
        value: problem
          ? problem
          : next
            ? `${next.title} ${countdown(next.start.getTime() - now.getTime())}`
            : feeds.length === 0
              ? 'not set up'
              : 'nothing scheduled'
      },
      { kind: 'button', id: 'refresh', w: 2, label: 'Refresh', icon: '🔄', action: 'refresh' }
    ]);
  };

  const refresh = async () => {
    if (feeds.length === 0) {
      render();
      return;
    }
    const now = new Date();
    const until = new Date(now.getTime() + days * DAY_MS);
    const collected: Occurrence[] = [];
    const failures: string[] = [];

    for (const feed of feeds) {
      try {
        collected.push(...occurrencesBetween(await loadFeed(feed), now, until));
      } catch (error) {
        failures.push((error as Error).message);
        api.warn(`could not load a feed: ${(error as Error).message}`);
      }
    }

    // A failed refresh keeps the events already on screen rather than blanking them.
    if (failures.length < feeds.length || !loaded) {
      events = collected.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    loaded = true;
    problem =
      failures.length === 0
        ? null
        : failures.length === feeds.length
          ? `could not load (${failures[0]})`
          : `${failures.length} of ${feeds.length} feeds failed`;
    render();
  };

  api.onAction('select', (payload) => {
    const id = (payload as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string') {
      selected = id;
      render();
    }
  });

  api.onAction('move', (payload) => {
    const delta = rotateDelta(payload);
    const now = Date.now();
    const list = events.filter((event) => event.end.getTime() > now || event.start.getTime() >= now - 5 * 60_000);
    if (delta === null || list.length === 0) return;
    const index = Math.max(0, list.findIndex((event) => key(event) === selected));
    selected = key(list[Math.min(list.length - 1, Math.max(0, index + delta))]);
    render();
  });

  api.onAction('refresh', refresh);
  api.setControls({ rotate: 'move', presets: ['refresh'] });

  render();
  api.every(refreshMinutes * 60_000, refresh);
  // Countdowns and "now" need to move even when the feed has not changed.
  api.every(60_000, render);
}

export default definePlugin({
  manifest: {
    id: 'calendar',
    name: 'Calendar',
    version: '1.0.0',
    description: 'Upcoming events from iCalendar (.ics) feeds',
    icon: '📅',
    defaultConfig: { feeds: [], days: 7, refreshMinutes: 10 }
  },
  setup
});
