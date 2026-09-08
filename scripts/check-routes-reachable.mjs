/**
 * SOTE — keine Route hinter einer, die sie verschluckt.
 *
 * ## Der Anlass
 *
 * Ich habe die Gast-Klingel als eigene Route in `routes.ts` gelegt, hinter den
 * Zweig, der `/api/share/:token/…` abfängt und in `shareRoutes` schickt. Sie
 * war damit **unerreichbar** und antwortete 404 — im Browser ein stiller
 * `EventSource`-Fehler, also genau die Sorte Defekt, die aussieht wie „hier
 * passiert nichts".
 *
 * SONE hat für diese Klasse einen Wächter (`check-routes-reachable.mjs`), SOTE
 * hatte keinen. Jetzt schon, und er prüft die eine Form, die hier vorkommt:
 * eine Verzweigung, die mit `return` endet, verschluckt alles, was ihr Muster
 * trifft.
 *
 * ## Was geprüft wird
 *
 * Für jeden Pfad, der in `routes.ts` **wörtlich** vorkommt (`path === '…'` oder
 * ein Regex-Literal), wird gefragt: fängt ein *früherer* Zweig mit `return` ihn
 * schon? Getestet wird gegen die Regex-Zweige, denn nur die fangen mehr als
 * einen Pfad.
 *
 * Das ist keine vollständige Analyse — es ist die Prüfung für den Fehler, der
 * wirklich passiert ist. Ein Wächter, der alles könnte, wäre einer, den ich
 * nicht fertig geschrieben hätte.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../packages/server/src/routes.ts', import.meta.url), 'utf8');

// Kommentare weg: ein Pfad in einer Erklärung ist kein Weg.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const lines = code.split('\n');

/** Zweige, die mehr als einen Pfad fangen — und danach `return`. */
const gates = [];
/** Wörtliche Pfade, in der Reihenfolge, in der der Server sie prüft. */
const literals = [];

lines.forEach((line, i) => {
  const re = /=\s*\/\^\\\/api(.+?)\/\.exec\(path\)/.exec(line);
  if (re !== null) {
    // Aus dem Quelltext-Regex ein echtes machen: die Datei escapt Schrägstriche.
    const body = ('^\\/api' + re[1]).replace(/\\\\/g, '\\');
    try {
      gates.push({ line: i + 1, re: new RegExp(body), src: body });
    } catch {
      // Ein Muster, das sich hier nicht bauen lässt, wird nicht geprüft — und
      // das steht im Bericht, statt still übergangen zu werden.
      gates.push({ line: i + 1, re: null, src: body });
    }
    return;
  }
  for (const m of line.matchAll(/path === '(\/[^']+)'/g)) {
    literals.push({ line: i + 1, path: m[1] });
  }
});

const verschluckt = [];
for (const lit of literals) {
  for (const gate of gates) {
    if (gate.re === null || gate.line >= lit.line) continue;
    if (gate.re.test(lit.path)) {
      verschluckt.push({ path: lit.path, at: lit.line, gate: gate.src, gateAt: gate.line });
    }
  }
}

const ungeprueft = gates.filter((g) => g.re === null);
if (ungeprueft.length > 0) {
  console.log(
    `check-routes-reachable: ${ungeprueft.length} Muster nicht pruefbar ` +
      `(Zeilen ${ungeprueft.map((g) => g.line).join(', ')})`,
  );
}

if (verschluckt.length > 0) {
  console.error('check-routes-reachable: diese Wege erreicht niemand:\n');
  for (const v of verschluckt) {
    console.error(`  ${v.path} (Zeile ${v.at})`);
    console.error(`    verschluckt von ${v.gate} in Zeile ${v.gateAt}, die mit return endet\n`);
  }
  console.error('Der frueherere Zweig fangt das Muster und kehrt zurueck. Entweder gehoert');
  console.error('der Weg IN diesen Zweig, oder er muss vor ihm stehen.');
  process.exit(1);
}

console.log(
  `check-routes-reachable: ${literals.length} Wege, ${gates.length} Muster, alle erreichbar`,
);
