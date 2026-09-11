/**
 * SOTE — die Kalender-Ausgabe.
 *
 * Das Format hat genug Ecken, dass „sieht im Kalender richtig aus" keine
 * Prüfung ist: Faltung nach Oktetten, Escaping in einer bestimmten Reihenfolge,
 * ausschließende Enddaten. Jede davon hat hier einen Test, und jeder sagt,
 * welcher Fehler ohne ihn durchgeht.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildIcs, type IcsTask } from '../src/task/ics.js';

const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0, 0));

function task(over: Partial<IcsTask> = {}): IcsTask {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Heizung entlüften',
    planned: new Date(Date.UTC(2026, 8, 8, 9, 0, 0)),
    plannedAllDay: false,
    due: null,
    dueAllDay: false,
    duration: null,
    note: null,
    projectName: null,
    updatedAt: new Date(Date.UTC(2026, 8, 7, 8, 0, 0)),
    ...over,
  };
}

const lines = (text: string) => text.split('\r\n');

test('ein Dokument mit Kopf und Fuß', () => {
  const out = buildIcs({ tasks: [], name: 'SOTE — Haus', now: NOW });
  const l = lines(out);
  assert.equal(l[0], 'BEGIN:VCALENDAR');
  assert.equal(l.includes('VERSION:2.0'), true);
  assert.equal(l.includes('END:VCALENDAR'), true);
  // Der Name, den das Programm in der Seitenleiste zeigt.
  assert.equal(l.includes('X-WR-CALNAME:SOTE — Haus'), true);
});

test('CRLF überall, auch am Ende', () => {
  // Das Format schreibt es vor, und Kalender, die es genau nehmen, lehnen
  // LF-Dateien ab. Auf einem Unix-Server sieht das falsch aus und ist richtig.
  const out = buildIcs({ tasks: [task()], name: 'x', now: NOW });
  assert.equal(out.endsWith('\r\n'), true);
  assert.equal(out.includes('\n\n'), false);
  for (const l of out.split('\r\n')) assert.equal(l.includes('\n'), false);
});

test('ein Zeitpunkt ohne Dauer bleibt ein Zeitpunkt', () => {
  /*
   * Kein erfundenes DTEND. „Dauert schon mal eine Stunde" wäre eine Angabe,
   * die niemand gemacht hat — und sie sähe im Kalender genauso aus wie eine
   * echte.
   */
  const out = lines(buildIcs({ tasks: [task()], name: 'x', now: NOW }));
  assert.equal(out.includes('DTSTART:20260908T090000Z'), true);
  assert.equal(
    out.some((l) => l.startsWith('DTEND')),
    false,
  );
});

test('eine Dauer wird ein Block', () => {
  // Der Lohn für das Dauer-Feld: ~90 an einer Aufgabe sind neunzig Minuten im
  // Kalender.
  const out = lines(buildIcs({ tasks: [task({ duration: 90 })], name: 'x', now: NOW }));
  assert.equal(out.includes('DTSTART:20260908T090000Z'), true);
  assert.equal(out.includes('DTEND:20260908T103000Z'), true);
});

test('ein Ganztagstermin endet am FOLGETAG', () => {
  /*
   * DTEND ist ausschließend (RFC 5545 §3.8.2.2). Mit demselben Tag zeigen
   * manche Programme einen Termin ohne Dauer und andere gar keinen — der
   * Fehler ist unsichtbar, bis jemand ein anderes Programm benutzt.
   */
  const out = lines(
    buildIcs({
      tasks: [task({ planned: new Date(Date.UTC(2026, 8, 8)), plannedAllDay: true })],
      name: 'x',
      now: NOW,
    }),
  );
  assert.equal(out.includes('DTSTART;VALUE=DATE:20260908'), true);
  assert.equal(out.includes('DTEND;VALUE=DATE:20260909'), true);
});

