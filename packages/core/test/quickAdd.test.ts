import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseQuickAdd } from '../src/task/quickAdd.js';
import { describe as describeRecurrence } from '../src/task/recurrence.js';

/** Montag, 7. September 2026, 10:00 UTC. */
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));
const parse = (s: string) => parseQuickAdd(s, { now: NOW });
const utc = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const iso = (d: Date | undefined) => (d === undefined ? undefined : d.toISOString());

/* ── Der Testfall aus dem Konzept ──────────────────────────────────────── */

test('„Steuerbescheid morgen 9 Uhr #finanzen !!"', () => {
  const q = parse('Steuerbescheid morgen 9 Uhr #finanzen !!');
  assert.equal(q.title, 'Steuerbescheid');
  assert.equal(iso(q.planned), iso(utc(2026, 9, 8, 9, 0)));
  assert.equal(q.project, 'finanzen');
  assert.equal(q.priority, 2);
  assert.equal(q.due, undefined);
});

test('„Filter reinigen jeden zweiten Dienstag 8 Uhr #haus !!"', () => {
  const q = parse('Filter reinigen jeden zweiten Dienstag 8 Uhr #haus !!');
  assert.equal(q.title, 'Filter reinigen');
  assert.equal(q.project, 'haus');
  assert.equal(q.priority, 2);
  assert.equal(q.recurrence?.kind, 'calendar');
  assert.equal(
    describeRecurrence(q.recurrence!),
    'Jeden zweiten Dienstag um 08:00 Uhr, ohne Ende.',
  );
  // Der erste Dienstag nach dem 7.9. ist der 8.9., um 8 Uhr.
  assert.equal(iso(q.planned), iso(utc(2026, 9, 8, 8, 0)));
});

test('„Rückruf Steuerberater Donnerstag bis Freitag +anna"', () => {
  const q = parse('Rückruf Steuerberater Donnerstag bis Freitag +anna');
  assert.equal(q.title, 'Rückruf Steuerberater');
  assert.equal(iso(q.planned), iso(utc(2026, 9, 10)));
  assert.equal(iso(q.due), iso(utc(2026, 9, 11)));
  assert.deepEqual(q.assignees, ['anna']);
});

/* ── Geplant und Frist bleiben getrennt ────────────────────────────────── */

test('„bis" macht eine Frist und nicht einen zweiten geplanten Tag', () => {
  const q = parse('Angebot einholen bis 15.9.');
  assert.equal(q.title, 'Angebot einholen');
  assert.equal(q.planned, undefined);
  assert.equal(iso(q.due), iso(utc(2026, 9, 15)));
});

test('fällig-Schreibweise ebenso', () => {
  const q = parse('Bericht abgeben fällig am 30.9.2026');
  assert.equal(iso(q.due), iso(utc(2026, 9, 30)));
  assert.equal(q.title, 'Bericht abgeben');
});

/* ── Zeitangaben ───────────────────────────────────────────────────────── */

test('ein Wochentag heißt der nächste, nie heute', () => {
  // NOW ist ein Montag. „Montag" heißt also nächste Woche.
  assert.equal(iso(parse('Jour fixe Montag').planned), iso(utc(2026, 9, 14)));
  assert.equal(iso(parse('Einkauf Samstag').planned), iso(utc(2026, 9, 12)));
});

test('heute, morgen, übermorgen, in n Tagen, in n Wochen', () => {
  assert.equal(iso(parse('A heute').planned), iso(utc(2026, 9, 7)));
  assert.equal(iso(parse('A morgen').planned), iso(utc(2026, 9, 8)));
  assert.equal(iso(parse('A übermorgen').planned), iso(utc(2026, 9, 9)));
  assert.equal(iso(parse('A in 3 Tagen').planned), iso(utc(2026, 9, 10)));
  assert.equal(iso(parse('A in 2 Wochen').planned), iso(utc(2026, 9, 21)));
});

test('ein Datum ohne Jahr, das schon vorbei ist, meint nächstes Jahr', () => {
  assert.equal(iso(parse('Geburtstag 3.2.').planned), iso(utc(2027, 2, 3)));
  assert.equal(iso(parse('Termin 20.9.').planned), iso(utc(2026, 9, 20)));
});

test('eine Uhrzeit ohne Datum heißt heute', () => {
  assert.equal(iso(parse('Rückruf 14:30').planned), iso(utc(2026, 9, 7, 14, 30)));
});

test('25 Uhr ist keine Uhrzeit und bleibt im Titel', () => {
  const q = parse('Raum 25 Uhr');
  assert.equal(q.planned, undefined);
  assert.equal(q.title, 'Raum 25 Uhr');
});

