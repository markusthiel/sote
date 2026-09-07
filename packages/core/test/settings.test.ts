/**
 * SOTE — drei Ebenen, eine Antwort.
 *
 * Der Test hält die Reihenfolge fest (SONEs ADR-0124: Person, dann
 * Arbeitsbereich über Instanz, dann das Gerät) und die Stelle, an der sie am
 * leichtesten falsch wird: `system` ist eine **Wahl** und kein fehlender Wert.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { isScheme, readSettings, resolveSettings, SCHEMES } from '../src/look/settings.js';

test('die Person schlägt den Arbeitsbereich schlägt die Instanz', () => {
  assert.equal(
    resolveSettings({ scheme: 'dark' }, { scheme: 'light' }, { scheme: 'light' }).scheme,
    'dark',
  );
  assert.equal(resolveSettings({}, { scheme: 'light' }, { scheme: 'dark' }).scheme, 'light');
  assert.equal(resolveSettings({}, {}, { scheme: 'dark' }).scheme, 'dark');
});

test('hat niemand etwas gesagt, entscheidet das Gerät', () => {
  assert.equal(resolveSettings({}, {}, {}).scheme, 'system');
});

test('„system" ist eine Wahl und kein fehlender Wert', () => {
  // Der Punkt, an dem eine Vorrangregel typischerweise kippt: wer ausdrücklich
  // „wie das Gerät" gewählt hat, will das AUCH DANN, wenn der Arbeitsbereich
  // dunkel sagt. Ein `??` über einen leeren String oder eine Prüfung auf
  // Wahrheitswert würde hier den Arbeitsbereich gewinnen lassen.
  assert.equal(resolveSettings({ scheme: 'system' }, { scheme: 'dark' }, {}).scheme, 'system');
});

test('die Zeitzone folgt derselben Reihenfolge', () => {
  assert.equal(
    resolveSettings({ zone: 'Europe/Berlin' }, { zone: 'UTC' }, {}).zone,
    'Europe/Berlin',
  );
  assert.equal(resolveSettings({}, {}, { zone: 'Europe/Berlin' }).zone, 'Europe/Berlin');
  // Und ohne Angabe wirklich nichts — nicht 'UTC'. Der Browser schickt seine
  // mit; diese hier ist die Rückfallebene für alles ohne Browser.
  assert.equal(resolveSettings({}, {}, {}).zone, undefined);
});

test('was der Kern nicht kennt, zählt als nichts gesagt', () => {
  // Ein Konto, in dem ein Wort aus einer künftigen Fassung steht, bekommt die
  // gewöhnliche Antwort — keine Oberfläche, die sich nicht entscheiden kann.
  assert.deepEqual(readSettings({ scheme: 'sepia' }), {});
  assert.deepEqual(readSettings({ scheme: 'dark', zone: 'Europa/Berlin' }), { scheme: 'dark' });
  assert.deepEqual(readSettings(null), {});
  assert.deepEqual(readSettings('dark'), {});
  assert.deepEqual(readSettings({ scheme: 'dark', zone: 'Europe/Berlin' }), {
    scheme: 'dark',
    zone: 'Europe/Berlin',
  });
});

test('drei Schemata, und „auto" ist keines davon', () => {
  assert.deepEqual([...SCHEMES], ['system', 'light', 'dark']);
  assert.equal(isScheme('system'), true);
  assert.equal(isScheme('auto'), false, 'ein zweites Wort für dieselbe Sache wäre zwei Wahrheiten');
});
