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
import { makeList } from './support/tree.js';
import { migrate } from '../src/migrate.js';
import { MAX_DURATION } from '@sote/core';

import { detail } from '../src/detail.js';
import { search } from '../src/search.js';
import {
  complete,
  createFromLine,
  NotFound,
  patch,
  recurrenceOf,
  reopen,
} from '../src/tasks.js';
import { list, splitOverdue } from '../src/views.js';

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
  const projectId = await makeList(pool, w!.id, 'Haus');
  return { workspaceId: w!.id, projectId };
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
  // Zwei: der Ordner „Haus" und das Projekt „Haus" darin — die Form, die
  // `makeList` anlegt und die Migration 0009 herstellt. Entscheidend ist, dass
  // es NICHT drei sind: ein gemeldetes #projekt wird nicht stillschweigend
  // angelegt.
  assert.equal(count!.n, '2', 'es darf kein Projekt dazugekommen sein');
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

  const sections = splitOverdue(await list(pool, 'today', workspaceId, NOW), NOW);
  assert.deepEqual(
    sections.overdue.map((t) => t.title),
    ['Steuerbescheid einreichen'],
  );
  assert.deepEqual(
    [...sections.rest.map((t) => t.title)].sort(),
    ['Angebot einholen', 'Kopplung entwerfen'],
  );

  // Abgehakt heißt weg aus Heute — aber nicht aus der Datenbank.
  await complete(pool, heute.task.id, userId, NOW);
  const after_ = await list(pool, 'today', workspaceId, NOW);
  assert.equal(
    after_.some((t) => t.title === 'Kopplung entwerfen'),
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
  assert.equal((await list(pool, 'today', workspaceId, NOW)).length, 0);
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

/* ── Den Haken zurücknehmen ──────────────────────────────────────────────── */

test('eine abgehakte Aufgabe lässt sich wieder eröffnen', async () => {
  // Gemeldet: „Ich kann übrigens abgehakte Aufgaben nicht wieder eröffnen." Es
  // gab die Funktion nicht — die Oberfläche rief immer `complete`, und das
  // kehrt bei einer erledigten Aufgabe früh zurück.
  const { workspaceId, projectId } = await scratch('t-reopen');
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Kabel messen',
    now: NOW,
    projectId,
  });
  await complete(pool, t.task.id, userId, NOW);

  const back = await reopen(pool, t.task.id, workspaceId);
  assert.equal(back.completed_at, null);
  /*
   * „Von wem" ohne „wann" wäre eine Auskunft über ein Ereignis, das nicht
   * stattgefunden hat — also direkt aus der Tabelle gefragt und nicht aus der
   * Antwort: `RETURNING` führt `completed_by` nicht, weil die Oberfläche es
   * nicht anzeigt. Meine erste Fassung prüfte das Feld der Antwort und war
   * damit ein Test über eine Spaltenliste statt über die Datenbank.
   */
  const row = await queryOne<{ completed_by: string | null }>(
    pool,
    'SELECT completed_by FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.equal(row!.completed_by, null);
});

test('zweimal zurücknehmen ist kein Fehler', async () => {
  // Wer zweimal klickt, hat nicht zwei verschiedene Dinge gemeint. Der zweite
  // Aufruf trifft eine offene Aufgabe und lässt sie offen.
  const { workspaceId, projectId } = await scratch('t-reopen-twice');
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Doppelt',
    now: NOW,
    projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  await reopen(pool, t.task.id, workspaceId);
  const again = await reopen(pool, t.task.id, workspaceId);
  assert.equal(again.completed_at, null);
});

test('eine Aufgabe im Papierkorb lässt sich nicht wieder eröffnen', async () => {
  // Sie ist nicht offen und nicht erledigt, sondern weg. Sie hier zu öffnen
  // hieße, sie an einem Ort zu verändern, an dem man sie nicht sieht.
  const { workspaceId, projectId } = await scratch('t-reopen-trash');
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Weggeworfen',
    now: NOW,
    projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [t.task.id]);
  await assert.rejects(() => reopen(pool, t.task.id, workspaceId), NotFound);
});

