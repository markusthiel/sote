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
  /*
   * „Oben" heisst: eine Zeile, die mit `import` beginnt. Der dynamische steht
   * eingerückt im Rumpf.
   *
   * Der erste Wurf dieses Tests prüfte auf `^import .*pdfjs-dist` und schlug
   * an — nicht wegen eines statischen Imports, sondern weil ich beim Umstellen
   * auf `legacy` den zweiten Teil der Prüfung vergessen hatte. Der Test hat
   * also gemeldet, was er melden sollte, nur mit dem falschen Satz daneben.
   */
  const oben = SRC.split('\n').filter((zeile) => /^import\b/.test(zeile));
  assert.equal(oben.some((zeile) => zeile.includes('pdfjs-dist')), false);
  assert.ok(SRC.includes("import('pdfjs-dist/legacy/build/pdf.mjs')"));
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

test('die legacy-Fassung, und zwar aus einem gemessenen Grund', () => {
  /*
   * GEMELDET: „Dieses PDF liess sich nicht oeffnen, kommt jetzt auf dem
   * Desktop."
   *
   * Im Browser nachgesehen, und da stand es: „TypeError:
   * getOrInsertComputed is not a function". Die gewoehnliche Fassung von
   * pdf.js 6 benutzt `Map.prototype.getOrInsertComputed` -- eine
   * Sprachfunktion aus 2025, die es in Firefox und Safari noch nicht gibt und
   * in Chrome erst seit kurzem.
   *
   * `legacy` ist dieselbe Fassung auf aelterem Sprachstand. Der Test haelt sie
   * fest, weil der Unterschied im Quelltext EIN WORT ist und der Fehler erst
   * im fremden Browser auftritt -- also bei niemandem, der ihn baut.
   */
  assert.ok(SRC.includes("import('pdfjs-dist/legacy/build/pdf.mjs')"));
  assert.ok(SRC.includes('legacy/build/pdf.worker.min.mjs?url'));
});
