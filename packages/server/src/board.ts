/**
 * SOTE — die Spalten einer Tafel.
 *
 * Sie gehören einer LISTE und nicht dem Arbeitsbereich: Spalten sind die
 * Gliederung eines Vorhabens, und zwei Vorhaben gliedern sich verschieden.
 *
 * ## Das Auffangbecken ist keine Spalte
 *
 * Abgesprochen: „eine erste Spalte zum Auffangbecken machen geht. Die kann man
 * dann ja umbenennen." Darum trägt keine Spalte eine Eigenschaft dafür, und
 * Aufgaben ohne Zuordnung behalten `column_id IS NULL`. Wer zeichnet, legt sie
 * in die erste Spalte — und damit verschiebt Umbenennen keine Aufgabe, und
 * Umsortieren auch nicht.
 *
 * Eine gespeicherte Markierung „das ist das Auffangbecken" müsste bei jedem
 * Umsortieren nachgezogen werden und wäre irgendwann an der zweiten Spalte.
 *
 * ## Die Fertig-Spalte folgt dem Häkchen
 *
 * Höchstens eine je Liste (teilweiser Index in 0029). Was beim Abhaken und
 * beim Wiederöffnen passiert, steht in `tasks.ts` — dort, wo das Häkchen
 * geschrieben wird, und nicht hier: zwei Schreibvorgänge wären ein
 * Zwischenzustand, in dem etwas fertig ist und noch in der alten Spalte liegt.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction } from './db.js';
import { sortKeyFor } from './tasks.js';

export class BoardTrouble extends Error {
  override name = 'BoardTrouble';
}

export interface BoardColumn {
  readonly id: string;
  readonly name: string;
  readonly sort_key: string;
  readonly is_done: boolean;
}

/** Die Spalten einer Liste, in ihrer Reihenfolge. */
export async function columnsOf(
  pool: Pool,
  workspaceId: string,
  projectId: string,
): Promise<readonly BoardColumn[]> {
  return queryRows<BoardColumn>(
    pool,
    `SELECT c.id, c.name, c.sort_key, c.is_done
       FROM board_columns c JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = $1 AND p.workspace_id = $2
      ORDER BY c.sort_key ASC`,
    [projectId, workspaceId],
  );
}

/**
 * Eine Spalte anlegen.
 *
 * Der Sortierschlüssel kommt fertig von der Oberfläche — dieselbe Aufteilung
 * wie beim Baum und bei den Aufgaben: nur sie weiß, zwischen welche beiden
 * Nachbarn etwas soll.
 */
export async function addColumn(
  pool: Pool,
  workspaceId: string,
  projectId: string,
  input: { name: string; sortKey: string; isDone?: boolean },
): Promise<BoardColumn> {
  const name = input.name.trim();
  if (name === '') throw new BoardTrouble('eine Spalte braucht einen Namen');

  return withTransaction(pool, async (client) => {
    const project = await queryOne<{ id: string }>(
      client,
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2',
      [projectId, workspaceId],
    );
    if (project === undefined) throw new BoardTrouble('diese Liste gibt es hier nicht');

    if (input.isDone === true) await clearDone(client, projectId);

    try {
      const row = await queryOne<BoardColumn>(
        client,
        `INSERT INTO board_columns (project_id, name, sort_key, is_done)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, sort_key, is_done`,
        [projectId, name, input.sortKey, input.isDone === true],
      );
      if (row === undefined) throw new Error('INSERT ohne Zeile');
      // Im selben Zug: was schon fertig ist, liegt ab jetzt hier.
      if (input.isDone === true) await gatherDone(client, projectId, row.id);
      return row;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        throw new BoardTrouble('an dieser Stelle steht schon eine Spalte — lade neu');
      }
      if (err.code === '23514') throw new BoardTrouble('dieser Name geht nicht');
      throw e;
    }
  });
}

/**
 * Umbenennen, umsortieren, zur Fertig-Spalte machen — oder das zurücknehmen.
 *
 * Ein fehlender Schlüssel heißt „nicht angefasst", wie überall in SOTE.
 */
