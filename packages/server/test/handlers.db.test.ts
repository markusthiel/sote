/**
 * SOTE — der Papierkorb leert sich.
 *
 * Der erste Bearbeiter, und er prüft vor allem die beiden Vorsichten: gefragt
 * wird nach `trashed_at` und nicht nach dem Alter der Zeile, und ein Projekt
 * verschwindet nicht, solange darunter etwas liegt, dessen Frist noch läuft.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { TRASH_DAYS } from '../src/handlers.js';
import { enqueue, runOne } from '../src/jobs.js';

/** Nur die eigenen Auftragsnamen -- die Testdateien teilen eine Datenbank. */
const MEINE = ['trash.purge'] as const;
import { migrate } from '../src/migrate.js';
import { makeFolder, makeList } from './support/tree.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let ws: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  // Die Bearbeiter melden sich beim Laden des Moduls an — der Import oben
  // genügt, und `TRASH_DAYS` ist der Beleg, dass er wirklich stattfand.
  assert.equal(TRASH_DAYS, 30);
});

beforeEach(async () => {
  // Nur die eigenen: die Testdateien laufen parallel gegen dieselbe Datenbank.
  await pool.query("DELETE FROM jobs WHERE kind = 'trash.purge'");
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`purge-${Date.now()}-${Math.random()}`],
  );
  ws = w!.id;
});

after(async () => {
  await pool.end();
});

const alt = (tage: number): string => `now() - interval '${tage} days'`;

/**
 * Mit `uniqueKey` — genau so, wie es im Server geschieht.
 *
 * Ohne ihn lief mein Test nie in den Konflikt mit der fertigen Zeile, und
 * genau dort war der Fehler: die Wiederholung war nach dem ersten Lauf still
 * tot. **Ein Test, der den Weg nicht geht, prüft ihn nicht** — und gefunden
 * habe ich es nicht durch den Test, sondern durch einen Blick in die
 * Datenbank des laufenden Servers.
 */
/**
 * Warum die Servertests **nacheinander** laufen (`--test-concurrency=1`).
 *
 * Dieser Bearbeiter löscht über **alle** Arbeitsbereiche — das ist im Betrieb
 * richtig und im Test das Problem: die Testdateien teilen eine Datenbank, und
 * während dieser hier aufräumt, schreiben andere dieselben Tabellen. Dann
 * scheitert das `DELETE`, der Auftrag gilt als fehlgeschlagen, und sein
 * Nachfolger entsteht nicht.
 *
 * Gefunden als Wackler: einer von drei Läufen, immer derselbe Test, auch auf
 * frischer Datenbank. Ein Geltungsbereich nach Auftragsnamen half nicht, weil
 * die Kollision nicht in der Warteschlange liegt, sondern in den Daten.
 *
 * Die Alternative wäre eine Datenbank je Testdatei — sauberer, aber eine
 * Migration je Datei, und das kostet mehr als die verlorene Nebenläufigkeit.
 */
async function purge(): Promise<void> {
  await enqueue(pool, 'trash.purge', { uniqueKey: 'trash.purge' });
  assert.equal(await runOne(pool, new Date(), MEINE), true);
  /*
   * Und ER MUSS GELAUFEN SEIN, nicht bloß geholt worden.
   *
   * `runOne` gibt `true` zurück, auch wenn der Bearbeiter geworfen hat — es
   * heißt „es gab einen Auftrag" und nicht „er hat funktioniert". Ohne diese
   * Zeile war der Wackler eine Meldung über einen fehlenden Nachfolger, und
   * die eigentliche Ursache stand ungelesen in `last_error`.
   */
  const gelaufen = await queryOne<{ done_at: Date | null; last_error: string | null }>(
    pool,
    "SELECT done_at, last_error FROM jobs WHERE kind = 'trash.purge' AND attempts > 0",
  );
  assert.notEqual(gelaufen!.done_at, null, `Bearbeiter fehlgeschlagen: ${gelaufen!.last_error}`);
}

async function taskCount(): Promise<number> {
  const r = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM tasks WHERE workspace_id = $1',
    [ws],
  );
  return Number(r!.n);
}

test('was länger als dreißig Tage im Korb liegt, ist weg — der Rest bleibt', async () => {
  const p = await makeList(pool, ws, 'Haus');
  const mk = async (title: string, sql: string | null): Promise<void> => {
    await pool.query(
      `INSERT INTO tasks (workspace_id, project_id, title, sort_key, trashed_at)
       VALUES ($1,$2,$3,$3, ${sql ?? 'NULL'})`,
      [ws, p, title],
    );
  };
  await mk('lebt', null);
  await mk('gestern weggeworfen', alt(1));
  await mk('vor 40 Tagen weggeworfen', alt(40));
  assert.equal(await taskCount(), 3);

  await purge();

  assert.equal(await taskCount(), 2);
  const weg = await queryOne(
    pool,
    "SELECT id FROM tasks WHERE workspace_id = $1 AND title = 'vor 40 Tagen weggeworfen'",
    [ws],
  );
  assert.equal(weg, undefined);
});

