/**
 * SOTE — die Kalender-Ausgabe, von einem FREMDEN Parser gelesen.
 *
 * `ics.test.ts` prüft, dass das Dokument so aussieht, wie ich es meine. Das ist
 * die halbe Prüfung: es vergleicht meine Ausgabe mit meiner Vorstellung davon,
 * und wenn die Vorstellung falsch ist, sind beide einig und beide falsch.
 * Genau der Fehler, gegen den ADR-0131 warnt — „two lists agreeing with each
 * other is not a check".
 *
 * Hier liest `ical.js` (die Bibliothek hinter Thunderbirds Kalender), und
 * geprüft wird, was ANKOMMT. Ein Escaping in der falschen Reihenfolge, eine
 * Faltung mitten in einem Umlaut, ein ausschließendes Enddatum zu früh: das
 * sieht man in meiner eigenen Zeichenkette nicht, aber ein Parser stolpert
 * darüber — so wie das Kalenderprogramm, das Markus benutzt.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import ICAL from 'ical.js';

import { buildIcs, type IcsTask } from '../src/task/ics.js';

const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

function task(over: Partial<IcsTask> = {}): IcsTask {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    title: 'Heizung entlüften',
    planned: new Date(Date.UTC(2026, 8, 8, 9, 0)),
    plannedAllDay: false,
    due: null,
    dueAllDay: false,
    duration: null,
    note: null,
    projectName: null,
    updatedAt: new Date(Date.UTC(2026, 8, 7, 8, 0)),
    ...over,
  };
}

/** Einmal hin und zurück: bauen, fremd lesen, Einträge herausgeben. */
function gelesen(tasks: readonly IcsTask[], base?: string) {
  const text = buildIcs({ tasks, name: 'SOTE — Haus', now: NOW, ...(base ? { base } : {}) });
  // `ICAL.parse` wirft bei jedem Formatfehler — das allein ist schon ein Test.
  const comp = new ICAL.Component(ICAL.parse(text));
  return {
    comp,
    events: comp.getAllSubcomponents('vevent').map((e) => new ICAL.Event(e)),
    raw: comp.getAllSubcomponents('vevent'),
  };
}

test('ein fremder Parser nimmt das Dokument an', () => {
  const { comp } = gelesen([task()]);
  assert.equal(comp.name, 'vcalendar');
  assert.equal(comp.getFirstPropertyValue('version'), '2.0');
  assert.equal(comp.getFirstPropertyValue('x-wr-calname'), 'SOTE — Haus');
});

test('die geschützten Zeichen kommen UNVERSEHRT an', () => {
  /*
   * Der Test, den meine eigene Zeichenkette nicht leisten kann: ob
   * `a\\;b\\,c\\\\d` richtig ist, weiß ich nur, wenn jemand anders daraus
   * wieder `a;b,c\d` macht. Bei falscher Reihenfolge im Escaping liest ein
   * Parser hier zwei Werte statt einem.
   */
  const titel = 'Heizung; entlüften, ganz\\gut';
  const { events } = gelesen([task({ title: titel })]);
  assert.equal(events[0]?.summary, titel);
});

test('eine Notiz mit Zeilenschaltung kommt mit Zeilenschaltung an', () => {
  const { raw } = gelesen([task({ note: 'erste Zeile\nzweite Zeile' })]);
  const desc = String(raw[0]?.getFirstPropertyValue('description'));
  assert.ok(desc.includes('erste Zeile\nzweite Zeile'));
});

test('neunzig Umlaute überleben die Faltung', () => {
  /*
   * 180 Oktette, also mindestens zwei Faltungen — und jede davon könnte mitten
   * in eine Zwei-Oktett-Folge fallen. Dann stünde im Dokument ein halbes
   * Zeichen, und hier käme ein Ersatzzeichen an.
   */
  const titel = 'Ä'.repeat(90);
  const { events } = gelesen([task({ title: titel })]);
  assert.equal(events[0]?.summary, titel);
  assert.equal(events[0]?.summary.includes('\uFFFD'), false);
});

