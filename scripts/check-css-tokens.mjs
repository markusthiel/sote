/**
 * SOTE — jedes `var(--x)` muss es auch geben.
 *
 * GEFUNDEN beim Bau der Namensauswahl: ich hatte `--accent-soft` und
 * `--text-default` benutzt. Beide gibt es nicht — ich hatte sie mir nach dem
 * Muster der anderen ausgedacht.
 *
 * Eine CSS-Regel mit einem unbekannten Token tut EINFACH NICHTS. Kein Fehler,
 * keine Meldung im Browser, keine im Übersetzer: die Zeile steht da, sieht
 * richtig aus und wirkt nicht. Beim Hintergrund merkt man es im Bild; bei
 * einer Textfarbe erbt das Element die des Elternteils und sieht damit oft
 * fast richtig aus — das ist die Sorte, die bleibt.
 *
 * Darum dieser Wächter. Er liest, welche Tokens das Stylesheet ERKLÄRT
 * (`--name: wert`), und welche es BENUTZT (`var(--name)`), und meldet die
 * Differenz.
 *
 * Tokens, die aus JavaScript gesetzt werden, stehen in `VON_AUSSEN`: sie
 * gehören dorthin, weil ihr Wert je Zeile ein anderer ist (die eigene Farbe
 * einer Aufgabe). Wer einen hinzufügt, muss ihn hier nennen — und genau das
 * ist die Absicht: eine Ausnahme, die man aufschreiben muss, ist eine, über
 * die jemand nachgedacht hat.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * OHNE Kommentare gelesen.
 *
 * In den Erklaerungen stehen SONEs Namen als Zitat (`var(--sone-text)`), und
 * die gibt es hier zu Recht nicht: sie sagen, woher eine Regel kommt. Ein
 * Waechter, der Zitate fuer Code haelt, zwingt dazu, die Herkunft nicht mehr
 * aufzuschreiben -- und das waere ein schlechter Tausch.
 */
const css = readFileSync(join(wurzel, 'packages/web/src/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Aus der Oberflaeche gesetzt, nicht im Stylesheet erklaert. */
const VON_AUSSEN = new Set(['--eigen']);

const erklaert = new Set(VON_AUSSEN);
/*
 * Jede Erklaerung, egal wo sie steht.
 *
 * Mein erster Versuch verlangte ein `;` oder `{` davor -- und uebersah damit
 * jede erste Zeile eines Blocks mit Kommentar davor. Er meldete 21 Tokens, die
 * es sehr wohl gibt. Ein Waechter, der falschen Alarm schlaegt, wird
 * abgeschaltet, und dann faengt er auch den echten Fall nicht mehr.
 *
 * `var(--x)` hat nie einen Doppelpunkt dahinter, also genuegt der.
 */
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) erklaert.add(m[1]);

const fehlend = new Map();
/*
 * Nur `var(--x)` OHNE Rueckfall.
 *
 * `var(--board-column, 280px)` ist kein Versehen, sondern die Bauform fuer
 * einen Wert, der von aussen kommen KANN: fehlt er, greift die Zahl dahinter.
 * Ein Waechter, der die auch meldet, wuerde verlangen, dass man jede
 * Einstellung zusaetzlich im Stylesheet erklaert -- und damit genau die
 * Doppelung erzwingen, gegen die die anderen Waechter da sind.
 *
 * Ohne Rueckfall gibt es dagegen nichts, was einspringt: die Regel faellt
 * ersatzlos aus.
 */
for (const m of css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) {
  if (erklaert.has(m[1])) continue;
  const zeile = css.slice(0, m.index).split('\n').length;
  if (!fehlend.has(m[1])) fehlend.set(m[1], zeile);
}

if (fehlend.size > 0) {
  console.error('check-css-tokens: benutzt, aber nirgends erklaert:\n');
  for (const [name, zeile] of fehlend) console.error(`  - ${name} (Zeile ${zeile})`);
  console.error(
    '\nEine Regel mit einem unbekannten Token tut NICHTS -- kein Fehler, keine\n' +
      'Meldung, nur eine Wirkung, die ausbleibt. Wird der Wert aus JavaScript\n' +
      'gesetzt, gehoert er in VON_AUSSEN in diesem Skript.',
  );
  process.exit(1);
}

console.log(`check-css-tokens: ${erklaert.size} Tokens erklaert, alle benutzten vorhanden`);
