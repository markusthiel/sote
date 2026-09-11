/**
 * SOTE — was ein Schlagwort ist.
 *
 * Die Regeln stehen an einer Stelle (`core/task/label.ts`), weil drei Stellen
 * sie brauchen: der Schnellerfasser, das Detailfeld und der Server. Vorher gab
 * es sie nirgends — ein Schlagwort war, was hinter einem `@` stand.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MAX_LABEL, normalizeLabel, sameLabel, uniqueLabels } from '../src/task/label.js';

test('Rand-Leerzeichen fallen weg, alles andere bleibt', () => {
  assert.equal(normalizeLabel('  unterwegs '), 'unterwegs');
  // Groß und klein ist die Entscheidung dessen, der es anlegt.
  assert.equal(normalizeLabel('Unterwegs'), 'Unterwegs');
  assert.equal(normalizeLabel('büro-2'), 'büro-2');
});

test('ein Schlagwort ist ein Wort', () => {
  /*
   * Und das ist keine Bequemlichkeit des Parsers: geschrieben wird `@zu`,
   * gesucht wird `@zu`, und ein Leerzeichen beendet beides. „zu hause" wäre
   * eines, das man mit derselben Sprache nicht wiederfindet, in der man es
   * angelegt hat.
   */
  assert.equal(normalizeLabel('zu hause'), undefined);
  assert.equal(normalizeLabel('a\tb'), undefined);
});

test('nicht stillschweigend umschreiben', () => {
  // Ein Bindestrich statt des Leerzeichens wäre eine Entscheidung von jemand
  // anderem als dem, der es getippt hat — und die Zeile sagt hinterher nicht,
  // warum dort etwas anderes steht.
  assert.notEqual(normalizeLabel('zu hause'), 'zu-hause');
});

test('kein Zeichen der Erfassung am Anfang', () => {
  for (const text of ['@haus', '#haus', '+markus', '!wichtig', '~30']) {
    assert.equal(normalizeLabel(text), undefined, text);
  }
});

test('Leeres und Übermaß', () => {
  assert.equal(normalizeLabel(''), undefined);
  assert.equal(normalizeLabel('   '), undefined);
  assert.equal(normalizeLabel('x'.repeat(MAX_LABEL)), 'x'.repeat(MAX_LABEL));
  assert.equal(normalizeLabel('x'.repeat(MAX_LABEL + 1)), undefined);
});

test('gleich ist gleich, ohne Rücksicht auf Groß und Klein', () => {
  // Die Suche verglich seit immer `lower(l.name)`, das Anlegen Zeichen für
  // Zeichen. Zwei Vergleiche für eine Frage.
  assert.equal(sameLabel('Haus', 'haus'), true);
  assert.equal(sameLabel(' haus ', 'HAUS'), true);
  assert.equal(sameLabel('haus', 'hausen'), false);
});

test('eine Liste wird entdoppelt, die erste Schreibweise gewinnt', () => {
  assert.deepEqual(uniqueLabels(['Haus', 'haus', 'büro']), ['Haus', 'büro']);
  // Unbrauchbares fällt heraus und bringt die Liste nicht zu Fall.
  assert.deepEqual(uniqueLabels(['ok', 'zwei worte', '']), ['ok']);
});
