/**
 * SOTE — Erwaehnungen und wohin eine Meldung geht.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { channelDefaults, mentionsIn, NOTE_KINDS } from '../src/task/notes.js';

test('eine Nennung sieht aus wie im Schnellerfasser', () => {
  // Wer gelernt hat, eine Aufgabe mit `@markus` zuzuweisen, schreibt denselben
  // Namen in einen Kommentar und meint dasselbe.
  assert.deepEqual(mentionsIn('kannst du das @markus uebernehmen?'), ['markus']);
  assert.deepEqual(mentionsIn('@anna @bernd — bitte'), ['anna', 'bernd']);
});

test('eine Mailadresse ist keine Nennung', () => {
  // `a@b.de` enthaelt ein `@`, meint aber niemanden hier. Darum muss vor dem
  // Zeichen ein Zeilenanfang oder ein Leerraum stehen.
  assert.deepEqual(mentionsIn('schreib an markus@example.org'), []);
  assert.deepEqual(mentionsIn('a@b.de und @echt'), ['echt']);
});

test('derselbe Name zaehlt einmal', () => {
  // Sonst bekaeme jemand zwei Meldungen fuer einen Satz.
  assert.deepEqual(mentionsIn('@markus, @Markus, @MARKUS'), ['markus']);
});

test('ein Punkt am Ende gehoert zum Satz, nicht zum Namen', () => {
  assert.deepEqual(mentionsIn('frag @markus.'), ['markus']);
});

test('je persoenlicher, desto lauter', () => {
  /*
   * Die Vorgaben sind eine Entscheidung und keine Bequemlichkeit:
   *
   * - zugewiesen und Erinnerung: Mail UND App -- da wartet jemand oder eine
   *   Uhrzeit.
   * - genannt und beantwortet: App, keine Mail -- an mich gerichtet, aber es
   *   wartet niemand.
   * - kommentiert: nur der Posteingang. Sonst wird die App bei jedem Satz
   *   laut, und das ist der Weg, auf dem Leute Meldungen ganz abschalten.
   */
  assert.deepEqual(channelDefaults('assigned'), { email: true, push: true });
  assert.deepEqual(channelDefaults('reminder'), { email: true, push: true });
  assert.deepEqual(channelDefaults('mentioned'), { email: false, push: true });
  assert.deepEqual(channelDefaults('replied'), { email: false, push: true });
  assert.deepEqual(channelDefaults('commented'), { email: false, push: false });
});

test('jede Art hat eine Vorgabe', () => {
  // Eine neue Art ohne Vorgabe waere eine, die still nirgends ankommt.
  for (const k of NOTE_KINDS) {
    const c = channelDefaults(k);
    assert.equal(typeof c.email, 'boolean', k);
    assert.equal(typeof c.push, 'boolean', k);
  }
});
