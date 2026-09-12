/**
 * SOTE — Erwaehnungen und wohin eine Meldung geht.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { channelDefaults, mentionsIn, NOTE_KINDS } from '../src/task/notes.js';

test('eine Nennung ist `@name`, wie beim Zuweisen', () => {
  /*
   * GEMELDET, zweimal: „Wenn ich @Name eingebe, gibt er ein Schlagwort ein
   * anstatt einen User." -- und danach: „Dann lass uns das bitte umdrehen, +
   * fuer Schlagwoerter und @ fuer Personen, das ist gaengiger."
   *
   * Also `@` fuer eine Person, ueberall. Dass ich sie beim ersten Bauen von
   * selbst so geschrieben hatte, ist der beste Beleg dafuer, dass es die
   * erwartete Schreibweise ist.
   */
  assert.deepEqual(mentionsIn('kannst du das @markus uebernehmen?'), ['markus']);
  assert.deepEqual(mentionsIn('@anna @bernd — bitte'), ['anna', 'bernd']);
});

test('ein Schlagwort ist KEINE Nennung', () => {
  // Schlagwoerter tragen jetzt `+`, also sucht ein `+unterwegs` niemanden.
  assert.deepEqual(mentionsIn('das ist +unterwegs und +wichtig'), []);
});

test('eine Mailadresse ist keine Nennung', () => {
  // `a@b.de` waere sonst eine Nennung von „b.de". Vor dem Zeichen muss ein
  // Zeilenanfang oder ein Leerraum stehen.
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
