/**
 * SOTE — Projekte gegen eine echte Datenbank.
 *
 * Zwei Fragen tragen diese Datei. Erstens: kann ein Name so entstehen, dass
 * `#name` in der Schnellerfassung raten müsste. Zweitens: kann ein Projekt sein
 * eigener Nachfahre werden — dann wäre es samt allem darunter aus dem Baum
 * verschwunden, aber noch in der Datenbank, und keine Abfrage über den Baum
 * würde je enden.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { create, NameTaken, update } from '../src/projects.js';
import { createFromLine, NotFound, OutOfOrder, restore, trash } from '../src/tasks.js';

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
    [`projects-${process.pid}@example.org`, 'Markus'],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function space(name: string): Promise<string> {
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
  return w!.id;
}

const tree = async (workspaceId: string) =>
  queryRows<{ name: string; parent_id: string | null; sort_key: string }>(
    pool,
    `SELECT name, parent_id, sort_key FROM projects
      WHERE workspace_id = $1 AND trashed_at IS NULL ORDER BY sort_key`,
    [workspaceId],
  );

/* ── Anlegen ───────────────────────────────────────────────────────────── */

test('ein Projekt anlegen, mit Farbe und am Ende der Liste', async () => {
  const ws = await space('p-create');
  const a = await create(pool, ws, { name: 'Haus', color: '#a8762b' });
  const b = await create(pool, ws, { name: 'Büro' });
  assert.equal(a.name, 'Haus');
  assert.equal(a.color, '#a8762b');
  assert.equal(b.color, null);
  assert.ok(b.sort_key > a.sort_key, 'das zweite landet hinter dem ersten');
  assert.deepEqual((await tree(ws)).map((p) => p.name), ['Haus', 'Büro']);
});

test('ein Name wird beschnitten, ein leerer abgelehnt', async () => {
  const ws = await space('p-trim');
  const p = await create(pool, ws, { name: '  Haus  ' });
  assert.equal(p.name, 'Haus');
  await assert.rejects(() => create(pool, ws, { name: '   ' }), OutOfOrder);
});

test('eine Farbe, die keine ist, wird abgelehnt', async () => {
  const ws = await space('p-color');
  await assert.rejects(
    () => create(pool, ws, { name: 'Haus', color: 'rot; background: url(x)' }),
    OutOfOrder,
  );
  await assert.rejects(() => create(pool, ws, { name: 'Haus', color: '#xyz' }), OutOfOrder);
});

/* ── Der Name entscheidet, ob #name raten müsste ───────────────────────── */

test('zwei Projekte mit demselben Namen an derselben Stelle gehen nicht', async () => {
  const ws = await space('p-clash');
  await create(pool, ws, { name: 'Haus' });
  await assert.rejects(
    () => create(pool, ws, { name: 'haus' }),
    (e: unknown) => e instanceof NameTaken,
    'auch in anderer Schreibweise nicht',
  );
});

test('derselbe Name unter verschiedenen Eltern ist erlaubt', async () => {
  // „Kabel" unter „Haus" und unter „Büro" sind zwei verschiedene Dinge.
  const ws = await space('p-siblings');
  const haus = await create(pool, ws, { name: 'Haus' });
  const buero = await create(pool, ws, { name: 'Büro' });
  await create(pool, ws, { name: 'Kabel', parentId: haus.id });
  await create(pool, ws, { name: 'Kabel', parentId: buero.id });
  assert.equal((await tree(ws)).filter((p) => p.name === 'Kabel').length, 2);
});

test('dann ist #kabel mehrdeutig — und die Erfassung rät nicht', async () => {
  const ws = await space('p-ambiguous');
  const haus = await create(pool, ws, { name: 'Haus' });
  const buero = await create(pool, ws, { name: 'Büro' });
  await create(pool, ws, { name: 'Kabel', parentId: haus.id });
  await create(pool, ws, { name: 'Kabel', parentId: buero.id });

  const out = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Kabel messen #kabel',
    now: NOW,
  });
  assert.equal(out.ambiguousProject, 'kabel');
  assert.equal(out.unknownProject, undefined);
  assert.equal(out.task.project_id, null, 'ohne Projekt ist besser als im falschen');
});

test('ein weggeworfenes Projekt blockiert seinen Namen nicht — und blockiert ihn wieder, wenn es zurückkommt', async () => {
  const ws = await space('p-trashname');
  const first = await create(pool, ws, { name: 'Haus' });
  await trash(pool, 'project', first.id, ws, userId);

  const second = await create(pool, ws, { name: 'Haus' });
  assert.notEqual(second.id, first.id);

  // Und jetzt kann das alte nicht zurück: der Name ist belegt. Die Ablehnung
  // ist der ehrliche Ausgang — zwei Projekte namens „Haus" wären genau der
  // Zustand, den der Index verhindert.
  await assert.rejects(
    () => restore(pool, 'project', first.id, ws),
    (e: unknown) => (e as { code?: string }).code === '23505',
  );
});

test('umbenennen auf einen belegten Namen wird abgelehnt', async () => {
  const ws = await space('p-rename-clash');
  await create(pool, ws, { name: 'Haus' });
  const b = await create(pool, ws, { name: 'Büro' });
  await assert.rejects(() => update(pool, b.id, ws, { name: 'Haus' }), NameTaken);
  // Und auf sich selbst umbenennen geht.
  const same = await update(pool, b.id, ws, { name: 'Büro' });
  assert.equal(same.name, 'Büro');
});

/* ── Umbenennen und umfärben ───────────────────────────────────────────── */