test('gefragt wird nach dem Wegwerfen, nicht nach dem Alter der Zeile', async () => {
  // Eine alte Aufgabe, die GESTERN weggeworfen wurde, hat noch dreißig Tage.
  const p = await makeList(pool, ws, 'Haus');
  await pool.query(
    `INSERT INTO tasks (workspace_id, project_id, title, sort_key, created_at, trashed_at)
     VALUES ($1,$2,'alt aber frisch weggeworfen','a', ${alt(400)}, ${alt(1)})`,
    [ws, p],
  );
  await purge();
  assert.equal(await taskCount(), 1);
});

test('ein Projekt verschwindet nicht, solange darunter etwas noch zurückkann', async () => {
  /*
   * Der Fall, der ohne die Prüfung still Schaden macht: ein Projekt löscht per
   * Fremdschlüssel seine Aufgaben mit. Liefe es zuerst, verschwänden Aufgaben,
   * deren eigene Frist noch läuft — jemand holt ein Projekt aus dem Korb und
   * findet es leer.
   */
  const p = await makeList(pool, ws, 'Haus');
  await pool.query(`UPDATE projects SET trashed_at = ${alt(40)} WHERE id = $1`, [p]);
  await pool.query(
    `INSERT INTO tasks (workspace_id, project_id, title, sort_key, trashed_at)
     VALUES ($1,$2,'gestern weg','a', ${alt(1)})`,
    [ws, p],
  );
  await purge();

  const projekt = await queryOne(pool, 'SELECT id FROM projects WHERE id = $1', [p]);
  assert.notEqual(projekt, undefined, 'das Projekt ist noch da');
  assert.equal(await taskCount(), 1, 'und die Aufgabe auch');
});

test('ein Ordner verschwindet nicht, solange ein Kind noch zurückkann', async () => {
  const ordner = await makeFolder(pool, ws, 'Nur Ordner', 'z1');
  const kind = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,'Kind','list','z2') RETURNING id`,
    [ws, ordner],
  );
  await pool.query(`UPDATE projects SET trashed_at = ${alt(40)} WHERE id = $1`, [ordner]);
  await pool.query(`UPDATE projects SET trashed_at = ${alt(2)} WHERE id = $1`, [kind!.id]);
  await purge();
  assert.notEqual(
    await queryOne(pool, 'SELECT id FROM projects WHERE id = $1', [ordner]),
    undefined,
  );
});

test('die Wiederholung reisst nach dem ersten Lauf nicht ab', async () => {
  /*
   * Der Fehler, den es gab, und der Grund für diesen Test.
   *
   * Der erste Lauf war fertig, sein Folgeauftrag stiess auf die fertige Zeile
   * mit demselben Schlüssel, und das `DO UPDATE` wurde übersprungen: **still
   * keine Wiederholung mehr**. Zwei Läufe hintereinander sind der kürzeste
   * Weg, das zu bemerken.
   */
  await purge();
  const erster = await queryOne<{ id: string }>(
    pool,
    "SELECT id FROM jobs WHERE kind = 'trash.purge' AND done_at IS NULL",
  );
  assert.notEqual(erster, undefined, 'nach dem ersten Lauf liegt einer da');

  /*
   * Und nach dem zweiten wieder — nicht nur einmal.
   *
   * Statt `run_at` umzuschreiben wird dem Läufer gesagt, es sei später. Zwei
   * Gründe: die Umschreibung traf **alle** offenen Aufträge, also auch die
   * anderer Testdateien, und sie verglich eine Zeit aus der Datenbank mit einer
   * aus JavaScript — ein Wettlauf um Millisekunden, den ich als wandernden
   * Wackler bezahlt habe. Die Zeit ist ein Parameter; dann benutze ich sie.
   */
  assert.equal(await runOne(pool, new Date(Date.now() + 7 * 3_600_000), MEINE), true);
  const zweiter = await queryOne<{ id: string }>(
    pool,
    "SELECT id FROM jobs WHERE kind = 'trash.purge' AND done_at IS NULL",
  );
  assert.notEqual(zweiter, undefined, 'und nach dem zweiten auch');
  assert.notEqual(zweiter!.id, erster!.id, 'ein neuer, nicht derselbe');
});

test('zweimal laufen tut nichts Zusätzliches', async () => {
  // Die Zusage des Läufers ist „mindestens einmal" (Migration 0015), also muss
  // genau das gelten — ein DELETE, das nichts mehr findet, löscht nichts.
  const p = await makeList(pool, ws, 'Haus');
  await pool.query(
    `INSERT INTO tasks (workspace_id, project_id, title, sort_key, trashed_at)
     VALUES ($1,$2,'weg','a', ${alt(40)}), ($1,$2,'bleibt','b', NULL)`,
    [ws, p],
  );
  await purge();
  assert.equal(await taskCount(), 1);
  await purge();
  assert.equal(await taskCount(), 1);
});

test('der Bearbeiter legt seinen nächsten Lauf selbst', async () => {
  // Die Wiederholung liegt im Auftrag und nicht in einem Zeitplan daneben: so
  // gibt es genau einen Ort, an dem steht, wie oft etwas läuft.
  await purge();
  const naechster = await queryOne<{ run_at: Date; done_at: Date | null }>(
    pool,
    "SELECT run_at, done_at FROM jobs WHERE kind = 'trash.purge' AND done_at IS NULL",
  );
  assert.notEqual(naechster, undefined, 'es liegt einer in der Schlange');
  assert.ok(naechster!.run_at.getTime() > Date.now() + 3_600_000, 'und zwar später');
});
