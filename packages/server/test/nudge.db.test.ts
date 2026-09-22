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
  /*
   * Erst ausklingen lassen, dann leeren, dann tun: eine Klingel aus dem
   * vorigen Schritt, die erst jetzt ankommt, sähe sonst aus wie eine aus
   * diesem. Unter Last (die ganze Suite hintereinander) ist genau das
   * passiert — „zuletzt benutzt klingelt nicht" hörte die Zuweisung von
   * davor.
   */
  await new Promise((r) => setTimeout(r, 150));
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

test('das Titelbild klingelt — und jede andere Spalte, die man in der Liste sieht', async () => {
  /*
   * GEMELDET: „Wenn ich es als Titelbild setze, dann sollte es live updaten.
   * Ich muss erst die Seite reloaden."
   *
   * Die Ursache: die Spaltenliste im Trigger stand seit Migration 0020 und
   * kannte `duration_min`, `column_id` und `cover` nicht — alles, was nach ihr
   * dazukam.
   */
  const laut = await horch(() =>
    pool.query(`UPDATE tasks SET cover = '{"color":"blue"}'::jsonb WHERE id = $1`, [task]),
  );
  assert.deepEqual(laut, ['tasks']);
});

test('die Liste im Trigger kennt JEDE Spalte der Tabelle', async () => {
  /*
   * DER TEST GEGEN DAS VERALTEN — und der eigentliche Ertrag dieser Runde.
   *
   * Die Spaltenliste im Trigger ist eine Entscheidung („es klingelt, was
   * andere in ihrer LISTE sehen") und kein Versehen. Aber sie ist auch eine
   * Liste, die bei jeder neuen Spalte nachgezogen werden muss — und genau das
   * ist dreimal nicht passiert, ohne dass etwas daran erinnert hätte.
   *
   * Also erinnert jetzt dieser Test: er holt die tatsächlichen Spalten aus der
   * Datenbank und verlangt, dass jede entweder klingelt oder ausdrücklich als
   * schweigend eingetragen ist. Eine neue Spalte lässt ihn fallen, bis jemand
   * entschieden hat, was sie soll.
   *
   * Dieselbe Bauart wie `check-task-columns.mjs`, nur für den Trigger — dort
   * sieht kein Wächter hin, weil die Liste in SQL steht.
   */
  const SCHWEIGT = new Set([
    // Schlüssel und Herkunft: ändern sich nicht, und wenn, dann nicht sichtbar.
    'id',
    'workspace_id',
    'created_by',
    'created_at',
    'updated_at',
    // Technische Konfliktversion; die fachlich geänderten Felder lösen den Anstoß aus.
    'integration_revision',
    'completed_by',
    'trashed_by',
    /*
     * Die Notiz — die dokumentierte Ausnahme aus Migration 0020: sie steht nur
     * in der Detailspalte, und die hat die Aufgabe schon offen. Ein Anstoss je
     * Tastendruck wäre ein Push, der schlechter ist als das Polling, das er
     * ersetzt.
     */
    'note',
    /*
     * Und ihr Dokument, aus demselben Grund und noch deutlicher: der Editor
     * speichert nach zwei Sekunden Ruhe, also mehrmals, während jemand
     * schreibt. Ein Anstoss je Speichern wäre ein Nachladen der Spalte
     * mitten im Satz.
     */
    'note_doc',
    // Die Herkunft eines geteilten Eintrags: steht in der Detailspalte.
    'origin_url',
    'origin_title',
    'origin_seen_at',
  ]);

  const spalten = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tasks' AND table_schema = 'public'`,
  );
  const quelle = await pool.query<{ prosrc: string }>(
    `SELECT prosrc FROM pg_proc WHERE proname = 'notify_tasks_upd'`,
  );
  const koerper = quelle.rows[0]!.prosrc;

  const fehlend = spalten.rows
    .map((r) => r.column_name)
    .filter((name) => !SCHWEIGT.has(name))
    .filter((name) => !new RegExp(`\\bn\\.${name}\\b`).test(koerper));

  assert.deepEqual(
    fehlend,
    [],
    `Diese Spalten sieht der Trigger nicht: ${fehlend.join(', ')}. ` +
      'Entweder in die Liste in der Migration aufnehmen (dann klingelt eine ' +
      'Aenderung) oder oben als schweigend eintragen — mit Grund.',
  );
});

test('der Strom ist auf SEINEN Arbeitsbereich gefiltert', async () => {
  /*
   * GEMELDET: „Wenn ich bei einer vorhandenen Aufgabe den Titel aendere,
   * aendert sich der Text nicht in der Aufgabenliste. Das muss auch live
   * passieren. Eigentlich alles muss live passieren."
   *
   * Es lag nicht am Titel. Die Oberflaeche oeffnete den Strom OHNE
   * `?workspace=`, und der Server nimmt ohne Angabe den ersten Bereich, in dem
   * jemand Mitglied ist -- die Seite hoerte also einem anderen zu als dem, den
   * sie zeigt. Wer nur einen Bereich hat, merkt nichts; wer zwei hat, bekommt
   * gar nichts mehr.
   *
   * Dieser Test haelt die Filterung fest, auf der das beruht: die Klingel nennt
   * IHREN Bereich, und ein Zuhoerer eines anderen hat nichts davon.
   */
  const fremd = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`strom-fremd-${process.pid}`],
  );

  const alle: string[] = [];
  const zweiter = new Client({ connectionString: URL_ });
  await zweiter.connect();
  zweiter.on('notification', (m) => alle.push(m.payload ?? ''));
  await zweiter.query('LISTEN sote_workspace_changed');

  const laut = await horch(() =>
    pool.query(`INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'Fremd','z')`, [
      fremd!.id,
    ]),
  );
  await zweiter.end();

  // Der Zuhoerer dieses Bereichs hoert NICHTS …
  assert.deepEqual(laut, []);
  // … waehrend die Klingel sehr wohl gelaeutet hat, nur fuer einen anderen.
  assert.ok(alle.some((p) => p.startsWith(`${fremd!.id}:`)));
});

