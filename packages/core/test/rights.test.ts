/**
 * SOTE — was eine Rolle gibt.
 *
 * Der Satz, an dem sich das messen muss (SONEs ADR-0087):
 *
 * > A settings screen offering a switch that gates nothing is worse than not
 * > offering it, because somebody will turn it off and believe something.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { allows, isRight, readRights, RIGHT_SAYS, RIGHTS } from '../src/task/rights.js';

test('jedes Recht wird irgendwo geprüft', () => {
  /*
   * Der Wächter für den Satz oben, und er prüft die **Sache**: jeder Name aus
   * der Liste muss im Server vorkommen, und zwar nicht in einem Kommentar.
   *
   * `groups.manage` stand in SOTEs Daten und bewachte nichts. Ein Test über
   * eine Liste („diese drei gibt es") hätte das nie gefunden — er hätte der
   * anderen Liste zugestimmt, und zwei Listen, die einander bestätigen, sind
   * keine Prüfung (ADR-0131).
   */
  const src = ['settings.ts', 'routes.ts', 'people.ts', 'accounts.ts', 'shares.ts']
    .map((f) =>
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'src', f),
        'utf8',
      ),
    )
    .join('\n')
    // Kommentare weg: ein Recht, das nur in einer Erklärung steht, bewacht
    // nichts. (Zum dritten Mal derselbe Testfehler in diesem Projekt, darum
    // gleich richtig.)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const right of RIGHTS) {
    assert.ok(src.includes(`'${right}'`), `„${right}" bewacht nichts`);
  }
});

test('jedes Recht sagt, was es erlaubt', () => {
  // Der Satz steht neben dem Schalter. Ohne ihn ist „roles.manage" eine
  // Zeichenkette, bei der jemand rät.
  for (const right of RIGHTS) {
    assert.ok((RIGHT_SAYS[right] ?? '').length > 10, `„${right}" erklärt sich nicht`);
  }
});

test('das Versprechen von Migration 0013 ist eingehalten', () => {
  /*
   * Hier stand: „es gibt keine Gruppen, also kein groups.manage" — mit dem
   * Zusatz, es komme zurück, wenn Gruppen kommen, **im selben Commit wie die
   * Wege, die es prüfen** (ADR-0087).
   *
   * Der Test steht jetzt umgedreht da, und das ist der Beleg: das Recht ist
   * zurück, und der Wächter oben hat verlangt, dass die Prüfungen mitkommen —
   * er schlug an, bevor eine Gruppe existierte.
   */
  assert.equal(isRight('groups.manage'), true);
  assert.ok((RIGHTS as readonly string[]).includes('groups.manage'));
});

test('unbekanntes wird weggeworfen, nicht übernommen', () => {
  // Ein Recht aus einer künftigen Fassung soll nicht abstürzen — und eines aus
  // einer vergangenen nicht als Erlaubnis wiederauferstehen.
  assert.deepEqual(readRights(['roles.manage', 'nonsens', 'alles.duerfen']), ['roles.manage']);
  assert.deepEqual(readRights('roles.manage'), []);
  assert.deepEqual(readRights(null), []);
  // Doppeltes einmal, und sortiert: zwei Schreibweisen für dieselbe Menge
  // laufen auseinander.
  assert.deepEqual(readRights(['roles.manage', 'people.manage', 'roles.manage']), [
    'people.manage',
    'roles.manage',
  ]);
});

test('ein Eigentümer hält jedes Recht — und zwar hier', () => {
  /*
   * ADR-0087. An einer Stelle und nicht in jeder Abfrage: eine Bedingung, die
   * jeder Aufrufer selbst um „oder Eigentümer" ergänzen muss, ist eine, die ein
   * Aufrufer vergisst.
   */
  const gast = { rights: [] as string[] };
  const chef = { rights: [] as string[], isOwner: true };
  for (const right of RIGHTS) {
    assert.equal(allows(gast, right), false);
    assert.equal(allows(chef, right), true);
  }
  assert.equal(allows({ rights: ['roles.manage'] }, 'roles.manage'), true);
  assert.equal(allows({ rights: ['roles.manage'] }, 'people.manage'), false);
});
