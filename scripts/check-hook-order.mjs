/**
 * SOTE — ein Hook hinter einem `return`.
 *
 * ## Der Anlass: eine weiße Seite
 *
 * Gemeldet: „Wenn ich das Seitenmenü öffnen will, indem ich eine Aufgabe
 * anklicke, wird die ganze Seite weiß und alles ist weg."
 *
 * In `Detail.tsx` stand `useDetailTab(...)` HINTER `if (data === undefined)
 * return …`. Beim ersten Zeichnen (nichts geladen) lief er nicht, beim zweiten
 * (Daten da) schon: elf Hooks, dann zwölf. React bricht dann die ganze Wurzel
 * ab — nicht nur das Bauteil, die ganze Anwendung. Übrig bleibt eine leere
 * Seite, und der einzige Weg zurück ist ein Neuladen.
 *
 * Der Typecheck sieht es nicht. Die Tests sahen es nicht, weil sie die
 * Oberfläche nicht zeichnen. Und im Quelltext sieht es harmlos aus: eine
 * Zeile, die dort steht, wo man sie beim Schreiben gerade brauchte.
 *
 * ## Was hier geprüft wird
 *
 * In jeder `.tsx` unter `packages/web/src`: in einer Funktion, die ein Bauteil
 * ist (großer Anfangsbuchstabe), darf nach dem ersten `return` auf der obersten
 * Ebene kein Hook mehr aufgerufen werden.
 *
 * „Oberste Ebene" heißt: mit genau zwei Leerzeichen eingerückt. Das ist grob,
 * aber es passt zur Formatierung dieses Projekts — und die Alternative wäre,
 * TypeScript zu parsen, um eine Regel durchzusetzen, die in zwei Zeilen
 * beschreibbar ist.
 *
 * Hooks INNERHALB eines verschachtelten Bauteils (ein `function Foo()` weiter
 * unten in derselben Datei) fangen ihre eigene Zählung an. Darum beginnt die
 * Prüfung bei jeder Bauteil-Deklaration neu.
 *
 * ## Warum kein eslint-plugin-react-hooks
 *
 * Das wäre die gründlichere Antwort, und wenn dieses Projekt einen Linter
 * hätte, gehörte die Regel dorthin. Es hat keinen — und ein Wächter, der die
 * eine Regel prüft, die schon einmal eine weiße Seite erzeugt hat, ist besser
 * als ein Werkzeugkasten, den niemand einrichtet.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';

const WEB = new URL('../packages/web/src/', import.meta.url);

function dateien(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const pfad = new URL(name, dir);
    if (statSync(pfad).isDirectory()) out.push(...dateien(new URL(`${name}/`, dir)));
    else if (name.endsWith('.tsx')) out.push(pfad);
  }
  return out;
}

const problems = [];

for (const datei of dateien(WEB)) {
  const text = readFileSync(datei, 'utf8');
  const name = datei.pathname.split('/').slice(-2).join('/');
  const zeilen = text.split('\n');

  /** Ab welcher Zeile in diesem Bauteil schon etwas zurückgegeben wurde. */
  let returnBei = null;
  let bauteil = null;
  /*
   * Stehen wir in einer Schutzklausel — `  if (…) {` auf der obersten Ebene?
   *
   * Ohne diese Frage gibt es nur zwei schlechte Antworten: zählt man vier
   * Leerzeichen nie, übersieht man genau den Fall, für den es diesen Wächter
   * gibt (das `return` einer Schutzklausel ist eingerückt). Zählt man sie
   * immer, meldet man jedes `return` in einer beiläufigen Hilfsfunktion —
   * `const siblings = (id) => { … return […]; }` ist kein Verlassen des
   * Bauteils.
   */
  let schutz = false;

  zeilen.forEach((zeile, i) => {
    /*
     * Eine neue Funktion auf oberster Ebene: die Zählung fängt von vorn an.
     *
     * JEDE, nicht nur die mit großem Anfangsbuchstaben. Der erste Wurf zählte
     * nur Bauteile — und übersah damit, dass in derselben Datei hinter einem
     * Bauteil noch ein eigener Hook stehen kann (`useNotifications`). Dessen
     * Aufrufe wurden dem Bauteil darüber zugeschlagen und als Fehler gemeldet,
     * obwohl sie in ihrer eigenen Funktion ganz oben stehen.
     */
    const start = /^(?:export )?(?:async )?function ([A-Za-z][A-Za-z0-9]*)\s*\(/.exec(zeile);
    if (start !== null) {
      bauteil = start[1];
      returnBei = null;
      return;
    }
    if (bauteil === null) return;

    /*
     * Ein `return`, das das Bauteil verlässt — zwei ODER vier Leerzeichen.
     *
     * Vier, weil genau so eine Schutzklausel aussieht:
     *
     *     if (data === undefined) {
     *       return <aside … />;
     *     }
     *
     * Mein erster Wurf zählte nur zwei Leerzeichen und übersah damit genau den
     * Fall, für den es diesen Wächter gibt — er lief grün über den Fehler
     * hinweg, der die weiße Seite erzeugt hat. Aufgefallen nur, weil ich den
     * Fehler zum Ausprobieren wieder eingebaut habe.
     *
     * Ausgenommen bleibt `return () => …`: das ist die AUFRÄUM-Funktion eines
     * `useEffect` und kein Verlassen des Bauteils. Ohne diese Ausnahme waren es
     * elf Fehlalarme, und ein Wächter, der Richtiges meldet, wird abgeschaltet.
     */
    if (
      /^ {2}return\b/.test(zeile) ||
      (schutz && /^ {4}return\b/.test(zeile) && !/return \(?\)? ?=>/.test(zeile))
    ) {
      if (returnBei === null) returnBei = i + 1;
      return;
    }

    /* Eine Schutzklausel öffnet sich: `  if (…) {` auf der obersten Ebene. */
    if (/^ {2}if \(.*\{\s*$/.test(zeile)) {
      schutz = true;
      return;
    }
    if (/^ {2}\}/.test(zeile)) schutz = false;

    /*
     * Ein Hook-Aufruf auf der obersten Ebene. Zwei Schreibweisen: mit und ohne
     * Zuweisung. Kommentare und Zeichenketten fallen raus, weil die Zeile mit
     * genau zwei Leerzeichen und dann `const`/`use` anfangen muss.
     */
    const hook = /^ {2}(?:const .*=\s*)?(use[A-Z][A-Za-z0-9]*)\(/.exec(zeile);
    if (hook !== null && returnBei !== null) {
      problems.push(
        `${name}: ${bauteil} ruft ${hook[1]}() in Zeile ${i + 1} auf — ` +
          `nach einem return in Zeile ${returnBei}`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error('check-hook-order: ein Hook hinter einem return\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nHooks muessen in JEDEM Durchlauf in derselben Reihenfolge laufen. Laeuft',
  );
  console.error(
    'einer mal mit und mal nicht, bricht React die ganze WURZEL ab -- nicht nur',
  );
  console.error('das Bauteil. Uebrig bleibt eine weisse Seite.');
  process.exit(1);
}

console.log('check-hook-order: kein Hook hinter einem return');