test('ein fremder Arbeitsbereich kann sie nicht wieder eröffnen', async () => {
  // Die Route liegt hinter der Mitgliedsprüfung, aber die Funktion prüft es
  // selbst: eine Prüfung, die nur im Weg dorthin steht, gilt nur für diesen Weg.
  const a = await scratch('t-reopen-a');
  const b = await scratch('t-reopen-b');
  const t = await createFromLine(pool, {
    workspaceId: a.workspaceId,
    userId,
    line: 'Fremd',
    now: NOW,
    projectId: a.projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  await assert.rejects(() => reopen(pool, t.task.id, b.workspaceId), NotFound);
});

test('nach dem Wiedereröffnen steht sie wieder in ihrer Ansicht', async () => {
  const { workspaceId, projectId } = await scratch('t-reopen-view');
  const t = await createFromLine(pool, {
    workspaceId,
    userId,
    // „heute fällig heute" hätte beide Vorkommen als Zeitangabe gelesen und
    // einen leeren Titel hinterlassen — richtig so, aber als Testdatum
    // unbrauchbar. Dieselbe Falle wie in views.db.test.ts.
    line: 'Bericht fällig heute',
    now: NOW,
    projectId,
  });
  await complete(pool, t.task.id, userId, NOW);
  assert.equal((await list(pool, 'today', workspaceId, NOW)).length, 0);
  await reopen(pool, t.task.id, workspaceId);
  assert.deepEqual(
    (await list(pool, 'today', workspaceId, NOW)).map((x) => x.title),
    ['Bericht'],
  );
});

/* ── Die Dauer ─────────────────────────────────────────────────────────── */

test('~2h landet als 120 Minuten in der Zeile', async () => {
  const { workspaceId } = await scratch('ws-dauer');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Heizung entlüften ~2h',
    now: NOW,
  });
  assert.equal(out.task.duration_min, 120);
  assert.equal(out.task.title, 'Heizung entlüften');
});

test('ohne Angabe steht NULL und nicht 0', async () => {
  // Eine zweite Schreibweise für „keine Angabe“ müsste jede Summe kennen.
  const { workspaceId } = await scratch('ws-dauer-leer');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Irgendwas',
    now: NOW,
  });
  assert.equal(out.task.duration_min, null);
});

test('die Dauer lässt sich nachträglich setzen, ändern und wegnehmen', async () => {
  const { workspaceId } = await scratch('ws-dauer-patch');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Streichen', now: NOW });

  const gesetzt = await patch(pool, out.task.id, workspaceId, { duration: 45 });
  assert.equal(gesetzt.duration_min, 45);

  const geaendert = await patch(pool, out.task.id, workspaceId, { duration: 90 });
  assert.equal(geaendert.duration_min, 90);

  const weg = await patch(pool, out.task.id, workspaceId, { duration: null });
  assert.equal(weg.duration_min, null);
});

test('ein Patch ohne Dauer lässt sie stehen', async () => {
  /*
   * `undefined` heißt „nicht angefasst“, `null` heißt „leeren“. Die beiden zu
   * vermischen wäre ein Menü, das beim Setzen eines Datums die Schätzung
   * mitnimmt.
   */
  const { workspaceId } = await scratch('ws-dauer-unberuehrt');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Fegen ~30', now: NOW });
  const nachher = await patch(pool, out.task.id, workspaceId, { priority: 1 });
  assert.equal(nachher.duration_min, 30);
});

test('Unsinniges wird abgelehnt, mit Grund und nicht als 500', async () => {
  const { workspaceId } = await scratch('ws-dauer-grenzen');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas', now: NOW });
  for (const wert of [0, -5, 1.5, MAX_DURATION + 1]) {
    await assert.rejects(
      () => patch(pool, out.task.id, workspaceId, { duration: wert }),
      (e: Error) => e.name === 'OutOfOrder',
      `${wert} hätte abgelehnt werden müssen`,
    );
  }
  // Und die Grenze selbst gilt noch.
  const grenze = await patch(pool, out.task.id, workspaceId, { duration: MAX_DURATION });
  assert.equal(grenze.duration_min, MAX_DURATION);
});

test('der CHECK hält die Grenzen auch am Server vorbei', async () => {
  // Die Prüfung im Code gibt einen lesbaren Satz; die in der Tabelle gilt für
  // jeden weiteren Schreibweg, den es einmal gibt.
  const { workspaceId } = await scratch('ws-dauer-check');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas', now: NOW });
  await assert.rejects(() =>
    pool.query('UPDATE tasks SET duration_min = 0 WHERE id = $1', [out.task.id]),
  );
  await assert.rejects(() =>
    pool.query('UPDATE tasks SET duration_min = 99999 WHERE id = $1', [out.task.id]),
  );
});

