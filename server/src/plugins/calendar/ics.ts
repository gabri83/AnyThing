/**
 * Just enough iCalendar to show what is coming up.
 *
 * Reads VEVENTs from an .ics document and expands them into concrete
 * occurrences inside a time window. Handles UTC, floating and TZID times,
 * all-day events, DTEND or DURATION, EXDATE, moved or cancelled instances
 * (RECURRENCE-ID), and RRULEs with FREQ, INTERVAL, COUNT, UNTIL and — for
 * weekly rules — BYDAY.
 *
 * Not handled: positional BYDAY ("second Tuesday"), BYMONTHDAY, BYSETPOS and
 * RDATE. A monthly or yearly rule using those falls back to "same day of the
 * month", which is right for most calendars and wrong for some.
 */

export interface Occurrence {
  uid: string;
  title: string;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface Property {
  params: Record<string, string>;
  value: string;
}

/** A wall-clock time, plus the zone it is in ('UTC', an IANA name, or null for local). */
interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  zone: string | null;
  dateOnly: boolean;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Upper bound on generated instances per event, so a bad rule cannot spin. */
const MAX_INSTANCES = 5000;

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

function parseLine(line: string): { name: string; property: Property } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf('=');
    if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), property: { params, value: line.slice(colon + 1) } };
}

function parseWallTime(property: Property): WallTime | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(property.value.trim());
  if (!match) return null;
  const dateOnly = match[4] === undefined;
  return {
    y: +match[1],
    mo: +match[2],
    d: +match[3],
    h: dateOnly ? 0 : +match[4],
    mi: dateOnly ? 0 : +match[5],
    s: dateOnly ? 0 : +match[6],
    zone: match[7] ? 'UTC' : (property.params.TZID ?? null),
    dateOnly
  };
}

/** Offset of `zone` from UTC, in ms, at the instant `utc`. */
function zoneOffset(utc: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(utc));
  const get = (type: string) => +(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utc / 1000) * 1000;
}

/** The instant a wall-clock time denotes. */
function toDate(time: WallTime): Date {
  if (time.dateOnly || time.zone === null) {
    // All-day and floating times mean "that time, wherever you are".
    return new Date(time.y, time.mo - 1, time.d, time.h, time.mi, time.s);
  }
  const guess = Date.UTC(time.y, time.mo - 1, time.d, time.h, time.mi, time.s);
  if (time.zone === 'UTC') return new Date(guess);
  try {
    // Two passes: the offset at the guess can differ from the offset at the
    // answer when the guess lands on the other side of a DST change.
    const first = guess - zoneOffset(guess, time.zone);
    return new Date(guess - zoneOffset(first, time.zone));
  } catch {
    // An unknown zone name (Windows zone ids turn up in the wild): treat as local.
    return new Date(time.y, time.mo - 1, time.d, time.h, time.mi, time.s);
  }
}

function parseDuration(value: string): number {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return 0;
  const ms =
    (+(match[2] ?? 0) * 7 + +(match[3] ?? 0)) * DAY_MS +
    +(match[4] ?? 0) * 3_600_000 +
    +(match[5] ?? 0) * 60_000 +
    +(match[6] ?? 0) * 1000;
  return match[1] === '-' ? -ms : ms;
}

interface RawEvent {
  uid: string;
  title: string;
  location: string | null;
  start: WallTime;
  durationMs: number;
  rule: Record<string, string> | null;
  exdates: Set<number>;
  /** Set on an instance that overrides one occurrence of a recurring event. */
  recurrenceId: number | null;
  cancelled: boolean;
}

function parseEvents(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: Record<string, Property[]> | null = null;
  let depth = 0;

  for (const line of unfold(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, property } = parsed;

    if (name === 'BEGIN') {
      if (property.value.toUpperCase() === 'VEVENT' && !current) current = {};
      else if (current) depth += 1; // VALARM and friends, nested in the event
      continue;
    }
    if (name === 'END') {
      if (current && depth > 0) depth -= 1;
      else if (current && property.value.toUpperCase() === 'VEVENT') {
        const event = buildEvent(current);
        if (event) events.push(event);
        current = null;
      }
      continue;
    }
    if (current && depth === 0) (current[name] ??= []).push(property);
  }
  return events;
}

