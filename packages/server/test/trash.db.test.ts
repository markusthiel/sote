/**
 * SOTE — der Papierkorb gegen eine echte Datenbank.
 *
 * Die Fragen, die hier zählen, sind nicht „wird das Feld gesetzt", sondern:
 * verschwindet eine weggeworfene Aufgabe aus **allen** Ansichten, kommt ein
 * zurückgeholtes Projekt mit seinen Aufgaben zurück, und gibt es einen Weg,
 * an dessen Ende etwas zurückgeholt und trotzdem unsichtbar ist.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import {
  complete,
  createFromLine,
  listTrash,
  NeedsTarget,
  NotFound,
  purge,
  restore,
  trash,
} from '../src/tasks.js';
import { counts, list } from '../src/views.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`trash-${process.pid}@example.org`, 'Markus'],
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
  const haus = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Haus','a0')
     RETURNING id`,
    [w!.id],
  );
  const buero = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Büro','a1')
     RETURNING id`,
    [w!.id],
  );
  return { workspaceId: w!.id, haus: haus!.id, buero: buero!.id };
}

const add = (workspaceId: string, line: string) =>
  createFromLine(pool, { workspaceId, userId, line, now: NOW });

const titles = (rows: readonly { title: string }[]) => rows.map((r) => r.title).sort();

/* ── Erledigt ist nicht gelöscht ───────────────────────────────────────── */

test('Abhaken bringt nichts in den Papierkorb', async () => {
  const { workspaceId } = await scratch('t-done');
  const t = await add(workspaceId, 'Namen entscheiden heute');
  await complete(pool, t.task.id, userId, NOW);
  assert.deepEqual(await listTrash(pool, workspaceId, 'task'), []);
});

test('der Papierkorb zeigt nichts Abgehaktes', async () => {
  const { workspaceId } = await scratch('t-nodone');
  const a = await add(workspaceId, 'weggeworfen heute');
  const b = await add(workspaceId, 'abgehakt heute');
  await complete(pool, b.task.id, userId, NOW);
  await trash(pool, 'task', a.task.id, workspaceId, userId);
  assert.deepEqual(titles(await listTrash(pool, workspaceId, 'task')), ['weggeworfen']);
});

/* ── Eine weggeworfene Aufgabe ist überall weg ─────────────────────────── */

test('eine weggeworfene Aufgabe verschwindet aus jeder Ansicht und aus den Zählern', async () => {
  const { workspaceId } = await scratch('t-gone');
  const heute = await add(workspaceId, 'a heute');
  const spaeter = await add(workspaceId, 'b in 3 Tagen');
  const irgendwann = await add(workspaceId, 'c');

  for (const t of [heute, spaeter, irgendwann]) {
    await trash(pool, 'task', t.task.id, workspaceId, userId);
  }

  assert.equal((await list(pool, 'today', workspaceId, NOW)).length, 0);
  assert.equal((await list(pool, 'upcoming', workspaceId, NOW)).length, 0);
  assert.equal((await list(pool, 'someday', workspaceId, NOW)).length, 0);
  assert.deepEqual(await counts(pool, workspaceId, NOW), {
    today: 0,
    upcoming: 0,
    someday: 0,
    overdue: 0,
  });
  assert.equal((await listTrash(pool, workspaceId, 'task')).length, 3);
});

/* ── Ein Projekt nimmt seine Aufgaben mit ──────────────────────────────── */

