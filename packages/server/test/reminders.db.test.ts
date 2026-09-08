/**
 * SOTE — Erinnerungen.
 *
 * Die Zusage, um die es hier geht: **genau einmal je Tag** — obwohl der Läufer
 * „mindestens einmal" sagt. Sie hält, weil Quittung und Mailauftrag in
 * derselben Transaktion entstehen; das Zustellen selbst bleibt „mindestens
 * einmal", denn das verlässt den Server.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { enqueue, runOne } from '../src/jobs.js';

/** Nur die eigenen Auftragsnamen -- die Testdateien teilen eine Datenbank. */
const MEINE = ['reminders.tick'] as const;
import { migrate } from '../src/migrate.js';
import { scheduleReminders } from '../src/reminders.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let wer: string;
let ws: string;

before(async () => {
  process.env['SOTE_SMTP_HOST'] = 'mail.example';
  process.env['SOTE_MAIL_FROM'] = 'sote@example';
  process.env['SOTE_BASE_URL'] = 'https://sote.example';
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Rita Riemann')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Rita Riemann' RETURNING id`,
    [`rem-${process.pid}@example.org`],
  );
  wer = u!.id;
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`rem-${process.pid}`],
  );
  ws = w!.id;
});

beforeEach(async () => {
  // Nur die eigenen — sonst räumt dieser Lauf den anderen Testdateien die
  // Zeilen weg (genau das ist mir passiert).
  await pool.query("DELETE FROM jobs WHERE kind IN ('reminders.tick','mail.send')");
  await pool.query('DELETE FROM reminders_sent WHERE user_id = $1', [wer]);
  await pool.query('DELETE FROM tasks WHERE workspace_id = $1', [ws]);
  await pool.query("DELETE FROM settings WHERE scope = 'user' AND scope_id = $1", [wer]);
});

after(async () => {
  await pool.end();
});

/** Die Einstellung der Person: Zone und Erinnerungszeit. */
async function will(at: string | null, zone = 'UTC'): Promise<void> {
  await pool.query(
    `INSERT INTO settings (scope, scope_id, data) VALUES ('user', $1, $2)
     ON CONFLICT (scope, scope_id) DO UPDATE SET data = EXCLUDED.data`,
    [wer, at === null ? { zone } : { zone, reminders: { at } }],
  );
}

async function tick(): Promise<void> {
  await enqueue(pool, 'reminders.tick');
  assert.equal(await runOne(pool, new Date(), MEINE), true);
}

const briefe = async () =>
  queryRows<{ payload: Record<string, unknown> }>(
    pool,
    "SELECT payload FROM jobs WHERE kind = 'mail.send' ORDER BY created_at",
  );

test('ohne Einstellung kommt keine Post', async () => {
  /*
   * Aus, bis jemand ja sagt. Wer sich anmeldet, hat nicht um Mail gebeten — und
   * eine Anwendung, die von selbst zu schreiben anfängt, ist eine, die man
   * abstellt, bevor man sie kennt.
   */
  await will(null);
  await tick();
  assert.equal((await briefe()).length, 0);
});

test('wer eine Zeit gewählt hat, bekommt einen Brief', async () => {
  await will('00:00');
  await tick();
  const alle = await briefe();
  assert.equal(alle.length, 1);
  assert.match(String(alle[0]!.payload['text']), /Guten Morgen, Rita/);
  // Und der Weg zum Abstellen steht drin: eine Erinnerung ohne Ausschalter
  // ist eine, die man im Postfach filtert.
  assert.match(String(alle[0]!.payload['text']), /abstellst|abstellen|ab\./);
});

test('zweimal laufen schickt keinen zweiten Brief', async () => {
  /*
   * Der Kern. Der Läufer sagt „mindestens einmal" zu, also MUSS ein zweiter
   * Lauf vorkommen — und darf nichts tun.
   */
  await will('00:00');
  await tick();
  await tick();
  await tick();
  assert.equal((await briefe()).length, 1);
});

test('vor der gewählten Zeit kommt nichts', async () => {
  // 23:59 in UTC: es sei denn, der Test läuft in der letzten Minute des Tages —
  // dann ist die Zeit vorbei und der Brief richtig. Darum wird die Aussage an
  // der Uhr geprüft und nicht behauptet.
  await will('23:59');
  await tick();
  const jetzt = await queryOne<{ hm: string }>(
    pool,
    "SELECT to_char(now(), 'HH24:MI') AS hm",
  );
  const soll = jetzt!.hm >= '23:59' ? 1 : 0;
  assert.equal((await briefe()).length, soll);
});

test('die Zone der Person entscheidet, welcher Tag es ist', async () => {
  /*
   * Wer in Tokio um 8 Uhr erinnert wird, soll seinen Brief am japanischen
   * Dienstag bekommen. Geprüft wird das an der Quittung: ihr Datum ist das
   * örtliche und nicht das von UTC.
   */
  await will('00:00', 'Asia/Tokyo');
  await tick();
  const quittung = await queryOne<{ for_date: Date }>(
    pool,
    'SELECT for_date FROM reminders_sent WHERE user_id = $1',
    [wer],
  );
  const erwartet = await queryOne<{ d: string }>(
    pool,
    "SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date)::text AS d",
  );
  assert.equal(quittung!.for_date.toISOString().slice(0, 10), erwartet!.d);
});

test('der Brief nennt Heutiges und Überfälliges getrennt', async () => {
  // Zwei Zahlen, weil es zwei Sachen sind: „5 Aufgaben" sagt nicht, ob etwas
  // brennt.
  await will('00:00');
  await pool.query(
    `INSERT INTO tasks (workspace_id, title, sort_key, created_by, planned_at)
     VALUES ($1,'heute','a',$2, now())`,
    [ws, wer],
  );
  await pool.query(
    `INSERT INTO tasks (workspace_id, title, sort_key, created_by, due_at)
     VALUES ($1,'spät','b',$2, now() - interval '3 days')`,
    [ws, wer],
  );
  await tick();
  const [brief] = await briefe();
  const text = String(brief!.payload['text']);
  assert.match(text, /Heute: 1 Aufgabe/);
  assert.match(text, /Überfällig: 1 Aufgabe/);
  // Und der Betreff sagt es auch: wer im Postfach überfliegt, liest nur den.
  assert.match(String(brief!.payload['subject']), /überfällig/);
});

test('auch an einem leeren Tag kommt ein Brief', async () => {
  /*
   * Ein Brief, der nur bei Arbeit kommt, ist einer, dessen Ausbleiben zweierlei
   * heißen kann: nichts zu tun, oder SOTE ist kaputt.
   */
  await will('00:00');
  await tick();
  const [brief] = await briefe();
  assert.match(String(brief!.payload['text']), /nichts an, und nichts ist überfällig/);
});

test('ohne Mailweg wird nicht eingereiht — und das wird gesagt', async () => {
  /*
   * Sonst liefe der Auftrag alle fünfzehn Minuten und **verbrauchte die
   * Quittungen** für Briefe, die niemand zustellt: nach einem Tag ohne
   * Mailserver hätte jeder eine Quittung und niemand einen Brief.
   */
  const keep = process.env['SOTE_SMTP_HOST'];
  delete process.env['SOTE_SMTP_HOST'];
  try {
    assert.equal(await scheduleReminders(pool), false);
    assert.equal(
      (await queryRows(pool, "SELECT id FROM jobs WHERE kind = 'reminders.tick'")).length,
      0,
    );
  } finally {
    process.env['SOTE_SMTP_HOST'] = keep;
  }
  assert.equal(await scheduleReminders(pool), true);
});

test('der Bearbeiter legt seinen nächsten Lauf selbst', async () => {
  await will('00:00');
  await tick();
  const naechster = await queryOne<{ run_at: Date }>(
    pool,
    "SELECT run_at FROM jobs WHERE kind = 'reminders.tick' AND done_at IS NULL",
  );
  assert.notEqual(naechster, undefined);
  assert.ok(naechster!.run_at.getTime() > Date.now() + 10 * 60_000);
});
