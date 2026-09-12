import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildTaskQuery,
  isEmptyQuery,
  parseTaskQuery,
  splitQuery,
} from '../src/task/query.js';

/* ── Lesen ─────────────────────────────────────────────────────────────── */

test('Freitext bleibt Freitext', () => {
  const q = parseTaskQuery('kabel messen');
  assert.equal(q.text, 'kabel messen');
  assert.deepEqual(q.read, []);
  /*
   * „Alles" ist die Vorgabe, nicht „offen".
   *
   * Der Test behauptete das Gegenteil, und er hatte recht — bis gefragt wurde,
   * ob die Suche auch Erledigtes zeigen soll, und die Antwort ja war. In einer
   * Suche nennt man einen Namen und keinen Zustand: wer „Dosen" tippt, sucht
   * die Aufgabe, und ob sie abgehakt ist, ist die Antwort und nicht die Frage.
   */
  assert.equal(q.status, 'all', 'alles ist die Vorgabe');
});

test('die Zeichen aus der Schnellerfassung gelten auch hier', () => {
  // Wer +haus tippt, um etwas anzulegen, tippt +haus, um es zu finden.
  // `@` ist eine Person, `+` ein Schlagwort — die Suche spricht dieselbe
  // Sprache wie die Erfassung.
  const q = parseTaskQuery('messen +haus #unterwegs @anna !!');
  assert.equal(q.text, 'messen');
  assert.deepEqual(q.projects, ['haus']);
  assert.deepEqual(q.labels, ['unterwegs']);
  assert.deepEqual(q.assignees, ['anna']);
  assert.deepEqual(q.priorities, [2]);
});

test('Schlüsselwörter deutsch und englisch', () => {
  for (const line of ['projekt:haus', 'project:haus', 'p:haus']) {
    assert.deepEqual(parseTaskQuery(line).projects, ['haus'], line);
  }
  for (const line of ['schlagwort:eilig', 'label:eilig', 'tag:eilig']) {
    assert.deepEqual(parseTaskQuery(line).labels, ['eilig'], line);
  }
  assert.equal(parseTaskQuery('ist:erledigt').status, 'done');
  assert.equal(parseTaskQuery('is:done').status, 'done');
  assert.equal(parseTaskQuery('status:alles').status, 'all');
  assert.equal(parseTaskQuery('frist:überfällig').due, 'overdue');
  assert.equal(parseTaskQuery('due:week').due, 'week');
});

test('ein Wert in Anführungszeichen darf Leerzeichen haben', () => {
  const q = parseTaskQuery('projekt:"Umzug Büro" dosen');
  assert.deepEqual(q.projects, ['Umzug Büro']);
  assert.equal(q.text, 'dosen');
});

test('mehrere Werte derselben Facette stehen nebeneinander', () => {
  const q = parseTaskQuery('#eilig #unterwegs prio:1 prio:2');
  assert.deepEqual(q.labels, ['eilig', 'unterwegs']);
  assert.deepEqual(q.priorities, [1, 2]);
});

test('ein Zeichen mit Doppelpunkt bleibt ein Zeichen', () => {
  // `#guest:lars` ist eine Zuweisung an einen Gast und keine unbekannte
  // Facette namens `#guest`. Die erste Fassung prüfte den Doppelpunkt vorher,
  // und die Suche nach einem Gast fand nichts.
  const q = parseTaskQuery('@guest:lars dosen');
  assert.deepEqual(q.assignees, ['guest:lars']);
  assert.equal(q.text, 'dosen');
});

test('ein Doppelpunkt, der keine Facette ist, bleibt Text', () => {
  // Eine Abfrage, die bei „12:30" nichts findet, wäre schlechter als eine, die
  // danach sucht.
  const q = parseTaskQuery('Termin 12:30 klären');
  assert.equal(q.text, 'Termin 12:30 klären');
  assert.deepEqual(q.read, []);
});

