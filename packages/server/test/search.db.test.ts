/**
 * SOTE — die Suche gegen eine echte Datenbank.
 *
 * Die reine Abfragesprache hat ihre Tests in `@sote/core`. Hier geht es um die
 * Naht: wird aus der gelesenen Abfrage das richtige SQL, und findet die Suche
 * beim **Tippen** etwas — also mit einem halben Wort.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { create } from '../src/projects.js';
import { search, toTsQuery } from '../src/search.js';
import { complete, createFromLine, patch, trash } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0)); // Montag

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`search-${process.pid}@example.org`, 'Markus Thiel'],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function space(name: string): Promise<string> {
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
  return w!.id;
}

const add = (workspaceId: string, line: string) =>
  createFromLine(pool, { workspaceId, userId, line, now: NOW });

const found = async (ws: string, q: string) =>
  (await search(pool, ws, q, NOW)).tasks.map((t) => t.title).sort();

/* ── Die tsquery selbst ────────────────────────────────────────────────── */

test('jedes Wort wird Präfix ODER gestemmt, und Zeichen der Abfragesprache fallen weg', () => {
  // `:*` schaltet die Stemmung ab — nachgemessen: to_tsquery('german','dosen:*')
  // ergibt 'dosen':* und trifft den gestemmten Vektor 'dos' nicht. Also
  // braucht jedes Wort beide Formen.
  assert.equal(toTsQuery('kab'), '(kab:* | kab)');
  assert.equal(toTsQuery('kabel messen'), '(kabel:* | kabel) & (messen:* | messen)');
  // Ein getipptes `!` oder `(` würde to_tsquery sonst zum Syntaxfehler
  // bringen — und der käme beim Tippen ständig.
  assert.equal(toTsQuery('kabel! (messen)'), '(kabel:* | kabel) & (messen:* | messen)');
  assert.equal(toTsQuery('   '), null);
  assert.equal(toTsQuery('!!!'), null);
});

/* ── Tippen ────────────────────────────────────────────────────────────── */

test('ein halbes Wort findet die Aufgabe', async () => {
  // Wer tippt, hat das Wort noch nicht fertig. Eine Suche, die erst beim
  // letzten Buchstaben etwas findet, benutzt man zweimal.
  const ws = await space('s-prefix');
  await add(ws, 'Netzwerkdosen zählen');
  await add(ws, 'Kartons bestellen');
  assert.deepEqual(await found(ws, 'netz'), ['Netzwerkdosen zählen']);
  assert.deepEqual(await found(ws, 'kar'), ['Kartons bestellen']);
});

test('zwei Wörter verengen, sie erweitern nicht', async () => {
  const ws = await space('s-and');
  await add(ws, 'Kartons bestellen');
  await add(ws, 'Kabel bestellen');
  assert.deepEqual(await found(ws, 'bestellen'), ['Kabel bestellen', 'Kartons bestellen']);
  assert.deepEqual(await found(ws, 'kabel bestellen'), ['Kabel bestellen']);
});

test('die Notiz wird mitgesucht', async () => {
  const ws = await space('s-note');
  const t = await add(ws, 'Angebot einholen');
  await patch(pool, t.task.id, ws, { note: 'Ansprechpartner ist Frau Bergmann.' });
  assert.deepEqual(await found(ws, 'bergmann'), ['Angebot einholen']);
});

test('deutsche Stemmung: die Beugung findet das Wort', async () => {
  // Nachgesehen, was der Stemmer wirklich tut: „Dosen" und „Dose" werden beide
  // zu „dos", „bestellungen" zu „bestell". „Kabeln" bleibt dagegen „kabeln" —
  // der Stemmer streicht kein -n. Ein Test, der das behauptet, prüft nicht die
  // Software, sondern eine Vermutung über Deutsch.
  const ws = await space('s-stem');
  await add(ws, 'Dose beschriften');
  await add(ws, 'Bestellung aufgeben');
  assert.deepEqual(await found(ws, 'dosen'), ['Dose beschriften']);
  assert.deepEqual(await found(ws, 'bestellungen'), ['Bestellung aufgeben']);
});

