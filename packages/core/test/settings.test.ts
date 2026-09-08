/**
 * SOTE — drei Ebenen, eine Antwort.
 *
 * Der Test hält die Reihenfolge fest (SONEs ADR-0124: Person, dann
 * Arbeitsbereich über Instanz, dann das Gerät) und die Stelle, an der sie am
 * leichtesten falsch wird: `system` ist eine **Wahl** und kein fehlender Wert.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  isScheme,
  readSettings,
  resolveLook,
  resolveSettings,
  SCHEMES,
} from '../src/look/settings.js';

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

test('jedes Feld des Aussehens wird wirklich aufgelöst', () => {
  /*
   * Der Test, den es nach dem Fehler geben muss.
   *
   * `tint` war im Typ, in `readLook` und in `lookAttributes` — und nicht in
   * `resolveLook`. Der Server speicherte die Tönung korrekt und antwortete mit
   * `effective.look = {}`; im Browser änderte sich nichts. Alle Tests waren
   * grün, weil sie die anderen drei Stellen prüften.
   *
   * Geprüft wird darum nicht „die Felder, die ich kenne", sondern **jedes Feld
   * eines vollständig gesetzten Aussehens**. Ein neues Feld, das hier vergessen
   * wird, fällt beim ersten Lauf auf.
   */
  const alles = {
    surfaces: { rail: 'inverted' as const },
    corners: 'round' as const,
    accent: 'blue' as const,
    tint: '#3355cc' as const,
    fonts: 'reading' as const,
  };
  // Vom Arbeitsbereich gesetzt.
  assert.deepEqual(resolveLook({ look: alles }, {}), alles);
  // Von der Instanz gesetzt, Arbeitsbereich sagt nichts.
  assert.deepEqual(resolveLook({}, { look: alles }), alles);
  // Und wirklich jedes Feld — nicht „die drei, die ich getippt habe".
  for (const key of Object.keys(alles)) {
    assert.ok(
      key in resolveLook({ look: alles }, {}),
      `„${key}" wird nicht aufgelöst`,
    );
  }
});

test('der Arbeitsbereich setzt sein Feld, ohne die anderen der Instanz zu verdrängen', () => {
  // „Gefüllt statt ersetzt": wer nur die Ecken setzt, behält den Akzent der
  // Instanz. Ein `{...i, ...w}` wäre kürzer und würde das brechen.
  const out = resolveLook(
    { look: { corners: 'sharp' } },
    { look: { accent: 'red', tint: '#112233', corners: 'round' } },
  );
  assert.deepEqual(out, { corners: 'sharp', accent: 'red', tint: '#112233' });
});
