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
import { migrate } from '../src/migrate.js';
import {
  complete,
  createFromLine,
  move,
  NotFound,
  OutOfOrder,
  patch,
} from '../src/tasks.js';
import { boundsOf, counts, list } from '../src/views.js';

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
  const p = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Haus','a0')
     RETURNING id`,
    [w!.id],
  );
  return { workspaceId: w!.id, projectId: p!.id };
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

  assert.deepEqual(today.map((t) => t.title), ['Bericht']);
  assert.deepEqual(upcoming.map((t) => t.title), ['Angebot']);
  assert.deepEqual(
    someday.map((t) => t.title).sort(),
    ['Archiv sortieren', 'Filter reinigen'],
  );

  // Keine Aufgabe in zwei Ansichten, keine in keiner.
  const ids = [...today, ...upcoming, ...someday].map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'eine Aufgabe liegt in zwei Ansichten');
  assert.equal(ids.length, 4, 'eine Aufgabe liegt in keiner Ansicht');
});

test('eine erledigungsbezogene Wiederholung liegt vor dem ersten Abhaken unter Irgendwann', async () => {
  // Der offene Punkt aus dem Konzept, hier als Verhalten festgehalten: sie ist
  // nicht unsichtbar, sondern ungeplant. Sonst könnte niemand sie abhaken, und
  // ohne Abhaken entsteht kein Termin.
  const { workspaceId } = await scratch('v-after');
  await add(workspaceId, 'Filter reinigen 3 Monate nach dem Abhaken');
  const someday = await list(pool, 'someday', workspaceId, NOW);
  assert.deepEqual(someday.map((t) => t.title), ['Filter reinigen']);
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

test('ein Projekt zeigt auch Erledigtes, aber unten', async () => {
  const { workspaceId, projectId } = await scratch('v-project');
  const one = await add(workspaceId, 'offen #haus');
  const two = await add(workspaceId, 'erledigt #haus');
  await complete(pool, two.task.id, userId, NOW);

  const rows = await list(pool, 'project', workspaceId, NOW, projectId);
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
  const { workspaceId } = await scratch('p-move-view');
  const t = await add(workspaceId, 'ungeplant');
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
