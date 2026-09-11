/**
 * SOTE — die kleine Fassung eines Bildes.
 *
 * GEMELDET: „Ist es entsprechend verkleinert, damit keine mehrere MB grosse
 * Datei geladen wird?" Nein, war es nicht.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { canShrink, fitTo, webName, WEB_MAX, WEB_MIN_BYTES } from '../src/task/shrink.js';

test('das Seitenverhaeltnis bleibt', () => {
  // Eine Vorschau, die ein Hochformat in ein Quadrat presst, ist keine
  // Vorschau, sondern eine Behauptung ueber das Bild.
  const quer = fitTo(4000, 3000);
  assert.deepEqual(quer, { width: 1600, height: 1200 });
  const hoch = fitTo(3000, 4000);
  assert.deepEqual(hoch, { width: 1200, height: 1600 });
});

test('es wird nur verkleinert, nie vergroessert', () => {
  // Ein 400 px breites Bild auf 1600 zu ziehen macht es groesser und nicht
  // besser.
  assert.equal(fitTo(400, 300), null);
  assert.equal(fitTo(WEB_MAX, 900), null);
});

test('auch ein Panorama bekommt mindestens einen Pixel', () => {
  // 20000 x 300 waere sonst 1600 x 24 … was stimmt; bei 20000 x 5 kaeme 0
  // heraus, und ein Bild von null Pixeln Hoehe ist keins.
  const p = fitTo(20000, 5);
  assert.ok(p !== null);
  assert.ok(p.height >= 1);
});

test('SVG und GIF werden nicht neu gezeichnet', () => {
  /*
   * SVG ist bereits klein und in jeder Groesse scharf — es zu rastern hiesse,
   * seine einzige Eigenschaft wegzuwerfen. Einem GIF naehme ein Einzelbild die
   * Bewegung.
   */
  assert.equal(canShrink('image/svg+xml'), false);
  assert.equal(canShrink('image/gif'), false);
  assert.equal(canShrink('application/pdf'), false);
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
    assert.equal(canShrink(t), true, t);
  }
});

test('unter der Schwelle lohnt sich keine zweite Datei', () => {
  // Verwaltung ohne Ersparnis — und ein knapp gespeichertes JPEG neu zu
  // kodieren kostet oft mehr, als es bringt.
  assert.ok(WEB_MIN_BYTES > 0);
  assert.equal(WEB_MIN_BYTES, 300 * 1024);
});

test('die kleine Fassung ist am Namen zu erkennen', () => {
  // Damit sie im Papierkorb eines Servers oder in einer Fehlermeldung als das
  // erkennbar ist, was sie ist — und nicht als zweiter Anhang.
  assert.equal(webName('foto.JPG'), 'foto.web.jpg');
  assert.equal(webName('ohne-endung'), 'ohne-endung.web.jpg');
  assert.equal(webName('.versteckt'), '.versteckt.web.jpg');
});
