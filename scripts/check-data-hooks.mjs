/**
 * SOTE — greift jeder Zustands-Haken im Stylesheet ins Leere?
 *
 * ## Der Anlass
 *
 * Die Oberfläche steuert ihr Aussehen über `data-*`-Merkmale: `data-drop`,
 * `data-view`, `data-done`, `data-surface-rail` und ein paar Dutzend mehr. Das
 * ist die richtige Bauart — das Bauteil sagt, WAS gilt, das Stylesheet, wie es
 * aussieht.
 *
 * Sie hat aber eine stille Bruchstelle: ein Vertipper auf einer der beiden
 * Seiten meldet sich nirgends. `[data-droped]` im Stylesheet ist gültiges CSS,
 * `data-view="cards"` im Bauteil ist gültiges JSX, und die Regel greift
 * einfach nie. Kein Typecheck sieht das, kein Test, und im Bild fehlt nur eine
 * Farbe, die man für Absicht halten kann.
 *
 * Genau diese Sorte ist in dieser Woche mehrfach vorgekommen — eine Regel, die
 * dasteht und nichts tut.
 *
 * ## Was hier geprüft wird
 *
 * **Eine Richtung, und zwar die sichere:** jedes `data-…` in einem
 * CSS-SELEKTOR muss irgendwo in den Bauteilen gesetzt werden.
 *
 * Die Gegenrichtung wäre verlockend („jedes gesetzte Merkmal soll auch
 * gestaltet werden"), ist aber falsch: viele Merkmale sind für die GESTE da und
 * nicht fürs Aussehen — `data-row`, `data-col`, `data-drag-now`, `data-list-row`
 * werden von `usePointerDrag` gelesen und haben mit Farbe nichts zu tun. Ein
 * Wächter, der sie meldet, wäre einer, den man abschaltet.
 *
 * Verglichen werden nur die NAMEN, nicht die Werte. Ein Wert kann gerechnet
 * sein (`data-drop={drag.target.intent}`), und dem sieht man nicht an, welche
 * Wörter herauskommen.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';

const WEB = new URL('../packages/web/src/', import.meta.url);
/*
 * Der KERN gehört dazu.
 *
 * `theme.ts` setzt die Merkmale für Flächen, Ecken und Schrift — die Oberfläche
 * schreibt nur hin, was er ausrechnet. Beim ersten Lauf fehlte er, und der
 * Wächter meldete `data-corners` und `data-fonts` als tot, obwohl sie gesetzt
 * werden. Ein Wächter, der Richtiges meldet, wird abgeschaltet.
 */
const CORE = new URL('../packages/core/src/', import.meta.url);

const css = readFileSync(new URL('styles.css', WEB), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Alle .tsx/.ts unter `src`, rekursiv. */
function dateien(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const pfad = new URL(name, dir);
    if (statSync(pfad).isDirectory()) out.push(...dateien(new URL(`${name}/`, dir)));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(pfad);
  }
  return out;
}

const markup = [...dateien(WEB), ...dateien(CORE)]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Die Merkmale, an denen das Stylesheet hängt. */
const imCss = new Set();
for (const m of css.matchAll(/\[(data-[a-z-]+)/g)) imCss.add(m[1]);

/**
 * Die Merkmale, die die Bauteile setzen.
 *
 * Drei Schreibweisen, weil JSX drei kennt: `data-x="y"`, `'data-x': y` (in
 * einem gestreuten Objekt) und `dataset.x`. Die dritte in camelCase, darum
 * zurückübersetzt.
 */
const imMarkup = new Set();
for (const m of markup.matchAll(/(data-[a-z-]+)\s*[=:]/g)) imMarkup.add(m[1]);
// Und als Schluesselwort in einem Objekt: `attributes['data-corners'] = …`.
for (const m of markup.matchAll(/['"](data-[a-z-]+)['"]\s*\]?\s*[=:]/g)) imMarkup.add(m[1]);
for (const m of markup.matchAll(/dataset\[?['"]?([a-zA-Z]+)/g)) {
  imMarkup.add(`data-${m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
}

/*
 * Gerechnete Namen decken ihre ganze Familie ab.
 *
 * `attributes[`data-surface-${surface}`]` setzt drei Merkmale, von denen im
 * Quelltext keines wörtlich dasteht. Wer hier auf Buchstabengleichheit besteht,
 * meldet drei richtige Regeln als tot.
 */
const familien = [...markup.matchAll(/`(data-[a-z-]+-)\$\{/g)].map((m) => m[1]);
const gedeckt = (name) =>
  imMarkup.has(name) || familien.some((prefix) => name.startsWith(prefix));

const blind = [...imCss].filter((name) => !gedeckt(name)).sort();

if (blind.length > 0) {
  console.error('check-data-hooks: diese Regeln greifen ins Leere\n');
  for (const name of blind) console.error(`  - [${name}] steht im Stylesheet, aber nichts setzt es`);
  console.error(
    '\nEin Vertipper auf einer der beiden Seiten ist gueltiges CSS und gueltiges',
  );
  console.error('JSX -- die Regel greift nur nie, und im Bild fehlt nur eine Farbe.');
  process.exit(1);
}

console.log(`check-data-hooks: ${imCss.size} Merkmale im Stylesheet, alle werden gesetzt`);