test('die nächste Folge einer Wiederholung erbt die Schätzung', async () => {
  /*
   * Sie ist eine Eigenschaft der Aufgabe und nicht dieses Termins: derselbe
   * Vorgang dauert beim nächsten Mal dasselbe. Ohne das müsste man sie jede
   * Woche neu eintippen.
   */
  const { workspaceId } = await scratch('ws-dauer-wieder');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Rasen mähen jeden Montag ~45',
    now: NOW,
  });
  assert.equal(out.task.duration_min, 45);
  const done = await complete(pool, out.task.id, userId, NOW);
  assert.notEqual(done.next, undefined);
  assert.equal(done.next?.duration_min, 45);
});

test('jede Ansicht liefert die Dauer mit', async () => {
  /*
   * Vier Spaltenlisten stehen im Server (tasks, views, detail, search). Eine
   * neue Spalte in nur drei davon ist eine Zeile, die in einer Ansicht eine
   * Schätzung hat und in der nächsten nicht — und das sieht wie ein
   * Datenverlust aus.
   */
  const { workspaceId } = await scratch('ws-dauer-ansichten');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Ablage sortieren heute ~30',
    now: NOW,
  });
  const rows = await list(pool, 'today', workspaceId, NOW);
  const drin = rows.find((r) => r.id === out.task.id);
  assert.equal(drin?.duration_min, 30);

  const d = await detail(pool, out.task.id, workspaceId);
  assert.equal(d.task.duration_min, 30);

  const gefunden = await search(pool, workspaceId, 'Ablage', NOW);
  assert.equal(gefunden.tasks.find((r) => r.id === out.task.id)?.duration_min, 30);
});

/* ── Schlagwörter ──────────────────────────────────────────────────────── */

test('@wort beim Anlegen wird ein Schlagwort und steht an der Zeile', async () => {
  const { workspaceId } = await scratch('ws-tag');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Schrauben kaufen @baumarkt @unterwegs',
    now: NOW,
  });
  assert.equal(out.task.title, 'Schrauben kaufen');
  // Nach Namen sortiert, damit die Zeile bei jedem Laden gleich aussieht.
  assert.deepEqual(out.task.labels, ['baumarkt', 'unterwegs']);
});

test('ohne Schlagwörter steht ein leeres Array und nicht NULL', async () => {
  // NULL wäre eine zweite Schreibweise für „keine“, und jede Stelle in der
  // Oberfläche müsste beide kennen.
  const { workspaceId } = await scratch('ws-tag-leer');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Nichts', now: NOW });
  assert.deepEqual(out.task.labels, []);
});

test('@Haus und @haus sind EIN Schlagwort, die erste Schreibweise gilt', async () => {
  /*
   * Der Fehler, den Migration 0025 abstellt: `ON CONFLICT (workspace_id,
   * name)` verglich Zeichen für Zeichen, die Suche verglich `lower(name)`.
   * Also entstanden zwei Zeilen, die in einer Liste gleich aussahen — und
   * die Suche fand Aufgaben aus beiden.
   */
  const { workspaceId } = await scratch('ws-tag-gross');
  const erst = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Eins @Haus',
    now: NOW,
  });
  const dann = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Zwei @haus',
    now: NOW,
  });
  assert.deepEqual(erst.task.labels, ['Haus']);
  assert.deepEqual(dann.task.labels, ['Haus']);
  const zeilen = await pool.query('SELECT name FROM labels WHERE workspace_id = $1', [
    workspaceId,
  ]);
  assert.equal(zeilen.rows.length, 1);
});

test('der Index lässt keine zweite Schreibweise daneben', async () => {
  // Als eindeutiger Index über lower(name) und nicht als Prüfung im Code: ein
  // weiterer Schreibweg kennt ihn, ohne ihn zu kennen.
  const { workspaceId } = await scratch('ws-tag-index');
  await pool.query('INSERT INTO labels (workspace_id, name) VALUES ($1,$2)', [
    workspaceId,
    'Büro',
  ]);
  await assert.rejects(() =>
    pool.query('INSERT INTO labels (workspace_id, name) VALUES ($1,$2)', [workspaceId, 'büro']),
  );
});

