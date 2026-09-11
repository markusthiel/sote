/**
 * SOTE — die Tafel.
 *
 * Drei Regeln, und jede hat einen Test, der sagt, was ohne sie schiefginge:
 *
 * 1. Das Auffangbecken ist KEINE Spalte — es ist `column_id IS NULL`.
 * 2. Höchstens eine Fertig-Spalte, und sie folgt dem Häkchen.
 * 3. Eine gelöschte Spalte nimmt keine Aufgabe mit.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { addColumn, BoardTrouble, columnsOf, placeCard, removeColumn, updateColumn } from '../src/board.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { complete, createFromLine, reopen } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Tafelmensch') RETURNING id`,
    [`board-${process.pid}-${Date.now()}@example.org`],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(): Promise<{ ws: string; liste: string }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`board-${Date.now()}-${Math.random()}`],
  );
  const f = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,'Ordner','folder','a0') RETURNING id`,
    [w!.id],
  );
  const l = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,'Liste','list','a0') RETURNING id`,
    [w!.id, f!.id],
  );
  return { ws: w!.id, liste: l!.id };
}

const spalteVon = async (taskId: string) =>
  (await pool.query<{ column_id: string | null }>('SELECT column_id FROM tasks WHERE id = $1', [
    taskId,
  ])).rows[0]!.column_id;

test('eine Liste fängt ohne Spalten an', async () => {
  // Und das ist kein Mangel: eine Liste ohne Tafel ist eine Liste.
  const { ws, liste } = await scratch();
  assert.deepEqual(await columnsOf(pool, ws, liste), []);
});

test('Spalten stehen in ihrer Reihenfolge', async () => {
  const { ws, liste } = await scratch();
  await addColumn(pool, ws, liste, { name: 'Offen', sortKey: 'a0' });
  await addColumn(pool, ws, liste, { name: 'Fertig', sortKey: 'a2' });
  await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a1' });
  assert.deepEqual((await columnsOf(pool, ws, liste)).map((c) => c.name), [
    'Offen',
    'In Arbeit',
    'Fertig',
  ]);
});

test('eine neue Aufgabe liegt im Auffangbecken, nicht in einer Spalte', async () => {
  /*
   * Das Auffangbecken ist KEINE Spalte, sondern `column_id IS NULL`. Wer die
   * erste Spalte umbenennt, verschiebt damit keine Aufgabe; wer sie löscht,
   * macht die zweite zur ersten — ganz ohne dass eine Zeile angefasst wird.
   */
  const { ws, liste } = await scratch();
  await addColumn(pool, ws, liste, { name: 'Eingang', sortKey: 'a0' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Neu',
    now: NOW,
    projectId: liste,
  });
  assert.equal(await spalteVon(t.task.id), null);
});

test('ohne Fertig-Spalte bleibt eine abgehakte Aufgabe liegen', async () => {
  // „Wenn man diese Spalte nicht angelegt hat, dann bleiben die Aufgaben als
  // abgehakt in der jeweiligen Spalte liegen."
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas',
    now: NOW,
    projectId: liste,
  });
  await placeCard(pool, ws, t.task.id, arbeit.id, userId, NOW);
  await complete(pool, t.task.id, userId, NOW);
  assert.equal(await spalteVon(t.task.id), arbeit.id);
});

test('mit Fertig-Spalte wandert eine abgehakte Aufgabe dorthin', async () => {
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });
  const fertig = await addColumn(pool, ws, liste, {
    name: 'Fertig',
    sortKey: 'a1',
    isDone: true,
  });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas',
    now: NOW,
    projectId: liste,
  });
  await placeCard(pool, ws, t.task.id, arbeit.id, userId, NOW);
  await complete(pool, t.task.id, userId, NOW);
  assert.equal(await spalteVon(t.task.id), fertig.id);
});

