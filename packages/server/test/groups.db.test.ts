/**
 * SOTE — Gruppen.
 *
 * Die eine Regel, um die es hier geht (SONEs ADR-0087, begründet in ADR-0026):
 * **in eine Gruppe aufgenommen zu werden darf niemals wegnehmen, was jemand
 * schon durfte.** Vereinigung der Rechte, Maximum der Stufen, niemals Abzug.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { add, create, drop, list, remove, update } from '../src/groups.js';
import { migrate } from '../src/migrate.js';
import { NameTaken } from '../src/projects.js';
import { create as createRole } from '../src/roles.js';
import { mayDo, mayWriteLists } from '../src/settings.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let anna: string;
let bert: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const mk = async (email: string, name: string): Promise<string> => {
    const u = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO users (email, display_name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [email, name],
    );
    return u!.id;
  };
  anna = await mk(`g-anna-${process.pid}@example.org`, 'Anna');
  bert = await mk(`g-bert-${process.pid}@example.org`, 'Bert');
});

after(async () => {
  await pool.end();
});

/** Ein Arbeitsbereich, in dem Anna nur MITLESEN darf und nichts verwaltet. */
async function scratch(name: string): Promise<{ ws: string; nurLesen: string }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','viewer') RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [w!.id, anna, r!.id],
  );
  return { ws: w!.id, nurLesen: r!.id };
}

/* ── Vereinigung und Maximum ─────────────────────────────────────────────── */

test('eine Gruppe hebt hinauf', async () => {
  const { ws } = await scratch('g-lift');
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), false);
  assert.equal(await mayWriteLists(pool, anna, ws), false);

  const rolle = await createRole(pool, ws, {
    name: 'Vorstand',
    listLevel: 'admin',
    rights: ['people.manage'],
  });
  const g = await create(pool, ws, 'Vorstand');
  await update(pool, g.id, ws, { roleId: rolle.id });
  await add(pool, g.id, ws, anna);

  // Ihre EIGENE Rolle ist unverändert `viewer` ohne Rechte — beides kommt aus
  // der Gruppe.
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), true, 'Vereinigung der Rechte');
  assert.equal(await mayWriteLists(pool, anna, ws), true, 'Maximum der Stufen');
  assert.equal(await mayDo(pool, anna, ws, 'roles.manage'), false, 'und nur, was sie gibt');
});

test('eine Gruppe zieht nie herunter', async () => {
  /*
   * Die Regel selbst. Eine Gruppe mit einer schwächeren Rolle darf nichts
   * wegnehmen — sonst ist jede Gruppenmitgliedschaft eine Sache, die man vor
   * dem Vergeben prüft (ADR-0026).
   */
  const { ws } = await scratch('g-nolower');
  const stark = await createRole(pool, ws, {
    name: 'Stark',
    listLevel: 'admin',
    rights: ['people.manage', 'roles.manage'],
  });
  await pool.query('UPDATE workspace_members SET role_id = $3 WHERE workspace_id = $1 AND user_id = $2', [
    ws,
    anna,
    stark.id,
  ]);
  const schwach = await createRole(pool, ws, { name: 'Schwach', listLevel: null, rights: [] });
  const g = await create(pool, ws, 'Umzug');
  await update(pool, g.id, ws, { roleId: schwach.id });
  await add(pool, g.id, ws, anna);

  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), true);
  assert.equal(await mayDo(pool, anna, ws, 'roles.manage'), true);
  assert.equal(await mayWriteLists(pool, anna, ws), true);
});

test('eine Gruppe ohne Rolle gibt nichts und ordnet nur', async () => {
  // Kein halber Zustand, sondern ein Zweck: „das sind die Leute vom Umzug" ist
  // eine nützliche Liste, auch wenn sie niemandem etwas gibt.
  const { ws } = await scratch('g-norole');
  const g = await create(pool, ws, 'Umzug');
  await add(pool, g.id, ws, anna);
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), false);
  const alle = await list(pool, ws);
  assert.equal(alle[0]!.roleId, null);
  assert.equal(alle[0]!.members.length, 1);
});

test('austreten nimmt zurück, was die Gruppe gab', async () => {
  const { ws } = await scratch('g-leave');
  const rolle = await createRole(pool, ws, {
    name: 'Vorstand',
    listLevel: 'admin',
    rights: ['people.manage'],
  });
  const g = await create(pool, ws, 'Vorstand');
  await update(pool, g.id, ws, { roleId: rolle.id });
  await add(pool, g.id, ws, anna);
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), true);
  await drop(pool, g.id, ws, anna);
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), false);
  // Zweimal austreten ist kein Fehler: er ist danach draußen.
  await drop(pool, g.id, ws, anna);
});

/* ── Was nicht geht ──────────────────────────────────────────────────────── */

test('wer nicht im Arbeitsbereich ist, kommt in keine Gruppe', async () => {
  /*
   * Sonst wäre es eine zweite Tür neben „Leute": jemand bekäme über die Rolle
   * der Gruppe Rechte, ohne hier zu sein — und die Tür hätte niemand
   * aufgesucht.
   */
  const { ws } = await scratch('g-outsider');
  const g = await create(pool, ws, 'Vorstand');
  await assert.rejects(() => add(pool, g.id, ws, bert), OutOfOrder);
});

test('eine Rolle aus einem fremden Arbeitsbereich geht nicht', async () => {
  const a = await scratch('g-cross-a');
  const b = await scratch('g-cross-b');
  const fremd = await createRole(pool, b.ws, { name: 'Fremd', listLevel: 'admin', rights: [] });
  const g = await create(pool, a.ws, 'Gruppe');
  await assert.rejects(() => update(pool, g.id, a.ws, { roleId: fremd.id }), NotFound);
});

test('eine fremde Gruppe ist unerreichbar', async () => {
  const a = await scratch('g-far-a');
  const b = await scratch('g-far-b');
  const g = await create(pool, a.ws, 'Gruppe');
  await assert.rejects(() => update(pool, g.id, b.ws, { name: 'Geklaut' }), NotFound);
  await assert.rejects(() => remove(pool, g.id, b.ws), NotFound);
  await assert.rejects(() => add(pool, g.id, b.ws, anna), NotFound);
});

test('zwei Gruppen mit demselben Namen gehen nicht', async () => {
  const { ws } = await scratch('g-dup');
  await create(pool, ws, 'Vorstand');
  await assert.rejects(() => create(pool, ws, 'Vorstand'), NameTaken);
});

test('eine Gruppe wird gelöscht, auch mit Leuten darin', async () => {
  /*
   * Anders als bei Rollen und Konten, und der Unterschied ist begründet: eine
   * Gruppe zu löschen nimmt niemandem etwas, was er ohne sie hätte. Ihre Rolle
   * gab nur DAZU (Vereinigung), also bleibt jeder bei seiner eigenen.
   */
  const { ws } = await scratch('g-del');
  const rolle = await createRole(pool, ws, {
    name: 'Vorstand',
    listLevel: 'admin',
    rights: ['people.manage'],
  });
  const g = await create(pool, ws, 'Vorstand');
  await update(pool, g.id, ws, { roleId: rolle.id });
  await add(pool, g.id, ws, anna);
  await remove(pool, g.id, ws);
  assert.equal((await list(pool, ws)).length, 0);
  // Und Anna ist noch da, mit ihrer eigenen Rolle.
  assert.equal(await mayDo(pool, anna, ws, 'people.manage'), false);
  assert.equal(await mayWriteLists(pool, anna, ws), false);
});