test('ein Kommentar klingelt — mit eigenem Scope', async () => {
  /*
   * GEWUENSCHT: „Die Kommentare kommen noch nicht live rein bei anderen, die es
   * gerade offen haben. Geht das? Dann waere es schon fast ein Chat."
   *
   * Ein EIGENER Scope und nicht `tasks`: sonst luede bei jedem Satz jede
   * offene Liste neu, obwohl in keiner Liste ein Kommentar steht. Bei zwei
   * Leuten, die sich unterhalten, waere das ein vollstaendiger Listenabruf je
   * Satz -- fuer eine Zeile, die nur in EINER offenen Detailspalte sichtbar
   * ist.
   */
  const laut = await horch(() =>
    // Als GAST geschrieben: der Trigger haengt an der Aufgabe und nicht am
    // Verfasser, und ein Konto braucht dieser Test nicht.
    pool.query(
      `INSERT INTO task_comments (task_id, author_guest, body) VALUES ($1,'Gast','Hallo')`,
      [task],
    ),
  );
  assert.deepEqual(laut, ['comments']);
});

test('und das Zuruecknehmen auch', async () => {
  // Sonst staende ein zurueckgenommener Kommentar bei den anderen weiter da
  // und verschwaende beim naechsten Laden ohne Zutun -- das liest sich wie ein
  // Fehler.
  const c = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO task_comments (task_id, author_guest, body) VALUES ($1,'Gast','Weg') RETURNING id`,
    [task],
  );
  const laut = await horch(() =>
    pool.query('DELETE FROM task_comments WHERE id = $1', [c!.id]),
  );
  assert.deepEqual(laut, ['comments']);
});

/* ── Die Tabellen NEBEN den Aufgaben (Migration 0041) ─────────────────────── */

test('ein Schlagwort an einer Aufgabe klingelt — und Name oder Farbe des Schlagworts auch', async () => {
  /*
   * GEMELDET: „Wenn ich das Schlagwort einer Aufgabe hinzufüge, färbt sich
   * die Aufgabe erst nach Reload." Keine Spalte von `tasks`, sondern eine
   * Zeile in `task_labels` — und die Tabelle hatte keinen Trigger. Der Test
   * aus 0032 konnte das nicht sehen: er prüft Spalten, nicht Tabellen.
   */
  const l = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO labels (workspace_id, name, color) VALUES ($1,'dringend','red') RETURNING id`,
    [ws],
  );
  // Das Anlegen selbst hat geklingelt — wegräumen, damit der nächste Schritt allein zählt.
  await new Promise((r) => setTimeout(r, 250));

  const anhaengen = await horch(() =>
    pool.query('INSERT INTO task_labels (task_id, label_id) VALUES ($1,$2)', [task, l!.id]),
  );
  assert.deepEqual(anhaengen, ['tasks'], 'anhängen');

  const umfaerben = await horch(() =>
    pool.query(`UPDATE labels SET color = 'blue' WHERE id = $1`, [l!.id]),
  );
  assert.deepEqual(umfaerben, ['tasks'], 'umfärben');

  const abnehmen = await horch(() =>
    pool.query('DELETE FROM task_labels WHERE task_id = $1 AND label_id = $2', [task, l!.id]),
  );
  assert.deepEqual(abnehmen, ['tasks'], 'abnehmen');
});

test('eine Zuweisung klingelt', async () => {
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Zust') RETURNING id`,
    [`nudge-zust-${process.pid}@example.org`],
  );
  const hin = await horch(() =>
    pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2)', [task, u!.id]),
  );
  assert.deepEqual(hin, ['tasks']);
  const weg = await horch(() =>
    pool.query('DELETE FROM task_assignees WHERE task_id = $1 AND user_id = $2', [task, u!.id]),
  );
  assert.deepEqual(weg, ['tasks']);
});

test('eine Spalte der Tafel klingelt auf tasks', async () => {
  const ordner = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, kind, sort_key) VALUES ($1,'Ordner','folder','zo') RETURNING id`,
    [ws],
  );
  const p = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key) VALUES ($1,$2,'Tafel','list','zt') RETURNING id`,
    [ws, ordner!.id],
  );
  await new Promise((r) => setTimeout(r, 250));
  const neu = await horch(() =>
    pool.query(`INSERT INTO board_columns (project_id, name, sort_key) VALUES ($1,'Offen','a')`, [p!.id]),
  );
  assert.deepEqual(neu, ['tasks']);
  const um = await horch(() =>
    pool.query(`UPDATE board_columns SET name = 'In Arbeit' WHERE project_id = $1`, [p!.id]),
  );
  assert.deepEqual(um, ['tasks']);
});

test('ein umbenannter Arbeitsbereich klingelt auf projects — ein Stempel nicht', async () => {
  const um = await horch(() =>
    pool.query(`UPDATE workspaces SET name = name || '!' WHERE id = $1`, [ws]),
  );
  assert.deepEqual(um, ['projects']);
  const nichts = await horch(() =>
    pool.query(`UPDATE workspaces SET name = name WHERE id = $1`, [ws]),
  );
  assert.deepEqual(nichts, []);
});
