/**
 * SOTE — wohin eine Meldung geht.
 *
 * GEWUENSCHT: „Namensnennungen und Zuweisungen bei den Benachrichtigungen …
 * konfigurierbar machen, was per E-Mail benachrichtigt wird, ueber die
 * Oberflaeche oder per App."
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { channelsFor, deliver, setChannels } from '../src/deliver.js';
import { withTransaction } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let ws: string;
let ich: string;
let du: string;
let task: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const a = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Ich') RETURNING id`,
    [`deliver-a-${process.pid}@t.tools`],
  );
  const b = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Du') RETURNING id`,
    [`deliver-b-${process.pid}@t.tools`],
  );
  ich = a!.id;
  du = b!.id;
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`deliver-${process.pid}`],
  );
  ws = w!.id;
  /*
   * BEIDE sind Mitglieder — so, wie Produktion es schreibt. `deliver` prüft
   * die Mitgliedschaft (Audit 12.09.2026, F13); ein Fixture ohne sie prüft
   * eine Form, die es nicht gibt (SONE ADR-0102).
   */
  const rolle = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor') RETURNING id`,
    [ws],
  );
  for (const wer of [ich, du]) {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner) VALUES ($1,$2,$3,$4)`,
      [ws, wer, rolle!.id, wer === ich],
    );
  }
  const t = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'Etwas','a0') RETURNING id`,
    [ws],
  );
  task = t!.id;
});

after(async () => {
  await pool.end();
});

/*
 * Wie viele Auftraege es zu DIESER Aufgabe gibt.
 *
 * Gezaehlt wird ueber die Aufgaben-Id im Koerper -- und darum muss sie auch
 * drinstehen. Mein erster Versuch gab als Adresse ein `…/a/x` mit, und damit
 * enthielt der Mail-Auftrag die Id nirgends: der Test meldete „keine Mail",
 * waehrend die Mail danebenlag. Eine Zaehlung, die ihren Gegenstand nicht
 * findet, sagt dasselbe wie „gibt es nicht" -- und das ist die unangenehmste
 * Sorte falscher Befund.
 */
const auftraege = async (kind: string): Promise<number> => {
  const rows = await queryRows<{ n: string }>(
    pool,
    `SELECT count(*) AS n FROM jobs WHERE kind = $1 AND payload::text LIKE '%' || $2 || '%'`,
    [kind, task],
  );
  return Number(rows[0]!.n);
};

test('keine Zeile heisst Vorgabe — und die steht im Kern', async () => {
  /*
   * Eine Vorgabe in der Datenbank muesste beim Anlegen jedes Kontos fuer jede
   * Art eine Zeile schreiben und bei jeder neuen Art ueber alle Konten
   * wandern.
   */
  assert.deepEqual(await channelsFor(pool, du, 'assigned'), { email: true, push: true });
  assert.deepEqual(await channelsFor(pool, du, 'commented'), { email: false, push: false });
});

test('eine Zuweisung geht in den Posteingang UND hinaus', async () => {
  const vorherMail = await auftraege('mail.send');
  const vorherPush = await auftraege('push.send');

  await withTransaction(pool, (client) =>
    deliver(client, {
      userId: du,
      actorId: ich,
      workspaceId: ws,
      kind: 'assigned',
      taskId: task,
      title: 'Etwas',
      body: 'Dir zugewiesen',
      url: `https://example.test/a/${task}`,
    }),
  );

  const posteingang = await queryRows<{ id: string }>(
    pool,
    'SELECT id FROM notifications WHERE user_id = $1 AND task_id = $2',
    [du, task],
  );
  assert.equal(posteingang.length, 1);
  assert.equal(await auftraege('mail.send'), vorherMail + 1);
  assert.equal(await auftraege('push.send'), vorherPush + 1);
});

test('abgestellt heisst abgestellt — der Posteingang bleibt', async () => {
  await setChannels(pool, du, 'commented', { email: false, push: false });
  const vorherMail = await auftraege('mail.send');
  const vorherPush = await auftraege('push.send');

  await withTransaction(pool, (client) =>
    deliver(client, {
      userId: du,
      actorId: ich,
      workspaceId: ws,
      kind: 'commented',
      taskId: task,
      title: 'Etwas',
      body: 'Jemand schreibt',
      url: `https://example.test/a/${task}`,
    }),
  );

  // Kein Auftrag hinaus …
  assert.equal(await auftraege('mail.send'), vorherMail);
  assert.equal(await auftraege('push.send'), vorherPush);
  // … aber die Zeile im Posteingang steht. Er ist kein Kanal, sondern der Ort,
  // an dem eine Meldung ohnehin steht.
  const rows = await queryRows<{ id: string }>(
    pool,
    'SELECT id FROM notifications WHERE user_id = $1 AND task_id = $2',
    [du, task],
  );
  assert.equal(rows.length, 2);
});

test('ueber sich selbst meldet niemand', async () => {
  const vorherPush = await auftraege('push.send');
  await withTransaction(pool, (client) =>
    deliver(client, {
      userId: ich,
      actorId: ich,
      workspaceId: ws,
      kind: 'assigned',
      taskId: task,
      title: 'Etwas',
      body: 'Dir zugewiesen',
      url: `https://example.test/a/${task}`,
    }),
  );
  assert.equal(await auftraege('push.send'), vorherPush);
});

test('die Erinnerung steht NICHT im Posteingang', async () => {
  // Sie ist keine Nachricht von jemandem, sondern eine Verabredung mit sich
  // selbst -- und sie steht schon als Aufgabe da.
  const vorher = await queryRows<{ id: string }>(
    pool,
    'SELECT id FROM notifications WHERE user_id = $1',
    [du],
  );
  await withTransaction(pool, (client) =>
    deliver(client, {
      userId: du,
      actorId: null,
      workspaceId: ws,
      kind: 'reminder',
      taskId: task,
      title: 'Etwas',
      body: 'steht heute an',
      url: `https://example.test/a/${task}`,
    }),
  );
  const nachher = await queryRows<{ id: string }>(
    pool,
    'SELECT id FROM notifications WHERE user_id = $1',
    [du],
  );
  assert.equal(nachher.length, vorher.length);
});

test('wer nicht mehr Mitglied ist, bekommt nichts — nicht einmal in den Posteingang', async () => {
  /*
   * Audit 12.09.2026, F13. Die Empfänger kommen aus Urheber und Zuständigen;
   * beides überlebt den Austritt. Vorher ging die Mail mit Titel und
   * Kommentartext trotzdem hinaus.
   */
  const fremd = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Fort') RETURNING id`,
    [`deliver-fort-${process.pid}@t.tools`],
  );
  const vorherMail = await auftraege('mail.send');
  const vorherPush = await auftraege('push.send');
  await withTransaction(pool, (client) =>
    deliver(client, {
      userId: fremd!.id,
      actorId: ich,
      workspaceId: ws,
      kind: 'commented',
      taskId: task,
      title: 'Etwas',
      body: 'ein vertraulicher Satz',
      url: `https://example.test/a/${task}`,
    }),
  );
  const posteingang = await queryRows<{ id: string }>(
    pool,
    'SELECT id FROM notifications WHERE user_id = $1 AND task_id = $2',
    [fremd!.id, task],
  );
  assert.equal(posteingang.length, 0);
  assert.equal(await auftraege('mail.send'), vorherMail);
  assert.equal(await auftraege('push.send'), vorherPush);
});
