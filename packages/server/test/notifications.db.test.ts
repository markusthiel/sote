/**
 * SOTE — Benachrichtigungen.
 *
 * Die Regel, um die es geht: **nie über sich selbst**, und die Prüfung steht im
 * Schreibweg. Eine Zeile, die niemand sehen soll, soll nicht entstehen — als
 * Filter beim Lesen wäre sie eine Zeile, die in jeder Zählung mitläuft, bis
 * jemand den Filter vergisst.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne, withTransaction } from '../src/db.js';
import { addComment } from '../src/detail.js';
import { migrate } from '../src/migrate.js';
import { list, markRead, notify, unreadCount } from '../src/notifications.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let anna: string;
let bert: string;
let ws: string;
let task: string;

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
  anna = await mk(`n-anna-${process.pid}@example.org`, 'Anna');
  bert = await mk(`n-bert-${process.pid}@example.org`, 'Bert');
  ws = await createWorkspace(pool, { name: `n-${process.pid}`, ownerId: anna });
  const t = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO tasks (workspace_id, title, sort_key, created_by)
     VALUES ($1,'Dach dichten','a',$2) RETURNING id`,
    [ws, anna],
  );
  task = t!.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM notifications WHERE user_id IN ($1,$2)', [anna, bert]);
});

after(async () => {
  await pool.end();
});

const anlegen = (userId: string, actorId: string | null, kind: 'assigned' | 'commented') =>
  withTransaction(pool, (client) =>
    notify(client, { userId, workspaceId: ws, kind, taskId: task, actorId }),
  );

test('eine fremde Zuweisung kommt an', async () => {
  await anlegen(anna, bert, 'assigned');
  const meine = await list(pool, anna);
  assert.equal(meine.length, 1);
  assert.equal(meine[0]!.kind, 'assigned');
  assert.equal(meine[0]!.actorName, 'Bert');
  assert.equal(meine[0]!.taskTitle, 'Dach dichten');
  assert.equal(await unreadCount(pool, anna), 1);
});

test('nie über sich selbst', async () => {
  /*
   * Der Kern. Wer sich eine Aufgabe selbst zuweist oder seinen eigenen
   * Kommentar schreibt, bekommt keine Post — und es entsteht **keine Zeile**,
   * nicht bloß eine unsichtbare.
   */
  await anlegen(anna, anna, 'assigned');
  assert.equal((await list(pool, anna)).length, 0);
  const roh = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM notifications WHERE user_id = $1',
    [anna],
  );
  assert.equal(Number(roh!.n), 0, 'gar nicht entstanden');
});

test('ein Gast über einen Link ist niemand, und das steht so da', async () => {
  // `actorId: null` — „über einen Link" ist eine ehrlichere Auskunft als ein
  // erfundener Name (Konzept 10e).
  await anlegen(anna, null, 'commented');
  assert.equal((await list(pool, anna))[0]!.actorName, null);
});

test('ein Kommentar erreicht Urheber und Zuständige, jeden einmal', async () => {
  /*
   * Beide, weil beide Antworten auf „wen geht das an" richtig sind. Und
   * `DISTINCT`, weil sonst jemand, der beides ist, zwei Meldungen über einen
   * Kommentar bekäme.
   */
  await pool.query(
    'INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [task, anna],
  );
  await addComment(pool, task, ws, bert, 'Regen kommt');
  const meine = await list(pool, anna);
  assert.equal(meine.length, 1, 'Anna ist Urheberin UND zuständig — trotzdem einmal');
  assert.equal(meine[0]!.kind, 'commented');
  await pool.query('DELETE FROM task_assignees WHERE task_id = $1', [task]);
});

test('gelesen wirkt, und nur auf eigene Zeilen', async () => {
  await anlegen(anna, bert, 'assigned');
  await anlegen(bert, anna, 'assigned');
  const meine = await list(pool, anna);

  // Berts Zeile mit Annas Kennung als gelesen zu markieren tut nichts.
  const berts = await list(pool, bert);
  await markRead(pool, anna, berts[0]!.id);
  assert.equal(await unreadCount(pool, bert), 1, 'Berts bleibt ungelesen');

  await markRead(pool, anna, meine[0]!.id);
  assert.equal(await unreadCount(pool, anna), 0);
});

test('alles gelesen nimmt nur meine', async () => {
  await anlegen(anna, bert, 'assigned');
  await anlegen(bert, anna, 'commented');
  await markRead(pool, anna);
  assert.equal(await unreadCount(pool, anna), 0);
  assert.equal(await unreadCount(pool, bert), 1);
});

test('eine weggeworfene Aufgabe verschwindet aus der Liste, nicht aus der Datenbank', async () => {
  /*
   * Eine Auskunft über etwas, das man nicht mehr tun kann, ist keine. Sie
   * bleibt in der Datenbank, weil der Papierkorb die Aufgabe zurückholen kann
   * — und dann soll die Meldung wieder da sein.
   */
  await anlegen(anna, bert, 'assigned');
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [task]);
  assert.equal((await list(pool, anna)).length, 0);
  assert.equal(await unreadCount(pool, anna), 0);
  const roh = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM notifications WHERE user_id = $1',
    [anna],
  );
  assert.equal(Number(roh!.n), 1, 'die Zeile ist noch da');

  await pool.query('UPDATE tasks SET trashed_at = NULL WHERE id = $1', [task]);
  assert.equal((await list(pool, anna)).length, 1, 'und kommt mit der Aufgabe zurück');
});
