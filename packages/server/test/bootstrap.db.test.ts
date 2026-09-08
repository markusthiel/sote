/**
 * SOTE — ein Arbeitsbereich mit seinen Rollen.
 *
 * `createWorkspaceIn` ist aus `createAccountIn` herausgezogen, weil es jetzt
 * **zwei** Aufrufer gibt: die Einrichtung und „Neuer Arbeitsbereich" im Wähler.
 * Die Begründung stand dort schon, als es einen gab — *zwei Umsetzungen wären
 * zwei Rollenlisten, und die eine hätte irgendwann eine Rolle, die die andere
 * nicht hat* —, und aus der Vorsorge ist eine Notwendigkeit geworden.
 *
 * Und diese Datei ist **neu**: mein erstes `>>` hat sie angelegt statt an eine
 * bestehende anzuhängen, also standen zwei Tests ohne Importe und ohne Aufbau
 * darin. Ein `>>` auf eine Datei, von der man glaubt, sie existiere, ist ein
 * `>` mit besserer Tarnung.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
});

after(async () => {
  await pool.end();
});

test('ein Arbeitsbereich kommt nie ohne seine vier Rollen', async () => {
  /*
   * Herausgezogen aus `createAccountIn`, weil es jetzt zwei Aufrufer gibt: die
   * Einrichtung und „Neuer Arbeitsbereich". Die Begründung stand dort schon,
   * als es einen gab — *zwei Umsetzungen wären zwei Rollenlisten* —, und aus
   * der Vorsorge ist eine Notwendigkeit geworden.
   */
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Zweiter')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Zweiter' RETURNING id`,
    [`ws-${process.pid}@example.org`],
  );
  const id = await createWorkspace(pool, { name: 'Zweiter Bereich', ownerId: u!.id });

  const rollen = await queryRows<{ name: string; rights: string[] }>(
    pool,
    'SELECT name, rights FROM roles WHERE workspace_id = $1 ORDER BY name',
    [id],
  );
  assert.deepEqual(
    rollen.map((r) => r.name),
    ['admin', 'guest', 'member', 'owner'],
  );
  // Und `groups.manage` ist dabei — das Recht, das in Migration 0013 entfernt
  // und in 0014 zurückgekommen ist. Ein zweiter Weg, der es nicht vergibt,
  // wäre ein Arbeitsbereich, in dem niemand Gruppen anlegen kann.
  const owner = rollen.find((r) => r.name === 'owner');
  assert.ok(owner?.rights.includes('groups.manage'));

  const chef = await queryOne<{ is_owner: boolean }>(
    pool,
    'SELECT is_owner FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [id, u!.id],
  );
  assert.equal(chef?.is_owner, true, 'wer anlegt, besitzt');
});

test('ein Arbeitsbereich ohne Namen wird abgelehnt', async () => {
  const u = await queryOne<{ id: string }>(pool, 'SELECT id FROM users LIMIT 1');
  await assert.rejects(
    () => createWorkspace(pool, { name: '   ', ownerId: u!.id }),
    (e: unknown) => /braucht einen Namen/.test((e as Error).message),
  );
});
