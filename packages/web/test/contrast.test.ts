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

import { AA, contrastRatio, mixSrgb, toHex } from '@sote/core';

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'),
  'utf8',
);

/**
 * Löst einen Tokennamen im Themenblock auf — inklusive `color-mix`.
 *
 * `color-mix(in srgb, …)` ist **linear in sRGB**, auf genau den Hex-Ziffern,
 * ohne Linearisierung; die Leuchtdichte ist es nicht. Deshalb ist das Mischen
 * `mixSrgb` und nicht Teil der Kontrastrechnung (SONEs ADR-0135). Genau so
 * löst ein Browser es auf, und nur so kann dieser Test etwas über das
 * behaupten, was jemand sieht.
 *
 * `tint` ist absichtlich **nicht** gesetzt: der ungetönte Fall ist der, der
 * für jede Instanz ohne eigene Farbe gilt, und der Test unten prüft
 * ausdrücklich, dass er exakt der Grundton ist.
 */
function resolve(name: string, scheme: 'light' | 'dark', tint?: string): string {
  const block =
    scheme === 'light'
      ? CSS.slice(CSS.indexOf(':root[data-theme="light"]'), CSS.indexOf(':root[data-theme="dark"]'))
      : CSS.slice(CSS.indexOf(':root[data-theme="dark"]'));
  const root = CSS.slice(0, CSS.indexOf(':root[data-theme="light"]'));

  const look = (where: string, key: string): string | null => {
    const m = new RegExp(`--${key}:\\s*([^;]+);`).exec(where);
    return m === null ? null : m[1]!.trim();
  };

  const step = (value: string): string => {
    const plain = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (plain !== null) {
      const next = look(block, plain[1]!) ?? look(root, plain[1]!);
      assert.ok(next !== null, `--${plain[1]} (${scheme}) gibt es nicht`);
      return step(next);
    }

    // var(--tint, RÜCKFALL) — ohne Tönung gilt der Rückfall.
    const withFallback = /^var\(--tint,\s*(.+)\)$/.exec(value);
    if (withFallback !== null) return step(tint ?? withFallback[1]!.trim());

    const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(value);
    if (mix !== null) {
      const top = step(mix[1]!);
      const bottom = step(mix[3]!);
      return toHex(mixSrgb(top, Number(mix[2]), bottom));
    }
    return value;
  };

  let value = look(block, name) ?? look(root, name);
  assert.ok(value !== null, `--${name} (${scheme}) gibt es nicht`);
  value = step(value);
  assert.ok(value.startsWith('#'), `--${name} (${scheme}) löst nicht auf: ${value}`);
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

test('ohne Tönung ist jede Fläche exakt ihr Grundton', () => {
  /*
   * Die Korrektur aus dem Status von SONEs ADR-0028, hier als Rechnung.
   *
   * Der Rückfall jeder Mischung war dort `transparent`, und `transparent` ist
   * `rgb(0 0 0 / 0)` — eine Instanz ohne Tönung mischte also nicht *nichts*
   * bei, sondern vierzehn Prozent von *gar nichts*, und jede Fläche kam leicht
   * durchsichtig heraus. Unsichtbar auf einer Spalte, unübersehbar auf der
   * Schublade eines Telefons.
   *
   * Eine Farbe mit sich selbst gemischt ist sie selbst. Das prüft dieser Test,
   * und er prüft es an den Werten und nicht an der Absicht.
   */
  const grounds: readonly [string, 'light' | 'dark', string][] = [
    ['page', 'light', '#faf8f4'],
    ['surface', 'light', '#f7f5f0'],
    ['sunken', 'light', '#f0ede5'],
    ['page', 'dark', '#161615'],
    ['surface', 'dark', '#1e1d1b'],
    ['sunken', 'dark', '#121211'],
  ];
  for (const [name, scheme, base] of grounds) {
    assert.equal(
      resolve(name, scheme).toLowerCase(),
      base,
      `--${name} (${scheme}) ist ungetönt nicht sein Grundton`,
    );
  }
});

test('auch mit einer kräftigen Tönung bleibt leiser Text lesbar', () => {
  // Eine Tönung ist ein RAUM und kein Wert (ADR-0135). Geprüft wird darum
  // nicht „eine schöne Farbe", sondern die Ecken: volles Rot, volles Blau,
  // Schwarz und Weiß, in beiden Themen und auf der Fläche, die am meisten
  // Farbton nimmt.
  for (const scheme of ['light', 'dark'] as const) {
    for (const tint of ['#ff0000', '#0000ff', '#000000', '#ffffff']) {
      const ground = resolve('sunken', scheme, tint);
      for (const ink of ['text', 'text-muted']) {
        const ratio = contrastRatio(resolve(ink, scheme), ground);
        assert.ok(
          ratio >= AA.text,
          `--${ink} auf getönter Fläche ${tint} (${scheme}): ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
});

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
