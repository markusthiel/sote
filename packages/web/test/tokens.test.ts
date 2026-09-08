/**
 * SOTE — die Tokens als Test.
 *
 * Drei Prüfungen, und jede hält einen Fehler fest, der in SONE live war:
 *
 * 1. **Parität.** Hell und Dunkel sind zwei gleichrangige, vollständige Listen.
 *    Ein Token, das nur in einer steht, ist in der anderen `unset`.
 * 2. **Die color-mix-Falle** (SONE, PR #2). `transparent` ist `rgb(0 0 0 / 0)`
 *    und nicht „nichts": als Fallback eines Tint-Mixes macht es die Fläche
 *    durchsichtig. Vierzehn Flächen waren so gebaut, und als Spalte fiel es
 *    niemandem auf.
 * 3. **Kein Fetch nach außen.** Schriften werden selbst ausgeliefert.
 *
 * Und die Lehre aus ADR-0135 gleich mit: dieser Test vergleicht **Namen**, nicht
 * Werte. Er kann nicht sehen, ob eine Farbe lesbar ist — dafür wäre eine
 * Kontrastrechnung nötig, und die ist noch nicht gebaut. Der Test sagt das
 * selbst, damit niemand mehr aus ihm herausliest, als er prüft.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAW = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'),
  'utf8',
);

/**
 * Ohne Kommentare geprüft — und das ist keine Bequemlichkeit.
 *
 * Die erste Fassung dieses Tests las die Datei roh und schlug an genau der
 * Stelle an, an der die color-mix-Falle **erklärt** wird: das Gegenbeispiel
 * steht im Stylesheet als Kommentar. Ein Wächter, der Text liest, macht damit
 * das Aufschreiben einer Regel zum Verstoß gegen sie — und die naheliegende
 * Behebung wäre, die Erklärung zu löschen. Also werden Kommentare abgezogen,
 * bevor gesucht wird.
 */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/** Der Inhalt eines Blocks, dessen Selektor `selector` enthält. */
function block(selector: string): string {
  const at = CSS.indexOf(selector);
  assert.notEqual(at, -1, `Selektor fehlt: ${selector}`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('\n}', open);
  return CSS.slice(open + 1, close);
}

const declared = (body: string) =>
  new Set([...body.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]!));

const ROOT = declared(block(':root {'));
const DARK = declared(block(':root[data-theme="dark"]'));

/**
 * Was pro Schema unterschiedlich sein muss.
 *
 * Primitive (`--ink-*`, `--accent-500`, …) sind Farbwerte und gelten in beiden
 * Schemata; semantische Namen zeigen auf verschiedene Primitive. Nur die
 * semantischen brauchen also einen zweiten Eintrag — und die Liste steht hier,
 * damit ein neues semantisches Token auffällt, wenn es im Dunkeln fehlt.
 */
const SEMANTIC = [
  '--page',
  '--surface',
  '--raised',
  '--sunken',
  '--line',
  '--line-strong',
  '--text',
  '--text-muted',
  '--text-faint',
  '--accent',
  '--accent-line',
  '--accent-on',
  '--danger',
  '--warning',
  '--sote-shadow-sm',
  '--sote-shadow-md',
  '--sote-shadow-lg',
];

test('jedes semantische Token ist im Hellmodus deklariert', () => {
  for (const token of SEMANTIC) {
    assert.ok(ROOT.has(token), `${token} fehlt in :root`);
  }
});

test('jedes semantische Token ist im Dunkelmodus deklariert', () => {
  const missing = SEMANTIC.filter((t) => !DARK.has(t));
  assert.deepEqual(missing, [], `im Dunkeln nicht gesetzt: ${missing.join(', ')}`);
});

test('der Dunkelmodus deklariert kein Token, das es hell nicht gibt', () => {
  const extra = [...DARK].filter((t) => !ROOT.has(t) && t !== '--color-scheme');
  assert.deepEqual(extra, [], `nur im Dunkeln: ${extra.join(', ')}`);
});

test('beide Schemata nennen color-scheme, damit Scrollbalken und Popups mitgehen', () => {
  // `color-scheme: light dark` heißt „das System entscheidet" — eine dunkle
  // Oberfläche auf einem hellen Laptop bekam davon helle Scrollbalken und ein
  // helles Datumsfeld (SONE, ADR-0144).
  assert.match(block(':root[data-theme="light"]'), /color-scheme:\s*light/);
  assert.match(block(':root[data-theme="dark"]'), /color-scheme:\s*dark/);
});

