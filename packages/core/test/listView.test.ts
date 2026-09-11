/**
 * SOTE — die Anzeigeform einer Liste.
 *
 * Zwei Ebenen: was die Person für DIESEN Ort gewählt hat, sonst was der
 * Arbeitsbereich vorgibt. Die Auflösung steht im Kern, weil die Liste, die
 * Suche und später die Tafel dieselbe Frage stellen — und drei Antworten auf
 * eine Frage laufen auseinander.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DEFAULT_LIST_VIEW,
  isListPlace,
  isListView,
  LIST_VIEWS,
  LIST_VIEW_SAYS,
  resolveListView,
} from '../src/look/listView.js';

test('die Person schlägt den Arbeitsbereich', () => {
  // „Jeder sollte die Liste so anzeigen können wie er möchte."
  assert.equal(resolveListView('plain', 'cards'), 'plain');
});

test('ohne eigene Wahl gilt die Vorgabe', () => {
  assert.equal(resolveListView(undefined, 'cards'), 'cards');
  assert.equal(resolveListView(null, 'plain'), 'plain');
});

test('ohne beides gilt, was vorher war', () => {
  // `full` ist der Stand vor dieser Einstellung: wer nichts ändert, soll
  // nichts ändern sehen.
  assert.equal(resolveListView(undefined, undefined), 'full');
  assert.equal(DEFAULT_LIST_VIEW, 'full');
});

test('Unbekanntes zählt als „nichts gesagt“', () => {
  /*
   * Dieselbe Regel wie in `settings.ts`: ein Wort aus einer künftigen Fassung
   * — hier `gantt`, morgen vielleicht wirklich eines — soll die gewöhnliche
   * Antwort bekommen und keine Liste, die sich nicht entscheiden kann.
   *
   * Der Test stand hier vorher mit `board` als dem unbekannten Wort, und das
   * war gut so: er ist fehlgeschlagen, als `board` eines wurde. Genau dafür
   * ist er da — ein Wortschatz, der wächst, muss beim Wachsen auffallen.
   */
  assert.equal(resolveListView('gantt', 'cards'), 'cards');
  assert.equal(resolveListView('gantt', 'gantt'), 'full');
  assert.equal(resolveListView(42, undefined), 'full');
});

test('jede Form hat einen Namen und einen Satz dazu', () => {
  /*
   * Gekreuzt und nicht als zweite Liste geschrieben: eine Form ohne Text wäre
   * ein Knopf mit leerer Beschriftung, und das fällt im Bild nicht auf, weil
   * die anderen beiden daneben stehen.
   */
  for (const form of LIST_VIEWS) {
    const text = LIST_VIEW_SAYS[form];
    assert.ok(text !== undefined, form);
    assert.ok(text.name.length > 0, form);
    assert.ok(text.says.length > 0, form);
  }
  assert.equal(Object.keys(LIST_VIEW_SAYS).length, LIST_VIEWS.length);
});

test('die festen Ansichten sind genau die vier', () => {
  // Sie tragen ein Wort statt einer Id, weil sie keine Zeile in `projects`
  // haben — und die Datenbank prüft dieselben vier (CHECK in 0028).
  for (const ort of ['today', 'upcoming', 'someday', 'inbox']) {
    assert.equal(isListPlace(ort), true, ort);
  }
  assert.equal(isListPlace('project'), false);
  assert.equal(isListPlace('heute'), false);
});

test('isListView kennt genau den Wortschatz', () => {
  // Gekreuzt statt aufgezählt: eine zweite Liste hier wäre eine, die man beim
  // nächsten Wort vergisst.
  for (const form of LIST_VIEWS) assert.equal(isListView(form), true, form);
  assert.equal(isListView('gantt'), false);
  assert.equal(isListView(''), false);
});

test('die Tafel ist dabei', () => {
  // Der ganze Ertrag der Entscheidung, einen Wortschatz zu nehmen statt eines
  // Ja-Nein-Schalters: sie kostete ein Wort und eine Zeile in der Datenbank.
  assert.equal(isListView('board'), true);
  assert.equal(resolveListView('board', undefined), 'board');
});
