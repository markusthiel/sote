/**
 * SOTE — eine gewählte Farbe.
 *
 * Der Test, der die Lehre aus SONE festhält: ein Palettenname ist **keine
 * CSS-Farbe**. Ihn direkt in ein `style` zu schreiben funktionierte dort für
 * die eigenen Hex-Werte und tat für die acht Namen stillschweigend nichts —
 * und das ist die schlechtere Hälfte, weil die Namen die sind, die man wählt.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  colorValue,
  isCustomColor,
  isPaletteName,
  PALETTE,
  readColor,
  readIcon,
} from '../src/look/color.js';

test('ein Name wird zum Token und folgt damit der Palette', () => {
  for (const name of PALETTE) {
    assert.equal(colorValue(name), `var(--sote-palette-${name})`);
  }
});

test('ein Hex-Wert ist er selbst', () => {
  assert.equal(colorValue('#2b6398'), '#2b6398');
  assert.equal(colorValue('#FFF000'), '#FFF000');
});

test('alles andere ist undefined — die Zeile wird ohne Farbe gezeichnet', () => {
  // Kein Fehler: eine Farbe, die eine neuere Fassung kennt und diese nicht,
  // soll die Zeile nicht unbrauchbar machen.
  for (const bad of ['blue', 'rebeccapurple', '#abc', '#12345', 'var(--x)', '', null, 42, {}]) {
    assert.equal(colorValue(bad), undefined, JSON.stringify(bad));
  }
});

test('gelesen wird das eine oder das andere, sonst null', () => {
  assert.equal(readColor('blau'), 'blau');
  assert.equal(readColor('#2B6398'), '#2b6398', 'Hex wird kleingeschrieben');
  assert.equal(readColor('türkis'), null);
  assert.equal(readColor(undefined), null);
});

test('die Prüfungen sind eng — „blue" ist kein Palettenname', () => {
  assert.equal(isPaletteName('blau'), true);
  assert.equal(isPaletteName('blue'), false);
  assert.equal(isCustomColor('#abcdef'), true);
  assert.equal(isCustomColor('#abcde'), false);
  assert.equal(isCustomColor('abcdef'), false);
});

test('acht Namen, alle verschieden', () => {
  assert.equal(PALETTE.length, 8);
  assert.equal(new Set(PALETTE).size, 8);
});

/* ── Das Zeichen ──────────────────────────────────────────────────────────── */

test('ein Zeichen ist Name und Farbe, und beides darf fehlen', () => {
  assert.deepEqual(readIcon({ icon: 'home', iconColor: 'blau' }), {
    icon: 'home',
    iconColor: 'blau',
  });
  assert.deepEqual(readIcon({ icon: 'home' }), { icon: 'home' });
  assert.deepEqual(readIcon({ iconColor: '#2b6398' }), { iconColor: '#2b6398' });
});

test('ein Zeichen ohne Inhalt ist kein Zeichen', () => {
  // null und nicht `{}`: ein leeres Objekt in der Datenbank behauptet, dass
  // jemand etwas gewählt hat.
  assert.equal(readIcon({}), null);
  assert.equal(readIcon({ icon: '   ' }), null);
  assert.equal(readIcon({ icon: '', iconColor: 'türkis' }), null);
  assert.equal(readIcon(null), null);
  assert.equal(readIcon('home'), null);
});

test('der Name des Zeichens wird nicht geprüft, nur begrenzt', () => {
  // Welche Zeichen es gibt, weiß die Oberfläche. Eine Liste im Kern wäre eine
  // zweite Wahrheit, die bei jedem neuen Zeichen nachzuziehen wäre.
  assert.deepEqual(readIcon({ icon: 'gibt-es-nicht' }), { icon: 'gibt-es-nicht' });
  const long = readIcon({ icon: 'x'.repeat(200) });
  assert.equal(long?.icon?.length, 64);
});
