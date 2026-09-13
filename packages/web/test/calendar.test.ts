/** Der Kalender rechnet mit Tagen — geprüft ohne Browser. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  isoDate,
  isoWeek,
  parseIsoDate,
  spanOf,
  startOfWeek,
  step,
  titleOf,
} from '../src/calendar.js';

test('die Woche beginnt am Montag — auch von einem Sonntag aus', () => {
  // 13.9.2026 ist ein Sonntag; der Montag davor ist der 7.
  assert.equal(isoDate(startOfWeek(new Date(2026, 8, 13))), '2026-09-07');
  assert.equal(isoDate(startOfWeek(new Date(2026, 8, 14))), '2026-09-14', 'ein Montag bleibt');
});

test('ein Tag in der Adresse überlebt den Weg hin und zurück — und Unsinn fällt heraus', () => {
  for (const s of ['2026-09-14', '2026-01-01', '2026-12-31']) {
    assert.equal(isoDate(parseIsoDate(s)!), s);
  }
  assert.equal(parseIsoDate('2026-02-31'), undefined, 'den 31. Februar gibt es nicht');
  assert.equal(parseIsoDate('gestern'), undefined);
  assert.equal(parseIsoDate('2026-9-1'), undefined, 'ohne führende Nullen ist es kein Tag der Adresse');
});

test('das Fenster: Tag, Woche, Monat als volle Wochen', () => {
  const d = new Date(2026, 8, 14); // Montag
  const tag = spanOf('day', d);
  assert.equal(tag.days.length, 1);
  assert.equal(isoDate(tag.to), '2026-09-15');

  const woche = spanOf('week', new Date(2026, 8, 17)); // Donnerstag
  assert.equal(isoDate(woche.from), '2026-09-14');
  assert.equal(isoDate(woche.to), '2026-09-21');
  assert.equal(woche.days.length, 7);

  // September 2026 beginnt an einem Dienstag: das Raster fängt am Montag,
  // dem 31.8., an und hat sechs Zeilen.
  const monat = spanOf('month', new Date(2026, 8, 20));
  assert.equal(isoDate(monat.from), '2026-08-31');
  assert.equal(monat.days.length, 42);
  assert.equal(isoDate(monat.to), '2026-10-12');
});

test('ein Schritt geht in der Einheit der Ansicht — und der Monat bleibt ein Monat', () => {
  assert.equal(isoDate(step('day', new Date(2026, 8, 30), 1)), '2026-10-01');
  assert.equal(isoDate(step('week', new Date(2026, 8, 14), -1)), '2026-09-07');
  // 31. Januar + ein Monat ist der Februar, nicht der 3. März.
  assert.equal(isoDate(step('month', new Date(2026, 0, 31), 1)), '2026-02-01');
});

test('Überschriften und Kalenderwoche', () => {
  assert.equal(titleOf('month', new Date(2026, 8, 14)), 'September 2026');
  assert.equal(titleOf('day', new Date(2026, 8, 14)), 'Montag, 14. September 2026');
  assert.equal(titleOf('week', new Date(2026, 8, 16)), 'KW 38 · 14. – 20. September 2026');
  // Über den Monatswechsel nennt der Anfang seinen Monat.
  assert.equal(titleOf('week', new Date(2026, 8, 30)), 'KW 40 · 28. September – 4. Oktober 2026');
  // ISO: der 1.1.2027 liegt noch in KW 53 von 2026.
  assert.equal(isoWeek(new Date(2027, 0, 1)), 53);
  assert.equal(isoWeek(new Date(2026, 0, 1)), 1);
});
