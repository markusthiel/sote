/**
 * SOTE — Ansichten, Verschieben, Feldänderung.
 *
 * Das Verschieben ist hier das Wichtigste. Der Fractional Index ist aus SONE
 * übernommen und dort seit ADR-0002 im Einsatz — aber **in diesem Produkt hat
 * ihn bis zu diesen Tests nichts ausgeübt**, und ein Mechanismus, den nichts
 * ausübt, ist ein Mechanismus, dessen Verhalten eine Vermutung ist
 * (`claude/durchgang-nie-gelaufen.md`).
 *
 * Also wird nicht die Schlüsselrechnung geprüft — das tut
 * `fractionalIndex.test.ts` —, sondern die Kette: zwei Nachbarn als Ids, ein
 * Schlüssel dazwischen, die Datenbank sortiert danach, und zwei gleichzeitige
 * Einfügungen in dieselbe Lücke überleben beide.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { makeList } from './support/tree.js';
import { migrate } from '../src/migrate.js';
import {
  complete,
  createFromLine,
  move,
  NotFound,
  OutOfOrder,
  patch,
} from '../src/tasks.js';
import { boundsOf, counts, list, splitOverdue } from '../src/views.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0)); // Montag

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`views-${process.pid}@example.org`, 'Markus'],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(name: string) {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor')
     RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [w!.id, userId, r!.id],
  );
  // Ordner mit gleichnamigem Projekt darin — die Form, die Migration 0009
  // aus einem alten Projekt macht (Konzept 10d).
  const projectId = await makeList(pool, w!.id, 'Haus');
  return { workspaceId: w!.id, projectId };
}

const add = (workspaceId: string, line: string) =>
  createFromLine(pool, { workspaceId, userId, line, now: NOW });

/* ── Was eine Ansicht bedeutet ─────────────────────────────────────────── */

test('die vier Ansichten teilen dieselben Aufgaben ohne Überschneidung auf', async () => {
  const { workspaceId } = await scratch('v-split');
  // Titelwörter, die kein Datum sind: „heute fällig heute" hätte beide
  // Vorkommen als Zeitangabe gelesen und einen leeren Titel hinterlassen —
  // richtig so, aber als Testdatum unbrauchbar.
  await add(workspaceId, 'Bericht fällig heute');
  await add(workspaceId, 'Angebot in 3 Tagen');
  await add(workspaceId, 'Archiv sortieren');
  await add(workspaceId, 'Filter reinigen 3 Tage nach dem Abhaken');

  const today = await list(pool, 'today', workspaceId, NOW);
  const upcoming = await list(pool, 'upcoming', workspaceId, NOW);
  const someday = await list(pool, 'someday', workspaceId, NOW);
  const inbox = await list(pool, 'inbox', workspaceId, NOW);

  assert.deepEqual(today.map((t) => t.title), ['Bericht']);
  assert.deepEqual(upcoming.map((t) => t.title), ['Angebot']);
  /*
   * Irgendwann ist LEER, obwohl zwei Aufgaben ohne Zeit angelegt wurden.
   *
   * Der Test hieß früher „die vier Ansichten teilen dieselben Aufgaben ohne
   * Überschneidung auf", und die Annahme stimmt seit dem Posteingang nicht
   * mehr — ich habe sie geändert, also gehört sie hier richtiggestellt und
   * nicht umgebogen. Irgendwann heißt jetzt „ohne Zeit UND einsortiert"; was
   * noch keinen Ort hat, steht im Posteingang.
   */
  assert.deepEqual(someday.map((t) => t.title), []);

  // Die drei ZEIT-Ansichten teilen weiter ohne Überschneidung auf.
  const zeit = [...today, ...upcoming, ...someday].map((t) => t.id);
  assert.equal(new Set(zeit).size, zeit.length, 'eine Aufgabe liegt in zwei Zeit-Ansichten');

  /*
   * Der Posteingang schneidet quer, und das ist Absicht: er ist eine Frage an
   * den Menschen („wohin gehört das?") und keine Ansicht über die Zeit. Wer
   * „Zahnarzt anrufen morgen" tippt, hat einen Zeitpunkt gesagt und keinen
   * Ort — die Aufgabe steht dann in Demnächst UND im Posteingang.
   */
  assert.equal(inbox.length, 4, 'alle vier sind ortlos angelegt');
});

