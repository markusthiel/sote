/**
 * SOTE — die Detailspalte gegen eine echte Datenbank.
 *
 * Die interessante Frage ist nicht, ob die Abfrage Zeilen liefert, sondern:
 * taucht eine Teilaufgabe irgendwo **doppelt** auf, erbt sie das Projekt ihres
 * Elternteils, und was passiert mit ihr, wenn die Aufgabe darüber weggeworfen
 * wird.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { makeList } from './support/tree.js';
import { addChild, addComment, detail } from '../src/detail.js';
import { migrate } from '../src/migrate.js';
import { complete, createFromLine, NotFound, OutOfOrder, patch, trash } from '../src/tasks.js';
import { counts, list } from '../src/views.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`detail-${process.pid}@example.org`, 'Markus Thiel'],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(name: string) {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor')
     RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [w!.id, userId, r!.id],
  );
  const projectId = await makeList(pool, w!.id, 'Haus');
  return { workspaceId: w!.id, projectId };
}

const add = (workspaceId: string, line: string) =>
  createFromLine(pool, { workspaceId, userId, line, now: NOW });

/* ── Teilaufgaben ──────────────────────────────────────────────────────── */

test('eine Teilaufgabe erbt Projekt und Arbeitsbereich vom Elternteil', async () => {
  const { workspaceId, projectId } = await scratch('d-inherit');
  const parent = await add(workspaceId, 'Umzug vorbereiten #haus');
  const child = await addChild(pool, parent.task.id, workspaceId, userId, 'Kartons zählen');

  assert.equal(child.project_id, projectId);
  assert.equal(child.workspace_id, workspaceId);
  assert.equal(child.parent_id, parent.task.id);
});

test('die Projektansicht zeigt die Teilaufgabe nicht als eigene Zeile', async () => {
  // Sonst stünde dieselbe Sache zweimal in einer Liste, mit zwei Kästchen, die
  // dasselbe meinen.
  const { workspaceId, projectId } = await scratch('d-nodouble');
  const parent = await add(workspaceId, 'Umzug vorbereiten #haus');
  await addChild(pool, parent.task.id, workspaceId, userId, 'Kartons zählen');

  const rows = await list(pool, 'project', workspaceId, NOW, projectId);
  assert.deepEqual(rows.map((r) => r.title), ['Umzug vorbereiten']);

  const d = await detail(pool, parent.task.id, workspaceId);
  assert.deepEqual(d.children.map((c) => c.title), ['Kartons zählen']);
});

test('eine Teilaufgabe mit eigenem Datum steht in Heute — das ist ihr Zweck', async () => {
  // Echte Teilaufgaben statt Checklistenpunkte heißt: sie haben eigene Fristen
  // und eigene Prioritäten. Eine, die heute dran ist, muss in Heute stehen.
  const { workspaceId } = await scratch('d-today');
  const parent = await add(workspaceId, 'Umzug vorbereiten #haus');
  const child = await addChild(pool, parent.task.id, workspaceId, userId, 'Kartons zählen');
  await patch(pool, child.id, workspaceId, {
    plannedAt: new Date(Date.UTC(2026, 8, 7, 9, 0)),
    plannedAllDay: false,
  });

  const rows = await list(pool, 'today', workspaceId, NOW);
  assert.deepEqual(rows.map((r) => r.title), ['Kartons zählen']);
  assert.equal((await counts(pool, workspaceId, NOW)).today, 1);
});

test('eine Teilaufgabe bekommt keine Teilaufgaben', async () => {
  const { workspaceId } = await scratch('d-onedeep');
  const parent = await add(workspaceId, 'Umzug #haus');
  const child = await addChild(pool, parent.task.id, workspaceId, userId, 'Kartons');
  await assert.rejects(
    () => addChild(pool, child.id, workspaceId, userId, 'noch tiefer'),
    (e: unknown) => e instanceof OutOfOrder && /Teilaufgabe/.test((e as Error).message),
  );
});

test('eine leere Teilaufgabe wird abgelehnt', async () => {
  const { workspaceId } = await scratch('d-empty');
  const parent = await add(workspaceId, 'Umzug #haus');
  await assert.rejects(
    () => addChild(pool, parent.task.id, workspaceId, userId, '   '),
    OutOfOrder,
  );
});

