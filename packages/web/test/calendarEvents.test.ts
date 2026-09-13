import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SpanEvent } from '../src/api.js';
import { eventKey, eventOnDay, timedEventsOnDay } from '../src/calendarEvents.js';

const event: SpanEvent = {
  feedId: 'a', uid: 'event', recurrenceId: '', title: 'Termin',
  start: '2026-09-14T09:00:00', end: '2026-09-14T10:30:00', allDay: false, location: null,
};

test('Überschneidungen teilen sich die Breite; anschließende Termine nutzen wieder die ganze', () => {
  const segments = timedEventsOnDay([
    event,
    { ...event, uid: 'b', start: '2026-09-14T10:00:00', end: '2026-09-14T11:00:00' },
    { ...event, uid: 'c', start: '2026-09-14T10:30:00', end: '2026-09-14T11:30:00' },
    { ...event, uid: 'd', start: '2026-09-14T11:30:00', end: '2026-09-14T12:00:00' },
    { ...event, uid: 'ganztag', allDay: true },
  ], new Date(2026, 8, 14));
  assert.deepEqual(segments.map(({event, lane, lanes}) => [event.uid, lane, lanes]), [
    ['event', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1],
  ]);
});

test('Zeitblöcke werden auf die örtliche Uhrzeit und den jeweiligen Tag begrenzt', () => {
  assert.deepEqual(eventOnDay(event, new Date(2026, 8, 14)), { from: 540, to: 630 });
  assert.equal(eventOnDay(event, new Date(2026, 8, 15)), null);
  const overnight = { ...event, start: '2026-09-14T23:00:00', end: '2026-09-15T02:30:00' };
  assert.deepEqual(eventOnDay(overnight, new Date(2026, 8, 14)), { from: 1380, to: 1440 });
  assert.deepEqual(eventOnDay(overnight, new Date(2026, 8, 15)), { from: 0, to: 150 });
});

test('Ganztag bleibt ein Datum und das Ende ist exklusiv, auch über mehrere Tage', () => {
  const trip = { ...event, allDay: true, start: '2026-09-14T00:00:00.000Z', end: '2026-09-17T00:00:00.000Z' };
  for (const day of [14, 15, 16]) assert.deepEqual(eventOnDay(trip, new Date(2026, 8, day)), { from: 0, to: 1440 });
  assert.equal(eventOnDay(trip, new Date(2026, 8, 13)), null);
  assert.equal(eventOnDay(trip, new Date(2026, 8, 17)), null);
  assert.equal(eventOnDay({ ...event, end: '2026-09-15T00:00:00' }, new Date(2026, 8, 15)), null);
});

test('Sommerzeitwechsel rechnet in Wandstunden, nicht in vergangenen Stunden', () => {
  const previous = process.env['TZ'];
  process.env['TZ'] = 'Europe/Berlin';
  try {
    assert.deepEqual(eventOnDay({ ...event, start: '2026-03-29T00:30:00Z', end: '2026-03-29T02:30:00Z' }, new Date(2026, 2, 29)), { from: 90, to: 270 });
    assert.deepEqual(eventOnDay({ ...event, allDay: true, start: '2026-03-29T00:00:00Z', end: '2026-03-30T00:00:00Z' }, new Date(2026, 2, 29)), { from: 0, to: 1440 });
  } finally { if (previous === undefined) delete process.env['TZ']; else process.env['TZ'] = previous; }
});

test('Ganztag verschiebt sich westlich von UTC nicht auf den Vortag', () => {
  const previous = process.env['TZ'];
  process.env['TZ'] = 'America/Los_Angeles';
  try {
    const allDay = { ...event, allDay: true, start: '2026-09-14T00:00:00Z', end: '2026-09-15T00:00:00Z' };
    assert.equal(eventOnDay(allDay, new Date(2026, 8, 13)), null);
    assert.deepEqual(eventOnDay(allDay, new Date(2026, 8, 14)), { from: 0, to: 1440 });
  } finally { if (previous === undefined) delete process.env['TZ']; else process.env['TZ'] = previous; }
});

test('Ungültige Intervalle zeichnen keinen Block; Quellen und Wiederholungen bleiben getrennt', () => {
  assert.equal(eventOnDay({ ...event, start: 'broken' }, new Date(2026, 8, 14)), null);
  assert.equal(eventOnDay({ ...event, end: event.start }, new Date(2026, 8, 14)), null);
  assert.notEqual(eventKey(event), eventKey({ ...event, feedId: 'b' }));
  assert.notEqual(eventKey(event), eventKey({ ...event, start: '2026-09-15T09:00:00' }));
});
