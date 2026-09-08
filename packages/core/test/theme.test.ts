/**
 * SOTE — wie ein Arbeitsbereich aussieht.
 *
 * Zwei Sachen stehen hier auf dem Spiel, und beide sind SONEs Entscheidungen:
 *
 * 1. **Eine Beziehung, keine Farbe.** `#101010` auf der Schiene ist in beiden
 *    Themen schwarz — wer das setzt, gibt jedem, der im Dunkeln liest, eine
 *    schwarze Leiste auf schwarzer Seite.
 * 2. **Abwesend ist die Vorgabe.** Ein gespeichertes `follow` wäre eine zweite
 *    Schreibweise für denselben Zustand, und zwei Schreibweisen für einen
 *    Zustand laufen auseinander.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CORNERS, lookAttributes, readLook, SURFACES, TREATMENTS } from '../src/look/theme.js';

test('die Vorgabe wird nicht gespeichert, auch wenn sie dasteht', () => {
  assert.deepEqual(readLook({ surfaces: { rail: 'follow' } }), {});
  assert.deepEqual(readLook({ corners: 'soft' }), {});
  // Und was nicht die Vorgabe ist, bleibt.
  assert.deepEqual(readLook({ corners: 'round' }), { corners: 'round' });
});

test('drei Flächen, und die Seite ist keine davon', () => {
  // Wer draußen in der Sonne sitzt, will hell — was auch ein Arbeitsbereich
  // lieber hätte. Dasselbe Argument, das das Stylesheet für
  // prefers-color-scheme ohnehin macht.
  assert.deepEqual([...SURFACES], ['rail', 'sidebar', 'detail']);
  assert.equal((SURFACES as readonly string[]).includes('page'), false);
  assert.equal((SURFACES as readonly string[]).includes('topbar'), false);
});

test('fünf Beziehungen, und keine davon ist eine Farbe', () => {
  assert.deepEqual([...TREATMENTS], ['follow', 'raised', 'sunken', 'inverted', 'accent']);
  for (const t of TREATMENTS) {
    assert.doesNotMatch(t, /^#|rgb|hsl/, `„${t}" sieht wie eine Farbe aus`);
  }
});

test('drei Eckstufen, keine Länge', () => {
  assert.deepEqual([...CORNERS], ['sharp', 'soft', 'round']);
});

test('unbekanntes zählt als nichts gesagt', () => {
  assert.deepEqual(readLook({ surfaces: { rail: 'neon' } }), {});
  assert.deepEqual(readLook({ corners: '12px' }), {});
  assert.deepEqual(readLook({ accent: 'türkis' }), {});
  assert.deepEqual(readLook(null), {});
  assert.deepEqual(readLook('inverted'), {});
  // Eine Fläche, die es nicht gibt, bringt die anderen nicht zu Fall.
  assert.deepEqual(readLook({ surfaces: { rail: 'inverted', kueche: 'accent' } }), {
    surfaces: { rail: 'inverted' },
  });
});

test('ein Palettenname und ein Hex-Wert sind beide erlaubt', () => {
  assert.deepEqual(readLook({ accent: 'blue' }), { accent: 'blue' });
  assert.deepEqual(readLook({ accent: '#2B6398' }), { accent: '#2b6398' });
});

/* ── Was daraus im Stylesheet landet ─────────────────────────────────────── */

test('Flächen und Ecken werden Attribute, nicht Farben', () => {
  // Die Zuordnung „umgekehrt -> diese Töne" gehört ins Stylesheet, wo beide
  // Themen ohnehin definiert sind. Entstünde hier ein Farbwert, müsste der
  // Kern die Themen kennen — und dann gäbe es zwei Orte, an denen steht, was
  // dunkel bedeutet.
  const out = lookAttributes({ surfaces: { rail: 'inverted', detail: 'sunken' }, corners: 'sharp' });
  assert.deepEqual(out.attributes, {
    'data-surface-rail': 'inverted',
    'data-surface-detail': 'sunken',
    'data-corners': 'sharp',
  });
  assert.deepEqual(out.properties, {});
});

test('der Akzent ist die Ausnahme und geht als Wert hinaus', () => {
  // Eine gewählte Farbe hat kein Gegenstück im Entwurf, das man benennen
  // könnte — also ein Wert. Ein NAME wird trotzdem zum Token, damit er der
  // Palette folgt.
  // Dreimal derselbe Wert, und `--accent-base` ist kein Versehen: eine
  // Akzentfläche muss die Farbe lesen und `--accent` gleichzeitig umdefinieren,
  // und beides im selben CSS-Block ist ein Kreis. Die Begründung steht in
  // `theme.ts`.
  assert.deepEqual(lookAttributes({ accent: 'blue' }).properties, {
    '--accent': 'var(--sote-palette-blue)',
    '--accent-line': 'var(--sote-palette-blue)',
    '--accent-base': 'var(--sote-palette-blue)',
  });
  assert.deepEqual(lookAttributes({ accent: '#2b6398' }).properties, {
    '--accent': '#2b6398',
    '--accent-line': '#2b6398',
    '--accent-base': '#2b6398',
  });
});

test('ohne jede Einstellung bleibt beides leer', () => {
  const out = lookAttributes({});
  assert.deepEqual(out.attributes, {});
  assert.deepEqual(out.properties, {});
});