test('umbenennen und umfärben ändern nur das Genannte', async () => {
  const ws = await space('p-update');
  const p = await create(pool, ws, { name: 'Haus', color: '#a8762b' });
  const renamed = await update(pool, p.id, ws, { name: 'Zuhause' });
  assert.equal(renamed.name, 'Zuhause');
  assert.equal(renamed.color, '#a8762b', 'die Farbe war nicht genannt');

  const cleared = await update(pool, p.id, ws, { color: null });
  assert.equal(cleared.color, null);
  assert.equal(cleared.name, 'Zuhause');

  await assert.rejects(() => update(pool, p.id, ws, {}), OutOfOrder);
});

test('umbenennen lässt die Aufgaben, wo sie sind', async () => {
  const ws = await space('p-rename-tasks');
  const p = await create(pool, ws, { name: 'Haus' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Kabel messen #haus',
    now: NOW,
  });
  assert.equal(t.task.project_id, p.id);
  await update(pool, p.id, ws, { name: 'Zuhause' });
  const still = await queryOne<{ project_id: string | null }>(
    pool,
    'SELECT project_id FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.equal(still?.project_id, p.id);
});

/* ── Umhängen, und der Kreis ───────────────────────────────────────────── */

test('ein Projekt unter ein anderes hängen', async () => {
  const ws = await space('p-move');
  const haus = await create(pool, ws, { name: 'Haus' });
  const kabel = await create(pool, ws, { name: 'Kabel' });
  const moved = await update(pool, kabel.id, ws, { parentId: haus.id });
  assert.equal(moved.parent_id, haus.id);
  // Neuer Geschwisterkreis heißt neuer Schlüsselraum.
  assert.equal(moved.sort_key, 'a0');
});

test('und wieder nach oben', async () => {
  const ws = await space('p-out');
  const haus = await create(pool, ws, { name: 'Haus' });
  const kabel = await create(pool, ws, { name: 'Kabel', parentId: haus.id });
  const moved = await update(pool, kabel.id, ws, { parentId: null });
  assert.equal(moved.parent_id, null);
});

test('ein Projekt kann nicht in sich selbst liegen', async () => {
  const ws = await space('p-self');
  const haus = await create(pool, ws, { name: 'Haus' });
  await assert.rejects(
    () => update(pool, haus.id, ws, { parentId: haus.id }),
    (e: unknown) => e instanceof OutOfOrder && /sich selbst/.test((e as Error).message),
  );
});

test('ein Projekt kann nicht unter seinen eigenen Nachfahren', async () => {
  // Der Kreis. Ohne diese Prüfung wären beide aus dem Baum verschwunden und
  // eine rekursive Abfrage würde nicht enden.
  const ws = await space('p-cycle');
  const a = await create(pool, ws, { name: 'A' });
  const b = await create(pool, ws, { name: 'B', parentId: a.id });
  const c = await create(pool, ws, { name: 'C', parentId: b.id });

  await assert.rejects(
    () => update(pool, a.id, ws, { parentId: c.id }),
    (e: unknown) => e instanceof OutOfOrder && /Kreis/.test((e as Error).message),
  );
  await assert.rejects(
    () => update(pool, a.id, ws, { parentId: b.id }),
    (e: unknown) => e instanceof OutOfOrder && /Kreis/.test((e as Error).message),
  );

  // Der Baum steht unverändert.
  const rows = await tree(ws);
  assert.equal(rows.find((r) => r.name === 'A')?.parent_id, null);
});

test('ein Ziel in einem fremden Arbeitsbereich ist kein Ziel', async () => {
  const mine = await space('p-mine');
  const other = await space('p-other');
  const a = await create(pool, mine, { name: 'A' });
  const fremd = await create(pool, other, { name: 'Fremd' });
  await assert.rejects(() => update(pool, a.id, mine, { parentId: fremd.id }), NotFound);
  await assert.rejects(() => update(pool, fremd.id, mine, { name: 'X' }), NotFound);
  await assert.rejects(
    () => create(pool, mine, { name: 'Kind', parentId: fremd.id }),
    NotFound,
  );
});

test('ein weggeworfenes Projekt ist kein Elternteil', async () => {
  const ws = await space('p-trashparent');
  const haus = await create(pool, ws, { name: 'Haus' });
  await trash(pool, 'project', haus.id, ws, userId);
  await assert.rejects(
    () => create(pool, ws, { name: 'Kabel', parentId: haus.id }),
    NotFound,
  );
});

test('die Projektliste kommt in Baumreihenfolge und trägt ihre Tiefe', async () => {
  // Nicht global nach Sortierschlüssel: dann stünden Unterprojekte vor ihren
  // Eltern. Die Reihenfolge wäre nur zufällig brauchbar.
  const ws = await space('p-treeorder');
  const haus = await create(pool, ws, { name: 'Haus' });
  await create(pool, ws, { name: 'Kabel', parentId: haus.id });
  await create(pool, ws, { name: 'Dosen', parentId: haus.id });
  await create(pool, ws, { name: 'Büro' });

  const rows = await queryRows<{ name: string; depth: number }>(
    pool,
    `WITH RECURSIVE walk AS (
       SELECT p.id, p.name, p.sort_key, 0 AS depth, ARRAY[p.sort_key] AS path
         FROM projects p
        WHERE p.workspace_id = $1 AND p.parent_id IS NULL AND p.trashed_at IS NULL
       UNION ALL
       SELECT c.id, c.name, c.sort_key, w.depth + 1, w.path || c.sort_key
         FROM projects c JOIN walk w ON c.parent_id = w.id
        WHERE c.workspace_id = $1 AND c.trashed_at IS NULL
     )
     SELECT name, depth FROM walk ORDER BY path`,
    [ws],
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.depth]),
    [
      ['Haus', 0],
      ['Kabel', 1],
      ['Dosen', 1],
      ['Büro', 0],
    ],
  );
});