/* ── Zeichen ───────────────────────────────────────────────────────────── */

test('Schlagwörter und Zuweisungen sind Mengen, das Projekt ist eines', () => {
  const q = parse('Kabel kaufen @unterwegs @baumarkt +anna +lars #haus');
  assert.equal(q.title, 'Kabel kaufen');
  assert.deepEqual(q.labels, ['unterwegs', 'baumarkt']);
  assert.deepEqual(q.assignees, ['anna', 'lars']);
  assert.equal(q.project, 'haus');
});

test('ein zweites #tag wird Schlagwort und bleibt nicht als Syntax im Titel', () => {
  const q = parse('Kabel kaufen #haus #garten');
  assert.equal(q.title, 'Kabel kaufen');
  assert.equal(q.project, 'haus');
  assert.deepEqual(q.labels, ['garten']);
});

test('Priorität in beiden Schreibweisen, mehr Rufzeichen ist dringender', () => {
  assert.equal(parse('A !!!').priority, 1);
  assert.equal(parse('A !!').priority, 2);
  assert.equal(parse('A !').priority, 3);
  assert.equal(parse('A p1').priority, 1);
  assert.equal(parse('A p4').priority, 4);
  assert.equal(parse('A').priority, undefined);
});

test('ein Rufzeichen im Satz ist keine Priorität', () => {
  const q = parse('Nicht vergessen! Müll rausbringen');
  assert.equal(q.priority, undefined);
  assert.equal(q.title, 'Nicht vergessen! Müll rausbringen');
});

/* ── Wiederholungen aus der Zeile ──────────────────────────────────────── */

test('erledigungsbezogen wird als solche gelesen', () => {
  const q = parse('Filter reinigen 3 Tage nach dem Abhaken');
  assert.equal(q.title, 'Filter reinigen');
  assert.deepEqual(q.recurrence, { kind: 'afterCompletion', n: 3, unit: 'day' });
  // Und sie setzt kein geplantes Datum: es gibt noch keines.
  assert.equal(q.planned, undefined);
});

test('täglich, wöchentlich, monatlich', () => {
  assert.equal(parse('Tabletten täglich').recurrence?.kind, 'calendar');
  assert.equal(
    describeRecurrence(parse('Rechnung am 1. jedes Monats').recurrence!),
    'Jeden Monat am 1., ohne Ende.',
  );
  assert.equal(
    describeRecurrence(parse('Backup alle 2 Wochen am Freitag').recurrence!),
    'Jeden zweiten Freitag, ohne Ende.',
  );
});

/* ── Was gelesen wurde, wird gemeldet ─────────────────────────────────── */

test('read nennt jede gelesene Stelle, auch zwei für einen Wert', () => {
  const input = 'Steuerbescheid morgen 9 Uhr #finanzen !!';
  const q = parseQuickAdd(input, { now: NOW });

  // „morgen" und „9 Uhr" sind zwei Stellen, die zusammen einen Zeitpunkt
  // ergeben. Beide sollen im Feld leuchten, also sind es zwei Einträge —
  // read ist keine Liste von Chips.
  assert.deepEqual(
    q.read.map((t) => t.field).sort(),
    ['planned', 'planned', 'priority', 'project'],
  );
  for (const t of q.read) {
    assert.equal(input.slice(t.start, t.end), t.text, `Spanne von ${t.field} passt nicht`);
  }
  // Und keine zwei Stellen überlappen sich.
  const spans = [...q.read].sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i]!.start >= spans[i - 1]!.end, 'Stellen überlappen');
  }
});

test('Unbekanntes bleibt Titel, statt die Erfassung zu blockieren', () => {
  const q = parse('Mit Lars über den Vertrag von 2024 sprechen');
  assert.equal(q.title, 'Mit Lars über den Vertrag von 2024 sprechen');
  assert.equal(q.planned, undefined);
  assert.deepEqual(q.read, []);
});

test('eine leere Zeile ergibt einen leeren Titel und keinen Fehler', () => {
  const q = parse('   ');
  assert.equal(q.title, '');
  assert.deepEqual(q.read, []);
});

/* ── Die Zeitzone ────────────────────────────────────────────────────────── */

