/**
 * SOTE — die Dauer, gelesen und geschrieben.
 *
 * Der Test, auf den es ankommt, steht unten: **was angezeigt wird, lässt sich
 * zurücktippen.** Lesen und Schreiben sind zwei Funktionen, und zwei Funktionen
 * laufen auseinander — hier gehen alle Werte von einer Minute bis zur Grenze
 * einmal durch beide und müssen dieselbe Zahl wieder ergeben. Ohne das wäre
 * „1:30 h" im Feld eine Anzeige, die als Eingabe abgelehnt wird.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MAX_DURATION, formatDuration, parseDuration } from '../src/task/duration.js';

test('eine nackte Zahl sind Minuten', () => {
  // Die andere Richtung („1\" heisst eine Stunde) macht aus jedem „5\" fünf
  // Stunden, und das ist die häufigere Eingabe.
  assert.equal(parseDuration('30'), 30);
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('1'), 1);
});

test('Minuten mit Einheit, in vier Schreibweisen', () => {
  for (const text of ['90m', '90min', '90 Minuten', '90minute']) {
    assert.equal(parseDuration(text), 90, text);
  }
});

test('Stunden, in vier Schreibweisen', () => {
  for (const text of ['2h', '2 Std', '2 Stunden', '2stunde']) {
    assert.equal(parseDuration(text), 120, text);
  }
});

test('Stunden und Minuten zusammen', () => {
  assert.equal(parseDuration('1h30'), 90);
  assert.equal(parseDuration('1h30m'), 90);
  assert.equal(parseDuration('1h 30 min'), 90);
});

test('die Uhrzeitform', () => {
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('0:45'), 45);
  assert.equal(parseDuration('12:00'), 720);
});

test('Dezimalstunden, mit Komma und mit Punkt', () => {
  assert.equal(parseDuration('1,5h'), 90);
  assert.equal(parseDuration('1.5h'), 90);
  // Gerundet: 1,7 h sind keine ganze Minutenzahl, und eine Schätzung auf die
  // Sekunde ist keine.
  assert.equal(parseDuration('1,7h'), 102);
});

test('das Komma wird nicht als Trenner gelesen', () => {
  /*
   * Der Fehler, den die Reihenfolge der Ausdrücke verhindert: liest man zuerst
   * die Stunden-Minuten-Form, wird `1,5h` zu einer Stunde und fünf Minuten —
   * still, und um 85 Minuten falsch.
   */
  assert.equal(parseDuration('1,5h'), 90);
  assert.notEqual(parseDuration('1,5h'), 65);
});

test('null ist keine Dauer', () => {
  // „Keine Angabe\" ist `undefined` und hat genau eine Schreibweise; eine
  // zweite (0) müsste jede Summe kennen.
  assert.equal(parseDuration('0'), undefined);
  assert.equal(parseDuration('0:00'), undefined);
  assert.equal(parseDuration('0h'), undefined);
});

test('mehr als eine Woche ist keine Schätzung', () => {
  assert.equal(parseDuration(String(MAX_DURATION)), MAX_DURATION);
  assert.equal(parseDuration(String(MAX_DURATION + 1)), undefined);
  assert.equal(parseDuration('999h'), undefined);
});

test('Unlesbares wird abgelehnt und nicht geraten', () => {
  for (const text of ['', 'bald', 'lange', '1h70', 'h', ':30', '1:60', '-5', '3,h']) {
    assert.equal(parseDuration(text), undefined, text);
  }
});

test('drei Formen beim Anzeigen, jede für sich eindeutig', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(59), '59 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(120), '2 h');
  assert.equal(formatDuration(90), '1:30 h');
  // Zweistellig gepolstert, sonst liest sich 1:05 als 1:50.
  assert.equal(formatDuration(65), '1:05 h');
});

test('was angezeigt wird, lässt sich zurücktippen', () => {
  /*
   * Der Ringschluss, und der Grund für diesen Test: das Detailfeld zeigt
   * `formatDuration` und nimmt Eingaben durch `parseDuration`. Wäre eine
   * angezeigte Form keine lesbare, dann wäre der Wert im Feld einer, den das
   * Feld selbst ablehnt — und das fällt erst auf, wenn jemand ihn abtippt.
   *
   * Jede Minute von 1 bis zur Grenze, nicht eine Auswahl: die Stellen, an
   * denen es bricht, sind die runden und die knapp danebenliegenden, und die
   * findet man nicht durch Nachdenken über eine gute Stichprobe.
   */
  for (let m = 1; m <= MAX_DURATION; m += 1) {
    assert.equal(parseDuration(formatDuration(m)), m, `${m} → ${formatDuration(m)}`);
  }
});
