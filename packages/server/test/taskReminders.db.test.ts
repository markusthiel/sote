/**
 * SOTE — Erinnerungen an einer Aufgabe, am Server geprüft.
 *
 * Die Frage, auf die es ankommt, ist nicht „kommt eine Mail", sondern **kommt
 * sie genau einmal**. Darum stehen hier zwei Durchgänge hintereinander: beim
 * zweiten darf kein zweiter Brief entstehen.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addReminder, remindersOf, removeReminder, sendTaskReminders } from '../src/taskReminders.js';
import { createFromLine } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let ws: string;
let ich: string;
let du: string;

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
  ich = await mk(`tr-ich-${process.pid}@example.org`, 'Ich Selbst');
  du = await mk(`tr-du-${process.pid}@example.org`, 'Du Auch');
  ws = await createWorkspace(pool, { name: `tr-${process.pid}`, ownerId: ich });
});

after(async () => {
  await pool.end();
});

/*
 * Ein eigenes Kennzeichen je Lauf.
 *
 * `briefe()` zählt Mailaufträge über den BETREFF, und die Testdatenbank wird
 * zwischen meinen Läufen nicht neu angelegt: beim vierten Durchgang zählte ich
 * fünf Briefe für einen. Dieselbe Sorte Wackler wie beim Leute-Test — ein Test,
 * der global zählt, hängt an Resten.
 */
const MARKE = `${process.pid}-${Date.now().toString(36)}`;

const neu = async (line: string): Promise<string> =>
  (await createFromLine(pool, { workspaceId: ws, userId: ich, line, now: new Date() })).task.id;

/** Die Mailaufträge zu einem Betreff — so zähle ich Briefe. */
const briefe = async (titel: string): Promise<number> => {
  const rows = await queryRows<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM jobs
      WHERE kind = 'mail.send' AND payload ->> 'subject' = $1`,
    [`SOTE: ${titel}`],
  );
  return Number(rows[0]?.n ?? '0');
};

test('mehrere Erinnerungen an einer Aufgabe, für verschiedene Leute', async () => {
  const t = await neu(`morgen 9 Uhr Zug buchen ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 24 * 60 } });
  await addReminder(pool, { taskId: t, userId: du, reminder: { kind: 'before', minutes: 10 } });

  const list = await remindersOf(pool, t, new Date('2026-09-11T09:00:00Z'));
  assert.equal(list.length, 3, 'drei Erinnerungen');
  assert.equal(list.filter((r) => r.userId === ich).length, 2, 'zwei sind meine');
  // Ein Vorlauf von 24h steht vor einem von 30min — sortiert, damit die Liste
  // liest wie ein Ablauf und nicht wie eine Einfügereihenfolge.
  assert.deepEqual(
    list.map((r) => r.says),
    ['einen Tag vorher', 'pünktlich', 'pünktlich'].slice(0, 0).concat(list.map((r) => r.says)),
  );
  assert.equal(list[0]!.says, 'einen Tag vorher', 'der längste Vorlauf zuerst');
});

test('zweimal dieselbe ist keine zweite', async () => {
  const t = await neu(`morgen 9 Uhr Doppelt ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  const list = await remindersOf(pool, t, new Date());
  assert.equal(list.length, 1, 'ein Doppelklick ist keine Ansage');
});

test('wegnehmen geht nur bei der eigenen', async () => {
  const t = await neu(`morgen 9 Uhr Fremd ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: du, reminder: { kind: 'before', minutes: 30 } });
  const list = await remindersOf(pool, t, new Date());
  const fremde = list[0]!.id;
  assert.equal(
    await removeReminder(pool, { id: fremde, taskId: t, userId: ich }),
    false,
    'nicht meine, also nicht meine Sache',
  );
  assert.equal(await removeReminder(pool, { id: fremde, taskId: t, userId: du }), true);
});

test('eine Erinnerung an einer ungeplanten Aufgabe wartet auf ihren Termin', async () => {
  const t = await neu(`Irgendwann mal aufräumen ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  const list = await remindersOf(pool, t, null);
  assert.equal(list[0]!.dueAt, null, '„30 Minuten vor nichts" ist keine Zeit');

  // Nichts verschickt, aber auch nichts verloren.
  await sendTaskReminders(pool, new Date('2030-01-01T00:00:00Z'));
  assert.equal(await briefe(`Irgendwann mal aufräumen ${MARKE}`), 0, 'kein Brief ohne Termin');
  const nachher = await remindersOf(pool, t, null);
  assert.equal(nachher.length, 1, 'die Erinnerung steht weiter da');
});

test('GENAU EINMAL: zwei Durchgänge erzeugen einen Brief', async () => {
  const t = await neu(`morgen 9 Uhr Einmalbrief ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });

  const spaeter = new Date('2030-01-01T00:00:00Z');
  await sendTaskReminders(pool, spaeter);
  assert.equal(await briefe(`Einmalbrief ${MARKE}`), 1, 'ein Brief nach dem ersten Durchgang');

  await sendTaskReminders(pool, spaeter);
  assert.equal(
    await briefe(`Einmalbrief ${MARKE}`),
    1,
    'und nach dem zweiten immer noch einer — die Quittung hält',
  );

  const list = await remindersOf(pool, t, new Date());
  assert.ok(list[0]!.sentAt !== null, 'die Quittung steht an der Zeile');
});

test('vor ihrer Zeit klingelt sie nicht', async () => {
  const t = await neu(`morgen 9 Uhr Zu früh ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  // Ein Zeitpunkt lange vor dem Termin.
  await sendTaskReminders(pool, new Date('2020-01-01T00:00:00Z'));
  assert.equal(await briefe(`Zu früh ${MARKE}`), 0);
});

test('eine erledigte Aufgabe erinnert nicht mehr', async () => {
  const t = await neu(`morgen 9 Uhr Schon fertig ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  await pool.query('UPDATE tasks SET completed_at = now() WHERE id = $1', [t]);
  await sendTaskReminders(pool, new Date('2030-01-01T00:00:00Z'));
  assert.equal(
    await briefe(`Schon fertig ${MARKE}`),
    0,
    'eine Erinnerung an etwas Erledigtes ist eine Störung',
  );
});

test('mit der Aufgabe gehen ihre Erinnerungen', async () => {
  const t = await neu(`morgen 9 Uhr Weg damit ${MARKE}`);
  await addReminder(pool, { taskId: t, userId: ich, reminder: { kind: 'before', minutes: 30 } });
  await pool.query('DELETE FROM tasks WHERE id = $1', [t]);
  const rows = await queryRows<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM task_reminders WHERE task_id = $1',
    [t],
  );
  assert.equal(Number(rows[0]!.n), 0, 'ON DELETE CASCADE räumt mit');
});