test('Schlagwörter lassen sich nachträglich setzen, ergänzen und wegnehmen', async () => {
  const { workspaceId } = await scratch('ws-tag-patch');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Streichen', now: NOW });

  const eins = await patch(pool, out.task.id, workspaceId, { labels: ['baumarkt'] });
  assert.deepEqual(eins.labels, ['baumarkt']);

  const zwei = await patch(pool, out.task.id, workspaceId, {
    labels: ['baumarkt', 'unterwegs'],
  });
  assert.deepEqual(zwei.labels, ['baumarkt', 'unterwegs']);

  // Die Liste ist VOLLSTÄNDIG: was nicht drinsteht, geht ab.
  const weniger = await patch(pool, out.task.id, workspaceId, { labels: ['unterwegs'] });
  assert.deepEqual(weniger.labels, ['unterwegs']);

  const keine = await patch(pool, out.task.id, workspaceId, { labels: [] });
  assert.deepEqual(keine.labels, []);
});

test('die Antwort auf einen Patch trägt den NEUEN Stand', async () => {
  /*
   * `labels` ist keine Spalte, sondern `labels_of(id)`. Die Zeile aus dem
   * UPDATE trägt also den Stand VOR dem Schreiben der Zuordnungen — ohne das
   * zweite Lesen antwortet die Route mit den alten Etiketten, die Oberfläche
   * zeichnet sie, und das nächste Laden zeigt andere. Das sieht aus wie „hat
   * nicht gespeichert“.
   */
  const { workspaceId } = await scratch('ws-tag-antwort');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas @alt', now: NOW });
  const nachher = await patch(pool, out.task.id, workspaceId, { labels: ['neu'] });
  assert.deepEqual(nachher.labels, ['neu']);
});

test('ein Patch ohne Schlagwörter lässt sie stehen', async () => {
  const { workspaceId } = await scratch('ws-tag-unberuehrt');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas @haus', now: NOW });
  const nachher = await patch(pool, out.task.id, workspaceId, { priority: 1 });
  assert.deepEqual(nachher.labels, ['haus']);
});

test('ein Name mit Leerzeichen wird beim Setzen abgelehnt, mit Grund', async () => {
  const { workspaceId } = await scratch('ws-tag-schlecht');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas', now: NOW });
  await assert.rejects(
    () => patch(pool, out.task.id, workspaceId, { labels: ['zu hause'] }),
    (e: Error) => e.name === 'OutOfOrder',
  );
  // Und nichts halb geschrieben.
  const wieder = await patch(pool, out.task.id, workspaceId, { priority: 4 });
  assert.deepEqual(wieder.labels, []);
});

test('dasselbe Schlagwort in zwei Schreibweisen ist beim Setzen eines', async () => {
  const { workspaceId } = await scratch('ws-tag-doppelt');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Etwas', now: NOW });
  const nachher = await patch(pool, out.task.id, workspaceId, {
    labels: ['Haus', 'haus', 'HAUS'],
  });
  assert.deepEqual(nachher.labels, ['Haus']);
});

test('Schlagwörter gelten je Arbeitsbereich', async () => {
  // `UNIQUE (workspace_id, lower(name))`: derselbe Name in zwei Bereichen sind
  // zwei Schlagwörter, und keiner sieht das des anderen.
  const a = await scratch('ws-tag-a');
  const b = await scratch('ws-tag-b');
  const eins = await createFromLine(pool, {
    workspaceId: a.workspaceId,
    userId,
    line: 'Hier @gemeinsam',
    now: NOW,
  });
  const zwei = await createFromLine(pool, {
    workspaceId: b.workspaceId,
    userId,
    line: 'Dort @gemeinsam',
    now: NOW,
  });
  assert.deepEqual(eins.task.labels, ['gemeinsam']);
  assert.deepEqual(zwei.task.labels, ['gemeinsam']);
  /*
   * Auf die beiden Bereiche eingeschränkt, und das ist keine Feinheit: die
   * Testdatenbank bleibt zwischen den Läufen stehen, also zählte die Abfrage
   * ohne Einschränkung die `gemeinsam` aller früheren Läufe mit — beim
   * ersten Lauf grün, beim zweiten 8 statt 2. Genau die Sorte Test, die
   * einmal gutgeht und dann anfängt zu lügen.
   */
  const zeilen = await pool.query(
    `SELECT workspace_id FROM labels
      WHERE lower(name) = $1 AND workspace_id = ANY($2::uuid[])`,
    ['gemeinsam', [a.workspaceId, b.workspaceId]],
  );
  assert.equal(zeilen.rows.length, 2);
});