test('eine erledigungsbezogene Wiederholung liegt vor dem ersten Abhaken im Posteingang', async () => {
  // Der offene Punkt aus dem Konzept, hier als Verhalten festgehalten: sie ist
  // nicht unsichtbar, sondern ungeplant. Sonst könnte niemand sie abhaken, und
  // ohne Abhaken entsteht kein Termin.
  const { workspaceId } = await scratch('v-after');
  await add(workspaceId, 'Filter reinigen 3 Monate nach dem Abhaken');
  // Ortlos angelegt, also im Posteingang. Der Punkt bleibt derselbe: sie ist
  // nicht unsichtbar, sondern ungeplant — und findbar.
  const found = await list(pool, 'inbox', workspaceId, NOW);
  assert.deepEqual(found.map((t) => t.title), ['Filter reinigen']);
});

test('die Zähler stimmen mit den Listen überein', async () => {
  const { workspaceId } = await scratch('v-counts');
  await add(workspaceId, 'a heute');
  await add(workspaceId, 'b in 2 Tagen');
  await add(workspaceId, 'c in 5 Tagen');
  await add(workspaceId, 'd');
  const late = await add(workspaceId, 'e');
  await pool.query('UPDATE tasks SET planned_at = $2 WHERE id = $1', [
    late.task.id,
    new Date(Date.UTC(2026, 8, 4)),
  ]);

  const n = await counts(pool, workspaceId, NOW);
  assert.equal(n.today, (await list(pool, 'today', workspaceId, NOW)).length);
  assert.equal(n.upcoming, (await list(pool, 'upcoming', workspaceId, NOW)).length);
  assert.equal(n.someday, (await list(pool, 'someday', workspaceId, NOW)).length);
  assert.equal(n.overdue, 1);
});

test('ein Projekt zeigt Erledigtes, wenn man danach fragt — und dann unten', async () => {
  /*
   * Der Test hieß „ein Projekt zeigt AUCH Erledigtes, aber unten", und das war
   * die Vorgabe der Ansicht. Gemeldet wurde die Ungleichheit: nur das Projekt
   * konnte es, und es konnte es immer. Jetzt ist es überall eine Wahl — also
   * fragt dieser Test danach, statt es vorauszusetzen.
   */
  const { workspaceId, projectId } = await scratch('v-project');
  const one = await add(workspaceId, 'offen #haus');
  const two = await add(workspaceId, 'erledigt #haus');
  await complete(pool, two.task.id, userId, NOW);

  const rows = await list(pool, 'project', workspaceId, NOW, projectId, undefined, true);
  assert.deepEqual(rows.map((t) => t.title), ['offen', 'erledigt']);
  assert.equal(rows[0]!.id, one.task.id);
  assert.notEqual(rows[1]!.completed_at, null);
});

test('boundsOf trennt den Tag bei Mitternacht und nicht bei jetzt', async () => {
  const b = boundsOf(new Date(Date.UTC(2026, 8, 7, 23, 30)));
  assert.equal(b.startOfDay.toISOString(), '2026-09-07T00:00:00.000Z');
  assert.equal(b.endOfDay.toISOString(), '2026-09-07T23:59:59.999Z');
});

/* ── Verschieben ───────────────────────────────────────────────────────── */

async function order(workspaceId: string): Promise<string[]> {
  const rows = await queryRows<{ title: string }>(
    pool,
    `SELECT title FROM tasks WHERE workspace_id = $1 AND trashed_at IS NULL
      ORDER BY sort_key`,
    [workspaceId],
  );
  return rows.map((r) => r.title);
}

test('neue Aufgaben landen am Ende', async () => {
  const { workspaceId } = await scratch('m-append');
  for (const t of ['a', 'b', 'c']) await add(workspaceId, t);
  assert.deepEqual(await order(workspaceId), ['a', 'b', 'c']);
});

test('eine Zeile zwischen zwei andere schieben', async () => {
  const { workspaceId } = await scratch('m-between');
  const a = await add(workspaceId, 'a');
  const b = await add(workspaceId, 'b');
  const c = await add(workspaceId, 'c');

  // c zwischen a und b
  await move(pool, c.task.id, workspaceId, {
    afterId: a.task.id,
    beforeId: b.task.id,
  });
  assert.deepEqual(await order(workspaceId), ['a', 'c', 'b']);
});

