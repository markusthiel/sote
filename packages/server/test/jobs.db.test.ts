/**
 * SOTE — der Läufer.
 *
 * Die Zusage, um die es hier geht (Migration 0015): **mindestens einmal**. Ein
 * Bearbeiter muss mehrfaches Laufen aushalten, nichts wird still weggeworfen,
 * und ein unbekannter Name ist ein Fehler.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { enqueue, handle, runOne, tick } from '../src/jobs.js';

/**
 * Nur die eigenen Auftragsnamen.
 *
 * Die Testdateien laufen parallel gegen dieselbe Datenbank, und `runOne` nimmt
 * ohne Geltungsbereich den ältesten faelligen Auftrag -- also den einer anderen
 * Datei. So gefunden: ein Test schlug fehl, den ich nicht angefasst hatte.
 */
const MEINE = ['test.ok', 'test.boom', 'test.gibtsnicht'] as const;
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
const lief: string[] = [];

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  handle('test.ok', async ({ job }) => {
    lief.push(String(job.payload['was'] ?? 'ok'));
  });
  handle('test.boom', async () => {
    throw new Error('geht nicht');
  });
});

beforeEach(async () => {
  /*
   * Nur die EIGENEN Aufträge.
   *
   * `DELETE FROM jobs` räumte den anderen Testdateien die Zeilen weg — sie
   * laufen parallel gegen dieselbe Datenbank, und der Papierkorb-Test schlug
   * fehl, weil dieser hier seinen Folgeauftrag löschte. Der Fehler war nicht im
   * Code, sondern in meiner Aufräumzeile.
   */
  await pool.query("DELETE FROM jobs WHERE kind LIKE 'test.%'");
  lief.length = 0;
});

after(async () => {
  await pool.end();
});

const jobRow = async (kind: string) =>
  queryOne<{ attempts: number; done_at: Date | null; last_error: string | null; run_at: Date }>(
    pool,
    'SELECT attempts, done_at, last_error, run_at FROM jobs WHERE kind = $1',
    [kind],
  );

test('ein fälliger Auftrag läuft und wird quittiert', async () => {
  await enqueue(pool, 'test.ok', { payload: { was: 'eins' } });
  assert.equal(await runOne(pool, new Date(), MEINE), true);
  assert.deepEqual(lief, ['eins']);
  const row = await jobRow('test.ok');
  assert.notEqual(row!.done_at, null);
  assert.equal(row!.attempts, 1);
});

test('ein Auftrag in der Zukunft läuft nicht', async () => {
  const gleich = new Date(Date.now() + 3_600_000);
  await enqueue(pool, 'test.ok', { runAt: gleich });
  assert.equal(await runOne(pool, new Date(), MEINE), false);
  assert.deepEqual(lief, []);
  // Und später schon.
  assert.equal(await runOne(pool, new Date(gleich.getTime() + 1000), MEINE), true);
});

test('ein Fehler wirft nicht, sondern wartet — und wird sichtbar', async () => {
  /*
   * Nichts wird still weggeworfen: der Auftrag bleibt liegen, mit seinem
   * letzten Fehler. Einer, der still verschwindet, ist einer, von dem der
   * Betreiber nie erfährt, dass er nötig war.
   */
  await enqueue(pool, 'test.boom');
  const jetzt = new Date();
  assert.equal(await runOne(pool, jetzt, MEINE), true, 'der Läufer selbst wirft nicht');
  const row = await jobRow('test.boom');
  assert.equal(row!.done_at, null);
  assert.equal(row!.attempts, 1);
  assert.match(row!.last_error ?? '', /geht nicht/);
  // Und er wartet, statt sofort wieder zu laufen: eine Minute beim ersten Mal.
  assert.ok(row!.run_at.getTime() > jetzt.getTime() + 50_000, 'wartet');
});

test('nach fünf Versuchen bleibt er liegen, statt zu verschwinden', async () => {
  await enqueue(pool, 'test.boom');
  let jetzt = new Date();
  for (let i = 0; i < 8; i += 1) {
    // Weit genug vorspulen, dass die Wartezeit vorbei ist.
    jetzt = new Date(jetzt.getTime() + 60 * 60_000);
    await runOne(pool, jetzt, MEINE);
  }
  const row = await jobRow('test.boom');
  assert.equal(row!.attempts, 5, 'genau fünf Versuche');
  assert.equal(row!.done_at, null, 'und er ist noch da');
});

test('ein unbekannter Name ist ein Fehler, kein Stillschweigen', async () => {
  /*
   * Ein Auftrag ohne Bearbeiter ist ein Tippfehler oder ein Rest aus einer
   * alten Fassung — beides will man sehen.
   */
  await enqueue(pool, 'test.gibtsnicht');
  assert.equal(await runOne(pool, new Date(), MEINE), true);
  const row = await jobRow('test.gibtsnicht');
  assert.equal(row!.done_at, null);
  assert.match(row!.last_error ?? '', /kein Bearbeiter/);
});

test('derselbe wiederkehrende Auftrag liegt nur einmal in der Schlange', async () => {
  /*
   * Ohne `uniqueKey` entstehen bei jedem Neustart neue Ticks, und nach zehn
   * Neustarts läuft das Aufräumen zehnmal.
   */
  for (let i = 0; i < 5; i += 1) {
    await enqueue(pool, 'test.ok', { uniqueKey: 'test.tick' });
  }
  const alle = await queryRows(pool, "SELECT id FROM jobs WHERE kind = 'test.ok'");
  assert.equal(alle.length, 1);
});

test('beim zweiten Legen gewinnt der frühere Zeitpunkt', async () => {
  // „Läuft spätestens dann" ist die Zusage, die man will — „irgendwann später"
  // wäre eine, die sich mit jedem Neustart verschiebt.
  const spaet = new Date(Date.now() + 6 * 3_600_000);
  const frueh = new Date(Date.now() + 60_000);
  await enqueue(pool, 'test.ok', { uniqueKey: 'test.tick', runAt: spaet });
  await enqueue(pool, 'test.ok', { uniqueKey: 'test.tick', runAt: frueh });
  const row = await jobRow('test.ok');
  assert.ok(Math.abs(row!.run_at.getTime() - frueh.getTime()) < 2000, 'der frühere gilt');
});

test('ein Auftrag, den ein abgestürzter Prozess hielt, wird wieder geholt', async () => {
  /*
   * `locked_at` ist eine Zeit und kein Flag: ein Flag, das ein abgestürzter
   * Prozess gesetzt hat, bleibt für immer gesetzt.
   */
  await enqueue(pool, 'test.ok');
  await pool.query("UPDATE jobs SET locked_at = now() - interval '1 minute'");
  assert.equal(await runOne(pool, new Date(), MEINE), false, 'kurz gesperrt: bleibt liegen');
  await pool.query("UPDATE jobs SET locked_at = now() - interval '10 minutes'");
  assert.equal(await runOne(pool, new Date(), MEINE), true, 'lange gesperrt: wird geholt');
});

test('der Tick arbeitet mehrere ab und hört bei seinem Deckel auf', async () => {
  // Kein `while (true)`: ein Läufer, der beliebig lange arbeitet, blockiert die
  // Anfragen des Servers im selben Prozess.
  for (let i = 0; i < 7; i += 1) {
    await enqueue(pool, 'test.ok', { payload: { was: `n${i}` } });
  }
  assert.equal(await tick(pool, new Date(), 3, MEINE), 3);
  assert.equal(lief.length, 3);
  assert.equal(await tick(pool, new Date(), 99, MEINE), 4);
});
