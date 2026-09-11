/**
 * SOTE — was sich ansehen lässt.
 *
 * GEWÜNSCHT: „PDF, Bilder, Text, so viele wie möglich mit Unterstützung, sie
 * direkt anzuzeigen, anstatt nur herunterzuladen."
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { kindOf } from '../src/components/FileModal.js';

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
   */
  for (const t of [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'video/mp4',
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