test('jede Ansicht liefert die Schlagwörter mit', async () => {
  const { workspaceId } = await scratch('ws-tag-ansichten');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Ablage sortieren heute @büro',
    now: NOW,
  });
  const rows = await list(pool, 'today', workspaceId, NOW);
  assert.deepEqual(rows.find((r) => r.id === out.task.id)?.labels, ['büro']);

  const d = await detail(pool, out.task.id, workspaceId);
  assert.deepEqual(d.task.labels, ['büro']);
  // Und der Vorrat für das Feld: was es hier schon gibt.
  assert.deepEqual(d.known, ['büro']);

  const gefunden = await search(pool, workspaceId, '@büro', NOW);
  assert.deepEqual(gefunden.tasks.find((r) => r.id === out.task.id)?.labels, ['büro']);
});

test('die Suche findet ein Schlagwort in jeder Schreibweise', async () => {
  const { workspaceId } = await scratch('ws-tag-suche');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Termin @Arzt',
    now: NOW,
  });
  for (const q of ['@Arzt', '@arzt', '@ARZT']) {
    const gefunden = await search(pool, workspaceId, q, NOW);
    assert.equal(gefunden.tasks.some((r) => r.id === out.task.id), true, q);
  }
});

/* ── Was an einer Aufgabe hängt, in der Zeile ──────────────────────────── */

/** Die Zeichen einer Aufgabe, direkt aus der Funktion gelesen. */
async function marks(id: string): Promise<string[]> {
  const out = await pool.query<{ marks: string[] }>(
    'SELECT marks_of($1) AS marks',
    [id],
  );
  return out.rows[0]!.marks;
}

test('eine nackte Aufgabe trägt keine Zeichen', async () => {
  const { workspaceId } = await scratch('ws-marks-leer');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Nackt', now: NOW });
  assert.deepEqual(await marks(out.task.id), []);
  // Und `[]`, nicht NULL — eine zweite Schreibweise für „nichts“ müsste jede
  // Stelle in der Oberfläche kennen.
  assert.deepEqual(out.task.marks, []);
});

test('eine Notiz zählt nur, wenn etwas drinsteht', async () => {
  /*
   * Ein leeres Notizfeld entsteht beim Öffnen und Wiederschließen des Feldes.
   * Ein Zeichen dafür wäre ein Hinweis auf einen Inhalt, den es nicht gibt —
   * und man klickt darauf und findet nichts.
   */
  const { workspaceId } = await scratch('ws-marks-notiz');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Mit Notiz', now: NOW });
  await pool.query('UPDATE tasks SET note = $1 WHERE id = $2', ['   ', out.task.id]);
  assert.deepEqual(await marks(out.task.id), []);
  await pool.query('UPDATE tasks SET note = $1 WHERE id = $2', ['etwas', out.task.id]);
  assert.deepEqual(await marks(out.task.id), ['note']);
});

test('ein Bild ist kein Anhang und ein Anhang kein Bild', async () => {
  // Der Grund, aus dem gefragt wurde: „ob ein Anhang dabei ist, ein Bild.“
  const { workspaceId } = await scratch('ws-marks-datei');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Mit Datei', now: NOW });
  const einfuegen = (mime: string) =>
    pool.query(
      `INSERT INTO task_files
         (task_id, workspace_id, filename, mime_type, size_bytes, storage, storage_key, uploaded_by)
       VALUES ($1,$2,'x',$3,1,'local',$4,$5)`,
      [out.task.id, workspaceId, mime, `k-${Math.random()}`, userId],
    );

  await einfuegen('application/pdf');
  assert.deepEqual(await marks(out.task.id), ['file']);
  await einfuegen('image/png');
  assert.deepEqual(await marks(out.task.id), ['file', 'image']);
});

test('mehrere Anhänge sind ein Zeichen und keine Zahl', async () => {
  // Die Zeile sagt, DASS etwas dran ist. Eine Zahl wäre eine Auskunft, die man
  // liest und nicht braucht — und sie kostet Platz in einer Zeile, die von
  // Titel und Datum lebt.
  const { workspaceId } = await scratch('ws-marks-viele');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Viele', now: NOW });
  for (let i = 0; i < 5; i += 1) {
    await pool.query(
      `INSERT INTO task_files
         (task_id, workspace_id, filename, mime_type, size_bytes, storage, storage_key, uploaded_by)
       VALUES ($1,$2,'x','image/png',1,'local',$3,$4)`,
      [out.task.id, workspaceId, `k-${i}-${Math.random()}`, userId],
    );
  }
  assert.deepEqual(await marks(out.task.id), ['image']);
});