test('nach ganz vorn und nach ganz hinten', async () => {
  const { workspaceId } = await scratch('m-ends');
  const a = await add(workspaceId, 'a');
  const b = await add(workspaceId, 'b');
  const c = await add(workspaceId, 'c');

  await move(pool, c.task.id, workspaceId, { afterId: null, beforeId: a.task.id });
  assert.deepEqual(await order(workspaceId), ['c', 'a', 'b']);

  await move(pool, c.task.id, workspaceId, { afterId: b.task.id, beforeId: null });
  assert.deepEqual(await order(workspaceId), ['a', 'b', 'c']);
});

test('zwei gleichzeitige Einfügungen in dieselbe Lücke überleben beide', async () => {
  // Das ist der Grund für den Fractional Index. Mit ganzzahligen Positionen
  // hätte hier eine der beiden Zeilen die andere verdrängt.
  const { workspaceId } = await scratch('m-race');
  const a = await add(workspaceId, 'a');
  const b = await add(workspaceId, 'b');
  const x = await add(workspaceId, 'x');
  const y = await add(workspaceId, 'y');

  await Promise.all([
    move(pool, x.task.id, workspaceId, { afterId: a.task.id, beforeId: b.task.id }),
    move(pool, y.task.id, workspaceId, { afterId: a.task.id, beforeId: b.task.id }),
  ]);

  const result = await order(workspaceId);
  assert.equal(result.length, 4, 'keine Zeile ist verschwunden');
  assert.equal(result[0], 'a');
  assert.equal(result[3], 'b');
  assert.deepEqual([...result.slice(1, 3)].sort(), ['x', 'y']);

  const keys = await queryRows<{ sort_key: string }>(
    pool,
    'SELECT sort_key FROM tasks WHERE workspace_id = $1 ORDER BY sort_key',
    [workspaceId],
  );
  assert.equal(
    new Set(keys.map((k) => k.sort_key)).size,
    4,
    'zwei Zeilen tragen denselben Schlüssel',
  );
});

test('vertauschte Nachbarn werden abgelehnt statt tief drin zu werfen', async () => {
  const { workspaceId } = await scratch('m-wrong');
  const a = await add(workspaceId, 'a');
  const b = await add(workspaceId, 'b');
  const c = await add(workspaceId, 'c');
  await assert.rejects(
    () => move(pool, c.task.id, workspaceId, { afterId: b.task.id, beforeId: a.task.id }),
    (e: unknown) => e instanceof OutOfOrder && /veraltet/.test((e as Error).message),
  );
});

test('ein Nachbar aus einem fremden Arbeitsbereich ist kein Nachbar', async () => {
  const mine = await scratch('m-mine');
  const other = await scratch('m-other');
  const a = await add(mine.workspaceId, 'a');
  const fremd = await add(other.workspaceId, 'fremd');
  await assert.rejects(
    () =>
      move(pool, a.task.id, mine.workspaceId, {
        afterId: fremd.task.id,
        beforeId: null,
      }),
    NotFound,
  );
});

/* ── Feldänderung: nur was genannt ist ─────────────────────────────────── */

test('patch ändert genau die genannten Felder', async () => {
  const { workspaceId } = await scratch('p-fields');
  const t = await add(workspaceId, 'Bericht morgen 9 Uhr !!');
  const before = t.task;

  const out = await patch(pool, before.id, workspaceId, { priority: 1 });
  assert.equal(out.priority, 1);
  // Alles andere unangetastet — das ist der eigentliche Test.
  assert.equal(out.title, before.title);
  assert.equal(out.planned_at?.toISOString(), before.planned_at?.toISOString());
  assert.equal(out.planned_all_day, before.planned_all_day);
  assert.equal(out.due_at, before.due_at);
});

test('null leert ein Feld, ein fehlender Schlüssel nicht', async () => {
  const { workspaceId } = await scratch('p-null');
  const t = await add(workspaceId, 'Bericht morgen bis übermorgen');
  assert.notEqual(t.task.planned_at, null);
  assert.notEqual(t.task.due_at, null);

  const cleared = await patch(pool, t.task.id, workspaceId, { plannedAt: null });
  assert.equal(cleared.planned_at, null);
  assert.notEqual(cleared.due_at, null, 'die Frist war nicht genannt');
});

