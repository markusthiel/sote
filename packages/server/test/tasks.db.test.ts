/**
 * SOTE — Aufgaben gegen eine echte Datenbank.
 *
 * Nicht die Funktionen gegen sich selbst, sondern die Kette: Zeile → Parser →
 * INSERT → CHECK → Abfrage. Das ist die Naht, in der in SONE die Entscheidungen
 * lagen und in der jeder teure Fehler steckte (`claude/durchgang-nie-gelaufen.md`).
 *
 * Die Datenbank kommt aus `SOTE_TEST_DATABASE_URL`. Jeder Test bekommt einen
 * eigenen Arbeitsbereich, damit sie sich nicht sehen.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { complete, createFromLine, recurrenceOf, today } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`test-${process.pid}@example.org`, 'Markus'],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

/** Ein eigener Arbeitsbereich mit einer Mitgliedschaft und einem Projekt. */
async function scratch(name: string): Promise<{ workspaceId: string; projectId: string }> {
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
  const p = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Haus','a0')
     RETURNING id`,
    [w!.id],
  );
  return { workspaceId: w!.id, projectId: p!.id };
}

const utc = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const NOW = utc(2026, 9, 7, 10, 0); // Montag

/* ── Von der Zeile in die Datenbank ────────────────────────────────────── */

test('eine Zeile wird eine Aufgabe, und #haus findet das Projekt', async () => {
  const { workspaceId, projectId } = await scratch('ws-line');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Filter reinigen morgen 8 Uhr #haus !!',
    now: NOW,
  });
  assert.equal(out.task.title, 'Filter reinigen');
  assert.equal(out.task.project_id, projectId);
  assert.equal(out.task.priority, 2);
  assert.equal(out.task.planned_at?.toISOString(), utc(2026, 9, 8, 8, 0).toISOString());
  // Eine Uhrzeit wurde getippt, also ist es kein Ganztagstermin — und daran
  // hängt, ob es eine Erinnerung gibt.
  assert.equal(out.task.planned_all_day, false);
  assert.equal(out.unknownProject, undefined);
});

test('„morgen" ohne Uhrzeit bleibt ein Ganztagstermin', async () => {
  const { workspaceId } = await scratch('ws-allday');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Pfand wegbringen morgen',
    now: NOW,
  });
  assert.equal(out.task.planned_all_day, true);
  assert.equal(out.task.planned_at?.toISOString(), utc(2026, 9, 8).toISOString());
});

test('ein unbekanntes #projekt wird gemeldet und nicht angelegt', async () => {
  const { workspaceId } = await scratch('ws-unknown');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Beleg suchen #steuer2025',
    now: NOW,
  });
  assert.equal(out.unknownProject, 'steuer2025');
  assert.equal(out.task.project_id, null);
  const count = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM projects WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(count!.n, '1', 'es darf kein Projekt dazugekommen sein');
});

test('eine unbekannte Person wird gemeldet, eine bekannte zugewiesen', async () => {
  const { workspaceId } = await scratch('ws-assign');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Rückruf +Markus +niemand',
    now: NOW,
  });
  assert.deepEqual(out.unknownAssignees, ['niemand']);
  const a = await queryOne<{ user_id: string | null }>(
    pool,
    'SELECT user_id FROM task_assignees WHERE task_id = $1',
    [out.task.id],
  );
  assert.equal(a?.user_id, userId);
});

test('Schlagwörter entstehen einmal und werden wiederverwendet', async () => {
  const { workspaceId } = await scratch('ws-labels');
  await createFromLine(pool, { workspaceId, userId, line: 'A @unterwegs', now: NOW });
  await createFromLine(pool, { workspaceId, userId, line: 'B @unterwegs', now: NOW });
  const n = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM labels WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(n!.n, '1');
});

/* ── Abhaken: zwei Zeilen, nicht eine umdatierte ───────────────────────── */

test('eine kalenderfeste Wiederholung erzeugt beim Abhaken die nächste Instanz', async () => {
  const { workspaceId } = await scratch('ws-recur');
  const created = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Filter reinigen jeden zweiten Dienstag 8 Uhr #haus',
    now: NOW,
  });
  // Der erste Dienstag nach Montag dem 7.9. ist der 8.9.
  assert.equal(
    created.task.planned_at?.toISOString(),
    utc(2026, 9, 8, 8, 0).toISOString(),
  );

  const out = await complete(pool, created.task.id, userId, utc(2026, 9, 8, 9, 14));
  assert.ok(out.completed.completed_at !== null, 'die erledigte Zeile bleibt');
  assert.ok(out.next !== undefined, 'es muss eine nächste Zeile geben');
  // Zwei Wochen später, dieselbe Uhrzeit.
  assert.equal(out.next.planned_at?.toISOString(), utc(2026, 9, 22, 8, 0).toISOString());
  assert.equal(out.next.completed_at, null);
  assert.equal(out.next.title, 'Filter reinigen');
  // Und der Anker ist mitgewandert, sonst rechnet das nächste Abhaken falsch.
  assert.equal(out.next.recur_dtstart?.toISOString(), utc(2026, 9, 22, 8, 0).toISOString());
  assert.notEqual(out.next.id, created.task.id);
});

test('zweimal abhaken erzeugt keine zweite Nachfolgerin', async () => {
  const { workspaceId } = await scratch('ws-twice');
  const created = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Tabletten täglich',
    now: NOW,
  });
  const first = await complete(pool, created.task.id, userId, utc(2026, 9, 7, 11, 0));
  assert.ok(first.next !== undefined);
  const again = await complete(pool, created.task.id, userId, utc(2026, 9, 7, 11, 5));
  assert.equal(again.next, undefined, 'die Zeile war schon erledigt');
});

test('erledigungsbezogen rechnet ab dem Abhaken, nicht ab dem Plan', async () => {
  const { workspaceId } = await scratch('ws-after');
  const created = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Filter reinigen 3 Monate nach dem Abhaken',
    now: NOW,
  });
  assert.equal(created.task.planned_at, null, 'vor dem Abhaken gibt es kein Datum');
  assert.deepEqual(recurrenceOf(created.task), {
    kind: 'afterCompletion',
    n: 3,
    unit: 'month',
  });

  const out = await complete(pool, created.task.id, userId, utc(2026, 6, 12, 15, 30));
  assert.equal(
    out.next?.planned_at?.toISOString(),
    utc(2026, 9, 12, 15, 30).toISOString(),
  );
});

test('eine Aufgabe ohne Wiederholung bekommt keine Nachfolgerin', async () => {
  const { workspaceId } = await scratch('ws-once');
  const created = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Namen entscheiden heute',
    now: NOW,
  });
  const out = await complete(pool, created.task.id, userId, NOW);
  assert.equal(out.next, undefined);
});

test('eine Frist wandert mit der Wiederholung im gleichen Abstand mit', async () => {
  const { workspaceId } = await scratch('ws-due');
  const created = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Bericht wöchentlich',
    now: NOW,
  });
  await pool.query('UPDATE tasks SET planned_at = $2, due_at = $3 WHERE id = $1', [
    created.task.id,
    utc(2026, 9, 7),
    utc(2026, 9, 9),
  ]);
  const out = await complete(pool, created.task.id, userId, utc(2026, 9, 7, 12, 0));
  assert.ok(out.next !== undefined);
  const planned = out.next.planned_at!.getTime();
  const due = out.next.due_at!.getTime();
  assert.equal((due - planned) / 86_400_000, 2, 'zwei Tage Abstand wie vorher');
});

/* ── Die Heute-Ansicht ─────────────────────────────────────────────────── */

test('Heute trennt überfällig von heute und liest beide Zeitfelder', async () => {
  const { workspaceId } = await scratch('ws-today');
  const late = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Steuerbescheid einreichen',
    now: NOW,
  });
  await pool.query('UPDATE tasks SET planned_at = $2 WHERE id = $1', [
    late.task.id,
    utc(2026, 9, 4),
  ]);

  const heute = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Kopplung entwerfen heute 9:30',
    now: NOW,
  });

  // Nur eine Frist, kein geplanter Tag: gehört trotzdem in die Ansicht.
  const nurFrist = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Angebot einholen bis heute',
    now: NOW,
  });
  assert.equal(nurFrist.task.planned_at, null);

  // Und etwas, das nicht hineingehört.
  await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Später mal aufräumen in 2 Wochen',
    now: NOW,
  });

  const sections = await today(pool, workspaceId, NOW);
  assert.deepEqual(
    sections.overdue.map((t) => t.title),
    ['Steuerbescheid einreichen'],
  );
  assert.deepEqual(
    [...sections.today.map((t) => t.title)].sort(),
    ['Angebot einholen', 'Kopplung entwerfen'],
  );

  // Abgehakt heißt weg aus Heute — aber nicht aus der Datenbank.
  await complete(pool, heute.task.id, userId, NOW);
  const after_ = await today(pool, workspaceId, NOW);
  assert.equal(
    after_.today.some((t) => t.title === 'Kopplung entwerfen'),
    false,
  );
});

test('eine Aufgabe im Papierkorb erscheint nicht in Heute', async () => {
  const { workspaceId } = await scratch('ws-trash');
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Versehen heute',
    now: NOW,
  });
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [t.task.id]);
  const sections = await today(pool, workspaceId, NOW);
  assert.equal(sections.overdue.length + sections.today.length, 0);
});

/* ── Die Sortierschlüssel, gegen die echte Collation ───────────────────── */

test('die Datenbank sortiert die Sortierschlüssel wie ein String-Vergleich', async () => {
  const { workspaceId } = await scratch('ws-order');
  for (const line of ['A heute', 'B heute', 'C heute']) {
    await createFromLine(pool, { workspaceId, userId, line, now: NOW });
  }
  const rows = await pool.query<{ title: string; sort_key: string }>(
    `SELECT title, sort_key FROM tasks WHERE workspace_id = $1 ORDER BY sort_key`,
    [workspaceId],
  );
  assert.deepEqual(
    rows.rows.map((r) => r.title),
    ['A', 'B', 'C'],
  );
  // Und die Schlüssel sind wirklich verschieden und aufsteigend.
  const keys = rows.rows.map((r) => r.sort_key);
  assert.deepEqual([...keys].sort(), keys);
  assert.equal(new Set(keys).size, keys.length);
});
