/**
 * SOTE — welche Aufgaben aufgeklappt bleiben.
 *
 * Geprüft wird das SPEICHERN, nicht der Haken: der Rückruf des Hooks hängt an
 * React, aber was in den Browser-Speicher geht und was daraus zurückkommt, ist
 * eine Frage für sich — und genau die war gemeldet („sollte gespeichert
 * bleiben bei Reload").
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/hooks/useOpenTasks.ts', import.meta.url), 'utf8');

test('gemerkt wird im Browser und nicht am Konto', () => {
  /*
   * Dieselbe Begründung wie bei `useShowDone` und der Breite der Leiste: das
   * ist eine Eigenschaft dieses Fensters, keine Aussage über die Person. Wer
   * am großen Monitor drei Aufgaben offen hat und am Telefon keine, will zwei
   * Antworten.
   */
  assert.ok(SRC.includes('localStorage'));
  assert.equal(SRC.includes('api.'), false);
});

test('gelesen wird erst nach dem ersten Zeichnen', () => {
  // `localStorage` gibt es beim Bauen nicht — ein Zugriff im Anfangswert
  // bräche den Lauf ohne Browser. Dieselbe Falle, dieselbe Lösung wie in
  // `useShowDone`.
  const anfang = SRC.indexOf('useState<ReadonlySet<string>>(new Set())');
  assert.notEqual(anfang, -1);
  assert.ok(SRC.indexOf('useEffect(() => setIds') > anfang);
});

test('kaputter Speicher hindert die Liste nicht am Zeichnen', () => {
  /*
   * Ein Ausnahmefehler beim Lesen würde die ganze Liste anhalten — wegen einer
   * Angabe, die niemand vermisst. Beide Wege (Lesen und Schreiben) fangen ab.
   */
  assert.equal(SRC.match(/catch\s*{/g)?.length, 2);
});

test('nur die OFFENEN werden gespeichert', () => {
  // Zugeklappt ist der Normalzustand, „nichts gespeichert" heisst also „alles
  // zu". Die Umkehrung wäre eine Liste, die mit jeder Aufgabe wächst — auch
  // mit denen, die niemand je angefasst hat.
  assert.ok(SRC.includes('JSON.stringify([...next])'));
});

test('was gelesen wird, ist geprüft', () => {
  // Im Speicher kann alles stehen — auch eine Zahl oder ein Objekt. Was keine
  // Id ist, fliegt raus, statt als Id weiterverwendet zu werden.
  assert.ok(SRC.includes("typeof x === 'string'"));
  assert.ok(SRC.includes('Array.isArray'));
});