export async function updateColumn(
  pool: Pool,
  workspaceId: string,
  columnId: string,
  fields: { name?: string; sortKey?: string; isDone?: boolean },
): Promise<BoardColumn> {
  return withTransaction(pool, async (client) => {
    const mine = await queryOne<{ project_id: string }>(
      client,
      `SELECT c.project_id FROM board_columns c JOIN projects p ON p.id = c.project_id
        WHERE c.id = $1 AND p.workspace_id = $2
        FOR UPDATE OF c`,
      [columnId, workspaceId],
    );
    if (mine === undefined) throw new BoardTrouble('diese Spalte gibt es hier nicht');

    /*
     * Die alte Fertig-Spalte verliert die Eigenschaft, BEVOR die neue sie
     * bekommt.
     *
     * Der teilweise Index lässt nur eine zu; ohne diesen Schritt würde das
     * Setzen an einer zweiten Spalte mit einem Datenbankfehler abbrechen —
     * also mit „geht nicht" statt mit dem, was jeder meint, der es drückt:
     * *ab jetzt ist DIESE die Fertig-Spalte.*
     */
    if (fields.isDone === true) await clearDone(client, mine.project_id, columnId);

    const sets: string[] = [];
    const params: unknown[] = [columnId];
    const set = (sql: string, value: unknown) => {
      params.push(value);
      sets.push(`${sql} = $${params.length}`);
    };
    if (fields.name !== undefined) {
      const name = fields.name.trim();
      if (name === '') throw new BoardTrouble('eine Spalte braucht einen Namen');
      set('name', name);
    }
    if (fields.sortKey !== undefined) set('sort_key', fields.sortKey);
    if (fields.isDone !== undefined) set('is_done', fields.isDone);
    if (sets.length === 0) throw new BoardTrouble('nichts zu ändern');

    try {
      const row = await queryOne<BoardColumn>(
        client,
        `UPDATE board_columns SET ${sets.join(', ')} WHERE id = $1
         RETURNING id, name, sort_key, is_done`,
        params,
      );
      if (row === undefined) throw new BoardTrouble('diese Spalte gibt es nicht');
      if (fields.isDone === true) await gatherDone(client, mine.project_id, columnId);
      return row;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        throw new BoardTrouble('an dieser Stelle steht schon eine Spalte — lade neu');
      }
      if (err.code === '23514') throw new BoardTrouble('dieser Name geht nicht');
      throw e;
    }
  });
}

/** Die Eigenschaft „fertig" von allen anderen Spalten nehmen. */
async function clearDone(
  client: Parameters<typeof queryOne>[0],
  projectId: string,
  except?: string,
): Promise<void> {
  await client.query(
    `UPDATE board_columns SET is_done = false
      WHERE project_id = $1 AND is_done AND ($2::uuid IS NULL OR id <> $2)`,
    [projectId, except ?? null],
  );
}

/**
 * Das Bereits-Erledigte in die frisch bestimmte Fertig-Spalte holen.
 *
 * GEMELDET: „Wenn ich fertige Aufgaben habe und dann eine Fertig-Spalte
 * anlege, dann sollten die vorhandenen fertigen auch direkt dort landen. Jetzt
 * geht das nur mit neuen, die ich abhake."
 *
 * Stimmt, und der Fehler war eine zu enge Lesart der Regel. Sie hieß bei mir
 * „beim Abhaken wandert es dorthin" — gemeint war aber: *in dieser Spalte
 * liegt, was fertig ist.* Eine Spalte, die „fertig" heißt und in der die
 * fertigen Aufgaben NICHT liegen, ist eine Beschriftung ohne Deckung; man
 * müsste die alten von Hand hinüberziehen, und zwar genau die, die man nicht
 * mehr ansieht.
 *
 * Nur die noch NICHT zugeordneten? Nein, alle: wer diese Spalte bestimmt, sagt
 * damit, wo Fertiges liegt — auch das, was jemand vorher in „In Arbeit"
 * abgehakt hat. Das ist der Sinn des Knopfes.
 *
 * Nicht im Papierkorb: was weggeworfen ist, gehört auf keine Tafel.
 */
async function gatherDone(
  client: Parameters<typeof queryOne>[0],
  projectId: string,
  columnId: string,
): Promise<void> {
  await client.query(
    `UPDATE tasks SET column_id = $2, updated_at = now()
      WHERE project_id = $1
        AND completed_at IS NOT NULL
        AND trashed_at IS NULL
        AND column_id IS DISTINCT FROM $2`,
    [projectId, columnId],
  );
}

/**
 * Eine Spalte wegräumen.
 *
 * Ihre Aufgaben fallen zurück ins Auffangbecken (`ON DELETE SET NULL` in
 * 0029) — also in die erste Spalte, dorthin, wo auch alles Neue anfängt. Wer
 * eine Spalte löscht, verliert keine Arbeit; ein `CASCADE` wäre die Antwort
 * „Spalte weg, Arbeit weg".
 */