test('ein leerer Titel und eine fünfte Priorität werden abgelehnt', async () => {
  const { workspaceId } = await scratch('p-refuse');
  const t = await add(workspaceId, 'Bericht');
  await assert.rejects(
    () => patch(pool, t.task.id, workspaceId, { title: '   ' }),
    OutOfOrder,
  );
  await assert.rejects(
    () => patch(pool, t.task.id, workspaceId, { priority: 5 }),
    OutOfOrder,
  );
  await assert.rejects(() => patch(pool, t.task.id, workspaceId, {}), OutOfOrder);
});

test('eine Aufgabe aus einem fremden Arbeitsbereich lässt sich nicht ändern', async () => {
  const mine = await scratch('p-mine');
  const other = await scratch('p-other');
  const fremd = await add(other.workspaceId, 'fremd');
  await assert.rejects(
    () => patch(pool, fremd.task.id, mine.workspaceId, { priority: 1 }),
    NotFound,
  );
});

test('das Datum zu setzen bewegt die Aufgabe zwischen den Ansichten', async () => {
  const { workspaceId, projectId } = await scratch('p-move-view');
  // MIT Ort, damit die Aufgabe wirklich in Irgendwann liegt und nicht im
  // Posteingang: der Test soll den Weg zwischen den ZEIT-Ansichten zeigen.
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'ungeplant',
    now: NOW,
    projectId,
  });
  assert.deepEqual(
    (await list(pool, 'someday', workspaceId, NOW)).map((x) => x.title),
    ['ungeplant'],
  );

  await patch(pool, t.task.id, workspaceId, {
    plannedAt: new Date(Date.UTC(2026, 8, 7, 15, 0)),
    plannedAllDay: false,
  });
  assert.deepEqual(
    (await list(pool, 'today', workspaceId, NOW)).map((x) => x.title),
    ['ungeplant'],
  );
  assert.equal((await list(pool, 'someday', workspaceId, NOW)).length, 0);
});

test('ein Projekt nimmt nach einem weggeworfenen Eintrag weiter Aufgaben an', async () => {
  // Der Fehler, den trash.db.test.ts gefunden hat, hier als eigener Wächter:
  // keyAtEnd filterte weggeworfene Zeilen, der Unique-Index kennt keinen
  // Papierkorb. Die Lehre ist allgemeiner als der Fall — eine Abfrage, die
  // einen Schlüssel für einen Index rechnet, muss denselben Umfang haben wie
  // der Index.
  const { workspaceId } = await scratch('m-after-trash');
  const first = await add(workspaceId, 'eins');
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [first.task.id]);
  const second = await add(workspaceId, 'zwei');
  assert.notEqual(second.task.sort_key, first.task.sort_key);
  const third = await add(workspaceId, 'drei');
  assert.ok(third.task.sort_key > second.task.sort_key);
});

/* ── Die Zeitzone ────────────────────────────────────────────────────────── */

test('der Tag ist der der Person, nicht der von UTC', () => {
  // Gemeldet: „morgen 9 Uhr" wurde 11 Uhr. Der zweite Teil desselben Fehlers
  // ist stiller: um 00:30 in Berlin ist es in UTC noch gestern, und eine
  // Ansicht „Heute", die in UTC rechnet, zeigt dann den falschen Tag.
  const at = new Date('2026-09-08T22:30:00Z'); // 00:30 am 9. in Berlin
  const utc = boundsOf(at);
  const berlin = boundsOf(at, 'Europe/Berlin');
  assert.equal(utc.startOfDay.toISOString(), '2026-09-08T00:00:00.000Z');
  assert.equal(berlin.startOfDay.toISOString(), '2026-09-08T22:00:00.000Z');
  assert.notEqual(utc.startOfDay.getTime(), berlin.startOfDay.getTime());
});

test('ohne Zone bleibt es UTC — ein alter Aufrufer merkt nichts', () => {
  const at = new Date('2026-09-07T23:30:00Z');
  assert.deepEqual(boundsOf(at), boundsOf(at, 'UTC'));
});

