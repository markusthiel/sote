/**
 * SOTE — wie eine Aufgabe aussieht, aus drei Ebenen.
 *
 * GEWUENSCHT: „Das wuerde ich mehrstufig machen: Sie kann vom Projekt kommen
 * oder vom Schlagwort, und darueber hinaus kann sie manuell noch einzeln
 * gefaerbt werden."
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { isTaskLook, readTaskLook, resolveTaskLook } from '../src/task/look.js';

test('die Aufgabe schlaegt das Schlagwort schlaegt das Projekt', () => {
  // Von der allgemeinsten zur genauesten Aussage: ein Projekt gilt fuer
  // hundert Aufgaben, ein Schlagwort fuer zwanzig, die Aufgabe fuer sich.
  assert.deepEqual(
    resolveTaskLook({ color: 'red' }, [{ color: 'blue' }], { color: 'green' }),
    { color: 'red' },
  );
  assert.deepEqual(resolveTaskLook({}, [{ color: 'blue' }], { color: 'green' }), {
    color: 'blue',
  });
  assert.deepEqual(resolveTaskLook({}, [], { color: 'green' }), { color: 'green' });
});

test('gefuellt und nicht ersetzt — Feld fuer Feld', () => {
  /*
   * Wer nur ein Zeichen an die Aufgabe haengt, behaelt die Farbe seines
   * Projekts. Ein Ersetzen des ganzen Objekts wuerde eine Angabe zu einem
   * Verzicht auf alle anderen machen — dieselbe Regel wie bei `resolveLook`
   * fuer den Arbeitsbereich, und aus demselben Grund.
   */
  assert.deepEqual(resolveTaskLook({ icon: 'phone' }, [], { color: 'green' }), {
    icon: 'phone',
    color: 'green',
  });
});

test('bei mehreren Schlagwoertern gilt das erste, das etwas sagt', () => {
  /*
   * Mischen waere Unsinn (aus rot und blau wird kein drittes Schlagwort), alle
   * anzeigen ginge nicht — es ist EINE Farbe. Also das erste in der
   * Reihenfolge, in der sie an der Aufgabe stehen: vorhersagbar ist hier mehr
   * wert als klug.
   */
  assert.deepEqual(resolveTaskLook({}, [{}, { color: 'blue' }, { color: 'red' }], {}), {
    color: 'blue',
  });
});

test('ohne alles bleibt es leer — und das heisst „wie bisher“', () => {
  assert.deepEqual(resolveTaskLook({}, [], {}), {});
});

test('Unbrauchbares wird beim Lesen weggelassen', () => {
  assert.deepEqual(readTaskLook({ icon: 42, color: '' }), {});
  assert.deepEqual(readTaskLook(null), {});
  assert.deepEqual(readTaskLook({ icon: 'phone' }), { icon: 'phone' });
});

test('beim Schreiben wird abgelehnt statt gefiltert', () => {
  // Wie beim Titelbild: ein Schreibweg, der still filtert, nimmt jemandem die
  // Rueckmeldung, dass seine Eingabe nicht angekommen ist.
  assert.equal(isTaskLook({ icon: 'phone', color: 'red' }), true);
  assert.equal(isTaskLook({ hintergrund: 'red' }), false);
  assert.equal(isTaskLook({ icon: 42 }), false);
  assert.equal(isTaskLook(null), true);
});
