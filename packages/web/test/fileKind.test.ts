/**
 * SOTE — was sich ansehen lässt.
 *
 * GEWÜNSCHT: „PDF, Bilder, Text, so viele wie möglich mit Unterstützung, sie
 * direkt anzuzeigen, anstatt nur herunterzuladen."
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { kindName, kindOf } from '../src/components/FileModal.js';

test('Bilder und PDF kann der Browser selbst', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
    assert.equal(kindOf(t), 'image', t);
  }
  assert.equal(kindOf('application/pdf'), 'pdf');
});

test('Text auch dort, wo der Typ nicht „text/“ heisst', () => {
  /*
   * `application/json` ist die lesbarste Datei von allen und faengt trotzdem
   * nicht mit `text/` an. Ohne die Liste waere ein hochgeladenes JSON das
   * einzige, was man nicht ansehen kann.
   */
  for (const t of ['text/plain', 'text/csv', 'text/markdown', 'application/json']) {
    assert.equal(kindOf(t), 'text', t);
  }
});

test('alles andere bekommt KEINE Notloesung', () => {
  /*
   * Ein Word-Dokument in einem eingebetteten Rahmen zeigt in den meisten
   * Browsern eine leere Flaeche — und eine leere Flaeche ist eine schlechtere
   * Auskunft als der Satz „das laesst sich hier nicht zeigen".
   *
   * `video/mp4` stand hier einmal mit drin und ist jetzt weg: es war kein
   * Grundsatz, sondern der Stand von damals. Der Browser KANN Video, und
   * gemeldet wurde genau das.
   */
  for (const t of [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ]) {
    assert.equal(kindOf(t), 'other', t);
  }
});

test('Grossschreibung entscheidet nicht', () => {
  // Ein Typ kommt aus dem Upload und ist nicht normiert.
  assert.equal(kindOf('IMAGE/PNG'), 'image');
  assert.equal(kindOf('Application/PDF'), 'pdf');
});

test('Video und Ton bekommen einen Abspieler', () => {
  // Gemeldet: „Videos koennen nicht angezeigt werden … Audio ebenfalls. Dafuer
  // bitte Player." Der Browser bringt beide mit; es gab sie hier nur nicht,
  // weil die Liste sie nicht kannte.
  for (const t of ['video/mp4', 'video/webm', 'video/quicktime']) {
    assert.equal(kindOf(t), 'video', t);
  }
  for (const t of ['audio/mpeg', 'audio/ogg', 'audio/wav']) {
    assert.equal(kindOf(t), 'audio', t);
  }
});

test('und heissen dann auch so', () => {
  // Gemeldet: „Das Icon wird auch nicht als Video dargestellt." Die Art steht
  // in der Dateizeile als Wort, und die kam aus derselben Liste.
  assert.equal(kindName('video/mp4'), 'Video');
  assert.equal(kindName('audio/mpeg'), 'Audio');
});
