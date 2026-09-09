/**
 * SOTE — die Gestaltung driftet nicht zurück.
 *
 * Zwei Fragen, beide aus der Angleichung an SONE:
 *
 * ## 1. Jede Klasse im Markup hat eine Regel
 *
 * Die drei neuen Panels standen wochenlang mit erfundenen Klassennamen da, für
 * die es nie eine Regel gab — nackte Knöpfe mit den Vorgaben des Browsers.
 * Gemeldet als „einfach reingeklatscht ohne Style". Und beim Umbau des Wählers
 * löschte ein Regex vier Regeln zu viel: vier Bildschirme verloren ihre
 * Tabellengestalt, und niemand hat es gesehen. Beides ist dieselbe Frage: gibt
 * es zu diesem Namen im Markup eine Regel im Stylesheet?
 *
 * ## 2. Harte Pixel wachsen nicht
 *
 * SONE hat 156 Gestaltungsvariablen, SOTE hatte 80 mit fünf gleichen Namen und
 * harten Zahlen überall — daher sah alles ein bisschen anders aus. Die Zahlen
 * lassen sich nicht auf einmal ersetzen; was sich verhindern lässt, ist, dass
 * es mehr werden. Darum eine **Sperrklinke**: die Zahl der `font-size`,
 * `padding`, `gap`, `margin` und `min-height` in Pixeln steht hier als Grenze,
 * und der Lauf schlägt fehl, wenn sie überschritten wird. Sinkt sie, wird die
 * Grenze nachgezogen — von Hand, damit es ein bewusster Schritt ist.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const css = readFileSync(join(root, 'packages/web/src/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/* ── 1. Klassen ohne Regel ─────────────────────────────────────────────── */

const rules = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

function tsxFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const used = new Map();
for (const f of tsxFiles(join(root, 'packages/web/src'))) {
  const src = readFileSync(f, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  for (const m of src.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\}|\{[^}]*?'([^']+)'[^}]*\})/g)) {
    for (const grp of m.slice(1)) {
      if (!grp) continue;
      for (const c of grp.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) ?? []) {
        if (['true', 'false', 'undefined', 'null'].includes(c)) continue;
        if (!used.has(c)) used.set(c, new Set());
        used.get(c).add(f.slice(root.length));
      }
    }
  }
}

/*
 * Benannte Ausnahmen — Klassen, die absichtlich nur im Markup stehen:
 * als Haken für Skripte oder Tests, nicht für eine Regel.
 */
const markupOnly = new Set([]);

const ohneRegel = [...used.keys()].filter((c) => !rules.has(c) && !markupOnly.has(c)).sort();

/* ── 2. Sperrklinke für harte Pixel ───────────────────────────────────── */

/*
 * Die Grenze. Nachgezogen nach Flaeche 10 (Dialoge und Formularfelder):
 * font-size 81, padding 76, gap 46, margin 48, min-height 13.
 * Vorher stand hier font-size 84, padding 76, gap 46, margin 52, min-height 13.
 * Wer eine senkt, zieht die Zahl hier nach -- von Hand, damit es ein bewusster
 * Schritt ist und kein Nebeneffekt.
 */
const LIMIT = { 'font-size': 81, padding: 76, gap: 46, margin: 48, 'min-height': 13 };
const count = (prop) =>
  [...css.matchAll(new RegExp(`^\\s*${prop}[a-z-]*:\\s*[^;]*\\b\\d+px`, 'gm'))].length;
const gewachsen = Object.entries(LIMIT)
  .map(([p, max]) => ({ p, n: count(p), max }))
  .filter((x) => x.n > x.max);

/* ── Bericht ───────────────────────────────────────────────────────────── */

let fehler = false;
if (ohneRegel.length > 0) {
  fehler = true;
  console.error('check-styles: Klassen im Markup ohne Regel im Stylesheet:\n');
  for (const c of ohneRegel) console.error(`  .${c}  ←  ${[...used.get(c)].join(', ')}`);
  console.error('\nEine Klasse ohne Regel zeichnet die Vorgaben des Browsers -- oder nichts.');
}
if (gewachsen.length > 0) {
  fehler = true;
  console.error('check-styles: harte Pixelwerte sind gewachsen:\n');
  for (const g of gewachsen) console.error(`  ${g.p}: ${g.n} (Grenze ${g.max})`);
  console.error('\nWo eine Skala existiert (--sone-space-*, --sone-text-*, --sone-control*),');
  console.error('gehoert der Wert dorthin. Die Grenze in scripts/check-styles.mjs zieht');
  console.error('nur nach unten nach.');
}
if (fehler) process.exit(1);

const stand = Object.keys(LIMIT).map((p) => `${p} ${count(p)}/${LIMIT[p]}`).join(', ');
console.log(`check-styles: ${used.size} Klassen mit Regel; harte Pixel: ${stand}`);
