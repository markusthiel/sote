import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readIcs } from '../src/calendarSources.js';

test('ICS-Datumswerte bleiben unabhängig von der Serverzone, auch bei Wiederholungen', () => {
  const previous = process.env['TZ'];
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:holiday',
    'DTSTART;VALUE=DATE:20260914', 'DTEND;VALUE=DATE:20260916',
    'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Urlaub', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  try {
    for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles']) {
      process.env['TZ'] = zone;
      const events = readIcs(ics, new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
      assert.deepEqual(events.map((e) => [e.start.toISOString(), e.end.toISOString(), e.allDay]), [
        ['2026-09-14T00:00:00.000Z', '2026-09-16T00:00:00.000Z', true],
        ['2026-09-21T00:00:00.000Z', '2026-09-23T00:00:00.000Z', true],
      ], zone);
    }
  } finally { if (previous === undefined) delete process.env['TZ']; else process.env['TZ'] = previous; }
});