test('wieder öffnen holt sie aus der Fertig-Spalte ins Auffangbecken', async () => {
  /*
   * Eine offene Aufgabe in „Fertig" wäre derselbe Widerspruch wie eine
   * abgehakte in „In Arbeit“, nur andersherum. Zurück ins Auffangbecken und
   * nicht dorthin, wo sie vorher lag: das müsste eine zweite Spalte merken,
   * und die wäre falsch, sobald jemand die alte weggeräumt hat.
   */
  const { ws, liste } = await scratch();
  const fertig = await addColumn(pool, ws, liste, {
    name: 'Fertig',
    sortKey: 'a1',
    isDone: true,
  });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas',
    now: NOW,
    projectId: liste,
  });
  await complete(pool, t.task.id, userId, NOW);
  assert.equal(await spalteVon(t.task.id), fertig.id);
  await reopen(pool, t.task.id, ws);
  assert.equal(await spalteVon(t.task.id), null);
});

test('wieder öffnen lässt eine Karte in einer gewöhnlichen Spalte liegen', async () => {
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas',
    now: NOW,
    projectId: liste,
  });
  await placeCard(pool, ws, t.task.id, arbeit.id, userId, NOW);
  await complete(pool, t.task.id, userId, NOW);
  await reopen(pool, t.task.id, ws);
  assert.equal(await spalteVon(t.task.id), arbeit.id);
});

test('in die Fertig-Spalte ziehen hakt ab, herausziehen öffnet wieder', async () => {
  // Wer eine Karte dorthin zieht, meint genau das — ihn danach noch das
  // Kästchen anklicken zu lassen, wäre zweimal dasselbe sagen.
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });
  const fertig = await addColumn(pool, ws, liste, {
    name: 'Fertig',
    sortKey: 'a1',
    isDone: true,
  });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas',
    now: NOW,
    projectId: liste,
  });

  await placeCard(pool, ws, t.task.id, fertig.id, userId, NOW);
  const abgehakt = await pool.query<{ completed_at: Date | null }>(
    'SELECT completed_at FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.notEqual(abgehakt.rows[0]!.completed_at, null);

  await placeCard(pool, ws, t.task.id, arbeit.id, userId, NOW);
  const wieder = await pool.query<{ completed_at: Date | null }>(
    'SELECT completed_at FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.equal(wieder.rows[0]!.completed_at, null);
});

test('es gibt höchstens EINE Fertig-Spalte, und die letzte Ansage gilt', async () => {
  /*
   * Zwei wären zwei Ziele für dasselbe Abhaken, und welches gewinnt, entschiede
   * die Reihenfolge des Lesens. Der teilweise Index lässt nur eine zu — darum
   * nimmt der Server sie der alten ab, BEVOR er sie der neuen gibt. Ohne das
   * bräche es mit einem Datenbankfehler ab, also mit „geht nicht" statt mit
   * dem, was jeder meint, der es drückt.
   */
  const { ws, liste } = await scratch();
  const a = await addColumn(pool, ws, liste, { name: 'A', sortKey: 'a0', isDone: true });
  const b = await addColumn(pool, ws, liste, { name: 'B', sortKey: 'a1', isDone: true });
  const spalten = await columnsOf(pool, ws, liste);
  assert.deepEqual(spalten.filter((c) => c.is_done).map((c) => c.id), [b.id]);

  await updateColumn(pool, ws, a.id, { isDone: true });
  const danach = await columnsOf(pool, ws, liste);
  assert.deepEqual(danach.filter((c) => c.is_done).map((c) => c.id), [a.id]);
});

test('eine gelöschte Spalte nimmt keine Aufgabe mit', async () => {
  // Ein CASCADE wäre die Antwort „Spalte weg, Arbeit weg“. Die Karten fallen
  // ins Auffangbecken — dorthin, wo auch alles Neue anfängt.
  const { ws, liste } = await scratch();
  const weg = await addColumn(pool, ws, liste, { name: 'Weg', sortKey: 'a0' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Bleibt',
    now: NOW,
    projectId: liste,
  });
  await placeCard(pool, ws, t.task.id, weg.id, userId, NOW);
  await removeColumn(pool, ws, weg.id);

  const noch = await pool.query('SELECT column_id FROM tasks WHERE id = $1', [t.task.id]);
  assert.equal(noch.rows.length, 1);
  assert.equal(noch.rows[0]!.column_id, null);
});

test('eine Spalte aus einer fremden Liste nimmt keine Karte auf', async () => {
  const meins = await scratch();
  const fremd = await scratch();
  const dort = await addColumn(pool, fremd.ws, fremd.liste, { name: 'Dort', sortKey: 'a0' });
  const t = await createFromLine(pool, {
    workspaceId: meins.ws,
    userId,
    line: 'Hier',
    now: NOW,
    projectId: meins.liste,
  });
  await assert.rejects(
    () => placeCard(pool, meins.ws, t.task.id, dort.id, userId, NOW),
    (e: Error) => e instanceof BoardTrouble,
  );
});

