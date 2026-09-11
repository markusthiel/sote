/**
 * SOTE — die Bilder, die eine Anwendung mitbringen muss.
 *
 * GEMELDET: „Ich habe sie gerade als App auf den Desktop gelegt. Da steht
 * jetzt nur ein S anstatt des Favicons. Prüfe mal bitte, ob wir alle Grafiken
 * eingebaut haben wie bei SONE."
 *
 * Wir hatten EINE von sieben. Das fällt nicht auf, weil im Browser das SVG
 * genügt — erst wer die Seite als Anwendung ablegt, sieht die Lücke, und das
 * tut man einmal im Jahr.
 *
 * Also ein Wächter: jede Datei, auf die `index.html` oder das Manifest zeigen,
 * muss auch daliegen. Das ist die Prüfung, die den gemeldeten Fall gefunden
 * hätte — ein Verweis auf eine Datei, die es nicht gibt, ist die eine Sorte
 * Fehler, die man vom Schreibtisch aus sehen kann.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const oeffentlich = join(wurzel, 'packages/web/public');

const html = readFileSync(join(wurzel, 'packages/web/index.html'), 'utf8');
const manifestPfad = join(oeffentlich, 'manifest.webmanifest');

const fehlend = [];
const gefunden = new Set();

/** Jeder Verweis auf eine eigene Datei — `/etwas.png`, nicht `https://…`. */
for (const m of html.matchAll(/(?:href|content)="(\/[^"]+\.(?:png|svg|ico|webmanifest))"/g)) {
  const datei = join(oeffentlich, m[1]);
  gefunden.add(m[1]);
  if (!existsSync(datei)) fehlend.push(`${m[1]} (aus index.html)`);
}

if (!existsSync(manifestPfad)) {
  fehlend.push('manifest.webmanifest');
} else {
  const manifest = JSON.parse(readFileSync(manifestPfad, 'utf8'));
  for (const icon of manifest.icons ?? []) {
    gefunden.add(icon.src);
    if (!existsSync(join(oeffentlich, icon.src))) {
      fehlend.push(`${icon.src} (aus dem Manifest)`);
    }
  }
  /*
   * Und die beiden Zwecke: ein Manifest ohne `maskable` bekommt auf Android
   * einen weissen Kreis um ein Bild, das schon einen Grund hat.
   */
  const zwecke = new Set((manifest.icons ?? []).map((i) => i.purpose));
  for (const z of ['any', 'maskable']) {
    if (!zwecke.has(z)) fehlend.push(`kein Symbol mit purpose="${z}" im Manifest`);
  }
}

if (fehlend.length > 0) {
  console.error('check-assets: verwiesen, aber nicht vorhanden:\n');
  for (const f of fehlend) console.error(`  - ${f}`);
  console.error(
    '\nEin Verweis auf eine Datei, die es nicht gibt, faellt erst auf, wenn\n' +
      'jemand die Seite als Anwendung ablegt -- und dann steht dort ein Buchstabe.',
  );
  process.exit(1);
}

console.log(`check-assets: ${gefunden.size} Verweise, alle vorhanden`);
