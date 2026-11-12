import { occurrencesBetween } from './ics';

function calendar(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
}

function event(lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

const utc = (text: string) => new Date(text);
const starts = (text: string, from: string, to: string) =>
  occurrencesBetween(text, utc(from), utc(to)).map((occurrence) => occurrence.start.toISOString());

describe('occurrencesBetween', () => {
  it('reads a single UTC event with its title, location and end', () => {
    const [found] = occurrencesBetween(
      calendar(
        event([
          'UID:one',
          'SUMMARY:Design review\\, part 2',
          'LOCATION:Room 4',
          'DTSTART:20261112T140000Z',
          'DTEND:20261112T150000Z'
        ])
      ),
      utc('2026-11-12T00:00:00Z'),
      utc('2026-11-13T00:00:00Z')
    );
    expect(found).toMatchObject({ title: 'Design review, part 2', location: 'Room 4', allDay: false });
    expect(found.start.toISOString()).toBe('2026-11-12T14:00:00.000Z');
    expect(found.end.toISOString()).toBe('2026-11-12T15:00:00.000Z');
  });

  it('converts a TZID time, on both sides of a DST change', () => {
    const text = calendar(
      event(['UID:tz', 'SUMMARY:Standup', 'DTSTART;TZID=Europe/Rome:20261020T090000', 'RRULE:FREQ=WEEKLY;COUNT=3'])
    );
    // Rome is UTC+2 until 25 October 2026, then UTC+1: 09:00 local throughout.
    expect(starts(text, '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z')).toEqual([
      '2026-10-20T07:00:00.000Z',
      '2026-10-27T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z'
    ]);
  });

  it('leaves out events that are already over, keeps one still running', () => {
    const text = calendar(
      event(['UID:past', 'SUMMARY:Past', 'DTSTART:20261112T080000Z', 'DTEND:20261112T090000Z']),
      event(['UID:running', 'SUMMARY:Running', 'DTSTART:20261112T093000Z', 'DTEND:20261112T110000Z'])
    );
    const found = occurrencesBetween(text, utc('2026-11-12T10:00:00Z'), utc('2026-11-13T00:00:00Z'));
    expect(found.map((occurrence) => occurrence.title)).toEqual(['Running']);
  });

  it('expands a weekly rule on several days with an interval', () => {
    const text = calendar(
      event(['UID:w', 'SUMMARY:Gym', 'DTSTART:20261102T180000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'])
    );
    expect(starts(text, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z')).toEqual([
      '2026-11-02T18:00:00.000Z',
      '2026-11-05T18:00:00.000Z',
      '2026-11-16T18:00:00.000Z',
      '2026-11-19T18:00:00.000Z'
    ]);
  });

  it('honours UNTIL and EXDATE', () => {
    const text = calendar(
      event([
        'UID:d',
        'SUMMARY:Daily',
        'DTSTART:20261110T090000Z',
        'RRULE:FREQ=DAILY;UNTIL=20261113T090000Z',
        'EXDATE:20261111T090000Z'
      ])
    );
    expect(starts(text, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')).toEqual([
      '2026-11-10T09:00:00.000Z',
      '2026-11-12T09:00:00.000Z',
      '2026-11-13T09:00:00.000Z'
    ]);
  });

  it('counts COUNT from the first occurrence, not from the window', () => {
    const text = calendar(
      event(['UID:c', 'SUMMARY:Course', 'DTSTART:20261101T100000Z', 'RRULE:FREQ=DAILY;COUNT=5'])
    );
    expect(starts(text, '2026-11-04T00:00:00Z', '2026-12-01T00:00:00Z')).toEqual([
      '2026-11-04T10:00:00.000Z',
      '2026-11-05T10:00:00.000Z'
    ]);
  });

  it('skips months that do not have the day', () => {
    const text = calendar(
      event(['UID:m', 'SUMMARY:Rent', 'DTSTART:20260131T100000Z', 'RRULE:FREQ=MONTHLY'])
    );
    expect(starts(text, '2026-02-01T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual([
      '2026-03-31T10:00:00.000Z',
      '2026-05-31T10:00:00.000Z'
    ]);
  });

  it('uses a moved instance instead of the one the rule generates', () => {
    const text = calendar(
      event(['UID:r', 'SUMMARY:Sync', 'DTSTART:20261110T100000Z', 'RRULE:FREQ=DAILY;COUNT=3']),
      event([
        'UID:r',
        'SUMMARY:Sync (moved)',
        'RECURRENCE-ID:20261111T100000Z',
        'DTSTART:20261111T150000Z'
      ])
    );
    const found = occurrencesBetween(text, utc('2026-11-10T00:00:00Z'), utc('2026-11-20T00:00:00Z'));
    expect(found.map((occurrence) => `${occurrence.title} ${occurrence.start.toISOString()}`)).toEqual([
      'Sync 2026-11-10T10:00:00.000Z',
      'Sync (moved) 2026-11-11T15:00:00.000Z',
      'Sync 2026-11-12T10:00:00.000Z'
    ]);
  });

  it('treats a date-only event as all day and drops cancelled ones', () => {
    const text = calendar(
      event(['UID:a', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261225']),
      event(['UID:x', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20261225T100000Z'])
    );
    const found = occurrencesBetween(text, utc('2026-12-20T00:00:00Z'), utc('2026-12-30T00:00:00Z'));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: 'Holiday', allDay: true });
    expect(found[0].start.getDate()).toBe(25);
  });

  it('unfolds long lines and ignores alarms nested in an event', () => {
    const text = calendar(
      [
        'BEGIN:VEVENT',
        'UID:f',
        'SUMMARY:A very long ti',
        ' tle that was folded',
        'DTSTART:20261112T140000Z',
        'BEGIN:VALARM',
        'TRIGGER:-PT10M',
        'SUMMARY:Reminder',
        'END:VALARM',
        'END:VEVENT'
      ].join('\r\n')
    );
    const found = occurrencesBetween(text, utc('2026-11-12T00:00:00Z'), utc('2026-11-13T00:00:00Z'));
    expect(found.map((occurrence) => occurrence.title)).toEqual(['A very long title that was folded']);
  });
});