test('eine Spalte aus einem fremden Bereich lässt sich nicht ändern', async () => {
  const meins = await scratch();
  const fremd = await scratch();
  const dort = await addColumn(pool, fremd.ws, fremd.liste, { name: 'Dort', sortKey: 'a0' });
  await assert.rejects(
    () => updateColumn(pool, meins.ws, dort.id, { name: 'Meins' }),
    (e: Error) => e instanceof BoardTrouble,
  );
  await assert.rejects(
    () => removeColumn(pool, meins.ws, dort.id),
    (e: Error) => e instanceof BoardTrouble,
  );
  assert.equal((await columnsOf(pool, fremd.ws, fremd.liste))[0]?.name, 'Dort');
});

test('ein leerer Name wird abgelehnt', async () => {
  const { ws, liste } = await scratch();
  await assert.rejects(
    () => addColumn(pool, ws, liste, { name: '   ', sortKey: 'a0' }),
    (e: Error) => e instanceof BoardTrouble,
  );
});

test('eine Karte lässt sich innerhalb der Spalte einsortieren', async () => {
  /*
   * Die Tafel führt KEINE eigene Reihenfolge: sie sortiert nach demselben
   * Schlüssel wie die Liste. Ein zweiter Schlüssel je Spalte wäre eine zweite
   * Ordnung derselben Aufgaben — und dann stünde dieselbe Liste in zwei
   * Ansichten verschieden, ohne dass jemand das entschieden hätte.
   */
  const { ws, liste } = await scratch();
  const spalte = await addColumn(pool, ws, liste, { name: 'Offen', sortKey: 'a0' });
  const karten = [];
  for (const titel of ['A', 'B', 'C']) {
    const t = await createFromLine(pool, {
      workspaceId: ws,
      userId,
      line: titel,
      now: NOW,
      projectId: liste,
    });
    await placeCard(pool, ws, t.task.id, spalte.id, userId, NOW);
    karten.push(t.task.id);
  }

  const reihe = async () =>
    (
      await pool.query<{ title: string }>(
        `SELECT title FROM tasks WHERE column_id = $1 ORDER BY sort_key ASC`,
        [spalte.id],
      )
    ).rows.map((r) => r.title);

  const vorher = await reihe();
  // C nach ganz vorn.
  await placeCard(pool, ws, karten[2]!, spalte.id, userId, NOW, {
    afterId: null,
    beforeId: vorher[0] === 'C' ? null : karten[0]!,
  });
  assert.equal((await reihe())[0], 'C');
});

test('eine Karte behält ihre Stelle, wenn nur die Spalte wechselt', async () => {
  // Fehlende Nachbarn heißen „Reihenfolge lassen“ — sonst würde jedes
  // Verschieben zwischen Spalten die Liste umsortieren.
  const { ws, liste } = await scratch();
  const a = await addColumn(pool, ws, liste, { name: 'A', sortKey: 'a0' });
  const b = await addColumn(pool, ws, liste, { name: 'B', sortKey: 'a1' });
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Wandert',
    now: NOW,
    projectId: liste,
  });
  const vorher = (
    await pool.query<{ sort_key: string }>('SELECT sort_key FROM tasks WHERE id = $1', [
      t.task.id,
    ])
  ).rows[0]!.sort_key;

  await placeCard(pool, ws, t.task.id, a.id, userId, NOW);
  await placeCard(pool, ws, t.task.id, b.id, userId, NOW);
  const nachher = (
    await pool.query<{ sort_key: string }>('SELECT sort_key FROM tasks WHERE id = $1', [
      t.task.id,
    ])
  ).rows[0]!.sort_key;
  assert.equal(nachher, vorher);
});

test('Spalten lassen sich umsortieren', async () => {
  const { ws, liste } = await scratch();
  const a = await addColumn(pool, ws, liste, { name: 'A', sortKey: 'a1' });
  await addColumn(pool, ws, liste, { name: 'B', sortKey: 'a2' });
  await addColumn(pool, ws, liste, { name: 'C', sortKey: 'a3' });
  // A ans Ende.
  await updateColumn(pool, ws, a.id, { sortKey: 'a4' });
  assert.deepEqual((await columnsOf(pool, ws, liste)).map((c) => c.name), ['B', 'C', 'A']);
});