test('Termin und Frist sind zwei Einträge mit eigenen UIDs', () => {
  /*
   * Zwei verschiedene Aussagen über denselben Vorgang: „dann mache ich das"
   * und „dann muss es fertig sein". Ein Eintrag von einem bis zum anderen wäre
   * ein Termin über drei Tage für etwas, das eine halbe Stunde dauert.
   */
  const out = lines(
    buildIcs({
      tasks: [task({ due: new Date(Date.UTC(2026, 8, 11, 12, 0)) })],
      name: 'x',
      now: NOW,
    }),
  );
  assert.equal(out.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.equal(out.includes('UID:11111111-1111-4111-8111-111111111111-plan@sote'), true);
  assert.equal(out.includes('UID:11111111-1111-4111-8111-111111111111-due@sote'), true);
  // Unterscheidbar, sonst sieht dieselbe Aufgabe an zwei Tagen wie ein
  // Doppeleintrag aus — also wie ein Fehler.
  assert.equal(out.includes('SUMMARY:Frist: Heizung entlüften'), true);
});

test('die Dauer gilt für das Tun und nicht für die Frist', () => {
  // Ein Block von neunzig Minuten am Fälligkeitstag wäre eine Angabe, die
  // niemand gemacht hat.
  const out = lines(
    buildIcs({
      tasks: [task({ due: new Date(Date.UTC(2026, 8, 11, 12, 0)), duration: 90 })],
      name: 'x',
      now: NOW,
    }),
  );
  assert.equal(out.filter((l) => l.startsWith('DTEND')).length, 1);
});

test('eine Aufgabe ohne Datum kommt nicht vor', () => {
  const out = buildIcs({
    tasks: [task({ planned: null, due: null })],
    name: 'x',
    now: NOW,
  });
  assert.equal(out.includes('BEGIN:VEVENT'), false);
});

test('Sonderzeichen werden in der richtigen REIHENFOLGE geschützt', () => {
  /*
   * Der Rückstrich zuerst. Sonst verdoppelt der letzte Schritt die
   * Rückstriche, die die anderen gerade eingefügt haben: aus `a;b` würde
   * `a\\;b`, und das liest ein Kalender als Rückstrich gefolgt von einem
   * Trenner — also als zwei Werte.
   */
  const out = lines(
    buildIcs({ tasks: [task({ title: 'a;b,c\\d' })], name: 'x', now: NOW }),
  );
  assert.equal(out.includes('SUMMARY:a\\;b\\,c\\\\d'), true);
});

test('eine Zeilenschaltung in der Notiz wird nicht zur Zeilenschaltung im Dokument', () => {
  // Sonst endet der Wert dort, und der Rest der Notiz ist eine Zeile, die kein
  // Kalender versteht — im besten Fall wird die Datei abgelehnt.
  const out = buildIcs({
    tasks: [task({ note: 'erste\nzweite' })],
    name: 'x',
    now: NOW,
  });
  assert.equal(out.includes('erste\\nzweite'), true);
  assert.equal(out.includes('erste\r\nzweite'), false);
});

test('lange Zeilen werden gefaltet, und zwar nach OKTETTEN', () => {
  /*
   * Ein Umlaut ist in UTF-8 zwei Oktette. Nach Zeichen gezählt bekäme ein
   * Titel aus 75 Umlauten eine Zeile von 150 Oktetten — und die schneiden
   * manche Programme ab, andere lehnen die Datei ab.
   */
  const lang = 'ä'.repeat(80);
  const out = lines(buildIcs({ tasks: [task({ title: lang })], name: 'x', now: NOW }));
  for (const l of out) {
    assert.ok(
      new TextEncoder().encode(l).length <= 75,
      `zu lang (${new TextEncoder().encode(l).length} Oktette): ${l.slice(0, 20)}…`,
    );
  }
  // Und die Fortsetzung trägt ein Leerzeichen, das nicht zum Wert gehört.
  assert.ok(out.some((l) => l.startsWith(' ')));
});

test('die Faltung zerschneidet keinen Umlaut', () => {
  /*
   * Der Fehler, den ein Test nach Länge allein nicht findet: fällt die Grenze
   * mitten in eine Mehrbyte-Folge, steht im Dokument ein halbes Zeichen. Das
   * Zusammensetzen der Zeilen muss den Titel wieder ergeben.
   */
  const lang = `Aufgabe mit Umlauten ${'öä'.repeat(40)}`;
  const out = buildIcs({ tasks: [task({ title: lang })], name: 'x', now: NOW });
  // Falten rückgängig machen, wie ein Kalender es tut: CRLF plus ein
  // Leerzeichen verschwindet.
  const entfaltet = out.replace(/\r\n /g, '');
  assert.ok(entfaltet.includes(`SUMMARY:${lang}`));
  assert.equal(entfaltet.includes('\uFFFD'), false);
});

test('der Link zurück steht drin, wenn es eine Basis gibt', () => {
  // Ein Kalendereintrag, von dem man nicht zur Aufgabe kommt, ist eine
  // Sackgasse: man liest ihn und sucht dann von Hand in der Anwendung.
  const out = lines(
    buildIcs({ tasks: [task()], name: 'x', base: 'https://sote.example', now: NOW }),
  );
  assert.equal(
    out.includes('URL:https://sote.example/a/11111111-1111-4111-8111-111111111111'),
    true,
  );
});

test('ohne Basis keine erfundene Adresse', () => {
  const out = buildIcs({ tasks: [task()], name: 'x', now: NOW });
  assert.equal(out.includes('URL:'), false);
  assert.equal(out.includes('undefined'), false);
});

test('derselbe Stand ergibt dasselbe Dokument', () => {
  /*
   * `now` ist ein Parameter und nicht `new Date()` im Rumpf. Sonst wäre jedes
   * Abholen ein anderes Dokument, und kein Kalender könnte erkennen, dass sich
   * nichts geändert hat.
   */
  const a = buildIcs({ tasks: [task()], name: 'x', now: NOW });
  const b = buildIcs({ tasks: [task()], name: 'x', now: NOW });
  assert.equal(a, b);
});
