/**
 * SOTE — Rollen.
 *
 * Zwei Regeln aus SONEs ADR-0087 stehen hier auf dem Spiel: **Systemrollen
 * sind nicht änderbar**, und **Eigentümerschaft ist keine Rolle**.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { NameTaken } from '../src/projects.js';
import { create, list, remove, update } from '../src/roles.js';
import { mayDo, mayWriteLists } from '../src/settings.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Rollen')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Rollen' RETURNING id`,
    [`roles-${process.pid}@example.org`],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

/** Ein Arbeitsbereich mit den vier Systemrollen, wie die Einrichtung ihn macht. */
async function scratch(name: string): Promise<{ ws: string; ids: Record<string, string> }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const ids: Record<string, string> = {};
  for (const [n, level, rights] of [
    ['owner', 'admin', ['people.manage', 'roles.manage', 'workspace.settings']],
    ['admin', 'admin', ['people.manage', 'roles.manage', 'workspace.settings']],
    ['member', 'editor', []],
    ['guest', null, []],
  ] as [string, string | null, string[]][]) {
    const r = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO roles (workspace_id, name, list_level, rights)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [w!.id, n, level, rights],
    );
    ids[n] = r!.id;
  }
  return { ws: w!.id, ids };
}

/* ── Was eine Rolle ist ──────────────────────────────────────────────────── */

test('„nur lesend" fällt heraus, statt gebaut zu werden', async () => {
  // ADR-0087: eine Rolle ist (eine Stufe, eine Menge von Rechten). „Nur
  // lesend" ist dann `viewer` und keine Rechte — kein eigener Begriff.
  const { ws } = await scratch('r-readonly');
  const rolle = await create(pool, ws, { name: 'Nur lesend', listLevel: 'viewer', rights: [] });
  assert.equal(rolle.listLevel, 'viewer');
  assert.deepEqual(rolle.rights, []);
  assert.equal(rolle.system, false);
});

test('ein unbekanntes Recht wird weggeworfen, nicht gespeichert', async () => {
  const { ws } = await scratch('r-unknown');
  const rolle = await create(pool, ws, {
    name: 'Bastler',
    listLevel: 'editor',
    // `groups.manage` stand hier als Beispiel für ein unbekanntes Recht — und
    // ist seit Migration 0014 ein bekanntes. Ein Test, der ein Beispiel
    // benutzt, das gültig geworden ist, prüft nichts mehr.
    rights: ['roles.manage', 'alles.duerfen', 'projekte.loeschen'],
  });
  assert.deepEqual(rolle.rights, ['roles.manage'], 'nur was die Liste kennt');
});

/* ── Systemrollen ────────────────────────────────────────────────────────── */

test('Systemrollen lassen sich nicht ändern und nicht löschen', async () => {
  /*
   * Sie zu ändern hieße, die Bedeutung zu verschieben, auf die sich
   * Bestehendes verlässt — und `guest` mit Schreibrecht wäre kein Gast.
   */
  const { ws, ids } = await scratch('r-system');
  for (const name of ['owner', 'admin', 'member', 'guest']) {
    await assert.rejects(
      () => update(pool, ids[name]!, ws, { listLevel: 'admin' }),
      OutOfOrder,
      name,
    );
    await assert.rejects(() => remove(pool, ids[name]!, ws), OutOfOrder, name);
  }
  // Und `guest` hat danach noch keine Stufe.
  assert.equal((await list(pool, ws)).find((r) => r.name === 'guest')?.listLevel, null);
});

test('ein Systemname lässt sich auch nicht neu belegen', async () => {
  // Und die Meldung sagt WARUM: ein Name, der belegt ist, und einer, der
  // reserviert ist, sind zwei verschiedene Auskünfte.
  const { ws } = await scratch('r-reserve');
  await assert.rejects(
    () => create(pool, ws, { name: 'guest', listLevel: 'admin', rights: [] }),
    (e: unknown) => e instanceof OutOfOrder && /Systemrolle/.test((e as Error).message),
  );
});

test('zwei Rollen mit demselben Namen gehen nicht', async () => {
  const { ws } = await scratch('r-dup');
  await create(pool, ws, { name: 'Redaktion', listLevel: 'editor', rights: [] });
  await assert.rejects(
    () => create(pool, ws, { name: 'Redaktion', listLevel: 'viewer', rights: [] }),
    NameTaken,
  );
});

/* ── Löschen ─────────────────────────────────────────────────────────────── */

test('eine Rolle, die noch jemand hält, wird nicht gelöscht', async () => {
  /*
   * Sie zu löschen hieße zu entscheiden, was der dann darf — und die stille
   * Antwort wäre „nichts" oder „alles", beides falsch. Dieselbe Bauart wie
   * beim Löschen eines Kontos: still ist bei Löschen das falsche Wort.
   */
  const { ws } = await scratch('r-held');
  const rolle = await create(pool, ws, { name: 'Redaktion', listLevel: 'editor', rights: [] });
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [ws, userId, rolle.id],
  );
  await assert.rejects(() => remove(pool, rolle.id, ws), OutOfOrder);

  await pool.query('DELETE FROM workspace_members WHERE workspace_id = $1', [ws]);
  await remove(pool, rolle.id, ws);
  assert.equal((await list(pool, ws)).some((r) => r.id === rolle.id), false);
});

test('eine Rolle aus einem fremden Arbeitsbereich ist unerreichbar', async () => {
  const a = await scratch('r-cross-a');
  const b = await scratch('r-cross-b');
  const rolle = await create(pool, a.ws, { name: 'Fremd', listLevel: 'editor', rights: [] });
  await assert.rejects(() => update(pool, rolle.id, b.ws, { name: 'Geklaut' }), NotFound);
  await assert.rejects(() => remove(pool, rolle.id, b.ws), NotFound);
});

/* ── Was die Rechte wirklich bewachen ────────────────────────────────────── */

test('jedes Recht bewacht genau seine Sache', async () => {
  /*
   * Vorher bewachte `roles.manage` Einstellungen, Leute UND Rollen — drei
   * Dinge, von denen es nur eines heißt. Wer es vergab, vergab mehr als er las.
   */
  const { ws } = await scratch('r-guards');
  const nur = await create(pool, ws, {
    name: 'Nur Leute',
    listLevel: 'viewer',
    rights: ['people.manage'],
  });
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [ws, userId, nur.id],
  );
  assert.equal(await mayDo(pool, userId, ws, 'people.manage'), true);
  assert.equal(await mayDo(pool, userId, ws, 'roles.manage'), false);
  assert.equal(await mayDo(pool, userId, ws, 'workspace.settings'), false);
  // Und die STUFE ist eine andere Frage als die Rechte: `viewer` schreibt
  // nicht, auch mit einem Recht in der Tasche.
  assert.equal(await mayWriteLists(pool, userId, ws), false);
});

test('ein Eigentümer hält jedes Recht, ohne dass eines in seiner Rolle steht', async () => {
  // ADR-0087, und an einer Stelle geprüft: eine Bedingung, die jeder Aufrufer
  // selbst um „oder Eigentümer" ergänzen muss, ist eine, die einer vergisst.
  const { ws } = await scratch('r-owner');
  const leer = await create(pool, ws, { name: 'Leer', listLevel: null, rights: [] });
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [ws, userId, leer.id],
  );
  assert.equal(await mayDo(pool, userId, ws, 'roles.manage'), true);
  assert.equal(await mayDo(pool, userId, ws, 'workspace.settings'), true);
  assert.equal(await mayWriteLists(pool, userId, ws), true, 'auch ohne Stufe');
});
