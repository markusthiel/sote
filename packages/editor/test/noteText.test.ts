/**
 * SOTE — der Klartext-Schatten der Notiz.
 *
 * Warum das einen Test hat und nicht nur „sieht in der Karte richtig aus":
 * dieser Text ist das, was die Volltextsuche indiziert. Ein Fehler hier fällt
 * nicht beim Hinsehen auf, sondern erst, wenn jemand etwas sucht, von dem er
 * weiß, dass er es geschrieben hat, und es nicht findet.
 *
 * Und die Gegenrichtung: eine Notiz, die es vor dem Editor gab, darf beim
 * ersten Öffnen nicht verschwinden — sie ist dann noch nirgends sonst.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { docFromPlainText, noteText } from '../src/noteText.js';
import { schema } from '../src/schema.js';

const absatz = (text: string) => schema.nodes['paragraph']!.create(null, schema.text(text));
const doc = (...blocks: ReturnType<typeof absatz>[]) => schema.nodes['doc']!.create(null, blocks);

test('eine Zeile je Block, leere Blöcke fallen weg', () => {
  const d = doc(absatz('Erst anrufen'), schema.nodes['paragraph']!.create(), absatz('dann fahren'));
  assert.equal(noteText(d), 'Erst anrufen\ndann fahren');
});

test('Überschriften und Listen tragen ihre Wörter in die Suche', () => {
  const d = schema.nodes['doc']!.create(null, [
    schema.nodes['heading']!.create({ level: 2 }, schema.text('Anfahrt')),
    schema.nodes['bulletList']!.create(null, schema.text('Schlüssel mitnehmen')),
  ]);
  assert.equal(noteText(d), 'Anfahrt\n• Schlüssel mitnehmen');
});

test('eine Erwähnung steht als @Name da und nicht als Lücke', () => {
  const d = schema.nodes['doc']!.create(null, [
    schema.nodes['paragraph']!.create(null, [
      schema.text('Rückfrage an '),
      schema.nodes['mention']!.create({ userId: 'u1', label: 'Anna Berg' }),
    ]),
  ]);
  assert.equal(noteText(d), 'Rückfrage an @Anna Berg');
});

test('ein Bild trägt seinen Alt-Text bei, ein leeres Bild nichts', () => {
  const mitText = schema.nodes['doc']!.create(null, [
    schema.nodes['image']!.create({ url: '/x', alt: 'Zählerstand' }),
  ]);
  assert.equal(noteText(mitText), 'Zählerstand');

  const ohne = schema.nodes['doc']!.create(null, [
    schema.nodes['image']!.create({ url: '/x', alt: '' }),
    absatz('Text darunter'),
  ]);
  // Keine führende Leerzeile: sonst beginnt jede Kartenvorschau mit nichts.
  assert.equal(noteText(ohne), 'Text darunter');
});

test('eine Tabelle gibt ihre Zellen her', () => {
  const zelle = (text: string) =>
    schema.nodes['table_cell']!.create(null, absatz(text));
  const d = schema.nodes['doc']!.create(null, [
    schema.nodes['table']!.create(null, [
      schema.nodes['table_row']!.create(null, [zelle('Montag'), zelle('Werkstatt')]),
    ]),
  ]);
  assert.equal(noteText(d), 'Montag\nWerkstatt');
});

test('eine alte Notiz wandert Zeile für Zeile und geht dabei nicht verloren', () => {
  const alt = 'Schlüssel beim Nachbarn\nTelefon 06271 12345';
  const gewandert = docFromPlainText(alt);
  assert.equal(noteText(gewandert), alt);
});

test('eine leere alte Notiz ergibt ein beschreibbares Dokument', () => {
  // `block+` im Schema: ein Dokument ohne Block ist ungültig, und ein Editor,
  // der an ein ungültiges Dokument gebunden wird, lässt sich nicht betippen.
  const leer = docFromPlainText('');
  assert.equal(leer.childCount, 1);
  assert.equal(leer.firstChild?.type.name, 'paragraph');
});

test('der Schatten ist keine Rückverwandlung und behauptet auch nicht, eine zu sein', () => {
  const d = schema.nodes['doc']!.create(null, [
    schema.nodes['heading']!.create({ level: 1 }, schema.text('Titel')),
  ]);
  // Aus dem Schatten wieder ein Dokument gemacht, ist die Überschrift ein
  // Absatz. Das ist gewollt und hier festgehalten, damit niemand den Schatten
  // eines Tages als Sicherung missversteht: die Wahrheit ist `note_doc`.
  assert.equal(docFromPlainText(noteText(d)).firstChild?.type.name, 'paragraph');
});