function buildEvent(properties: Record<string, Property[]>): RawEvent | null {
  const first = (name: string) => properties[name]?.[0];
  const startProperty = first('DTSTART');
  const start = startProperty ? parseWallTime(startProperty) : null;
  if (!start) return null;

  let durationMs = start.dateOnly ? DAY_MS : 0;
  const endProperty = first('DTEND');
  const end = endProperty ? parseWallTime(endProperty) : null;
  if (end) durationMs = Math.max(0, toDate(end).getTime() - toDate(start).getTime());
  else if (first('DURATION')) durationMs = Math.max(0, parseDuration(first('DURATION')!.value));

  let rule: Record<string, string> | null = null;
  const rrule = first('RRULE');
  if (rrule) {
    rule = {};
    for (const part of rrule.value.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
    }
  }

  const exdates = new Set<number>();
  for (const exdate of properties.EXDATE ?? []) {
    for (const value of exdate.value.split(',')) {
      const time = parseWallTime({ params: exdate.params, value });
      if (time) exdates.add(toDate(time).getTime());
    }
  }

  const recurrence = first('RECURRENCE-ID');
  const recurrenceTime = recurrence ? parseWallTime(recurrence) : null;

  return {
    uid: first('UID')?.value.trim() ?? '',
    title: unescapeText(first('SUMMARY')?.value ?? '') || '(no title)',
    location: unescapeText(first('LOCATION')?.value ?? '') || null,
    start,
    durationMs,
    rule,
    exdates,
    recurrenceId: recurrenceTime ? toDate(recurrenceTime).getTime() : null,
    cancelled: (first('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED'
  };
}

/** Day number (days since the epoch) of a calendar date, for date arithmetic. */
function dayNumber(y: number, mo: number, d: number): number {
  return Math.round(Date.UTC(y, mo - 1, d) / DAY_MS);
}

function fromDayNumber(day: number): { y: number; mo: number; d: number; weekday: number } {
  const date = new Date(day * DAY_MS);
  return {
    y: date.getUTCFullYear(),
    mo: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    weekday: date.getUTCDay()
  };
}

/** Start instants of a recurring event, in order, up to `until`. */
function* recurrences(event: RawEvent, until: number): Generator<number> {
  const rule = event.rule as Record<string, string>;
  const { start } = event;
  const interval = Math.max(1, parseInt(rule.INTERVAL ?? '1', 10) || 1);
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity;
  const untilRule = rule.UNTIL ? parseWallTime({ params: {}, value: rule.UNTIL }) : null;
  // A date-only UNTIL includes that whole day.
  const limit = Math.min(
    until,
    untilRule ? toDate(untilRule).getTime() + (untilRule.dateOnly ? DAY_MS - 1 : 0) : Infinity
  );
  const at = (y: number, mo: number, d: number) => toDate({ ...start, y, mo, d }).getTime();
  const startDay = dayNumber(start.y, start.mo, start.d);
  const first = at(start.y, start.mo, start.d);

  let produced = 0;
  const emit = function* (time: number): Generator<number, boolean> {
    if (time < first) return true;
    if (time > limit || produced >= count || produced >= MAX_INSTANCES) return false;
    produced += 1;
    yield time;
    return true;
  };

  switch (rule.FREQ) {
    case 'DAILY':
      for (let day = startDay; ; day += interval) {
        const { y, mo, d } = fromDayNumber(day);
        if (!(yield* emit(at(y, mo, d)))) return;
      }

    case 'WEEKLY': {
      const days = (rule.BYDAY ?? '')
        .split(',')
        .map((token) => WEEKDAYS.indexOf(token.replace(/^[+-]?\d+/, '')))
        .filter((index) => index >= 0);
      const weekdays = days.length > 0 ? days : [fromDayNumber(startDay).weekday];
      // Weeks start on Monday unless the rule says otherwise.
      const weekStart = Math.max(0, WEEKDAYS.indexOf(rule.WKST ?? 'MO'));
      const offsets = weekdays.map((weekday) => (weekday - weekStart + 7) % 7).sort((a, b) => a - b);
      const firstWeek = startDay - ((fromDayNumber(startDay).weekday - weekStart + 7) % 7);
      for (let week = firstWeek; ; week += 7 * interval) {
        for (const offset of offsets) {
          const { y, mo, d } = fromDayNumber(week + offset);
          if (!(yield* emit(at(y, mo, d)))) return;
        }
      }
    }

    case 'MONTHLY':
      for (let index = 0; index < MAX_INSTANCES * 2; index += interval) {
        const month = start.mo - 1 + index;
        const y = start.y + Math.floor(month / 12);
        const mo = (month % 12) + 1;
        // A day the month does not have (the 31st of June) is skipped.
        if (fromDayNumber(dayNumber(y, mo, start.d)).d !== start.d) continue;
        if (!(yield* emit(at(y, mo, start.d)))) return;
      }
      return;

    case 'YEARLY':
      for (let y = start.y; y < start.y + MAX_INSTANCES; y += interval) {
        if (fromDayNumber(dayNumber(y, start.mo, start.d)).d !== start.d) continue; // 29 Feb
        if (!(yield* emit(at(y, start.mo, start.d)))) return;
      }
      return;

    default:
      yield* emit(first);
  }
}

/** Every occurrence that overlaps the window [from, to], soonest first. */
export function occurrencesBetween(text: string, from: Date, to: Date): Occurrence[] {
  const events = parseEvents(text);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  // Instances that were moved or cancelled individually replace the one the
  // rule would have generated at their original time.
  const overridden = new Set<string>();
  for (const event of events) {
    if (event.recurrenceId !== null) overridden.add(`${event.uid}@${event.recurrenceId}`);
  }

  const result: Occurrence[] = [];
  const add = (event: RawEvent, startMs: number) => {
    const endMs = startMs + event.durationMs;
    if (endMs < fromMs || startMs > toMs) return;
    // An event that is over is not "coming up", except while it is still running.
    if (endMs === startMs ? startMs < fromMs : endMs <= fromMs) return;
    result.push({
      uid: event.uid,
      title: event.title,
      location: event.location,
      start: new Date(startMs),
      end: new Date(endMs),
      allDay: event.start.dateOnly
    });
  };

  for (const event of events) {
    if (event.cancelled) continue;
    if (!event.rule || event.recurrenceId !== null) {
      add(event, toDate(event.start).getTime());
      continue;
    }
    for (const startMs of recurrences(event, toMs)) {
      if (event.exdates.has(startMs)) continue;
      if (overridden.has(`${event.uid}@${startMs}`)) continue;
      add(event, startMs);
    }
  }

  return result.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
}