test('ein unbekannter Wert einer bekannten Facette bleibt Text', () => {
  const q = parseTaskQuery('prio:9 status:vielleicht');
  assert.deepEqual(q.priorities, []);
  // „vielleicht" ist kein Status, also bleibt die Vorgabe stehen — und die ist
  // „alles". Der Punkt des Tests ist unberührt: ein unbekannter Wert wird nicht
  // zur Einschränkung, sondern zu Text.
  assert.equal(q.status, 'all');
  assert.equal(q.text, 'prio:9 status:vielleicht');
});

test('read nennt jede gelesene Facette für die Chips', () => {
  const q = parseTaskQuery('+haus #eilig @anna !!! ist:erledigt frist:heute');
  assert.deepEqual(q.read, [
    { facet: 'projekt', value: 'haus' },
    { facet: 'schlagwort', value: 'eilig' },
    { facet: 'zugewiesen', value: 'anna' },
    { facet: 'priorität', value: '1' },
    { facet: 'status', value: 'erledigt' },
    { facet: 'frist', value: 'heute' },
  ]);
});

test('eine leere Abfrage ist erkennbar leer — auch mit Status', () => {
  assert.equal(isEmptyQuery(parseTaskQuery('')), true);
  assert.equal(isEmptyQuery(parseTaskQuery('   ')), true);
  // Status allein ist kein Suchauftrag: „alle offenen" ist keine Suche,
  // sondern eine Ansicht.
  assert.equal(isEmptyQuery(parseTaskQuery('ist:offen')), true);
  assert.equal(isEmptyQuery(parseTaskQuery('+haus')), false);
  assert.equal(isEmptyQuery(parseTaskQuery('kabel')), false);
});

test('splitQuery hält Anführungszeichen zusammen', () => {
  assert.deepEqual(splitQuery('a "b c" d'), ['a', '"b c"', 'd']);
  assert.deepEqual(splitQuery('  a   b  '), ['a', 'b']);
  assert.deepEqual(splitQuery(''), []);
});

/* ── Zurückschreiben ───────────────────────────────────────────────────── */

test('eine Facette setzen, ohne den Rest anzufassen', () => {
  assert.equal(buildTaskQuery('kabel messen', 'projekt', 'haus'), 'kabel messen projekt:haus');
  // Der Freitext bleibt wortgetreu und in seiner Reihenfolge: ein Feld, das
  // sich beim Klicken selbst umschreibt, tippt niemand gern.
  assert.equal(
    buildTaskQuery('messen kabel dosen', 'status', 'erledigt'),
    'messen kabel dosen status:erledigt',
  );
});

test('eine Facette ersetzen, die es nur einmal geben darf', () => {
  assert.equal(buildTaskQuery('status:offen kabel', 'status', 'erledigt'), 'kabel status:erledigt');
  assert.equal(buildTaskQuery('frist:heute', 'frist', 'woche'), 'frist:woche');
});

test('eine Facette entfernen', () => {
  assert.equal(buildTaskQuery('kabel status:erledigt', 'status', undefined), 'kabel');
  assert.equal(buildTaskQuery('+haus kabel', 'projekt', undefined), 'kabel');
});

test('mehrfache Facetten sammeln, und derselbe Wert schaltet ab', () => {
  const one = buildTaskQuery('kabel', 'schlagwort', 'eilig', { multiple: true });
  assert.equal(one, 'kabel schlagwort:eilig');
  const two = buildTaskQuery(one, 'schlagwort', 'unterwegs', { multiple: true });
  assert.equal(two, 'kabel schlagwort:eilig schlagwort:unterwegs');
  // Noch ein Klick auf dasselbe entfernt es wieder.
  const back = buildTaskQuery(two, 'schlagwort', 'eilig', { multiple: true });
  assert.equal(back, 'kabel schlagwort:unterwegs');
});

