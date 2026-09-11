/**
 * SOTE — folgt jede Akzentfarbe dem gewählten Akzent?
 *
 * ## Der Anlass
 *
 * Gemeldet mit Bild: „Wo kommt diese komische Farbe im Hintergrund her? Die
 * kann ich nirgends sehen und konfigurieren." Auf einer orangen Instanz war der
 * Grund der gewählten Knöpfe blassgrün.
 *
 * Die Ursache: `--accent-quiet` und `--accent-text` standen im Stylesheet als
 * feste Stufen der EINGEBAUTEN Rampe. Wer den Akzent wählt, setzt `--accent`,
 * `--accent-line` und `--accent-base` — die beiden anderen blieben grün. Eine
 * Farbe also, die es in keiner Einstellung gibt und die trotzdem auf dem
 * Bildschirm steht.
 *
 * Das ist keine Eigenheit dieser zwei Namen, sondern eine KLASSE: jedes Token,
 * das aus der Rampe gefüllt wird und nicht von `theme.ts` überschrieben wird,
 * hat denselben Fehler. Beim nächsten Akzent-Token wäre er wieder da.
 *
 * ## Was hier geprüft wird
 *
 * Die beiden Listen werden GEKREUZT statt beide geschrieben (ADR-0131s Satz:
 * „two lists agreeing with each other is not a check"):
 *
 * - aus `styles.css`: welche `--accent*`-Tokens an der Wurzel aus der festen
 *   Rampe (`--accent-100` … `--accent-900`) gefüllt werden,
 * - aus `theme.ts`: welche Tokens eine gewählte Farbe tatsächlich schreibt.
 *
 * Jedes Token der ersten Liste muss in der zweiten stehen. Sonst ist es eine
 * Farbe, die die Einstellung nicht erreicht.
 *
 * ## Warum die Vorgabe trotzdem aus der Rampe kommen darf
 *
 * Sie MUSS es sogar: eine Instanz, die keinen Akzent gewählt hat, braucht
 * einen. Der Fehler ist nicht die Vorgabe, sondern eine Vorgabe, die niemand
 * ändern kann.
 */

import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('../packages/web/src/styles.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const theme = readFileSync(
  new URL('../packages/core/src/look/theme.ts', import.meta.url),
  'utf8',
);

/**
 * Die Tokens, die aus der festen Rampe gefüllt werden.
 *
 * Die Rampe selbst (`--accent-100: #d3ebe5`) steht mit einem HEXWERT da und
 * fällt damit nicht in diese Suche — gesucht sind nur die Namen, die sich auf
 * eine Stufe BEZIEHEN.
 */
const ausDerRampe = new Set();
for (const m of css.matchAll(/(--accent[a-z-]*)\s*:\s*var\((--accent-\d00)\)/g)) {
  ausDerRampe.add(m[1]);
}

/**
 * Was eine gewählte Farbe schreibt.
 *
 * Nur die LINKE Seite einer Zuweisung. Der erste Wurf zählte jedes Vorkommen —
 * und `properties['--base-accent-quiet'] = properties['--accent-quiet']` nennt
 * den Namen zweimal, einmal als Ziel und einmal als Quelle. Der Wächter hielt
 * `--accent-quiet` darum auch dann für geschrieben, als ich seine Zuweisung
 * zum Ausprobieren entfernt hatte — er meldete nichts, wo der gemeldete Fehler
 * stand.
 *
 * Gefunden, weil ich ihn an genau diesem Fehler ausprobiert habe, statt ihm
 * sein grünes Ergebnis zu glauben. Ein Wächter, den man nicht scheitern
 * gesehen hat, ist eine Behauptung.
 */
const geschrieben = new Set();
for (const m of theme.matchAll(/properties\['(--[a-z-]+)'\]\s*=/g)) {
  geschrieben.add(m[1]);
}

const fehlend = [...ausDerRampe].filter((name) => !geschrieben.has(name)).sort();

if (fehlend.length > 0) {
  console.error('check-accent-follows: diese Farben folgen dem Akzent nicht\n');
  for (const name of fehlend) {
    console.error(`  - ${name} wird aus der eingebauten Rampe gefuellt,`);
    console.error('    aber eine gewaehlte Akzentfarbe schreibt es nicht um.');
  }
  console.error(
    '\nEine Instanz mit eigenem Akzent bekommt dort die Vorgabefarbe --- also',
  );
  console.error(
    'eine Farbe, die in keiner Einstellung vorkommt und die niemand findet.',
  );
  console.error(
    'Entweder in theme.ts ableiten (siehe --accent-quiet) oder das Token',
  );
  console.error('woanders herholen.');
  process.exit(1);
}

console.log(
  `check-accent-follows: ${ausDerRampe.size} Akzent-Token, alle folgen der Wahl`,
);