test('nur OFFENE Teilaufgaben zählen', async () => {
  /*
   * Ein Zeichen für drei erledigte Unterpunkte wäre ein Hinweis auf Arbeit,
   * die getan ist — und die Zeile soll sagen, was noch dranhängt.
   */
  const { workspaceId } = await scratch('ws-marks-kinder');
  const eltern = await createFromLine(pool, { workspaceId, userId, line: 'Eltern', now: NOW });
  const kind = await createFromLine(pool, { workspaceId, userId, line: 'Kind', now: NOW });
  await pool.query('UPDATE tasks SET parent_id = $1 WHERE id = $2', [
    eltern.task.id,
    kind.task.id,
  ]);
  assert.deepEqual(await marks(eltern.task.id), ['subtask']);

  await pool.query('UPDATE tasks SET completed_at = now() WHERE id = $1', [kind.task.id]);
  assert.deepEqual(await marks(eltern.task.id), []);

  // Und Weggeworfenes zählt auch nicht.
  await pool.query('UPDATE tasks SET completed_at = NULL, trashed_at = now() WHERE id = $1', [
    kind.task.id,
  ]);
  assert.deepEqual(await marks(eltern.task.id), []);
});

test('nur AUSSTEHENDE Erinnerungen zählen', async () => {
  // Eine abgeschickte ist Vergangenheit, und ein Glockenzeichen dafür wäre die
  // Ankündigung einer Post, die schon da war.
  const { workspaceId } = await scratch('ws-marks-erinnern');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Mit Erinnerung morgen 9 Uhr',
    now: NOW,
  });
  await pool.query(
    'INSERT INTO task_reminders (task_id, user_id, offset_minutes) VALUES ($1,$2,30)',
    [out.task.id, userId],
  );
  assert.deepEqual(await marks(out.task.id), ['reminder']);

  await pool.query('UPDATE task_reminders SET sent_at = now() WHERE task_id = $1', [
    out.task.id,
  ]);
  assert.deepEqual(await marks(out.task.id), []);
});

test('Zuständige und Kommentare tragen je ein Zeichen', async () => {
  const { workspaceId } = await scratch('ws-marks-rest');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Rest', now: NOW });
  await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2)', [
    out.task.id,
    userId,
  ]);
  await pool.query(
    'INSERT INTO task_comments (task_id, author_id, body) VALUES ($1,$2,$3)',
    [out.task.id, userId, 'ein Wort'],
  );
  assert.deepEqual(await marks(out.task.id), ['assignee', 'comment']);
});

test('die Reihenfolge ist stabil, damit die Zeile nicht springt', async () => {
  /*
   * Sortiert in der Datenbank und nicht in der Oberfläche: käme die Liste in
   * der Reihenfolge der Einfügungen, sähe dieselbe Zeile bei jedem Laden
   * anders aus. Die Reihenfolge auf dem Bildschirm macht `MARKS` daraus —
   * gruppiert nach Sinn statt nach Alphabet.
   */
  const { workspaceId } = await scratch('ws-marks-ordnung');
  const out = await createFromLine(pool, { workspaceId, userId, line: 'Alles', now: NOW });
  await pool.query('UPDATE tasks SET note = $1 WHERE id = $2', ['da', out.task.id]);
  await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2)', [
    out.task.id,
    userId,
  ]);
  await pool.query(
    'INSERT INTO task_comments (task_id, author_id, body) VALUES ($1,$2,$3)',
    [out.task.id, userId, 'x'],
  );
  const erst = await marks(out.task.id);
  const nochmal = await marks(out.task.id);
  assert.deepEqual(erst, nochmal);
  assert.deepEqual(erst, ['assignee', 'comment', 'note']);
});

test('jede Ansicht liefert die Zeichen mit', async () => {
  const { workspaceId } = await scratch('ws-marks-ansichten');
  const out = await createFromLine(pool, {
    workspaceId,
    userId,
    line: 'Sichtbar heute',
    now: NOW,
  });
  await pool.query('UPDATE tasks SET note = $1 WHERE id = $2', ['eine Notiz', out.task.id]);

  const rows = await list(pool, 'today', workspaceId, NOW);
  assert.deepEqual(rows.find((r) => r.id === out.task.id)?.marks, ['note']);

  const d = await detail(pool, out.task.id, workspaceId);
  assert.deepEqual(d.task.marks, ['note']);

  const gefunden = await search(pool, workspaceId, 'Sichtbar', NOW);
  assert.deepEqual(gefunden.tasks.find((r) => r.id === out.task.id)?.marks, ['note']);
});