test('ein weggeworfenes Projekt nimmt seine Aufgaben aus allen Ansichten mit', async () => {
  // Das war ohne die erweiterte ALIVE-Bedingung kaputt: die Aufgaben blieben
  // in Heute stehen, während das Projekt aus dem Panel verschwunden war — und
  // niemand fand den Ort, an dem man sie loswird.
  const { workspaceId, haus } = await scratch('t-cascade');
  await add(workspaceId, 'Kartons bestellen heute #haus');
  await add(workspaceId, 'Kabel messen #haus');
  await add(workspaceId, 'ohne Projekt heute');

  await trash(pool, 'project', haus, workspaceId, userId);

  assert.deepEqual(titles(await list(pool, 'today', workspaceId, NOW)), ['ohne Projekt']);
  assert.equal((await list(pool, 'someday', workspaceId, NOW)).length, 0);
  const n = await counts(pool, workspaceId, NOW);
  assert.equal(n.today, 1);
  assert.equal(n.someday, 0);

  // Und im Papierkorb steht **ein** Eintrag, der sagt, wie viele mitkommen.
  const entries = await listTrash(pool, workspaceId, 'project');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.title, 'Haus');
  assert.equal(entries[0]!.carries, 2);
  assert.match(entries[0]!.peek ?? '', /Kartons bestellen/);

  // Die Aufgaben selbst liegen **nicht** im Aufgaben-Papierkorb: sie sind kein
  // eigener Irrtum, sondern Teil eines.
  assert.deepEqual(await listTrash(pool, workspaceId, 'task'), []);
});

test('ein zurückgeholtes Projekt bringt seine Aufgaben mit', async () => {
  const { workspaceId, haus } = await scratch('t-back');
  await add(workspaceId, 'Kartons bestellen heute #haus');
  await add(workspaceId, 'Kabel messen #haus');
  await trash(pool, 'project', haus, workspaceId, userId);
  await restore(pool, 'project', haus, workspaceId);

  assert.deepEqual(titles(await list(pool, 'today', workspaceId, NOW)), [
    'Kartons bestellen',
  ]);
  assert.deepEqual(titles(await list(pool, 'someday', workspaceId, NOW)), ['Kabel messen']);
  assert.deepEqual(await listTrash(pool, workspaceId, 'project'), []);
});

/* ── Zurückholen braucht ein Ziel, wenn es keins mehr gibt ─────────────── */

test('eine einzeln weggeworfene Aufgabe kommt in ihr Projekt zurück', async () => {
  const { workspaceId, haus } = await scratch('t-simple');
  const t = await add(workspaceId, 'Kabel messen #haus');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await restore(pool, 'task', t.task.id, workspaceId);
  const rows = await list(pool, 'project', workspaceId, NOW, haus);
  assert.deepEqual(titles(rows), ['Kabel messen']);
});

test('liegt ihr Projekt im Papierkorb, verlangt das Zurück ein Ziel', async () => {
  // Der eine Ausgang, den ein Zurück-Knopf nicht haben darf: zurückgeholt und
  // trotzdem unsichtbar.
  const { workspaceId, haus, buero } = await scratch('t-target');
  const t = await add(workspaceId, 'Kabel messen #haus');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await trash(pool, 'project', haus, workspaceId, userId);

  await assert.rejects(
    () => restore(pool, 'task', t.task.id, workspaceId),
    (e: unknown) => e instanceof NeedsTarget && /wohin/.test((e as Error).message),
  );

  // Und der Eintrag im Papierkorb sagt es vorher.
  const entry = (await listTrash(pool, workspaceId, 'task'))[0]!;
  assert.equal(entry.projectTrashed, true);
  assert.equal(entry.projectName, 'Haus');

  await restore(pool, 'task', t.task.id, workspaceId, buero);
  assert.deepEqual(titles(await list(pool, 'project', workspaceId, NOW, buero)), [
    'Kabel messen',
  ]);
});

test('als Ziel geht auch „ohne Projekt"', async () => {
  const { workspaceId, haus } = await scratch('t-none');
  const t = await add(workspaceId, 'Kabel messen #haus');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await trash(pool, 'project', haus, workspaceId, userId);
  await restore(pool, 'task', t.task.id, workspaceId, null);
  const someday = await list(pool, 'someday', workspaceId, NOW);
  assert.deepEqual(titles(someday), ['Kabel messen']);
  assert.equal(someday[0]!.project_id, null);
});

test('ein Ziel, das es nicht gibt, wird abgelehnt', async () => {
  const { workspaceId, haus } = await scratch('t-badtarget');
  const t = await add(workspaceId, 'Kabel messen #haus');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await trash(pool, 'project', haus, workspaceId, userId);
  await assert.rejects(
    () => restore(pool, 'task', t.task.id, workspaceId, haus),
    NotFound,
    'ein Projekt im Papierkorb ist kein Ziel',
  );
});

