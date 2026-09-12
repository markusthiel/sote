/**
 * SOTE — der Ort, an dem Schlagwörter wohnen.
 *
 * Vergeben werden sie an der Aufgabe (`tasks.db.test.ts`). Hier steht, was
 * danach kommt: nachsehen, richtigstellen, wegräumen — und der Fall, den man
 * beim Umbenennen leicht übersieht, nämlich der Zusammenstoß mit einem Namen,
 * den es schon gibt.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import { Pool } from 'pg';

import { migrate } from '../src/migrate.js';
import { labelsOfWorkspace, LabelTrouble, removeLabel, renameLabel } from '../src/labels.js';
import { createFromLine } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  pool = new Pool({ connectionString: URL_ });
  await migrate(pool);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1,'Tester') RETURNING id`,
    [`labels-${Date.now()}@example.test`],
  );
  userId = u.rows[0]!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(name: string): Promise<string> {
  const w = await pool.query<{ id: string }>(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`${name}-${Date.now()}-${Math.random()}`],
  );
  return w.rows[0]!.id;
}

test('die Übersicht zählt nur Aufgaben, die nicht im Papierkorb liegen', async () => {
  /*
   * Sonst steht an einem Schlagwort „3“, man sucht danach und findet eine: die
   * Suche blendet Weggeworfenes aus. Zwei Zahlen für eine Frage, und die
   * falsche steht an der Stelle, an der jemand entscheidet, ob er es wegräumt.
   */
  const ws = await scratch('ws-label-zahl');
  const a = await createFromLine(pool, { workspaceId: ws, userId, line: 'Eins +haus', now: NOW });
  await createFromLine(pool, { workspaceId: ws, userId, line: 'Zwei +haus', now: NOW });

  let liste = await labelsOfWorkspace(pool, ws);
  assert.equal(liste.length, 1);
  assert.equal(liste[0]?.tasks, 2);

  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [a.task.id]);
  liste = await labelsOfWorkspace(pool, ws);
  assert.equal(liste[0]?.tasks, 1);
});

test('umbenennen ändert den Namen an allen Aufgaben auf einmal', async () => {
  const ws = await scratch('ws-label-um');
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas +unterweg',
    now: NOW,
  });
  const liste = await labelsOfWorkspace(pool, ws);
  const out = await renameLabel(pool, ws, liste[0]!.id, 'unterwegs');
  assert.equal(out.name, 'unterwegs');
  assert.equal(out.merged, false);

  const zeile = await pool.query<{ labels: string[] }>(
    'SELECT labels_of(id) AS labels FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.deepEqual(zeile.rows[0]?.labels, ['unterwegs']);
});

test('umbenennen auf einen vorhandenen Namen VERSCHMILZT die beiden', async () => {
  /*
   * Wer `unterweg` auf `unterwegs` ändert und dabei auf ein vorhandenes
   * trifft, meint genau das: diese beiden sind dasselbe. Ein Fehler („gibt es
   * schon“) wäre die Antwort auf eine Frage, die niemand gestellt hat — der
   * Weg dahin wäre von Hand: alle Aufgaben suchen, das eine anhängen, das
   * andere abnehmen, dann löschen.
   */
  const ws = await scratch('ws-label-merge');
  const alt = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Alt +unterweg',
    now: NOW,
  });
  const neu = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Neu +unterwegs',
    now: NOW,
  });

  const liste = await labelsOfWorkspace(pool, ws);
  const falsch = liste.find((l) => l.name === 'unterweg')!;
  const out = await renameLabel(pool, ws, falsch.id, 'unterwegs');
  assert.equal(out.merged, true);

  // Eines statt zweien, und beide Aufgaben hängen daran.
  const danach = await labelsOfWorkspace(pool, ws);
  assert.equal(danach.length, 1);
  assert.equal(danach[0]?.name, 'unterwegs');
  assert.equal(danach[0]?.tasks, 2);

  for (const id of [alt.task.id, neu.task.id]) {
    const zeile = await pool.query<{ labels: string[] }>(
      'SELECT labels_of(id) AS labels FROM tasks WHERE id = $1',
      [id],
    );
    assert.deepEqual(zeile.rows[0]?.labels, ['unterwegs']);
  }
});

