/**
 * SOTE — wo jemand von der Vorgabe abweicht.
 *
 * Der Kern rechnet aus, welche Form gilt; hier geht es um das Aufbewahren:
 * dass die Wahl der PERSON gehört, dass sie sich zurücknehmen lässt, und dass
 * eine gelöschte Liste ihre Einstellung mitnimmt.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { listViewsOf, setListView, ViewTrouble } from '../src/listViews.js';
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let ich: string;
let du: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const a = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Ich') RETURNING id`,
    [`lv-a-${process.pid}-${Date.now()}@example.org`],
  );
  const b = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Du') RETURNING id`,
    [`lv-b-${process.pid}-${Date.now()}@example.org`],
  );
  ich = a!.id;
  du = b!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(): Promise<{ ws: string; ordner: string; liste: string }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`lv-${Date.now()}-${Math.random()}`],
  );
  const f = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,'Ordner','folder','a0') RETURNING id`,
    [w!.id],
  );
  const l = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,'Liste','list','a0') RETURNING id`,
    [w!.id, f!.id],
  );
  return { ws: w!.id, ordner: f!.id, liste: l!.id };
}

test('wer nichts gewählt hat, hat nichts stehen', async () => {
  // Nur die Abweichungen werden aufbewahrt. Eine Zeile je Liste und Person
  // wäre bei drei Leuten und dreißig Listen neunzig Zeilen, die alle dasselbe
  // sagen wie die Vorgabe.
  const { ws } = await scratch();
  assert.deepEqual(await listViewsOf(pool, ws, ich), { projects: {}, places: {} });
});

test('eine Wahl je Liste, und sie gehört der Person', async () => {
  /*
   * Der Kern der Bitte: „jeder sollte die Liste so anzeigen können wie er
   * möchte." Läge die Wahl an der Liste, sähe der zweite die Entscheidung des
   * ersten — dieselbe Vermischung, gegen die ADR-0028 argumentiert.
   */
  const { ws, liste } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: 'plain' });
  await setListView(pool, { workspaceId: ws, userId: du, projectId: liste, display: 'cards' });

  assert.equal((await listViewsOf(pool, ws, ich)).projects[liste], 'plain');
  assert.equal((await listViewsOf(pool, ws, du)).projects[liste], 'cards');
});

test('nochmal setzen ändert und legt keine zweite Zeile an', async () => {
  const { ws, liste } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: 'plain' });
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: 'cards' });
  assert.equal((await listViewsOf(pool, ws, ich)).projects[liste], 'cards');
  const zeilen = await pool.query('SELECT 1 FROM list_views WHERE user_id = $1 AND project_id = $2', [
    ich,
    liste,
  ]);
  assert.equal(zeilen.rows.length, 1);
});

test('zurücknehmen LÖSCHT die Zeile und schreibt nicht „full“ hinein', async () => {
  /*
   * Der Unterschied ist sichtbar: eine gelöschte Zeile folgt der Vorgabe des
   * Bereichs weiter, auch wenn die sich morgen ändert. Ein hineingeschriebenes
   * „full“ wäre eine Entscheidung, die dann stehen bleibt — „wie der
   * Arbeitsbereich sagt“ ist eine eigene Antwort und nicht dieselbe wie „voll“.
   */
  const { ws, liste } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: 'plain' });
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: null });
  assert.equal((await listViewsOf(pool, ws, ich)).projects[liste], undefined);
  const zeilen = await pool.query('SELECT 1 FROM list_views WHERE user_id = $1 AND project_id = $2', [
    ich,
    liste,
  ]);
  assert.equal(zeilen.rows.length, 0);
});

test('die festen Ansichten tragen ein Wort statt einer Id', async () => {
  const { ws } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, place: 'today', display: 'plain' });
  await setListView(pool, { workspaceId: ws, userId: ich, place: 'inbox', display: 'cards' });
  const out = await listViewsOf(pool, ws, ich);
  assert.deepEqual(out.places, { today: 'plain', inbox: 'cards' });
  assert.deepEqual(out.projects, {});
});

test('eine feste Ansicht gilt je Arbeitsbereich', async () => {
  // Anders als bei einer Liste, die ihren Bereich selbst kennt: „Heute“ gibt
  // es in jedem, und wer hier schmal will, will das nicht überall.
  const a = await scratch();
  const b = await scratch();
  await setListView(pool, { workspaceId: a.ws, userId: ich, place: 'today', display: 'plain' });
  assert.equal((await listViewsOf(pool, a.ws, ich)).places['today'], 'plain');
  assert.equal((await listViewsOf(pool, b.ws, ich)).places['today'], undefined);
});

test('entweder eine Liste oder eine Ansicht, nicht beides und nicht keines', async () => {
  const { ws, liste } = await scratch();
  await assert.rejects(
    () =>
      setListView(pool, {
        workspaceId: ws,
        userId: ich,
        projectId: liste,
        place: 'today',
        display: 'plain',
      }),
    (e: Error) => e instanceof ViewTrouble,
  );
  await assert.rejects(
    () => setListView(pool, { workspaceId: ws, userId: ich, display: 'plain' }),
    (e: Error) => e instanceof ViewTrouble,
  );
});

test('unbekannte Wörter werden abgelehnt, mit Grund', async () => {
  const { ws, liste } = await scratch();
  await assert.rejects(
    () =>
      setListView(pool, {
        workspaceId: ws,
        userId: ich,
        projectId: liste,
        display: 'board' as never,
      }),
    (e: Error) => e instanceof ViewTrouble,
  );
  await assert.rejects(
    () =>
      setListView(pool, { workspaceId: ws, userId: ich, place: 'heute', display: 'plain' }),
    (e: Error) => e instanceof ViewTrouble,
  );
});

test('eine Liste aus einem fremden Bereich bekommt keine Zeile', async () => {
  /*
   * Der eindeutige Index steht auf (user, project) — eine Zeile, die eine
   * Liste des einen Bereichs mit dem anderen verknüpft, bliebe unbemerkt und
   * wäre in keinem von beiden zu finden. Darum kommt der Bereich aus der
   * LISTE und nicht aus dem Aufruf.
   */
  const meins = await scratch();
  const fremd = await scratch();
  await setListView(pool, {
    workspaceId: meins.ws,
    userId: ich,
    projectId: fremd.liste,
    display: 'plain',
  });
  assert.deepEqual((await listViewsOf(pool, meins.ws, ich)).projects, {});
  assert.deepEqual((await listViewsOf(pool, fremd.ws, ich)).projects, {});
});

test('eine gelöschte Liste nimmt ihre Einstellung mit', async () => {
  // Der Grund für den Fremdschlüssel statt einer Textspalte für beides: sonst
  // bliebe eine Waise liegen, die niemand je wieder findet.
  const { ws, liste } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: liste, display: 'cards' });
  await pool.query('DELETE FROM projects WHERE id = $1', [liste]);
  assert.deepEqual((await listViewsOf(pool, ws, ich)).projects, {});
});

test('auch ein Ordner lässt sich einstellen', async () => {
  // Ein Ordner zeigt ebenfalls Aufgaben, also ist er ein Ort wie ein Projekt.
  const { ws, ordner } = await scratch();
  await setListView(pool, { workspaceId: ws, userId: ich, projectId: ordner, display: 'cards' });
  assert.equal((await listViewsOf(pool, ws, ich)).projects[ordner], 'cards');
});
