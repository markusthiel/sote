import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  addUnits,
  describe as describeRecurrence,
  nextAfterCompletion,
  nextOccurrence,
  nextOccurrences,
  parseRrule,
  RecurrenceError,
  type Recurrence,
} from '../src/task/recurrence.js';

const utc = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const iso = (d: Date) => d.toISOString();
const isos = (ds: readonly Date[]) => ds.map(iso);

/* ── Der Fall, an dem Things scheitert ─────────────────────────────────── */

test('jeden zweiten Dienstag zählt die Wochen ab dem Anker', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    dtstart: utc(2026, 9, 15, 8, 0),
  };
  assert.deepEqual(isos(nextOccurrences(rec, utc(2026, 9, 14), 3)), [
    iso(utc(2026, 9, 15, 8, 0)),
    iso(utc(2026, 9, 29, 8, 0)),
    iso(utc(2026, 10, 13, 8, 0)),
  ]);
});

test('jeden zweiten Dienstag überspringt die Zwischenwoche auch mitten drin', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    dtstart: utc(2026, 9, 15, 8, 0),
  };
  // Mittwoch der Anker-Woche: der nächste Termin ist 13 Tage später, nicht 6.
  assert.equal(iso(nextOccurrence(rec, utc(2026, 9, 16))!), iso(utc(2026, 9, 29, 8, 0)));
});

test('die Uhrzeit des Ankers gilt für jeden Termin', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: utc(2026, 9, 7, 6, 30),
  };
  assert.equal(iso(nextOccurrence(rec, utc(2026, 9, 7, 6, 29))!), iso(utc(2026, 9, 7, 6, 30)));
  // Genau auf dem Zeitpunkt: der nächste ist der übernächste Montag.
  assert.equal(iso(nextOccurrence(rec, utc(2026, 9, 7, 6, 30))!), iso(utc(2026, 9, 14, 6, 30)));
});

/* ── Monate, und der Fall, der Kalender kaputt macht ───────────────────── */

test('am 1. jedes Monats', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1',
    dtstart: utc(2026, 9, 1),
  };
  assert.deepEqual(isos(nextOccurrences(rec, utc(2026, 9, 5), 3)), [
    iso(utc(2026, 10, 1)),
    iso(utc(2026, 11, 1)),
    iso(utc(2026, 12, 1)),
  ]);
});

test('BYMONTHDAY=31 überspringt kurze Monate, statt auf den 1. zu rutschen', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31',
    dtstart: utc(2026, 1, 31),
  };
  assert.deepEqual(isos(nextOccurrences(rec, utc(2026, 1, 31), 4)), [
    iso(utc(2026, 3, 31)),
    iso(utc(2026, 5, 31)),
    iso(utc(2026, 7, 31)),
    iso(utc(2026, 8, 31)),
  ]);
});

test('alle 3 Monate zählt Monate ab dem Anker', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15',
    dtstart: utc(2026, 2, 15),
  };
  assert.deepEqual(isos(nextOccurrences(rec, utc(2026, 2, 15), 2)), [
    iso(utc(2026, 5, 15)),
    iso(utc(2026, 8, 15)),
  ]);
});

/* ── Ende einer Regel ──────────────────────────────────────────────────── */

test('COUNT ist erschöpft und gibt null, nicht den nächsten Kalendertermin', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=DAILY;INTERVAL=1;COUNT=3',
    dtstart: utc(2026, 9, 7),
  };
  assert.equal(nextOccurrences(rec, utc(2026, 9, 6), 10).length, 3);
  assert.equal(nextOccurrence(rec, utc(2026, 9, 6), { completed: 3 }), null);
});

test('UNTIL schneidet ab', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20260921T235959Z',
    dtstart: utc(2026, 9, 7),
  };
  assert.deepEqual(isos(nextOccurrences(rec, utc(2026, 9, 6), 5)), [
    iso(utc(2026, 9, 7)),
    iso(utc(2026, 9, 14)),
    iso(utc(2026, 9, 21)),
  ]);
});

/* ── Erledigungsbezogen: kein erfundenes Datum ─────────────────────────── */

test('erledigungsbezogen hat keinen nächsten Termin, solange nicht abgehakt wurde', () => {
  const rec: Recurrence = { kind: 'afterCompletion', n: 3, unit: 'month' };
  assert.equal(nextOccurrence(rec, utc(2026, 9, 7)), null);
  assert.equal(iso(nextAfterCompletion(rec, utc(2026, 6, 12))!), iso(utc(2026, 9, 12)));
});

test('nextAfterCompletion gibt null für den kalenderfesten Fall', () => {
  const rec: Recurrence = {
    kind: 'calendar',
    rrule: 'FREQ=DAILY',
    dtstart: utc(2026, 9, 7),
  };
  assert.equal(nextAfterCompletion(rec, utc(2026, 9, 7)), null);
});

test('ein Monat ab dem 31. wird der Letzte, nicht der Erste des Folgemonats', () => {
  assert.equal(iso(addUnits(utc(2026, 1, 31), 1, 'month')), iso(utc(2026, 2, 28)));
  assert.equal(iso(addUnits(utc(2026, 3, 31), 1, 'month')), iso(utc(2026, 4, 30)));
  assert.equal(iso(addUnits(utc(2026, 1, 15), 2, 'month')), iso(utc(2026, 3, 15)));
});

/* ── Der Satz unter dem Bedienelement ──────────────────────────────────── */

test('der Satz sagt, was die Regel tut', () => {
  assert.equal(
    describeRecurrence({
      kind: 'calendar',
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      dtstart: utc(2026, 9, 15, 8, 0),
    }),
    'Jeden zweiten Dienstag um 08:00 Uhr, ohne Ende.',
  );
  assert.equal(
    describeRecurrence({
      kind: 'afterCompletion',
      n: 3,
      unit: 'month',
    }),
    '3 Monaten nachdem du sie zuletzt abgehakt hast.',
  );
  assert.equal(
    describeRecurrence({
      kind: 'calendar',
      rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1;COUNT=6',
      dtstart: utc(2026, 9, 1),
    }),
    'Jeden Monat am 1., 6 Mal.',
  );
});

/* ── Unbekanntes wird abgelehnt, nicht ignoriert ───────────────────────── */

test('ein RRULE-Teil, den die Auswertung nicht kennt, wird abgelehnt', () => {
  assert.throws(
    () => parseRrule('FREQ=WEEKLY;BYSETPOS=-1;BYDAY=MO'),
    (e: unknown) => e instanceof RecurrenceError && /BYSETPOS/.test((e as Error).message),
  );
});

test('RRULE ohne FREQ wird abgelehnt', () => {
  assert.throws(() => parseRrule('INTERVAL=2'), RecurrenceError);
});

test('FREQ=HOURLY wird abgelehnt — die Oberfläche bietet es nicht an', () => {
  assert.throws(() => parseRrule('FREQ=HOURLY'), RecurrenceError);
});
