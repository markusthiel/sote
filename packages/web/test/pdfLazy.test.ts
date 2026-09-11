/**
 * SOTE — der PDF-Motor bleibt aussen vor, bis jemand ein PDF öffnet.
 *
 * SONEs Betrachter hat dafür einen eigenen Test, und der Grund steht dort:
 * „half a megabyte must not land on somebody who never opens a PDF. A test
 * asserts the import stays dynamic, because a static one would be an
 * invisible regression."
 *
 * Unsichtbar ist genau das Wort: ein statischer Import tut nichts Falsches, er
 * macht nur jeden Seitenaufruf teurer — und das sieht man nicht beim Lesen des
 * Codes, sondern erst in einer Messung, die niemand macht.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/components/PdfViewer.tsx', import.meta.url), 'utf8');

test('pdfjs wird dynamisch geholt, nicht oben importiert', () => {
  assert.equal(/^import .*pdfjs-dist/m.test(SRC), false);
  assert.ok(SRC.includes("import('pdfjs-dist')"));
});

test('der Arbeiter auch — sonst rechnet der Motor im Hauptfaden', () => {
  // Ohne eigenen Faden steht die Oberflaeche still, waehrend eine Seite
  // entsteht. Bei einer Seite merkt man es kaum, bei vierzig sehr.
  assert.ok(SRC.includes('pdf.worker.min.mjs?url'));
  assert.ok(SRC.includes('GlobalWorkerOptions.workerSrc'));
});

test('die Bildschirmdichte steht in der Rechnung', () => {
  // Ohne `devicePixelRatio` ist jede Seite auf einem guten Bildschirm
  // unscharf — und Unschaerfe sieht nach schlechtem Scan aus, nicht nach
  // falscher Skalierung.
  assert.ok(SRC.includes('devicePixelRatio'));
});

test('eine Seite wird erst gezeichnet, wenn sie in die Naehe kommt', () => {
  // Ein Prospekt mit vierzig Seiten waere sonst vierzig Bildflaechen in voller
  // Aufloesung, von denen man eine sieht.
  assert.ok(SRC.includes('IntersectionObserver'));
  assert.ok(SRC.includes('rootMargin'));
});