test('kein color-mix mit transparent als Fallback', () => {
  // Der Fallback eines Tint-Mixes ist immer die eigene Basisfarbe der Fläche.
  // Eine Farbe mit sich selbst gemischt ist sie selbst.
  const bad = [...CSS.matchAll(/color-mix\([^)]*transparent[^)]*\)/g)].map((m) => m[0]);
  assert.deepEqual(bad, [], `transparent in einem Mix: ${bad.join(' | ')}`);
});

test('nichts wird von außen geholt', () => {
  const remote = [...CSS.matchAll(/url\(\s*['"]?(https?:)?\/\//g)].map((m) => m[0]);
  assert.deepEqual(remote, [], 'externe URL im Stylesheet');
  assert.equal(CSS.includes('@import'), false, '@import holt eine zweite Datei');
});

test('die Eckenstufen sind 2 / 2 / 4', () => {
  // Aus SONEs Markensystem übernommen und nicht nachjustiert: drei Stufen,
  // damit ein Radius eine Bedeutung hat und nicht eine Vorliebe ist.
  assert.match(CSS, /--sote-radius-sm:\s*2px/);
  assert.match(CSS, /--sote-radius-md:\s*2px/);
  assert.match(CSS, /--sote-radius-lg:\s*4px/);
});

test('Überschriften sind dünn', () => {
  assert.match(CSS, /--sote-heading-weight:\s*300/);
});

test('Eingabefelder sind mindestens 16 px, sonst zoomt iOS', () => {
  assert.match(CSS, /font-size:\s*max\(1rem,\s*16px\)/);
});

test('die Umschaltung auf Fußleiste geschieht im Stylesheet', () => {
  // Nicht per JS-Media-Query: sonst gibt es zwei Antworten auf „welche Breite
  // ist gerade", und sie widersprechen sich beim Drehen des Geräts.
  assert.match(CSS, /@media \(max-width: 799px\)/);
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 799px)'));
  assert.match(mobile, /\.rail\s*\{\s*display:\s*none/);
  assert.match(mobile, /\.footbar\s*\{[^}]*display:\s*grid/);
});

test('reduzierte Bewegung wird respektiert', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});

test('keine Rastervorlage schlägt die Schmal-Regel', () => {
  /*
   * Der Fehler, den es gab, und der Grund für einen Wächter.
   *
   * `.app { grid-template-columns: 1fr }` steht in der Schmal-Media-Query und
   * wurde von `.app[data-sidebar="false"]` geschlagen — nicht wegen der
   * Reihenfolge, sondern wegen der **Spezifität**: ein Attribut wiegt mehr als
   * eine Klasse, und dagegen hilft kein Verschieben.
   *
   * Im Bild: auf 390 px war der Inhalt 55 Pixel breit, „Heute" auf zwei
   * Buchstaben abgeschnitten. Der Fehler war bei `data-detail` sogar ÄLTER als
   * meine Seitenleisten-Umschaltung und niemandem aufgefallen, weil die
   * Detailspalte auf dem Telefon ohnehin über allem liegt.
   *
   * Geprüft wird darum: jede Vorlage mit mehr als einer Spalte steht in einer
   * `min-width`-Klammer. Das ist gröber als eine echte Kaskadenrechnung, aber
   * es fängt genau die Form, in der der Fehler zweimal entstanden ist.
   */
  const zeilen = CSS.split('\n');
  let klammer: number | null = null;
  let tiefe = 0;
  const verstoesse: string[] = [];

  for (const [i, zeile] of zeilen.entries()) {
    if (/@media[^{]*min-width:\s*800px/.test(zeile)) {
      klammer = tiefe;
    }
    // Grobe Klammerzählung: reicht, weil dieses Stylesheet je Zeile öffnet
    // oder schließt und nicht beides.
    tiefe += (zeile.match(/\{/g) ?? []).length;
    tiefe -= (zeile.match(/\}/g) ?? []).length;
    if (klammer !== null && tiefe <= klammer) klammer = null;

    if (!/grid-template-columns:/.test(zeile)) continue;
    // Eine Spalte ist immer erlaubt: sie IST die Schmal-Antwort.
    const spalten = zeile.split(':')[1]!.trim().replace(/;$/, '').split(/\s+/).length;
    if (spalten <= 1) continue;
    // Nur `.app`-Vorlagen sind gemeint; andere Raster (Wochentage, Farbfelder)
    // haben mit der Kaskade der Hülle nichts zu tun.
    const regel = zeilen.slice(Math.max(0, i - 12), i).join(' ');
    if (!/\.app\[/.test(regel)) continue;
    if (klammer === null) {
      verstoesse.push(`Zeile ${i + 1}: ${zeile.trim()}`);
    }
  }

  assert.deepEqual(
    verstoesse,
    [],
    `mehrspaltige .app-Vorlage ohne min-width-Klammer:\n${verstoesse.join('\n')}`,
  );
});