test('mehrere Teilaufgaben landen in ihrer eigenen Reihe, nicht in der des Projekts', async () => {
  const { workspaceId, projectId } = await scratch('d-order');
  const parent = await add(workspaceId, 'Umzug #haus');
  const a = await addChild(pool, parent.task.id, workspaceId, userId, 'a');
  const b = await addChild(pool, parent.task.id, workspaceId, userId, 'b');
  const c = await addChild(pool, parent.task.id, workspaceId, userId, 'c');

  const d = await detail(pool, parent.task.id, workspaceId);
  assert.deepEqual(d.children.map((x) => x.title), ['a', 'b', 'c']);

  // Der Schlüsselraum ist pro Geschwisterkreis, also darf eine Teilaufgabe
  // denselben Schlüssel tragen wie eine oberste Zeile im selben Projekt.
  const top = await add(workspaceId, 'zweite oberste #haus');
  assert.equal(a.sort_key, 'a0');
  assert.notEqual(top.task.sort_key, a.sort_key);
  const rows = await list(pool, 'project', workspaceId, NOW, projectId);
  assert.deepEqual(rows.map((r) => r.title), ['Umzug', 'zweite oberste']);
  assert.equal([b, c].length, 2);
});

test('eine weggeworfene Aufgabe nimmt ihre Teilaufgaben aus der Detailspalte', async () => {
  const { workspaceId } = await scratch('d-trash');
  const parent = await add(workspaceId, 'Umzug #haus');
  const child = await addChild(pool, parent.task.id, workspaceId, userId, 'Kartons');
  await trash(pool, 'task', child.id, workspaceId, userId);
  const d = await detail(pool, parent.task.id, workspaceId);
  assert.deepEqual(d.children, []);
});

test('eine weggeworfene Aufgabe hat keine Detailspalte', async () => {
  const { workspaceId } = await scratch('d-trashparent');
  const parent = await add(workspaceId, 'Umzug #haus');
  await trash(pool, 'task', parent.task.id, workspaceId, userId);
  await assert.rejects(() => detail(pool, parent.task.id, workspaceId), NotFound);
});

test('erledigte Teilaufgaben stehen unten', async () => {
  const { workspaceId } = await scratch('d-donelast');
  const parent = await add(workspaceId, 'Umzug #haus');
  const a = await addChild(pool, parent.task.id, workspaceId, userId, 'a');
  await addChild(pool, parent.task.id, workspaceId, userId, 'b');
  await complete(pool, a.id, userId, NOW);
  const d = await detail(pool, parent.task.id, workspaceId);
  assert.deepEqual(d.children.map((x) => x.title), ['b', 'a']);
});

/* ── Kommentare ────────────────────────────────────────────────────────── */

test('ein Kommentar trägt den Namen des Verfassers und keinen Gastschlüssel', async () => {
  const { workspaceId } = await scratch('d-comment');
  const t = await add(workspaceId, 'Kopplung entwerfen #haus');
  const c = await addComment(pool, t.task.id, workspaceId, userId, '  Erst die Rechte.  ');

  assert.equal(c.body, 'Erst die Rechte.');
  assert.equal(c.authorName, 'Markus Thiel');
  assert.equal(c.authorGuest, null);

  const d = await detail(pool, t.task.id, workspaceId);
  assert.deepEqual(d.comments.map((x) => x.body), ['Erst die Rechte.']);
});

test('Kommentare stehen in der Reihenfolge, in der sie geschrieben wurden', async () => {
  const { workspaceId } = await scratch('d-order2');
  const t = await add(workspaceId, 'Kopplung #haus');
  await addComment(pool, t.task.id, workspaceId, userId, 'erst');
  await addComment(pool, t.task.id, workspaceId, userId, 'dann');
  const d = await detail(pool, t.task.id, workspaceId);
  assert.deepEqual(d.comments.map((c) => c.body), ['erst', 'dann']);
});

test('ein Kommentar eines Gastes bricht die Abfrage nicht', async () => {
  // Der Fall, der in SONE dreimal eine ganze Projektionstransaktion mitgerissen
  // hat: ein `guest:`-Schlüssel ist keine uuid (ADR-0091, ADR-0092). Hier
  // liegen die beiden in getrennten Spalten, und dieser Test hält fest, dass
  // die Detailabfrage einen Gast verkraftet.
  const { workspaceId } = await scratch('d-guest');
  const t = await add(workspaceId, 'Umzug Büro #haus');
  await pool.query(
    `INSERT INTO task_comments (task_id, author_guest, body) VALUES ($1,$2,$3)`,
    [t.task.id, 'guest:Lars', 'Dosen sind gezählt.'],
  );
  const d = await detail(pool, t.task.id, workspaceId);
  assert.equal(d.comments.length, 1);
  assert.equal(d.comments[0]!.authorGuest, 'guest:Lars');
  assert.equal(d.comments[0]!.authorName, null);
});

