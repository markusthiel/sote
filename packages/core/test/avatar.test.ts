/**
 * SOTE — die Rechnung hinter einem Profilbild.
 *
 * Sie steht im Kern, damit sie **ohne Leinwand** geprüft werden kann: die
 * Verkleinerung selbst braucht einen Browser, die Rechnung nicht. Und die
 * Rechnung ist die Stelle, an der ein Fehler um eins ein Bild bei jeder
 * Berührung ein Pixel schmaler macht.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { AVATAR_BOUND, AVATAR_MAX_BYTES, isAvatarType, variantSize } from '../src/index.js';

test('was schon klein genug ist, wird nicht gerechnet', () => {
  // Eine „Kopie" in derselben Größe wären zwei Dateien, wo eine genügt.
  assert.equal(variantSize({ width: 512, height: 512 }), undefined);
  assert.equal(variantSize({ width: 300, height: 120 }), undefined);
});

test('die lange Kante entscheidet, und das Seitenverhältnis bleibt', () => {
  const hoch = variantSize({ width: 1000, height: 2000 });
  assert.deepEqual(hoch, { width: 256, height: 512 });
  const breit = variantSize({ width: 2000, height: 1000 });
  assert.deepEqual(breit, { width: 512, height: 256 });
  // Nicht die Breite: ein Hochformat, das an der Breite gemessen wird, bleibt
  // zu hoch — und genau das sieht man erst an einem echten Foto.
  assert.equal(Math.max(hoch!.width, hoch!.height), AVATAR_BOUND);
});

test('nie auf null gerundet', () => {
  /*
   * Ein Panorama mit 8000 auf 3 Pixeln ist absurd und trotzdem jemandes Datei.
   * Eine Höhe von 0 ist eine Leinwand, die wirft — der Fehler wäre dann nicht
   * „das Bild ist seltsam", sondern „das Hochladen ist kaputt".
   */
  const dünn = variantSize({ width: 8000, height: 3 });
  assert.equal(dünn?.width, 512);
  assert.equal(dünn?.height, 1);
});

test('eine Größe von null wirft nicht und rechnet nicht', () => {
  // Kommt vor: ein beschädigtes Bild, das der Browser mit 0 auf 0 dekodiert.
  assert.equal(variantSize({ width: 0, height: 0 }), undefined);
});

test('nur Bilder, die der Browser auch verkleinern kann', () => {
  for (const gut of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(isAvatarType(gut), true, gut);
  }
  for (const schlecht of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', '']) {
    // SVG besonders: es ist ein Dokument, das Skripte tragen kann, und ein
    // Profilbild ist der letzte Ort, an dem man das haben will.
    assert.equal(isAvatarType(schlecht), false, schlecht);
  }
});

test('der Deckel ist dieselbe Zahl wie in der Migration', () => {
  /*
   * 262144 steht an zwei Stellen: hier und als CHECK in Migration 0021. Zwei
   * Zahlen, die zueinander passen müssen — also prüft dieser Test, dass sie es
   * tun, und die Migration ist die Quelle.
   */
  const sql = readFileSync(
    new URL('../../server/migrations/0021_avatars.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, new RegExp(String(AVATAR_MAX_BYTES)));
});