test('Groß und klein ist gleich', async () => {
  const ws = await space('s-case');
  await add(ws, 'Netzwerkdosen zählen');
  assert.deepEqual(await found(ws, 'NETZWERKDOSEN'), ['Netzwerkdosen zählen']);
});

/* ── Was nicht gefunden werden darf ────────────────────────────────────── */

test('alles ist die Vorgabe — Erledigtes wird gefunden, steht aber hinten', async () => {
  /*
   * Der Test hieß „offen ist die Vorgabe — Erledigtes kommt nur auf Verlangen",
   * und er hielt genau die Stelle fest, die gemeldet wurde: die Suche zeigte
   * Erledigtes nicht.
   *
   * **In einer Suche nennt man einen Namen und keinen Zustand.** Wer „Kabel"
   * tippt, sucht die Aufgabe; ob sie abgehakt ist, ist die Antwort und nicht
   * die Frage. Eine Suche, die einen Treffer verbirgt, lügt unbemerkt — man
   * sieht kein Ergebnis und schließt daraus, dass es die Sache nicht gibt.
   *
   * Einschränken geht weiter, und dann steht es sichtbar in der Abfrage.
   */
  const ws = await space('s-open');
  const a = await add(ws, 'Kabel messen');
  await add(ws, 'Kabel bestellen');
  await complete(pool, a.task.id, userId, NOW);

  // Beide, und das Erledigte hinten — die Sortierung zieht die Grenze, die die
  // Oberfläche als Bündel zeichnet.
  assert.deepEqual(await found(ws, 'kabel'), ['Kabel bestellen', 'Kabel messen']);
  assert.deepEqual(await found(ws, 'kabel ist:erledigt'), ['Kabel messen']);
  assert.deepEqual(await found(ws, 'kabel status:offen'), ['Kabel bestellen']);
});

test('Weggeworfenes wird nie gefunden, auch nicht mit status:alles', async () => {
  const ws = await space('s-trash');
  const t = await add(ws, 'Kabel messen');
  await trash(pool, 'task', t.task.id, ws, userId);
  assert.deepEqual(await found(ws, 'kabel status:alles'), []);
});

test('ein fremder Arbeitsbereich wird nicht durchsucht', async () => {
  const mine = await space('s-mine');
  const other = await space('s-other');
  await add(other, 'Geheimes Kabel');
  assert.deepEqual(await found(mine, 'kabel'), []);
});

/* ── Die Facetten als Bedingungen ──────────────────────────────────────── */

test('nach Projekt, auch über die Kurzform', async () => {
  const ws = await space('s-project');
  const o1 = await create(pool, ws, { name: 'Ordner Haus' });
  await create(pool, ws, { name: 'Haus', parentId: o1.id });
  const o2 = await create(pool, ws, { name: 'Ordner Büro' });
  await create(pool, ws, { name: 'Büro', parentId: o2.id });
  await add(ws, 'Kabel messen #haus');
  await add(ws, 'Kabel bestellen #büro');

  assert.deepEqual(await found(ws, '#haus'), ['Kabel messen']);
  assert.deepEqual(await found(ws, 'projekt:büro'), ['Kabel bestellen']);
  assert.deepEqual(await found(ws, 'kabel #haus'), ['Kabel messen']);
});

test('zwei Schlagwörter verengen — beide müssen dran sein', async () => {
  const ws = await space('s-labels');
  await add(ws, 'A +eilig +unterwegs');
  await add(ws, 'B +eilig');
  assert.deepEqual(await found(ws, '+eilig'), ['A', 'B']);
  assert.deepEqual(await found(ws, '+eilig +unterwegs'), ['A']);
});

test('nach Zuständigen, mit Vornamen wie in der Erfassung', async () => {
  const ws = await space('s-assignee');
  await add(ws, 'Rückruf @Markus');
  await add(ws, 'Ohne Zuständigen');
  assert.deepEqual(await found(ws, '@markus'), ['Rückruf']);
  assert.deepEqual(await found(ws, 'zugewiesen:markus'), ['Rückruf']);
});

