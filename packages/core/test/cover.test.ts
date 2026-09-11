/**
 * SOTE — das Titelbild einer Aufgabe.
 *
 * Die Regeln stammen aus SONEs ADR-0117, und die wichtigste ist keine
 * Formfrage: ein Titelbild wird bei jedem Zeichnen geladen, also darf dort
 * keine fremde Adresse stehen.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { isOwnFile, isTaskCover, readTaskCover } from '../src/task/cover.js';

const ANHANG = '/api/tasks/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222';

test('ein eigener Anhang wird angenommen', () => {
  assert.equal(isOwnFile(ANHANG), true);
  assert.deepEqual(readTaskCover({ image: ANHANG }), { image: ANHANG });
});

test('eine fremde Adresse nicht — und das ist der ganze Punkt', () => {
  /*
   * Eine Karte mit fremdem Titelbild meldet jeden Betrachter bei jemand
   * anderem: ein Zählpixel im Titelbild-Kostüm. Darum steht die Regel im WERT
   * und nicht im Auswahlmenü — das Menü ist nur einer von mehreren Wegen, auf
   * denen ein Wert hereinkommt.
   */
  for (const fremd of [
    'https://example.com/bild.jpg',
    '//example.com/bild.jpg',
    '/api/tasks/x/files/y',
    'javascript:alert(1)',
  ]) {
    assert.equal(isOwnFile(fremd), false, fremd);
    assert.equal(readTaskCover({ image: fremd }), undefined, fremd);
  }
});

test('verankert an BEIDEN Enden', () => {
  // Ohne das Ende wäre `…/files/<uuid>@example.com` gültig, ohne den Anfang
  // jede Adresse, die den Weg irgendwo enthält.
  assert.equal(isOwnFile(`https://fremd.example${ANHANG}`), false);
  assert.equal(isOwnFile(`${ANHANG}?x=1`), false);
});

test('eine Farbe geht auch — beide Schreibweisen', () => {
  // Dieselben zwei wie überall in diesem Projekt: ein Palettenname folgt dem
  // Arbeitsbereich, ein Hexwert bleibt er selbst.
  assert.deepEqual(readTaskCover({ color: 'blue' }), { color: 'blue' });
  assert.deepEqual(readTaskCover({ color: '#2f7d6f' }), { color: '#2f7d6f' });
});

test('nichts Brauchbares heisst kein Titelbild', () => {
  // Eine Aufgabe mit kaputtem Titelbild verliert ihr Titelbild, nie ihren
  // Platz in der Liste.
  assert.equal(readTaskCover(null), undefined);
  assert.equal(readTaskCover('bild.jpg'), undefined);
  assert.equal(readTaskCover({}), undefined);
  assert.equal(readTaskCover({ image: 42 }), undefined);
});

test('lesen und annehmen sind zwei Fragen', () => {
  /*
   * `readTaskCover` fragt „was davon kann ich zeichnen", `isTaskCover` fragt
   * „darf das hereinkommen". Ein Schreibweg, der still das Brauchbare
   * herausfiltert, nimmt jemandem die Rueckmeldung, dass sein Bild nicht
   * angekommen ist — darum lehnt der Server mit 422 ab, statt zu leeren.
   */
  assert.equal(isTaskCover({ image: 'https://example.com/x.jpg' }), false);
  assert.equal(isTaskCover({ bild: ANHANG }), false);
  assert.equal(isTaskCover({}), false);
  assert.equal(isTaskCover({ image: ANHANG }), true);
});

test('null ist, wie man es wegnimmt', () => {
  assert.equal(isTaskCover(null), true);
});
