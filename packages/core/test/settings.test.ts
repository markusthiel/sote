/**
 * SOTE — drei Ebenen, eine Antwort.
 *
 * Der Test hält die Reihenfolge fest (SONEs ADR-0124: Person, dann
 * Arbeitsbereich über Instanz, dann das Gerät) und die Stelle, an der sie am
 * leichtesten falsch wird: `system` ist eine **Wahl** und kein fehlender Wert.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { readLanding, resolveLanding } from '../src/look/landing.js';
import {
  isScheme,
  readSettings,
  resolveLook,
  resolveSettings,
  SCHEMES,
} from '../src/look/settings.js';

test('Kalender-Standardansicht kennt nur letzte Ansicht, Tag, Woche und Monat', () => {
  for (const calendarDefault of ['last', 'day', 'week', 'month']) assert.deepEqual(readSettings({ calendarDefault }), { calendarDefault });
  for (const calendarDefault of ['year', '', true, {}, null]) assert.deepEqual(readSettings({ calendarDefault }), {});
});

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

/* ── Wo du landest ───────────────────────────────────────────────────────── */

test('die Person schlägt den Arbeitsbereich, und today ist der Rückfall', () => {
  // Anders als beim Aussehen, und mit Grund (ADR-0032): wo jemand landet, ist
  // die Wahl EINER Person für ihre eigene Sitzung. Der Arbeitsbereich setzt
  // nur eine Vorgabe für alle, die selbst nichts gewählt haben.
  assert.deepEqual(resolveLanding({ kind: 'inbox' }, { kind: 'today' }), { kind: 'inbox' });
  assert.deepEqual(resolveLanding(undefined, { kind: 'inbox' }), { kind: 'inbox' });
  /*
   * `today` als letzter Rückfall und nicht `last`: beim allerersten Anmelden
   * gibt es kein „zuletzt", und ein Rückfall, der auf einen leeren Speicher
   * zeigt, bräuchte selbst einen Rückfall.
   */
  assert.deepEqual(resolveLanding(undefined, undefined), { kind: 'today' });
});

test('„ein bestimmtes Projekt" ohne Projekt ist keine Angabe', () => {
  // „Ein bestimmtes Projekt, aber ich sage nicht welches" ist kein Ort. Es
  // fällt ganz heraus, statt zu einem halben Zustand zu werden, den die
  // Oberfläche später auflösen müsste.
  assert.equal(readLanding({ kind: 'project' }), undefined);
  assert.equal(readLanding({ kind: 'project', projectId: 'Haus' }), undefined);
  assert.deepEqual(readLanding({ kind: 'project', projectId: '3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8' }), {
    kind: 'project',
    projectId: '3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
  });
});

test('unbekanntes zählt als nichts gesagt', () => {
  assert.equal(readLanding({ kind: 'mond' }), undefined);
  assert.equal(readLanding('today'), undefined);
  assert.equal(readLanding(null), undefined);
  // Und eine Landung ohne Projekt-Id trägt auch keine mit sich herum.
  assert.deepEqual(readLanding({ kind: 'today', projectId: 'egal' }), { kind: 'today' });
});