test('ein Gast ist als Zuständiger findbar', async () => {
  // Und die Abfrage bricht dabei nicht: ein `guest:`-Schlüssel ist keine uuid.
  const ws = await space('s-guest');
  const t = await add(ws, 'Dosen zählen');
  await pool.query(
    'INSERT INTO task_assignees (task_id, guest_key) VALUES ($1,$2)',
    [t.task.id, 'guest:Lars'],
  );
  assert.deepEqual(await found(ws, '@guest:lars'), ['Dosen zählen']);
});

test('nach Priorität, in beiden Schreibweisen', async () => {
  const ws = await space('s-prio');
  await add(ws, 'Dringend !!!');
  await add(ws, 'Wichtig !!');
  await add(ws, 'Normal');
  assert.deepEqual(await found(ws, 'prio:1'), ['Dringend']);
  assert.deepEqual(await found(ws, '!!'), ['Wichtig']);
  assert.deepEqual(await found(ws, 'prio:1 prio:2'), ['Dringend', 'Wichtig']);
});

test('nach Frist: heute, diese Woche, überfällig', async () => {
  const ws = await space('s-due');
  const late = await add(ws, 'Überfällig');
  await pool.query('UPDATE tasks SET due_at = $2 WHERE id = $1', [
    late.task.id,
    new Date(Date.UTC(2026, 8, 4)),
  ]);
  const today = await add(ws, 'Abgabe bis heute');
  assert.notEqual(today.task.due_at, null);
  const week = await add(ws, 'Bericht bis in 3 Tagen');
  assert.notEqual(week.task.due_at, null);
  await add(ws, 'Ohne Frist');

  assert.deepEqual(await found(ws, 'frist:überfällig'), ['Überfällig']);
  assert.deepEqual(await found(ws, 'frist:heute'), ['Abgabe', 'Überfällig']);
  assert.deepEqual(await found(ws, 'frist:woche'), [
    'Abgabe',
    'Bericht',
    'Überfällig',
  ]);
});

test('Text und Facetten zusammen', async () => {
  const ws = await space('s-mixed');
  const o3 = await create(pool, ws, { name: 'Ordner Haus' });
  await create(pool, ws, { name: 'Haus', parentId: o3.id });
  await add(ws, 'Kabel messen #haus !!');
  await add(ws, 'Kabel bestellen #haus');
  await add(ws, 'Kabel messen');
  assert.deepEqual(await found(ws, 'messen #haus !!'), ['Kabel messen']);
});

/* ── Ränder ────────────────────────────────────────────────────────────── */

test('eine leere Abfrage sucht nicht ins Blaue, sondern liefert die offenen', async () => {
  // Kein Sonderfall im SQL: ohne Bedingungen bleiben die Grundbedingungen
  // (dieser Arbeitsbereich, nicht weggeworfen, offen). Die Oberfläche zeigt
  // vorher einen leeren Bildschirm mit dem Vokabular — hier wird nur
  // festgehalten, dass die Route nicht wirft.
  const ws = await space('s-empty');
  await add(ws, 'Kabel messen');
  const out = await search(pool, ws, '', NOW);
  assert.equal(out.tasks.length, 1);
  assert.equal(out.more, false);
});

test('mehr Treffer als das Limit werden als solche gemeldet', async () => {
  const ws = await space('s-limit');
  for (let i = 0; i < 6; i += 1) await add(ws, `Kabel ${i}`);
  const out = await search(pool, ws, 'kabel', NOW, 4);
  assert.equal(out.tasks.length, 4);
  assert.equal(out.more, true, 'ehrlich statt „ungefähr"');

  const all = await search(pool, ws, 'kabel', NOW, 10);
  assert.equal(all.more, false);
});

test('die gelesene Abfrage kommt mit zurück, damit die Chips nicht geraten werden', async () => {
  const ws = await space('s-read');
  const out = await search(pool, ws, 'kabel #haus !!', NOW);
  assert.deepEqual(out.query.read, [
    { facet: 'projekt', value: 'haus' },
    { facet: 'priorität', value: '2' },
  ]);
  assert.equal(out.query.text, 'kabel');
});

test('ein Projektname, den es nicht gibt, findet nichts statt alles', async () => {
  const ws = await space('s-nosuch');
  await add(ws, 'Kabel messen');
  assert.deepEqual(await found(ws, '#gibtsnicht'), []);
});