test('an den Umstellungstagen ist der Tag nicht 24 Stunden lang', () => {
  // Deshalb werden Anfang und Ende getrennt gerechnet und nicht eines aus dem
  // anderen: 23 Stunden im Frühjahr, 25 im Herbst.
  const h = 3_600_000;
  const spring = boundsOf(new Date('2026-03-29T10:00:00Z'), 'Europe/Berlin');
  const autumn = boundsOf(new Date('2026-10-25T10:00:00Z'), 'Europe/Berlin');
  assert.equal(Math.round((spring.endOfDay.getTime() - spring.startOfDay.getTime()) / h), 23);
  assert.equal(Math.round((autumn.endOfDay.getTime() - autumn.startOfDay.getTime()) / h), 25);
});

/* ── Der Posteingang ─────────────────────────────────────────────────────── */

test('der Posteingang zeigt, was noch keinen Ort hat', async () => {
  const { workspaceId, projectId } = await scratch('v-inbox');
  await add(workspaceId, 'ohne Ort und ohne Zeit');
  // „morgen" wird als Datum gelesen und aus dem Titel genommen — richtig so,
  // aber als Testdatum unbrauchbar (dieselbe Falle wie oben bei „heute").
  await add(workspaceId, 'ohne Ort, aber datiert morgen');
  const mit = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'mit Ort',
    now: NOW,
    projectId,
  });
  assert.equal(mit.task.project_id, projectId);

  const inbox = (await list(pool, 'inbox', workspaceId, NOW)).map((t) => t.title);
  assert.deepEqual(inbox.sort(), ['ohne Ort und ohne Zeit', 'ohne Ort, aber datiert']);
});

test('ein Datum schließt aus dem Posteingang nicht aus', async () => {
  // Wer „Zahnarzt anrufen morgen" tippt, hat einen Zeitpunkt gesagt und keinen
  // Ort. Die Aufgabe steht dann in Demnächst UND hier, und das ist richtig:
  // sie ist erfasst und nicht eingeordnet. Der Posteingang ist eine Frage an
  // den Menschen, keine Ansicht über die Zeit.
  const { workspaceId } = await scratch('v-inbox-dated');
  await add(workspaceId, 'Zahnarzt anrufen morgen');
  assert.deepEqual((await list(pool, 'inbox', workspaceId, NOW)).map((t) => t.title), ['Zahnarzt anrufen']);
  assert.deepEqual((await list(pool, 'upcoming', workspaceId, NOW)).map((t) => t.title), ['Zahnarzt anrufen']);
});

test('Irgendwann heißt ohne Zeit, nicht ohne Ort', async () => {
  // Vorher lag alles Ortlose auch in Irgendwann. Eine Aufgabe an zwei Orten,
  // von denen einer „ungeplant" und der andere „unerfasst" heißt, lässt
  // niemanden wissen, welchen er abarbeiten soll.
  const { workspaceId, projectId } = await scratch('v-someday-place');
  await add(workspaceId, 'ohne Ort und ohne Zeit');
  await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'mit Ort, ohne Zeit',
    now: NOW,
    projectId,
  });
  assert.deepEqual((await list(pool, 'someday', workspaceId, NOW)).map((t) => t.title), ['mit Ort, ohne Zeit']);
  assert.deepEqual((await list(pool, 'inbox', workspaceId, NOW)).map((t) => t.title), ['ohne Ort und ohne Zeit']);
});

test('die Zahl am Posteingang stimmt mit seiner Liste überein', async () => {
  // Die Stelle, an der es auseinanderlaufen kann: `counts` und `whereFor`
  // schreiben dieselben Bedingungen zweimal. Eine Zahl, die anders zählt als
  // die Liste, ist schlimmer als keine Zahl.
  const { workspaceId, projectId } = await scratch('v-inbox-count');
  await add(workspaceId, 'eins');
  await add(workspaceId, 'zwei morgen');
  await createFromLine(pool, { workspaceId, userId, line: 'drei', now: NOW, projectId });

  const n = await counts(pool, workspaceId, NOW);
  assert.equal(n.inbox, (await list(pool, 'inbox', workspaceId, NOW)).length);
  assert.equal(n.someday, (await list(pool, 'someday', workspaceId, NOW)).length);
  assert.equal(n.inbox, 2);
});