test('zurückgeholt wird ans Ende der Zielliste, ohne Schlüsselkollision', async () => {
  // Die Lücke von damals ist längst zu, und ein alter Schlüssel kollidiert mit
  // dem Unique-Index aus Migration 0003.
  const { workspaceId, haus } = await scratch('t-key');
  const first = await add(workspaceId, 'eins #haus');
  await trash(pool, 'task', first.task.id, workspaceId, userId);
  await add(workspaceId, 'zwei #haus');
  await add(workspaceId, 'drei #haus');
  await restore(pool, 'task', first.task.id, workspaceId);
  const rows = await list(pool, 'project', workspaceId, NOW, haus);
  assert.deepEqual(
    rows.map((r) => r.title),
    ['zwei', 'drei', 'eins'],
  );
});

/* ── Endgültig ─────────────────────────────────────────────────────────── */

test('endgültig löschen geht nur aus dem Papierkorb', async () => {
  const { workspaceId } = await scratch('t-purge');
  const t = await add(workspaceId, 'lebt noch heute');
  await assert.rejects(() => purge(pool, 'task', t.task.id, workspaceId), NotFound);

  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await purge(pool, 'task', t.task.id, workspaceId);
  assert.deepEqual(await listTrash(pool, workspaceId, 'task'), []);
  const gone = await queryOne<{ id: string }>(pool, 'SELECT id FROM tasks WHERE id = $1', [
    t.task.id,
  ]);
  assert.equal(gone, undefined);
});

test('ein endgültig gelöschtes Projekt nimmt seine Aufgaben mit', async () => {
  const { workspaceId, haus } = await scratch('t-purge-project');
  await add(workspaceId, 'a #haus');
  await add(workspaceId, 'b #haus');
  await trash(pool, 'project', haus, workspaceId, userId);
  await purge(pool, 'project', haus, workspaceId);
  const left = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM tasks WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(left!.n, '0');
});

test('ein fremder Arbeitsbereich kann nichts wegwerfen oder löschen', async () => {
  const mine = await scratch('t-mine');
  const other = await scratch('t-other');
  const fremd = await add(other.workspaceId, 'fremd');
  await assert.rejects(
    () => trash(pool, 'task', fremd.task.id, mine.workspaceId, userId),
    NotFound,
  );
  await trash(pool, 'task', fremd.task.id, other.workspaceId, userId);
  await assert.rejects(
    () => purge(pool, 'task', fremd.task.id, mine.workspaceId),
    NotFound,
  );
  await assert.rejects(
    () => restore(pool, 'task', fremd.task.id, mine.workspaceId),
    NotFound,
  );
});

test('zweimal wegwerfen ist kein stiller Erfolg', async () => {
  const { workspaceId } = await scratch('t-twice');
  const t = await add(workspaceId, 'einmal');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await assert.rejects(
    () => trash(pool, 'task', t.task.id, workspaceId, userId),
    NotFound,
  );
});

test('es gibt keinen Sweep — nichts leert sich von selbst', async () => {
  // Kein Test kann beweisen, dass ein Job nicht existiert. Er kann aber
  // festhalten, dass eine sehr alte Zeile noch da ist: wenn jemand später eine
  // Frist einbaut, fällt sie hier auf und nicht bei einem Nutzer.
  const { workspaceId } = await scratch('t-nosweep');
  const t = await add(workspaceId, 'ganz alt');
  await trash(pool, 'task', t.task.id, workspaceId, userId);
  await pool.query(`UPDATE tasks SET trashed_at = now() - interval '400 days' WHERE id = $1`, [
    t.task.id,
  ]);
  const entries = await listTrash(pool, workspaceId, 'task');
  assert.equal(entries.length, 1);
  assert.ok(
    Date.now() - entries[0]!.trashedAt.getTime() > 300 * 86_400_000,
    'die Zeile ist wirklich alt und liegt noch da',
  );
});
