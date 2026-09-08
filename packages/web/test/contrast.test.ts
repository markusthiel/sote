/**
 * SOTE — Kontrast, gerechnet.
 *
 * SONEs ADR-0135 schließt eine Regel, die ADR-0023 aufgeschrieben und nie
 * gehalten hat: *„Contrast. Computed, not believed, and kept as a test."* In
 * SOTE stand sie nicht einmal auf dem Papier — meine Umkehrtöne und die
 * Palette sind von Hand gewählt und nie gemessen worden.
 *
 * Was die Tests, die ich hatte, prüften: dass beide Themen dieselben
 * Tokennamen tragen. Das ist SONEs Satz aus ADR-0131: **zwei Listen, die
 * einander bestätigen, sind keine Prüfung.**
 *
 * Dieser Test liest die Werte **aus dem Stylesheet** und rechnet. Er kann
 * darum nicht dadurch grün bleiben, dass jemand einen Wert ändert und den Test
 * mitändert.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AA, contrastRatio } from '@sote/core';

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'),
  'utf8',
);

/**
 * Löst einen Tokennamen im Themenblock auf.
 *
 * Nur `var(--x)`-Ketten und Hex-Werte, kein `color-mix` — die Töne, die hier
 * geprüft werden, sind alle direkt geschrieben. Was `color-mix` benutzt (die
 * Akzentfläche), braucht die Auflösung eines Browsers und ist unten benannt
 * statt stillschweigend übersprungen.
 */
function resolve(name: string, scheme: 'light' | 'dark'): string {
  const block =
    scheme === 'light'
      ? CSS.slice(CSS.indexOf(':root[data-theme="light"]'), CSS.indexOf(':root[data-theme="dark"]'))
      : CSS.slice(CSS.indexOf(':root[data-theme="dark"]'));
  const root = CSS.slice(0, CSS.indexOf(':root[data-theme="light"]'));

  const look = (where: string, key: string): string | null => {
    const m = new RegExp(`--${key}:\\s*([^;]+);`).exec(where);
    return m === null ? null : m[1]!.trim();
  };

  let value = look(block, name) ?? look(root, name);
  for (let i = 0; value !== null && i < 8; i += 1) {
    const m = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (m === null) break;
    value = look(block, m[1]!) ?? look(root, m[1]!);
  }
  assert.ok(value !== null && value.startsWith('#'), `--${name} (${scheme}) löst nicht auf: ${value}`);
  return value;
}

/** Jede Paarung, die auf einer umgekehrten Fläche wirklich vorkommt. */
const ON_INVERSE: readonly [string, string, number][] = [
  ['inverse-ink', 'inverse-bg', AA.text],
  ['inverse-muted', 'inverse-bg', AA.text],
  // Die blasseste Stufe trägt Beschriftungen wie „PROJEKTE" und Zahlen — kein
  // Fließtext, aber lesbar sein muss sie. AA nimmt dafür 3:1.
  ['inverse-faint', 'inverse-bg', AA.nonText],
  ['inverse-ink', 'inverse-hover', AA.text],
  ['inverse-muted', 'inverse-hover', AA.text],
  // Der Rand ist eine Begrenzung und kein Text.
  ['inverse-line', 'inverse-bg', 1.2],
];

for (const scheme of ['light', 'dark'] as const) {
  test(`umgekehrte Flächen sind lesbar — ${scheme}`, () => {
    for (const [ink, ground, min] of ON_INVERSE) {
      const ratio = contrastRatio(resolve(ink, scheme), resolve(ground, scheme));
      assert.ok(
        ratio >= min,
        `--${ink} auf --${ground} (${scheme}): ${ratio.toFixed(2)}:1, gebraucht ${min}:1`,
      );
    }
  });

  test(`die Palette ist auf beiden Gründen lesbar — ${scheme}`, () => {
    // Palettenfarben tragen Zeichen und Punkte, keinen Fließtext — also 3:1
    // (AA für Nichttext). Geprüft gegen BEIDE Flächen, auf denen sie
    // vorkommen: die Seite und die vertiefte.
    for (const name of ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']) {
      for (const ground of ['page', 'sunken']) {
        const ratio = contrastRatio(
          resolve(`palette-${name}-${scheme}`, scheme),
          resolve(ground, scheme),
        );
        assert.ok(
          ratio >= AA.nonText,
          `${name} auf --${ground} (${scheme}): ${ratio.toFixed(2)}:1, gebraucht ${AA.nonText}:1`,
        );
      }
    }
  });
}

test('was hier NICHT gerechnet wird, steht als Lücke da', () => {
  /*
   * Die Akzentfläche mischt mit `color-mix(in srgb, …)`, und ihr Grund ist eine
   * gewählte Farbe — also ein Raum und kein Wert. Das richtig zu prüfen heißt,
   * den Würfel abzugehen, wie SONEs ADR-0135 es tut; das ist eigene Arbeit und
   * nicht diese.
   *
   * Der Test hält nur fest, dass es zwei Ableitungen gibt und `--accent-on`
   * nicht geraten wird — damit die Lücke benannt bleibt, statt als Erledigtes
   * durchzugehen.
   */
  assert.match(CSS, /--accent-on:/, 'es gibt eine Farbe für Text auf dem Akzent');
  assert.match(CSS, /color-mix\(in srgb/, 'die Akzentfläche mischt');
});