export async function removeColumn(
  pool: Pool,
  workspaceId: string,
  columnId: string,
): Promise<void> {
  const out = await pool.query(
    `DELETE FROM board_columns c
      USING projects p
      WHERE c.id = $1 AND p.id = c.project_id AND p.workspace_id = $2`,
    [columnId, workspaceId],
  );
  if (out.rowCount === 0) throw new BoardTrouble('diese Spalte gibt es hier nicht');
}

/**
 * Eine Karte in eine Spalte legen.
 *
 * `columnId === null` legt sie ins Auffangbecken.
 *
 * ## In die Fertig-Spalte ziehen HAKT AB
 *
 * Und heraus zu ziehen öffnet wieder. Die Spalte heißt „fertig", und eine
 * offene Aufgabe darin wäre derselbe Widerspruch wie eine abgehakte in „In
 * Arbeit" — nur andersherum. Wer eine Karte dorthin zieht, meint genau das;
 * ihn danach noch das Kästchen anklicken zu lassen, wäre zweimal dasselbe
 * sagen.
 *
 * In EINEM Schreibvorgang, aus demselben Grund wie beim Abhaken: kein
 * Zwischenzustand, in dem die Karte schon dort liegt und noch offen ist.
 */
export async function placeCard(
  pool: Pool,
  workspaceId: string,
  taskId: string,
  columnId: string | null,
  userId: string | null,
  at: Date,
  /**
   * Wo in der Spalte — zwischen welchen beiden Karten.
   *
   * Leer heißt „Spalte wechseln, Reihenfolge lassen". Die Tafel führt KEINE
   * eigene Reihenfolge: sie sortiert nach demselben Schlüssel wie die Liste.
   * Ein zweiter Schlüssel je Spalte wäre eine zweite Ordnung derselben
   * Aufgaben — und dann stünde dieselbe Liste in zwei Ansichten verschieden,
   * ohne dass jemand das entschieden hätte.
   */
  between: { afterId?: string | null; beforeId?: string | null } = {},
): Promise<void> {
  return withTransaction(pool, async (client) => {
  const out = await client.query(
    `UPDATE tasks t SET
        column_id = $3,
        updated_at = now(),
        completed_at = CASE
          WHEN $3::uuid IS NOT NULL
           AND EXISTS (SELECT 1 FROM board_columns c WHERE c.id = $3 AND c.is_done)
            THEN COALESCE(t.completed_at, $4)
          WHEN EXISTS (SELECT 1 FROM board_columns c WHERE c.id = t.column_id AND c.is_done)
            THEN NULL
          ELSE t.completed_at
        END,
        completed_by = CASE
          WHEN $3::uuid IS NOT NULL
           AND EXISTS (SELECT 1 FROM board_columns c WHERE c.id = $3 AND c.is_done)
            THEN COALESCE(t.completed_by, $5)
          WHEN EXISTS (SELECT 1 FROM board_columns c WHERE c.id = t.column_id AND c.is_done)
            THEN NULL
          ELSE t.completed_by
        END
      WHERE t.id = $1 AND t.workspace_id = $2 AND t.trashed_at IS NULL
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM board_columns c
           WHERE c.id = $3 AND c.project_id IS NOT DISTINCT FROM t.project_id
        ))`,
    [taskId, workspaceId, columnId, at, userId],
  );
  if (out.rowCount === 0) {
    throw new BoardTrouble('diese Aufgabe oder diese Spalte gibt es hier nicht');
  }

  if (between.afterId === undefined && between.beforeId === undefined) return;

  /*
   * Und die Stelle innerhalb der Spalte — im SELBEN Schreibvorgang.
   *
   * Zwei Aufrufe wären ein Zwischenzustand, in dem die Karte schon in der
   * neuen Spalte liegt und noch an der alten Stelle steht; scheitert der
   * zweite, bleibt er stehen. Dieselbe Überlegung wie beim Abhaken.
   */
  const wo = await queryOne<{ project_id: string | null; parent_id: string | null }>(
    client,
    'SELECT project_id, parent_id FROM tasks WHERE id = $1 AND workspace_id = $2',
    [taskId, workspaceId],
  );
  if (wo === undefined) throw new BoardTrouble('diese Aufgabe gibt es hier nicht');

  const key = await sortKeyFor(client, {
    taskId,
    workspaceId,
    projectId: wo.project_id,
    parentId: wo.parent_id,
    between,
  });
  await client.query('UPDATE tasks SET sort_key = $2 WHERE id = $1', [taskId, key]);
  });
}