test('ein leerer Kommentar wird abgelehnt', async () => {
  const { workspaceId } = await scratch('d-emptyc');
  const t = await add(workspaceId, 'Kopplung #haus');
  await assert.rejects(
    () => addComment(pool, t.task.id, workspaceId, userId, '\n  '),
    OutOfOrder,
  );
});

test('eine fremde Aufgabe nimmt keinen Kommentar an', async () => {
  const mine = await scratch('d-mine');
  const other = await scratch('d-other');
  const fremd = await add(other.workspaceId, 'fremd');
  await assert.rejects(
    () => addComment(pool, fremd.task.id, mine.workspaceId, userId, 'hallo'),
    NotFound,
  );
  await assert.rejects(() => detail(pool, fremd.task.id, mine.workspaceId), NotFound);
});

/* ── Zuweisung und Herkunft ────────────────────────────────────────────── */

test('die Detailspalte nennt die Zuständigen mit Namen', async () => {
  const { workspaceId } = await scratch('d-assign');
  const t = await add(workspaceId, 'Rückruf +Markus');
  const d = await detail(pool, t.task.id, workspaceId);
  assert.equal(d.assignees.length, 1);
  assert.equal(d.assignees[0]!.name, 'Markus Thiel');
  assert.equal(d.assignees[0]!.guestKey, null);
});

test('ohne Herkunft gibt es kein Herkunftsfeld', async () => {
  // Kein „Herkunft: keine": jede Stelle mit SONE-Bezug hat einen Zustand für
  // „nicht verbunden", und der ist „gar nicht da".
  const { workspaceId } = await scratch('d-noorigin');
  const t = await add(workspaceId, 'ohne SONE');
  const d = await detail(pool, t.task.id, workspaceId);
  assert.equal(d.origin, undefined);
});

test('mit Herkunft steht dort URL und Titel — gespeichert, nicht abgefragt', async () => {
  // Der Rückweg muss auch funktionieren, wenn SONE unerreichbar ist
  // (Konzept, Abschnitt 8).
  const { workspaceId } = await scratch('d-origin');
  const t = await add(workspaceId, 'Rechteaussage entwerfen');
  await pool.query(
    `INSERT INTO task_origins (task_id, url, page_title) VALUES ($1,$2,$3)`,
    [t.task.id, 'https://sone.example.org/p/abc', 'Konzept: SOTE-Kopplung'],
  );
  const d = await detail(pool, t.task.id, workspaceId);
  assert.equal(d.origin?.pageTitle, 'Konzept: SOTE-Kopplung');
  assert.equal(d.origin?.url, 'https://sone.example.org/p/abc');
});

test('die Detailspalte nennt den Projektnamen, damit die Spalte allein lesbar ist', async () => {
  const { workspaceId } = await scratch('d-pname');
  const t = await add(workspaceId, 'Kabel messen #haus');
  const d = await detail(pool, t.task.id, workspaceId);
  assert.equal(d.projectName, 'Haus');
});

test('+vorname genügt, und bei zwei Treffern wird nicht geraten', async () => {
  // „+Markus Thiel" gibt es nicht: ein Leerzeichen beendet das Zeichen. Also
  // muss der Vorname reichen — und wenn zwei Leute so heißen, ist das eine
  // andere Nachricht als „gibt es hier nicht".
  const { workspaceId } = await scratch('d-firstname');
  const one = await add(workspaceId, 'Rückruf +Markus');
  assert.deepEqual(one.unknownAssignees, []);
  assert.deepEqual(one.ambiguousAssignees, []);
  assert.equal((await detail(pool, one.task.id, workspaceId)).assignees.length, 1);

  // Ein zweiter Markus im selben Arbeitsbereich.
  const other = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
    [`markus2-${process.pid}@example.org`, 'Markus Berg'],
  );
  const role = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM roles WHERE workspace_id = $1 LIMIT 1',
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [workspaceId, other!.id, role!.id],
  );

  const two = await add(workspaceId, 'Rückruf zwei +Markus');
  assert.deepEqual(two.ambiguousAssignees, ['Markus']);
  assert.deepEqual(two.unknownAssignees, []);
  assert.equal(
    (await detail(pool, two.task.id, workspaceId)).assignees.length,
    0,
    'ohne Zuständigen ist besser als mit dem falschen',
  );

  // Der volle Name trifft weiterhin eindeutig.
  const exact = await add(workspaceId, 'Rückruf drei +markus.berg');
  assert.deepEqual(exact.unknownAssignees, ['markus.berg']);
});

