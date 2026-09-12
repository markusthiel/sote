/**
 * SOTE — Wiederholung und Zuständige nachträglich ändern.
 *
 * Beides war bis hierher nur beim ANLEGEN setzbar: die Wiederholung über
 * `jeden Montag` im Schnellerfasser, die Zuständigen über `+name`. Danach gab
 * es keinen Weg mehr — kein Feld in `Patch`, keine Route. Die Spalten, der
 * Kern und das Abhaken waren fertig.
 *
 * Der letzte Test ist die Gegenprobe, die ich Markus schuldig war: erzeugt das
 * Abhaken einer wiederholten Aufgabe wirklich die nächste? Die Serverlogik
 * dafür stand da, geprüft war sie nie.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne } from '../src/db.js';
import { detail } from '../src/detail.js';
import { migrate } from '../src/migrate.js';
import { list } from '../src/notifications.js';
import { complete, createFromLine, patch } from '../src/tasks.js';

const URL_ =
process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

/*
 * Ohne `describe`: die anderen Servertests hier erklären `before` und `test`
 * auf oberster Ebene. Mit dem Rahmen meldete node:test „did not finish before
 * its parent and was cancelled" — wieder ein geratenes Muster statt des
 * nachgesehenen.
 */
let pool: Pool;
let ws: string;
let ich: string;
let du: string;
let fremd: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  /* Nachgesehen und nicht geraten: so legen die anderen Servertests Konten
   an — über `users` und `createWorkspace`, nicht über einen Einrichtungsweg
   mit Kennwort. Mein erster Versuch importierte `closePool` und
   `createAccountIn`, die es beide nicht gibt. */
  const mk = async (email: string, name: string): Promise<string> => {
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    [email, name],
  );
  return u!.id;
  };
  ich = await mk(`r-ich-${process.pid}@example.org`, 'Ich');
  du = await mk(`r-du-${process.pid}@example.org`, 'Du');
  fremd = await mk(`r-fremd-${process.pid}@example.org`, 'Fremd');
  ws = await createWorkspace(pool, { name: `r-${process.pid}`, ownerId: ich });
  await pool.query(
  `INSERT INTO workspace_members (workspace_id, user_id, role_id)
   SELECT $1, $2, id FROM roles WHERE workspace_id = $1 LIMIT 1`,
  [ws, du],
  );
});

after(async () => {
  await pool.end();
});

const neu = async (line: string) =>
  (await createFromLine(pool, { workspaceId: ws, userId: ich, line, now: new Date() })).task;

test('eine Wiederholung lässt sich setzen, wechseln und wegnehmen', async () => {
  const t = await neu('Fenster putzen');
  assert.equal(t.recur_rrule, null, 'anfangs einmalig');

  const woechentlich = await patch(pool, t.id, ws, {
  recurrence: { kind: 'calendar', rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: new Date() },
  });
  assert.equal(woechentlich.recur_rrule, 'FREQ=WEEKLY;BYDAY=MO');

  /*
   * Der Wechsel auf die andere Form muss die RRULE MITNEHMEN.
   *
   * `recurrenceOf` liest die Kalenderregel zuerst — bliebe sie stehen, käme
   * die Aufgabe weiter montags, obwohl „3 Tage nach Erledigung" dasteht.
   */
  const danach = await patch(pool, t.id, ws, {
  recurrence: { kind: 'afterCompletion', n: 3, unit: 'day' },
  });
  assert.equal(danach.recur_rrule, null, 'die alte Regel ist weg');
  assert.equal(danach.recur_after_n, 3);
  assert.equal(danach.recur_after_unit, 'day');

  const weg = await patch(pool, t.id, ws, { recurrence: null });
  assert.equal(weg.recur_rrule, null);
  assert.equal(weg.recur_after_n, null);
});

test('eine unsinnige Regel wird abgelehnt, nicht gespeichert', async () => {
  const t = await neu('Nichts');
  await assert.rejects(
  () =>
    patch(pool, t.id, ws, {
      recurrence: { kind: 'calendar', rrule: 'FREQ=FORTNIGHTLY', dtstart: new Date() },
    }),
  /FREQ|Wiederholung|kenne/i,
  );
  const row = await pool.query('SELECT recur_rrule FROM tasks WHERE id = $1', [t.id]);
  assert.equal(row.rows[0].recur_rrule, null, 'nichts geschrieben');
});