test('eine Teilaufgabe steht nicht im Posteingang', async () => {
  // Sie erbt Projekt und Arbeitsbereich vom Elternteil (Konzept 8) — und wenn
  // der Elternteil ortlos ist, ist SIE nicht das, was jemand einsortieren
  // muss. Der Posteingang zeigt darum nur oberste Zeilen.
  const { workspaceId } = await scratch('v-inbox-child');
  const parent = await add(workspaceId, 'Elternteil');
  await pool.query(
    `INSERT INTO tasks (workspace_id, parent_id, title, sort_key) VALUES ($1,$2,'Teil','a0')`,
    [workspaceId, parent.task.id],
  );
  assert.deepEqual((await list(pool, 'inbox', workspaceId, NOW)).map((t) => t.title), ['Elternteil']);
});

/* ── Erledigtes einblenden ───────────────────────────────────────────────── */

test('Erledigtes bleibt draußen, solange niemand danach fragt', async () => {
  const { workspaceId, projectId } = await scratch('v-done-off');
  const t = await createFromLine(pool, {
    workspaceId, userId, line: 'Bericht fällig heute', now: NOW, projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  for (const view of ['today', 'upcoming', 'someday', 'inbox'] as const) {
    assert.equal((await list(pool, view, workspaceId, NOW)).length, 0, view);
  }
  assert.equal((await list(pool, 'project', workspaceId, NOW, projectId)).length, 0);
});

test('mit Erledigtem steht es in jeder Ansicht — und zwar unten', async () => {
  // Gemeldet: „es sollte überall die möglichkeit geben abgehakte
  // einzublenden." Vorher konnte das nur die Projektansicht, und die konnte es
  // immer.
  const { workspaceId, projectId } = await scratch('v-done-on');
  const offen = await createFromLine(pool, {
    workspaceId, userId, line: 'Kabel messen heute', now: NOW, projectId,
  });
  const zu = await createFromLine(pool, {
    workspaceId, userId, line: 'Dosen setzen heute', now: NOW, projectId,
  });
  await complete(pool, zu.task.id, userId, NOW);

  const rows = await list(pool, 'today', workspaceId, NOW, null, undefined, true);
  assert.deepEqual(rows.map((r) => r.title), ['Kabel messen', 'Dosen setzen']);
  assert.equal(rows[0]!.id, offen.task.id, 'das Offene steht oben');
  assert.notEqual(rows[1]!.completed_at, null, 'das Erledigte steht unten');
});

test('Erledigtes ist nie überfällig', async () => {
  /*
   * „Überfällig" ist eine Aufforderung. Sie an etwas zu richten, das schon
   * getan ist, macht den Abschnitt unbrauchbar — und zwar für den, der ihn am
   * meisten braucht.
   */
  const { workspaceId, projectId } = await scratch('v-done-overdue');
  const alt = await createFromLine(pool, {
    workspaceId, userId, line: 'Angebot', now: NOW, projectId,
  });
  // Das Datum wird gesetzt und nicht getippt: „gestern" liest die
  // Schnellerfassung nicht als Zeitangabe, also wäre die Aufgabe ohne Datum
  // entstanden und gar nicht in Heute gelandet. Mein erster Versuch tat genau
  // das und meldete eine leere Liste.
  await pool.query(
    "UPDATE tasks SET planned_at = $2, planned_all_day = true WHERE id = $1",
    [alt.task.id, new Date(NOW.getTime() - 36 * 3600 * 1000)],
  );
  await complete(pool, alt.task.id, userId, NOW);
  const rows = await list(pool, 'today', workspaceId, NOW, null, undefined, true);
  const split = splitOverdue(rows, NOW);
  assert.equal(split.overdue.length, 0, 'Erledigtes gehört nicht in „überfällig"');
  assert.equal(split.rest.length, 1);
});

test('einblenden holt nichts aus dem Papierkorb', async () => {
  // „Einblenden" heißt erledigt, nicht weggeworfen. Beide Fassungen der
  // Bedingung schließen den Korb aus.
  const { workspaceId, projectId } = await scratch('v-done-trash');
  const t = await createFromLine(pool, {
    workspaceId, userId, line: 'Weg damit heute', now: NOW, projectId,
  });
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [t.task.id]);
  assert.equal((await list(pool, 'today', workspaceId, NOW, null, undefined, true)).length, 0);
});

test('die Zähler zählen weiter nur Offenes', async () => {
  // Eine Zahl an der Ansicht sagt „so viel liegt an". Erledigtes mitzuzählen
  // würde sie zu einer Zahl über die Vergangenheit machen, und die Zahl steht
  // neben einer Liste, die man abarbeiten soll.
  const { workspaceId, projectId } = await scratch('v-done-counts');
  const t = await createFromLine(pool, {
    workspaceId, userId, line: 'Bericht fällig heute', now: NOW, projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  assert.equal((await counts(pool, workspaceId, NOW)).today, 0);
});

test('Heute sortiert nach Dringlichkeit, dann von Hand', async () => {
  /*
   * GEMELDET: „Bei der Heute-Ansicht kann man nicht sortieren … ich tendiere
   * dazu, dass man auch dort sortieren kann, da wir ja gesagt haben, dass ich
   * auch heute eine Prio ordnen möchte."
   *
   * Vorher stand die Uhrzeit zwischen Dringlichkeit und Sortierschlüssel.
   * Damit war Ziehen unmöglich: zwei Zeilen mit verschiedenen Zeiten hätte der
   * Schlüssel nie auseinanderhalten können, und jede abgelegte Zeile wäre
   * zurückgesprungen. Ein Ablegen, das nicht hält, ist schlimmer als eines,
   * das gar nicht angeboten wird.
   */
  const { workspaceId } = await scratch('ws-heute-hand');
  // Vom TAGESANFANG aus gerechnet und nicht von NOW: NOW ist 10 Uhr, und
  // „plus 18 Stunden" landete damit am nächsten Tag — die Zeile fiel aus der
  // Ansicht, und der Test meldete eine falsche Reihenfolge statt des Grundes.
  const achtUhr = new Date(Date.UTC(2026, 8, 7, 8));
  const achtzehnUhr = new Date(Date.UTC(2026, 8, 7, 18));

  const spaet = await createFromLine(pool, {
    workspaceId, userId, line: 'Spaet', now: NOW,
  });
  const frueh = await createFromLine(pool, {
    workspaceId, userId, line: 'Frueh', now: NOW,
  });
  await pool.query(
    `UPDATE tasks SET planned_at = $2, planned_all_day = false WHERE id = $1`,
    [spaet.task.id, achtzehnUhr],
  );
  await pool.query(
    `UPDATE tasks SET planned_at = $2, planned_all_day = false WHERE id = $1`,
    [frueh.task.id, achtUhr],
  );

  // Beide gleich dringend: jetzt entscheidet die Hand — und die hat „Spaet"
  // zuerst angelegt, also steht es vorn, obwohl es später am Tag liegt.
  const rows = await list(pool, 'today', workspaceId, NOW);
  const titel = rows.map((r) => r.title);
  assert.deepEqual(titel, ['Spaet', 'Frueh']);

  // Und nach dem Ziehen andersherum.
  await move(pool, frueh.task.id, workspaceId, { afterId: null, beforeId: spaet.task.id });
  assert.deepEqual(
    (await list(pool, 'today', workspaceId, NOW)).map((r) => r.title),
    ['Frueh', 'Spaet'],
  );
});

test('die Dringlichkeit bleibt vor der Hand', async () => {
  // Sie ist die Aussage „das ist wichtiger", und die soll eine Handbewegung
  // nicht beiläufig überschreiben. Wer über die Grenze zieht, ändert sie
  // ausdrücklich — das entscheidet die Oberfläche und schreibt beides.
  const { workspaceId } = await scratch('ws-heute-prio');
  const wichtig = await createFromLine(pool, {
    workspaceId, userId, line: 'Wichtig !!', now: NOW,
  });
  const egal = await createFromLine(pool, { workspaceId, userId, line: 'Egal', now: NOW });
  for (const id of [wichtig.task.id, egal.task.id]) {
    await pool.query('UPDATE tasks SET planned_at = $2 WHERE id = $1', [id, NOW]);
  }

  // Der Titel heisst „Wichtig" und nicht „Wichtig !!": das Ausrufezeichen ist
  // die Dringlichkeit und wandert aus dem Titel in das Feld — das ist der
  // Sinn der Schnellerfassung.
  //
  // `egal` ganz nach vorn ziehen — die Dringlichkeit hält dagegen.
  await move(pool, egal.task.id, workspaceId, { afterId: null });
  assert.deepEqual(
    (await list(pool, 'today', workspaceId, NOW)).map((r) => r.title),
    ['Wichtig', 'Egal'],
  );
});