test('eine Nennung meldet gerichtet — und nicht doppelt', async () => {
  /*
   * GEWUENSCHT: „Namensnennungen … bei den Benachrichtigungen."
   *
   * Wer genannt wird, bekommt NICHT zusaetzlich die allgemeine Meldung „neuer
   * Kommentar". Zwei Meldungen ueber einen Satz sind eine zu viel, und die
   * gerichtete ist die bessere.
   */
  const { workspaceId } = await scratch(`nennung-${process.pid}`);
  const zweiter = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Anna') RETURNING id`,
    [`anna-${process.pid}@example.org`],
  );
  const rolle = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM roles WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [workspaceId, zweiter!.id, rolle!.id],
  );

  const t = await add(workspaceId, 'Etwas mit Nennung');
  await addComment(pool, t.task.id, workspaceId, userId, 'bitte +anna ansehen');

  const meldungen = await queryRows<{ kind: string }>(
    pool,
    'SELECT kind FROM notifications WHERE user_id = $1 AND task_id = $2',
    [zweiter!.id, t.task.id],
  );
  /*
   * GENAU EINE. Anna ist weder Urheberin noch zustaendig, bekaeme also ohne
   * Nennung gar nichts -- mit Nennung genau eine. Und wer beides waere,
   * bekaeme trotzdem nur eine: die gerichtete.
   */
  assert.equal(meldungen.length, 1);
});

test('eine Antwort haengt am Ursprung, auch in der zweiten Ebene', async () => {
  /*
   * EINE Ebene: wer auf eine Antwort antwortet, antwortet auf deren Ursprung.
   * Das loest der Server auf -- die Oberflaeche schickt einfach, worauf jemand
   * getippt hat, und muss die Regel nicht kennen.
   */
  const { workspaceId } = await scratch(`gespraech-${process.pid}`);
  const t = await add(workspaceId, 'Gespraech');
  const erster = await addComment(pool, t.task.id, workspaceId, userId, 'Frage?');
  const antwort = await addComment(
    pool, t.task.id, workspaceId, userId, 'Antwort', undefined, erster.id,
  );
  const drauf = await addComment(
    pool, t.task.id, workspaceId, userId, 'Nachfrage', undefined, antwort.id,
  );

  const rows = await queryRows<{ id: string; parent_id: string | null }>(
    pool,
    'SELECT id, parent_id FROM task_comments WHERE task_id = $1',
    [t.task.id],
  );
  assert.equal(rows.find((r) => r.id === antwort.id)?.parent_id, erster.id);
  // Die Nachfrage haengt am ERSTEN und nicht an der Antwort.
  assert.equal(rows.find((r) => r.id === drauf.id)?.parent_id, erster.id);
});

test('Gespraeche stehen nacheinander — nicht in zufaelliger Reihenfolge', async () => {
  /*
   * Mein erster Versuch sortierte nach `COALESCE(parent_id, id)`, und das
   * heisst fuer einen Beitrag ohne Antwort: nach seiner eigenen Id. Eine Id
   * ist hier ein Zufallswert -- das Gespraech stand also zufaellig da.
   *
   * Gefunden hat es ein Test von frueher („Kommentare stehen in der
   * Reihenfolge, in der sie geschrieben wurden"), geschrieben lange bevor es
   * Antworten gab. Dieser hier haelt zusaetzlich fest, was mit Antworten
   * gilt.
   */
  const { workspaceId } = await scratch(`reihenfolge-${process.pid}`);
  const t = await add(workspaceId, 'Reihenfolge');

  const eins = await addComment(pool, t.task.id, workspaceId, userId, 'eins');
  await addComment(pool, t.task.id, workspaceId, userId, 'zwei');
  await addComment(pool, t.task.id, workspaceId, userId, 'antwort auf eins', undefined, eins.id);

  const d = await detail(pool, t.task.id, workspaceId);
  assert.deepEqual(
    d.comments.map((c) => c.body),
    // Die Antwort steht bei ihrem Ursprung, und die Gespraeche nacheinander.
    ['eins', 'antwort auf eins', 'zwei'],
  );
});
