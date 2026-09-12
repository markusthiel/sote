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
 *
 * ## Und der Fehler, den er NICHT sah (Audit 12.09.2026, F07 und F16)
 *
 * `/kalender/:token.ics` stand hinter dem Zweig `if (!path.startsWith('/api/'))
 * … return`, der alles ausserhalb `/api/` als Datei der Oberfläche ausliefert.
 * Dieser Wächter meldete „alle erreichbar", weil er nur `/^\/api…/`-Muster als
 * Zweige kannte und nur `path === '…'`-Literale als Wege. Der Kalender war
 * ein Regex ausserhalb `/api/`, und der Zweig war ein `startsWith` — beides
 * ausserhalb seines Blicks. Ein Wächter, der grün ist, weil er die Frage nicht
 * stellt.
 *
 * Jetzt: jeder `/^\/…/.exec(path)`-Zweig ist ein Muster, egal ob unter `/api/`;
 * `!path.startsWith('/api/')` ist ein Zweig, der alles fängt, was nicht so
 * anfängt; und jedes Muster ist zugleich ein Weg — geprüft an seinem wörtlichen
 * Anfang (`/kalender/`), denn den fängt ein früherer Zweig oder nicht.
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
  // Der Zweig, der alles ausserhalb eines Präfixes fängt.
  const neg = /!path\.startsWith\('(\/[^']+)'\)/.exec(line);
  if (neg !== null) {
    const prefix = neg[1];
    gates.push({
      line: i + 1,
      re: { test: (p) => !p.startsWith(prefix) },
      src: `alles ausser ${prefix}…`,
    });
    return;
  }
  const re = /=\s*\/\^\\\/(.+?)\/\.exec\(path\)/.exec(line);
  if (re !== null) {
    // Aus dem Quelltext-Regex ein echtes machen: die Datei escapt Schrägstriche.
    const body = ('^\\/' + re[1]).replace(/\\\\/g, '\\');
    let built = null;
    try {
      built = new RegExp(body);
    } catch {
      // Ein Muster, das sich hier nicht bauen lässt, wird nicht geprüft — und
      // das steht im Bericht, statt still übergangen zu werden.
    }
    gates.push({ line: i + 1, re: built, src: body });
    // Und das Muster ist selbst ein Weg: sein wörtlicher Anfang muss ankommen.
    const anfang = /^\^((?:\\\/|[A-Za-z0-9_.-])+)/.exec(body);
    if (anfang !== null) {
      literals.push({ line: i + 1, path: anfang[1].replace(/\\\//g, '/') + 'x' });
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
