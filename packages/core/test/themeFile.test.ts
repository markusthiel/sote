/**
 * SOTE — ein Thema als Datei.
 *
 * Die zwei Regeln, die hier auf dem Spiel stehen, sind SONEs (ADR-0125):
 *
 * 1. **Eine Datei kann nichts, was das Formular nicht kann.** Dieselbe Prüfung,
 *    also kein zweiter Weg in ein Thema — und damit unbedenklich, eine von
 *    einem Fremden anzunehmen.
 * 2. **Was keine Marke trägt, wird ganz abgelehnt.** Überall sonst gilt „Feld
 *    weglassen, Rest behalten"; hier nicht, weil die falsche Datei
 *    auszuwählen der gewöhnliche Fehler ist und ein stilles `{}` das Aussehen
 *    eines Arbeitsbereichs leeren würde.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { readThemeFile, themeFile } from '../src/look/themeFile.js';

test('was hinausgeht, kommt wieder herein', () => {
  const datei = themeFile({
    scheme: 'dark',
    look: { surfaces: { rail: 'inverted' }, corners: 'round', accent: 'blue', tint: '#3355cc', fonts: 'reading' },
  });
  assert.equal(datei.sote, 'theme');
  assert.equal(datei.version, 1);

  const zurueck = readThemeFile(JSON.stringify(datei));
  assert.equal(zurueck.ok, true);
  assert.ok(zurueck.ok);
  assert.deepEqual(zurueck.theme, {
    scheme: 'dark',
    look: {
      surfaces: { rail: 'inverted' },
      corners: 'round',
      accent: 'blue',
      tint: '#3355cc',
      fonts: 'reading',
    },
  });
});

test('ohne Marke wird ganz abgelehnt, nicht halb genommen', () => {
  /*
   * Der Fall, den ADR-0125 nennt: die Angaben eines Urlaubsfotos. `readLook`
   * würde daraus ein `{}` machen, und das zu laden würde das Aussehen still
   * leeren — mit einer Oberfläche, die zurückgesetzt aussieht, ohne Grund.
   */
  const foto = JSON.stringify({ Make: 'Canon', Model: 'R6', ISO: 400 });
  assert.deepEqual(readThemeFile(foto), { ok: false, why: 'keine_marke' });
  // Auch ein Thema-artiges Objekt ohne Marke: „sieht aus wie ein Thema" passt
  // auf beinahe jedes Objekt, weil fast alle Felder wahlfrei sind.
  assert.deepEqual(readThemeFile('{"look":{"corners":"round"}}'), {
    ok: false,
    why: 'keine_marke',
  });
  assert.deepEqual(readThemeFile('{}'), { ok: false, why: 'keine_marke' });
});

test('zwei Gründe, zwei Sätze', () => {
  // „Das ist keine Datei dieser Art" gegen „das ist eine Datei, aber kein
  // Thema". Ein gemeinsamer Satz ließe jemanden nach einem Tippfehler suchen,
  // wo er die falsche Datei erwischt hat.
  assert.deepEqual(readThemeFile('nicht mal json'), { ok: false, why: 'kein_json' });
  assert.deepEqual(readThemeFile('[1,2,3]'), { ok: false, why: 'keine_marke' });
});

test('innerhalb einer Themendatei gilt die gewöhnliche Regel wieder', () => {
  // Ein Feld aus einer neueren Fassung soll eine ältere nicht daran hindern,
  // den Rest zu nehmen. Die Fassungsnummer wird darum geschrieben und nicht
  // gelesen — auf eine Zahl zu verweigern machte eine verträgliche Datei ohne
  // Gewinn zu einer Fehlermeldung.
  const out = readThemeFile(
    JSON.stringify({
      sote: 'theme',
      version: 99,
      scheme: 'mondlicht',
      look: { corners: 'round', surfaces: { rail: 'neon', sidebar: 'sunken' }, glitzer: true },
    }),
  );
  assert.ok(out.ok);
  assert.deepEqual(out.theme, {
    look: { corners: 'round', surfaces: { sidebar: 'sunken' } },
  });
});

test('eine Datei kann nichts, was das Formular nicht kann', () => {
  /*
   * Der Satz, der den ganzen Weg unbedenklich macht. Geprüft an dem, was
   * jemand sich ausdenken würde, um mehr hineinzuschreiben: eine rohe Farbe an
   * einer Fläche (dort sind nur Beziehungen erlaubt), eine Länge bei den Ecken
   * (dort sind nur Stufen erlaubt), eine Schrift als Familienname.
   */
  const out = readThemeFile(
    JSON.stringify({
      sote: 'theme',
      version: 1,
      look: {
        surfaces: { rail: '#101010' },
        corners: '999px',
        fonts: 'Comic Sans MS',
        accent: 'javascript:alert(1)',
        tint: 'url(http://x/y)',
      },
    }),
  );
  assert.ok(out.ok);
  assert.deepEqual(out.theme, {}, 'nichts davon ist ausdrückbar');
});

test('eine Ausgabe sagt, was hier gesetzt ist — nicht, was hier zu sehen ist', () => {
  // Wer das Aufgelöste ausgäbe, schriebe die Werte der Instanz in die Datei,
  // als wären sie die des Arbeitsbereichs — und auf einem anderen Server
  // würden sie zu seinen eigenen.
  assert.deepEqual(themeFile({}), { sote: 'theme', version: 1 });
});
