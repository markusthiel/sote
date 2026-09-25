/**
 * SOTE — das kleine Bild ist die Marke.
 *
 * Ein Favicon erscheint genau dort, wo nichts danebensteht, mit dem man es
 * vergleichen könnte: im Tab, im Dock, auf dem Startbildschirm. Deshalb ist es
 * drei Wochen lang dreizeilig geblieben, während die Oberfläche vier Zeilen
 * gezeichnet hat, und aufgefallen ist es erst, als beide Apps nebeneinander
 * installiert waren.
 *
 * Also festgehalten: vier Zeilen, papierfarbener Grund, dieselbe Geometrie und
 * dieselben Farben wie im Code. Erzeugt wird das von `tools/icons.py`; dieser
 * Test prüft das Ergebnis, nicht den Generator.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MARK_ACCENT_ROW, MARK_ROWS } from '../src/components/Logo.tsx';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const read = (name: string): string => readFileSync(path.join(PUBLIC, name), 'utf8');

test('das Favicon hat so viele Zeilen wie das Signet', () => {
  const svg = read('favicon.svg');
  // Ein Grund-Rechteck, dann je Zeile ein Punkt und eine Linie.
  const rects = (svg.match(/<rect/g) ?? []).length;
  assert.equal(rects, 1 + MARK_ROWS.length * 2, `Grund + ${MARK_ROWS.length} Zeilen à Punkt und Linie`);
  assert.equal(MARK_ROWS.length, 4, 'und es sind vier — keine Sonderfassung mit drei');
});

test('das Favicon steht auf Papier, nicht auf Tinte', () => {
  // SONE stand hier auf #161615 und SOTE auf Papier; nebeneinander installiert
  // sah das nach zwei Programmen aus, die nichts miteinander zu tun haben.
  const svg = read('favicon.svg');
  assert.match(svg, /<rect width="100" height="100" fill="#faf8f4"\/>/);
});

test('genau eine Zeile trägt den Akzent, und es ist die dritte', () => {
  const svg = read('favicon.svg');
  const accents = (svg.match(/fill="#2f7d6f"/g) ?? []).length;
  assert.equal(accents, 2, 'Punkt und Linie einer einzigen Zeile');
  assert.equal(MARK_ACCENT_ROW, 2, 'und im Code ist es dieselbe');
});

test('jedes Icon, das index.html und das Manifest nennen, liegt da', () => {
  // check-assets.mjs prüft die Verweise; hier steht, dass die Dateien auch
  // wirklich Bilder und nicht Reste sind.
  for (const name of [
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-192.png',
    'icon-maskable-512.png',
  ]) {
    const bytes = readFileSync(path.join(PUBLIC, name));
    assert.ok(bytes.length > 200, `${name} ist keine leere Hülle`);
  }
});
