/**
 * SOTE — die Datumsbeschriftungen.
 *
 * Gibt es, weil ein Fehler hier nicht auffällt, solange man ihn nicht liest:
 * eine Frist am 14. Oktober stand als „Mi, 14. Okto" im Browser. Die Kürzel
 * kamen aus `slice(0, 4)`, und das trifft bei sieben von zwölf Monaten kein
 * deutsches Kürzel.
 *
 * Also alle zwölf, einmal ausgeschrieben. Eine Liste, die geprüft wird, ist
 * billiger als eine Regel, die fast stimmt.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { dayDiff, isOverdue, whenLabel } from '../src/dates.js';

/** Ein Mittwoch, damit „heute“ und „morgen“ berechenbar sind. */
const NOW = new Date(2026, 8, 9, 14, 30);

test('alle zwölf Monate haben ein Kürzel, das man auch schreiben würde', () => {
  const expected = [
    'Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni',
    'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.',
  ];
  for (const [i, short] of expected.entries()) {
    // Der 14. jedes Monats 2027 — weit genug weg, dass nie „heute“ greift.
    const label = whenLabel(new Date(2027, i, 14), true, NOW);
    assert.ok(
      label.endsWith(`14. ${short}`),
      `Monat ${i + 1}: „${label}“ sollte auf „14. ${short}“ enden`,
    );
    // Und nichts ist mitten im Wort abgeschnitten.
    assert.doesNotMatch(
      label,
      /(Janu|Febr|Apri|Augu|Nove|Deze|Okto)\b/,
      `Monat ${i + 1}: „${label}“ ist abgeschnitten`,
    );
  }
});

test('heute, morgen und gestern werden benannt statt datiert', () => {
  assert.equal(whenLabel(new Date(2026, 8, 9), true, NOW), 'heute');
  assert.equal(whenLabel(new Date(2026, 8, 10), true, NOW), 'morgen');
  assert.equal(whenLabel(new Date(2026, 8, 8), true, NOW), 'gestern');
});

test('ein Ganztagstermin zeigt keine Uhrzeit — sonst stünde überall 00:00', () => {
  const at = new Date(2026, 8, 9, 0, 0);
  assert.equal(whenLabel(at, true, NOW), 'heute');
  assert.equal(whenLabel(at, false, NOW), 'heute, 00:00');
});

test('eine Uhrzeit wird zweistellig gepolstert', () => {
  assert.equal(whenLabel(new Date(2026, 8, 10, 9, 5), false, NOW), 'morgen, 09:05');
});

test('ein Tag weiter weg trägt Wochentag, Tag und Monat', () => {
  assert.equal(whenLabel(new Date(2026, 8, 14, 9, 0), false, NOW), 'Mo, 14. Sept., 09:00');
});

test('dayDiff zählt Tage und nicht Stunden', () => {
  // 23:59 heute und 00:01 morgen sind zwei Minuten und ein Tag auseinander.
  assert.equal(dayDiff(new Date(2026, 8, 10, 0, 1), new Date(2026, 8, 9, 23, 59)), 1);
  assert.equal(dayDiff(new Date(2026, 8, 9, 0, 1), new Date(2026, 8, 9, 23, 59)), 0);
});

test('überfällig heißt vor heute, nicht vor jetzt', () => {
  // Der Punkt: eine Aufgabe für „heute“ ist um 14:31 nicht überfällig.
  assert.equal(isOverdue(new Date(2026, 8, 9, 9, 0), NOW), false);
  assert.equal(isOverdue(new Date(2026, 8, 8, 23, 59), NOW), true);
});