test('eine Aufgabe, die BEIDE trug, hat danach eines und keinen Fehler', async () => {
  // Ohne `ON CONFLICT DO NOTHING` bliebe die ganze Zusammenlegung an einer
  // einzigen Aufgabe hängen — und zwar an der, die am gründlichsten verschlagwortet ist.
  const ws = await scratch('ws-label-beide');
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Beides +unterweg +unterwegs',
    now: NOW,
  });
  const liste = await labelsOfWorkspace(pool, ws);
  const falsch = liste.find((l) => l.name === 'unterweg')!;
  const out = await renameLabel(pool, ws, falsch.id, 'unterwegs');
  assert.equal(out.merged, true);

  const zeile = await pool.query<{ labels: string[] }>(
    'SELECT labels_of(id) AS labels FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.deepEqual(zeile.rows[0]?.labels, ['unterwegs']);
});

test('auch eine andere Schreibweise ist ein Zusammenstoß', async () => {
  // `Haus` und `haus` sind dasselbe (Migration 0025). Ohne diesen Fall liefe
  // das Umbenennen in den eindeutigen Index und käme als 500 zurück.
  const ws = await scratch('ws-label-gross');
  await createFromLine(pool, { workspaceId: ws, userId, line: 'Eins +Haus', now: NOW });
  await createFromLine(pool, { workspaceId: ws, userId, line: 'Zwei +büro', now: NOW });
  const liste = await labelsOfWorkspace(pool, ws);
  const buero = liste.find((l) => l.name === 'büro')!;
  const out = await renameLabel(pool, ws, buero.id, 'haus');
  assert.equal(out.merged, true);
  const danach = await labelsOfWorkspace(pool, ws);
  assert.equal(danach.length, 1);
  // Die vorhandene Schreibweise bleibt: sie steht schon in Zeilen und Suchen.
  assert.equal(danach[0]?.name, 'Haus');
});

test('ein unbrauchbarer Name wird abgelehnt, mit Grund', async () => {
  const ws = await scratch('ws-label-schlecht');
  await createFromLine(pool, { workspaceId: ws, userId, line: 'Etwas +haus', now: NOW });
  const liste = await labelsOfWorkspace(pool, ws);
  for (const name of ['zu hause', '', '+haus']) {
    await assert.rejects(
      () => renameLabel(pool, ws, liste[0]!.id, name),
      (e: Error) => e instanceof LabelTrouble,
      name,
    );
  }
});

test('wegräumen nimmt es von allen Aufgaben', async () => {
  const ws = await scratch('ws-label-weg');
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Etwas +weg +bleibt',
    now: NOW,
  });
  const liste = await labelsOfWorkspace(pool, ws);
  await removeLabel(pool, ws, liste.find((l) => l.name === 'weg')!.id);

  const zeile = await pool.query<{ labels: string[] }>(
    'SELECT labels_of(id) AS labels FROM tasks WHERE id = $1',
    [t.task.id],
  );
  assert.deepEqual(zeile.rows[0]?.labels, ['bleibt']);
});

test('ein fremdes Schlagwort lässt sich weder umbenennen noch wegräumen', async () => {
  /*
   * Die Id allein ist kein Ausweis. Ohne die Bedingung auf den
   * Arbeitsbereich könnte ein Mitglied des einen das Vokabular des anderen
   * umschreiben — und es würde nicht einmal auffallen.
   */
  const meins = await scratch('ws-label-meins');
  const fremd = await scratch('ws-label-fremd');
  await createFromLine(pool, { workspaceId: fremd, userId, line: 'Dort +geheim', now: NOW });
  const dort = await labelsOfWorkspace(pool, fremd);

  await assert.rejects(
    () => renameLabel(pool, meins, dort[0]!.id, 'meins'),
    (e: Error) => e instanceof LabelTrouble,
  );
  await assert.rejects(
    () => removeLabel(pool, meins, dort[0]!.id),
    (e: Error) => e instanceof LabelTrouble,
  );
  assert.equal((await labelsOfWorkspace(pool, fremd)).length, 1);
});
