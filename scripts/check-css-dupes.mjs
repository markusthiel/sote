/**
 * SOTE — dieselbe Regel zweimal.
 *
 * ## Der Anlass: dreimal derselbe Mechanismus an einem Tag
 *
 * - `.menu` steht dreimal im Stylesheet. Die letzte gewinnt, es sieht richtig
 *   aus — und wer die erste ändert, ändert nichts und sucht den Grund im
 *   Bauteil.
 * - `.head-toggle[aria-pressed]` stand dreimal. Jeder meiner drei Durchgänge
 *   an diesen Knöpfen hat eine Regel HINZUGEFÜGT statt die vorhandene zu
 *   ändern; die letzte setzte einen Rahmen, den ich gerade abgeschafft hatte,
 *   und eine Farbe, die nicht dem Akzent folgte. Gemeldet als „die komische
 *   Farbe im Hintergrund".
 * - `.grip` hatte nach einer Änderung ZWEIMAL `align-items` im selben Block,
 *   erst `flex-start`, dann das alte `center`. Gemeldet als „nicht auf
 *   gleicher Höhe".
 *
 * Dreimal derselbe Fehler, dreimal von Markus gefunden statt von einem Test.
 * Genau dafür gibt es in diesem Projekt Wächter.
 *
 * ## Was hier geprüft wird
 *
 * 1. **Ein Selektor zweimal im selben Zusammenhang.** „Zusammenhang" heißt:
 *    dieselbe Verschachtelung von `@media`/`@supports`. `.detail` in `:root`
 *    und `.detail` in einem `@media` sind zwei verschiedene Aussagen — das ist
 *    der normale Weg, eine Regel für schmale Fenster zu ändern, und kein
 *    Fehler.
 * 2. **Dieselbe Eigenschaft zweimal in einem Block.** Das ist NIE Absicht: wer
 *    zwei Werte schreibt, meint einen, und der andere ist ein Rest.
 *
 * ## Warum das kein Formatierer erledigt
 *
 * Ein Formatierer ordnet, was dasteht. Er sagt nicht, dass zwei Regeln
 * dasselbe Element meinen — dafür müsste er wissen, dass sie zusammengehören.
 * Die Frage ist nicht „ist es hübsch", sondern „gibt es zwei Orte, an denen man
 * die falsche ändert".
 */

import { readFileSync } from 'node:fs';

const FILE = 'packages/web/src/styles.css';
const raw = readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8');

/*
 * Kommentare weg — aber die Zeilenumbrüche behalten.
 *
 * Sonst stimmen alle Zeilennummern im Bericht nicht, und ein Bericht, der auf
 * die falsche Zeile zeigt, kostet mehr Zeit als er spart.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Wo ein Block anfängt: Selektor, Zeile, und in welchen @-Regeln er liegt. */
const blocks = [];
/** Der Stapel der offenen @-Regeln, z. B. ['@media (min-width: 800px)']. */
const context = [];

let at = 0;
let line = 1;
let buffer = '';

while (at < css.length) {
  const ch = css[at];

  if (ch === '\n') line += 1;

  if (ch === '{') {
    const head = buffer.trim().replace(/\s+/g, ' ');
    buffer = '';
    if (head.startsWith('@')) {
      // Eine @-Regel mit Block: sie ändert den Zusammenhang.
      context.push(head);
      at += 1;
      continue;
    }
    // Ein gewöhnlicher Block: bis zur schließenden Klammer einsammeln.
    let depth = 1;
    let body = '';
    let cursor = at + 1;
    const startLine = line;
    while (cursor < css.length && depth > 0) {
      const c = css[cursor];
      if (c === '{') depth += 1;
      if (c === '}') depth -= 1;
      if (depth > 0) body += c;
      if (c === '\n') line += 1;
      cursor += 1;
    }
    blocks.push({ selector: head, line: startLine, context: context.join(' > '), body });
    at = cursor;
    continue;
  }

  if (ch === '}') {
    context.pop();
    buffer = '';
    at += 1;
    continue;
  }

  buffer += ch;
  at += 1;
}

const problems = [];

/* ── 1. Derselbe Selektor zweimal im selben Zusammenhang ────────────────── */

const seen = new Map();
for (const block of blocks) {
  if (block.selector === '') continue;
  const key = `${block.context}||${block.selector}`;
  const before = seen.get(key);
  if (before === undefined) {
    seen.set(key, block.line);
    continue;
  }
  problems.push(
    `${block.selector} — Zeile ${block.line}, schon in Zeile ${before}` +
      (block.context === '' ? '' : ` (in ${block.context})`),
  );
}

/* ── 2. Dieselbe Eigenschaft zweimal in einem Block ─────────────────────── */

for (const block of blocks) {
  const props = new Map();
  for (const line_ of block.body.split(';')) {
    const m = /^\s*([a-z-]+)\s*:/.exec(line_);
    if (m === null) continue;
    const name = m[1];
    // Eigenschaften mit `--` sind Tokens; auch dort ist die Wiederholung ein
    // Rest, aber sie stehen in den Themenblöcken absichtlich nebeneinander —
    // dort gilt derselbe Name je Block trotzdem nur einmal.
    const count = (props.get(name) ?? 0) + 1;
    props.set(name, count);
  }
  for (const [name, count] of props) {
    if (count > 1) {
      problems.push(
        `${block.selector} (Zeile ${block.line}): \`${name}\` steht ${count}× im selben Block`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('check-css-dupes: dieselbe Regel mehrfach\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nZwei Regeln fuer dasselbe sind zwei Orte, an denen man die falsche',
  );
  console.error(
    'aendert -- die spaetere gewinnt still, und im Bild sieht man den Grund nicht.',
  );
  process.exit(1);
}

console.log(
  `check-css-dupes: ${blocks.length} Bloecke, keine Dubletten`,
);