test('die Kurzform wird als dieselbe Facette erkannt und ersetzt', () => {
  // Wer `+haus` getippt hat und dann im Panel „Büro" wählt, will nicht beide.
  assert.equal(buildTaskQuery('+haus kabel', 'projekt', 'büro'), 'kabel projekt:büro');
  assert.equal(buildTaskQuery('!! kabel', 'priorität', '1'), 'kabel prio:1');
});

test('ein Wert mit Leerzeichen wird beim Schreiben eingefasst', () => {
  const q = buildTaskQuery('dosen', 'projekt', 'Umzug Büro');
  assert.equal(q, 'dosen projekt:"Umzug Büro"');
  assert.deepEqual(parseTaskQuery(q).projects, ['Umzug Büro']);
});

test('lesen und zurückschreiben ergibt dieselbe Abfrage', () => {
  // Der eigentliche Punkt: die Bedienelemente lesen den String, ändern eine
  // Sache und schreiben ihn zurück. Wenn dabei etwas verloren geht, driften
  // Panel und Feld auseinander.
  const start = 'kabel messen +haus #eilig @anna prio:2 frist:heute';
  const parsed = parseTaskQuery(start);
  let round = start;
  round = buildTaskQuery(round, 'priorität', '2');
  round = buildTaskQuery(round, 'frist', 'heute');
  const again = parseTaskQuery(round);
  assert.equal(again.text, parsed.text);
  assert.deepEqual(again.projects, parsed.projects);
  assert.deepEqual(again.labels, parsed.labels);
  assert.deepEqual(again.assignees, parsed.assignees);
  assert.deepEqual(again.priorities, parsed.priorities);
  assert.equal(again.due, parsed.due);
});

test('die Zeichen: @ Person, # Schlagwort, + Projekt — beim Lesen UND beim Zurückschreiben', () => {
  /*
   * GEMELDET: „Wenn ich ein Schlagwort auswähle, zeigt er @Markus — aber das
   * ist das Schlagwort." Nach dem letzten Drehen der Zeichen las die Suche `@`
   * als Person, während `buildTaskQuery` für ein Schlagwort noch `@` schrieb.
   * Ein Klick auf ein Schlagwort suchte damit nach einer Person.
   *
   * Dieser Test hält beide Richtungen aneinander fest — für jedes der drei.
   */
  const q = parseTaskQuery('+haus #eilig @anna');
  assert.deepEqual(q.projects, ['haus']);
  assert.deepEqual(q.labels, ['eilig']);
  assert.deepEqual(q.assignees, ['anna']);

  assert.equal(buildTaskQuery('', 'projekt', 'haus'), 'projekt:haus');
  const geschrieben = [
    buildTaskQuery('', 'schlagwort', 'eilig'),
    buildTaskQuery('', 'zugewiesen', 'anna'),
  ];
  // Zurückgeschrieben wird die lange Form — und die lange Form liest sich
  // in dieselbe Facette wie das Kurzzeichen. Wichtig ist: `#eilig` in der
  // Zeile wird von `buildTaskQuery('schlagwort')` als SEINE Facette erkannt
  // und ersetzt, nicht als fremde stehen gelassen.
  assert.deepEqual(parseTaskQuery(geschrieben.join(' ')).labels, ['eilig']);
  assert.deepEqual(parseTaskQuery(geschrieben.join(' ')).assignees, ['anna']);
  assert.equal(buildTaskQuery('#eilig kabel', 'schlagwort', undefined), 'kabel', '# ist Schlagwort');
  assert.equal(buildTaskQuery('+haus kabel', 'projekt', undefined), 'kabel', '+ ist Projekt');
  assert.equal(buildTaskQuery('@anna kabel', 'zugewiesen', undefined), 'kabel', '@ ist Person');
  assert.equal(buildTaskQuery('@anna kabel', 'schlagwort', undefined), '@anna kabel', 'und nicht Schlagwort');
});