test('„morgen 9 Uhr" ist 9 Uhr bei der Person, nicht 9 Uhr UTC', () => {
  // Der gemeldete Fehler, wörtlich: eingetippt „morgen 9 Uhr", angezeigt
  // „morgen, 11:00". Der Parser läuft auf dem Server, der Container steht auf
  // UTC — also baute er 09:00Z, und das liest sich in Berlin als 11:00.
  const now = new Date('2026-09-07T12:00:00Z');
  const berlin = parseQuickAdd('Termin beim Amt morgen 9 Uhr', {
    now,
    zone: 'Europe/Berlin',
  });
  assert.equal(berlin.planned?.toISOString(), '2026-09-08T07:00:00.000Z');

  // Ohne Zone weiter UTC, damit ein alter Aufrufer nichts merkt.
  const utc = parseQuickAdd('Termin beim Amt morgen 9 Uhr', { now });
  assert.equal(utc.planned?.toISOString(), '2026-09-08T09:00:00.000Z');
});

test('derselbe Satz ergibt in drei Zonen drei Zeitpunkte und dieselbe Uhrzeit', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const each = ['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'].map(
    (zone) => parseQuickAdd('Probe morgen 9 Uhr', { now, zone }).planned!.toISOString(),
  );
  assert.deepEqual(each, [
    '2026-09-08T07:00:00.000Z',
    '2026-09-08T21:00:00.000Z',
    '2026-09-08T16:00:00.000Z',
  ]);
});

test('„heute" ist der Tag der Person — auch wenn UTC schon weiter ist', () => {
  // 00:30 am 8. in Berlin, aber noch der 7. in UTC. „heute" muss der 8. sein.
  const now = new Date('2026-09-07T22:30:00Z');
  const q = parseQuickAdd('Müll rausbringen heute', { now, zone: 'Europe/Berlin' });
  // Mitternacht des 8. in Berlin = 22:00Z am 7.
  assert.equal(q.planned?.toISOString(), '2026-09-07T22:00:00.000Z');
});

test('ein Datum über die Sommerzeitgrenze meint die Uhrzeit dort, nicht hier', () => {
  // Im Januar getippt, im Juli gemeint: 9 Uhr Sommerzeit ist 07:00Z, nicht
  // 08:00Z. Dafür klopft fromWallClock beide Versätze ab.
  const now = new Date('2026-01-15T12:00:00Z');
  const q = parseQuickAdd('Sommerfest 1.7. 9 Uhr', { now, zone: 'Europe/Berlin' });
  assert.equal(q.planned?.toISOString(), '2026-07-01T07:00:00.000Z');
});

test('~ liest eine Dauer', () => {
  const q = parseQuickAdd('Rasen mähen ~45', { now: NOW });
  assert.equal(q.duration, 45);
  assert.equal(q.title, 'Rasen mähen');
});

test('die Dauer nimmt alle Formen, die der Kern kennt', () => {
  for (const [text, minutes] of [
    ['~90', 90],
    ['~2h', 120],
    ['~1h30', 90],
    ['~1:30', 90],
    ['~1,5h', 90],
  ] as const) {
    const q = parseQuickAdd(`Etwas ${text}`, { now: NOW });
    assert.equal(q.duration, minutes, text);
    assert.equal(q.title, 'Etwas', text);
  }
});

test('eine nackte Zahl im Titel bleibt im Titel', () => {
  /*
   * Der Grund für das Zeichen. Ohne Tilde wäre „Rechnung 2024 zahlen“ ein
   * Vorgang über ein Kalenderjahr und „Hausnummer 30 prüfen“ eine halbe Stunde
   * — eine Erfassung, die Zahlen aus dem Titel nimmt, nimmt Rechnungsnummern
   * mit.
   */
  const q = parseQuickAdd('Rechnung 2024 zahlen', { now: NOW });
  assert.equal(q.duration, undefined);
  assert.equal(q.title, 'Rechnung 2024 zahlen');
});

test('was hinter der Tilde nicht zu lesen ist, bleibt stehen', () => {
  // Nicht stillschweigend wegwerfen: was aus der Zeile fällt, findet niemand
  // wieder — dieselbe Regel wie beim zweiten `#`.
  const q = parseQuickAdd('Erledigen ~bald', { now: NOW });
  assert.equal(q.duration, undefined);
  assert.equal(q.title, 'Erledigen ~bald');
});

test('die Dauer wird zurückgemeldet, damit das Feld sie hervorheben kann', () => {
  const q = parseQuickAdd('Etwas ~2h', { now: NOW });
  const token = q.read.find((t) => t.field === 'duration');
  assert.notEqual(token, undefined);
  assert.equal(token?.text, '~2h');
});

test('Dauer und Priorität stören sich nicht', () => {
  const q = parseQuickAdd('Etwas ~30 !! #haus', { now: NOW });
  assert.equal(q.duration, 30);
  assert.equal(q.priority, 2);
  assert.equal(q.project, 'haus');
  assert.equal(q.title, 'Etwas');
});