test('Zuständige werden ganz gesetzt — derselbe Weg nimmt zurück', async () => {
  const t = await neu('Dach prüfen');
  await patch(pool, t.id, ws, { assignees: [ich, du] });
  let d = await detail(pool, t.id, ws);
  assert.deepEqual(
  d.assignees.map((a) => a.userId).sort(),
  [ich, du].sort(),
  'beide zuständig',
  );

  await patch(pool, t.id, ws, { assignees: [du] });
  d = await detail(pool, t.id, ws);
  assert.deepEqual(d.assignees.map((a) => a.userId), [du], 'nur noch einer');

  await patch(pool, t.id, ws, { assignees: [] });
  d = await detail(pool, t.id, ws);
  assert.equal(d.assignees.length, 0, 'niemand');
});

test('wer nachträglich zuständig wird, erfährt es — einmal, und nicht von sich selbst', async () => {
  /*
   * Markus, mit einem eingeladenen Konto: „Ich habe gerade mit einem
   * eingeladenen User eine Aufgabe zugewiesen an meinen Hauptuser. Jetzt
   * sollte ich ja eine Benachrichtigung bekommen. Da kam gar nichts an."
   *
   * Beim Anlegen über `@name` gab es die Meldung; im Detail über `patch`
   * fehlte sie ganz. Derselbe Vorgang, zwei Wege, eine Meldung.
   */
  const t = await neu('Rückruf');
  await pool.query('DELETE FROM notifications WHERE user_id IN ($1,$2)', [ich, du]);

  await patch(pool, t.id, ws, { assignees: [du] }, ich);
  let meine = await list(pool, du);
  assert.equal(meine.length, 1, '„du" hat eine Meldung');
  assert.equal(meine[0]!.kind, 'assigned');
  assert.equal(meine[0]!.taskId, t.id);
  assert.equal((await list(pool, ich)).length, 0, 'der Zuweisende bekommt keine');

  // Nochmal dieselbe Liste, plus ich selbst: keine zweite Meldung für „du",
  // und keine für mich über mich.
  await patch(pool, t.id, ws, { assignees: [du, ich] }, ich);
  meine = await list(pool, du);
  assert.equal(meine.length, 1, 'wer schon zuständig war, wird nicht erneut gemeldet');
  assert.equal((await list(pool, ich)).length, 0, 'über sich selbst meldet niemand');

  // Und der Auftrag für Mail und Gerät liegt — die Zuweisung ist die laute Art.
  const jobs = await pool.query(
    `SELECT kind FROM jobs WHERE payload::text LIKE '%' || $1::text || '%'`,
    [t.id],
  );
  assert.ok(jobs.rows.length > 0, 'ein Zustellauftrag wurde gelegt');
});

test('wer nicht Mitglied ist, kann nicht zuständig werden', async () => {
  const t = await neu('Fremd');
  await assert.rejects(
  () => patch(pool, t.id, ws, { assignees: [fremd] }),
  /Mitglieder/,
  'eine Id von außen schreibt keine Zuständigkeit',
  );
  const d = await detail(pool, t.id, ws);
  assert.equal(d.assignees.length, 0, 'und nichts blieb hängen');
});

test('GEGENPROBE: Abhaken einer wiederholten Aufgabe erzeugt die nächste', async () => {
  const t = await neu('morgen 9 Uhr Müll rausbringen');
  await patch(pool, t.id, ws, {
  recurrence: { kind: 'calendar', rrule: 'FREQ=DAILY', dtstart: new Date() },
  });

  const vorher = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE workspace_id = $1', [
  ws,
  ]);
  // `complete(pool, taskId, userId, at)` — nachgesehen. Mein Aufruf gab den
  // Arbeitsbereich an die Stelle der Nutzer-Id und das Datum an die des
  // Zeitpunkts; Postgres meldete eine uuid, wo ein Zeitstempel hingehört.
  await complete(pool, t.id, ich, new Date());
  const nachher = await pool.query(
  'SELECT count(*)::int AS n FROM tasks WHERE workspace_id = $1',
  [ws],
  );
  assert.equal(
  nachher.rows[0].n,
  vorher.rows[0].n + 1,
  'es gibt eine Aufgabe mehr als vorher',
  );

  const folge = await pool.query(
  `SELECT title, planned_at, completed_at, recur_rrule FROM tasks
    WHERE workspace_id = $1 AND title = 'Müll rausbringen' AND completed_at IS NULL`,
  [ws],
  );
  assert.equal(folge.rows.length, 1, 'genau eine offene Folge');
  assert.equal(folge.rows[0].recur_rrule, 'FREQ=DAILY', 'die Regel geht mit');
  assert.ok(folge.rows[0].planned_at !== null, 'und sie ist geplant');
});
