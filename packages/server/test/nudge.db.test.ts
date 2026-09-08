/**
 * SOTE — die Türklingel.
 *
 * Die Tests, auf die es ankommt, sind **die für die Abwesenheit**. SONEs Regel:
 *
 * > Für jede „läutet nicht"-Entscheidung gibt es einen Test für die
 * > Abwesenheit. Er hat immer dieselbe seltsame Form: den Wert hinter dem
 * > Rücken des Triggers verstellen, dann die harmlose Änderung machen, und
 * > behaupten, dass der **veraltete** Wert überlebt.
 *
 * Hier ist die Form etwas anders — geprüft wird, ob eine Änderung **klingelt**
 * oder nicht —, aber der Zweck ist derselbe: „es wurde nichts neu gelesen" ist
 * eine Aussage, die man belegen muss, sonst ist der ganze Aufwand mit der
 * Spaltenliste unbelegt.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import { Client } from 'pg';
import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let hoerer: Client;
let ws: string;
let task: string;
let gehoert: string[] = [];

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Klingel')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Klingel' RETURNING id`,
    [`nudge-${process.pid}@example.org`],
  );
  ws = await createWorkspace(pool, { name: `nudge-${process.pid}`, ownerId: u!.id });

  // Eine eigene Verbindung zum Lauschen — `LISTEN` bindet sie dauerhaft, und
  // aus dem Pool genommen käme sie nie zurück.
  hoerer = new Client({ connectionString: URL_ });
  await hoerer.connect();
  hoerer.on('notification', (m) => {
    const [w, scope] = (m.payload ?? '').split(':');
    if (w === ws) gehoert.push(scope!);
  });
  await hoerer.query('LISTEN sote_workspace_changed');

  const t = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'Dach','a') RETURNING id`,
    [ws],
  );
  task = t!.id;
});

after(async () => {
  await hoerer.end();
  await pool.end();
});

/** Etwas tun und hören, was klingelt. Die Zustellung ist nicht sofort. */
async function horch(tun: () => Promise<unknown>): Promise<string[]> {
  gehoert = [];
  await tun();
  await new Promise((r) => setTimeout(r, 250));
  return [...new Set(gehoert)];
}

test('eine neue Aufgabe klingelt', async () => {
  const laut = await horch(() =>
    pool.query(`INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'Neu','b')`, [ws]),
  );
  assert.deepEqual(laut, ['tasks']);
});

test('abhaken klingelt, tippen an der Notiz nicht', async () => {
  /*
   * Der Test für die Abwesenheit, und er ist der Grund für die ganze
   * Spaltenliste: die Notiz steht nur in der Detailspalte, und die hat die
   * Aufgabe schon offen. Ein Trigger auf jedes Update verwandelte das Tippen
   * einer Person in volle Listen-Abrufe für alle anderen — *ein Push, der
   * schlechter ist als das Polling, das er ersetzt.*
   */
  const beim_haken = await horch(() =>
    pool.query('UPDATE tasks SET completed_at = now() WHERE id = $1', [task]),
  );
  assert.deepEqual(beim_haken, ['tasks']);

  const beim_tippen = await horch(() =>
    pool.query("UPDATE tasks SET note = 'ein Wort mehr' WHERE id = $1", [task]),
  );
  assert.deepEqual(beim_tippen, [], 'die Notiz läutet nicht');

  // Und `updated_at` allein auch nicht: es ändert sich bei jedem Schreiben und
  // sagt nichts darüber, dass eine Liste anders aussieht.
  const beim_stempel = await horch(() =>
    pool.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [task]),
  );
  assert.deepEqual(beim_stempel, []);
});

test('der Baum klingelt auf projects, nicht auf tasks', async () => {
  // Getrennt, weil ein Umbenennen im Baum nicht die Aufgabenliste neu holen
  // soll und ein Abhaken nicht den Baum.
  const laut = await horch(() =>
    pool.query(
      `INSERT INTO projects (workspace_id, name, kind, sort_key) VALUES ($1,'Keller','folder','z')`,
      [ws],
    ),
  );
  assert.deepEqual(laut, ['projects']);
});

test('ein Statement mit vielen Zeilen klingelt einmal', async () => {
  /*
   * Statement-level über Transition Tables. Ein Import schreibt viele Zeilen in
   * einem Statement — ein NOTIFY pro Zeile wäre ein voller Listen-Abruf pro
   * Zeile für alle.
   */
  gehoert = [];
  await pool.query(
    `INSERT INTO tasks (workspace_id, title, sort_key)
     SELECT $1, 'Viele ' || i, 'k' || i FROM generate_series(1,20) i`,
    [ws],
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(gehoert.length, 1, `einmal, nicht ${gehoert.length} Mal`);
});

test('ein Statement, das nichts trifft, klingelt nicht', async () => {
  // Richtig — und beim Debuggen von einem fehlenden Trigger nicht zu
  // unterscheiden. SONE hat genau hier eine Stunde verloren (falscher
  // Feldname, das UPDATE traf nichts), darum steht es als Test da.
  const laut = await horch(() =>
    pool.query("UPDATE tasks SET title = 'x' WHERE id = '00000000-0000-4000-8000-000000000000'"),
  );
  assert.deepEqual(laut, []);
});

test('„zuletzt benutzt" an einer Freigabe klingelt nicht', async () => {
  /*
   * Sonst läutet das Arbeiten eines Gasts die Liste des Eigentümers im
   * Sekundentakt: die Spalte ändert sich bei **jedem** Aufruf eines Links.
   */
  process.env['SOTE_SHARE_KEY'] ??= Buffer.alloc(32, 5).toString('hex');
  /*
   * Ein Projekt braucht einen Ordner über sich (`projects_list_needs_parent`,
   * Migration 0009) — ein Projekt an der Wurzel gibt es nicht. Mein erster
   * Versuch legte eines direkt an, und der CHECK hat es abgelehnt: die Regel
   * gilt auch für Tests, und das ist ihr Sinn.
   */
  const ordner = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,'Geteilt-Ordner','folder','y') RETURNING id`,
    [ws],
  );
  const p = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,'Geteilt','list','y1') RETURNING id`,
    [ws, ordner!.id],
  );
  const sh = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO shares (workspace_id, project_id, right_level, token_hash, token_enc)
     VALUES ($1,$2,'read',$3,'x') RETURNING id`,
    [ws, p!.id, `hash-${process.pid}`],
  );

  /*
   * Erst abwarten, was das ANLEGEN geläutet hat.
   *
   * Ein `INSERT` in `shares` klingelt selbst (`shares`), und unter Last kam
   * diese Klingel erst im Messfenster des nächsten Schritts an — dann sah der
   * Test dort ein `['shares']`, das er dem Benutzen zuschrieb. Im vollen Lauf
   * rot, allein grün: die Sorte Wackler, die man nur mit einem zweiten Lauf
   * findet.
   *
   * Eine leere Messung ist genau der richtige Weg zu warten: sie räumt das
   * Fenster leer und braucht keine geratene Pause.
   */
  await horch(async () => undefined);

  const beim_benutzen = await horch(() =>
    pool.query('UPDATE shares SET last_used_at = now() WHERE id = $1', [sh!.id]),
  );
  assert.deepEqual(beim_benutzen, [], 'benutzen läutet nicht');

  // Widerrufen dagegen schon: das ist eine Zeile, die aus der Liste
  // verschwindet.
  const beim_widerrufen = await horch(() =>
    pool.query('UPDATE shares SET revoked_at = now() WHERE id = $1', [sh!.id]),
  );
  assert.deepEqual(beim_widerrufen, ['shares']);
});