test('eine Dauer kommt als Dauer an', () => {
  const { events } = gelesen([task({ duration: 90 })]);
  const ev = events[0]!;
  const min = (ev.endDate.toJSDate().getTime() - ev.startDate.toJSDate().getTime()) / 60_000;
  assert.equal(min, 90);
});

test('ein Ganztagstermin dauert EINEN Tag, nicht null und nicht zwei', () => {
  /*
   * Die Probe auf das ausschließende DTEND. Mit demselben Tag käme hier 0 an,
   * mit zwei Tagen 2880 Minuten — und beides sieht im Kalender falsch aus,
   * ohne dass am Dokument etwas offensichtlich fehlt.
   */
  const { events } = gelesen([
    task({ planned: new Date(Date.UTC(2026, 8, 9)), plannedAllDay: true }),
  ]);
  const ev = events[0]!;
  const min = (ev.endDate.toJSDate().getTime() - ev.startDate.toJSDate().getTime()) / 60_000;
  assert.equal(min, 1440);
  assert.equal(ev.startDate.isDate, true);
});

test('Termin und Frist kommen als zwei Einträge an, mit verschiedenen UIDs', () => {
  const { events } = gelesen([task({ due: new Date(Date.UTC(2026, 8, 30, 12, 0)) })]);
  assert.equal(events.length, 2);
  assert.notEqual(events[0]?.uid, events[1]?.uid);
  // Verschiedene UIDs sind der Grund, warum kein Kalender sie zusammenlegt.
  assert.equal(new Set(events.map((e) => e.uid)).size, 2);
});

test('der Link zurück kommt als Adresse an und nicht als Text', () => {
  const { raw } = gelesen([task()], 'https://sote.example');
  assert.equal(
    raw[0]?.getFirstPropertyValue('url'),
    'https://sote.example/a/aaaaaaaa-1111-4111-8111-111111111111',
  );
});

test('ein ganzer Tagesstapel bleibt lesbar', () => {
  // Nicht ein Eintrag in einem sauberen Dokument, sondern zwanzig mit allem
  // gemischt: Ganztags, Zeitpunkte, Fristen, Umlaute, Sonderzeichen.
  const viele: IcsTask[] = [];
  for (let i = 0; i < 20; i += 1) {
    viele.push(
      task({
        id: `cccccccc-${String(i).padStart(4, '0')}-4111-8111-111111111111`,
        title: `Aufgabe ${i}; mit „Anführung“, ä\\ö`,
        planned: i % 2 === 0 ? new Date(Date.UTC(2026, 8, 8 + (i % 5), 9, 0)) : null,
        plannedAllDay: i % 4 === 0,
        due: i % 3 === 0 ? new Date(Date.UTC(2026, 8, 20, 12, 0)) : null,
        duration: i % 5 === 0 ? 45 : null,
        note: i % 6 === 0 ? 'eine Notiz\nmit zwei Zeilen' : null,
        projectName: i % 7 === 0 ? 'Haus & Garten' : null,
      }),
    );
  }
  const { events } = gelesen(viele, 'https://sote.example');
  /*
   * Die erwartete Zahl wird GERECHNET und nicht geschätzt. Mein erster Wurf
   * stand hier als `> 20` — falsch, weil ein Teil der zwanzig weder Termin
   * noch Frist hat und darum gar keinen Eintrag ergibt. Eine Schätzung als
   * Erwartung ist eine Prüfung gegen meine Annahme statt gegen die Regel:
   * ein Eintrag je Zeitpunkt.
   */
  const erwartet =
    viele.filter((t) => t.planned !== null).length + viele.filter((t) => t.due !== null).length;
  assert.equal(events.length, erwartet);
  for (const ev of events) {
    assert.ok(ev.summary.length > 0);
    assert.equal(ev.summary.includes('\uFFFD'), false);
    assert.ok(ev.startDate !== null);
  }
});