test('zwei Spalten können nicht denselben Platz haben', async () => {
  // Der eindeutige Index über (Liste, Schlüssel). Er fängt eine veraltete
  // Ansicht ab: wer gegen einen Stand von vorhin rechnet, bekommt einen Satz
  // statt einer Spalte, die woanders landet als gezeigt.
  const { ws, liste } = await scratch();
  await addColumn(pool, ws, liste, { name: 'A', sortKey: 'a1' });
  const b = await addColumn(pool, ws, liste, { name: 'B', sortKey: 'a2' });
  await assert.rejects(
    () => updateColumn(pool, ws, b.id, { sortKey: 'a1' }),
    (e: Error) => e instanceof BoardTrouble,
  );
});

test('eine frisch bestimmte Fertig-Spalte holt das BEREITS Erledigte', async () => {
  /*
   * GEMELDET: „Wenn ich fertige Aufgaben habe und dann eine Fertig-Spalte
   * anlege, dann sollten die vorhandenen fertigen auch direkt dort landen."
   *
   * Der Fehler war eine zu enge Lesart der Regel: sie hieß bei mir „beim
   * Abhaken wandert es dorthin“, gemeint war aber „in dieser Spalte liegt, was
   * fertig ist“. Eine Spalte namens „Fertig“, in der die fertigen Aufgaben
   * nicht liegen, ist eine Beschriftung ohne Deckung.
   */
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });

  const alt = await createFromLine(pool, {
    workspaceId: ws, userId, line: 'Schon fertig', now: NOW, projectId: liste,
  });
  const ohne = await createFromLine(pool, {
    workspaceId: ws, userId, line: 'Fertig ohne Spalte', now: NOW, projectId: liste,
  });
  const offen = await createFromLine(pool, {
    workspaceId: ws, userId, line: 'Noch offen', now: NOW, projectId: liste,
  });
  await placeCard(pool, ws, alt.task.id, arbeit.id, userId, NOW);
  await complete(pool, alt.task.id, userId, NOW);
  await complete(pool, ohne.task.id, userId, NOW);

  // Jetzt erst die Fertig-Spalte.
  const fertig = await addColumn(pool, ws, liste, {
    name: 'Fertig', sortKey: 'a1', isDone: true,
  });

  // Beide wandern — auch die, die in einer anderen Spalte abgehakt wurde.
  assert.equal(await spalteVon(alt.task.id), fertig.id);
  assert.equal(await spalteVon(ohne.task.id), fertig.id);
  // Und das Offene bleibt, wo es ist.
  assert.equal(await spalteVon(offen.task.id), null);
});

test('eine vorhandene Spalte zur Fertig-Spalte zu machen holt sie ebenso', async () => {
  const { ws, liste } = await scratch();
  const arbeit = await addColumn(pool, ws, liste, { name: 'In Arbeit', sortKey: 'a0' });
  const spaeter = await addColumn(pool, ws, liste, { name: 'Erledigt', sortKey: 'a1' });
  const t = await createFromLine(pool, {
    workspaceId: ws, userId, line: 'Fertig', now: NOW, projectId: liste,
  });
  await placeCard(pool, ws, t.task.id, arbeit.id, userId, NOW);
  await complete(pool, t.task.id, userId, NOW);
  assert.equal(await spalteVon(t.task.id), arbeit.id);

  await updateColumn(pool, ws, spaeter.id, { isDone: true });
  assert.equal(await spalteVon(t.task.id), spaeter.id);
});

test('Weggeworfenes wandert nicht mit', async () => {
  // Was im Papierkorb liegt, gehört auf keine Tafel.
  const { ws, liste } = await scratch();
  const t = await createFromLine(pool, {
    workspaceId: ws, userId, line: 'Weg', now: NOW, projectId: liste,
  });
  await complete(pool, t.task.id, userId, NOW);
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [t.task.id]);
  await addColumn(pool, ws, liste, { name: 'Fertig', sortKey: 'a0', isDone: true });
  assert.equal(await spalteVon(t.task.id), null);
});
