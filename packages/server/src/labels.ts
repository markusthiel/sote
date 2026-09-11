/**
 * SOTE — die Schlagwörter eines Arbeitsbereichs.
 *
 * Vergeben werden sie an der Aufgabe (`tasks.ts`, `setLabels`) — hier steht,
 * was danach kommt: nachsehen, was es gibt, einen Tippfehler richtigstellen,
 * ein totes wegräumen.
 *
 * ## Warum es diesen Ort überhaupt gibt
 *
 * Ohne ihn wären „echte Schlagwörter" nur halb wahr. Ein Vokabular, das nur
 * wachsen kann, sammelt `unterwegs`, `Unterwegs` (bis 0025) und `unterweg` —
 * und nichts davon lässt sich einsammeln. Die Suche findet dann drei Listen, wo
 * eine gemeint war, und niemand kann es reparieren.
 *
 * ## Umbenennen ist manchmal Verschmelzen
 *
 * Wer `unterweg` auf `unterwegs` ändert und dabei auf ein vorhandenes trifft,
 * meint genau das: *diese beiden sind dasselbe.* Ein Fehler („gibt es schon")
 * wäre die Antwort auf eine Frage, die niemand gestellt hat — der Weg dahin
 * wäre: alle Aufgaben suchen, das eine anhängen, das andere abnehmen, dann
 * löschen. Also macht es das hier, und die Antwort SAGT, dass es verschmolzen
 * hat: eine Zusammenlegung, die man nicht bemerkt, ist ein Datenverlust.
 */

import type { Pool } from 'pg';

import { normalizeLabel, MAX_LABEL } from '@sote/core';

import { queryOne, queryRows, withTransaction } from './db.js';

/** Ein Schlagwort mit der Zahl der Aufgaben, an denen es hängt. */
export interface LabelOverview {
  readonly id: string;
  readonly name: string;
  /**
   * An wie vielen Aufgaben — OHNE die im Papierkorb.
   *
   * Sonst steht an einem Schlagwort „3", man sucht danach und findet eine:
   * die Suche blendet Weggeworfenes aus. Zwei Zahlen für eine Frage.
   */
  readonly tasks: number;
}

export class LabelTrouble extends Error {
  override name = 'LabelTrouble';
}

export async function labelsOfWorkspace(
  pool: Pool,
  workspaceId: string,
): Promise<readonly LabelOverview[]> {
  return queryRows<LabelOverview>(
    pool,
    `SELECT l.id, l.name,
            (SELECT count(*)::int FROM task_labels tl
               JOIN tasks t ON t.id = tl.task_id
              WHERE tl.label_id = l.id AND t.trashed_at IS NULL) AS tasks
       FROM labels l
      WHERE l.workspace_id = $1
      ORDER BY lower(l.name)`,
    [workspaceId],
  );
}

/**
 * Umbenennen — und verschmelzen, wenn der Name schon vergeben ist.
 *
 * Die Antwort sagt, was passiert ist: `merged` ist wahr, wenn zwei zu einem
 * wurden. Die Oberfläche schreibt es hin, damit niemand später sucht, wo sein
 * zweites Schlagwort geblieben ist.
 */
export async function renameLabel(
  pool: Pool,
  workspaceId: string,
  labelId: string,
  raw: string,
): Promise<{ name: string; merged: boolean }> {
  const name = normalizeLabel(raw);
  if (name === undefined) {
    throw new LabelTrouble(
      `„${raw.trim()}“ ist kein Schlagwort — ein Wort ohne Leerzeichen, höchstens ${MAX_LABEL} Zeichen`,
    );
  }

  return withTransaction(pool, async (client) => {
    const mine = await queryOne<{ id: string; name: string }>(
      client,
      'SELECT id, name FROM labels WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
      [labelId, workspaceId],
    );
    if (mine === undefined) throw new LabelTrouble('dieses Schlagwort gibt es nicht');

    const other = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM labels
        WHERE workspace_id = $1 AND lower(name) = lower($2) AND id <> $3`,
      [workspaceId, name, labelId],
    );

    if (other === undefined) {
      await client.query('UPDATE labels SET name = $1 WHERE id = $2', [name, labelId]);
      return { name, merged: false };
    }

    /*
     * Die Zuordnungen ziehen um, dann fällt das alte weg.
     *
     * `ON CONFLICT DO NOTHING`: eine Aufgabe, die beide trug, hat danach
     * eines — und nicht einen Fehler, der die ganze Zusammenlegung verhindert.
     * Das Ziel ist das VORHANDENE (`other`), nicht das umbenannte: dessen
     * Schreibweise steht schon in Zeilen und Suchen.
     */
    await client.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT task_id, $1 FROM task_labels WHERE label_id = $2
       ON CONFLICT DO NOTHING`,
      [other.id, labelId],
    );
    await client.query('DELETE FROM labels WHERE id = $1', [labelId]);
    return { name, merged: true };
  });
}

/**
 * Wegräumen.
 *
 * Es verschwindet von allen Aufgaben — das ist der Zweck, und die Oberfläche
 * sagt vorher, an wie vielen es hängt. KEIN Papierkorb dafür: ein Schlagwort
 * ist ein Wort und kein Inhalt, und man tippt es in einer Sekunde wieder hin.
 * Ein Papierkorb für Wörter wäre ein Ort, an dem niemand nachsieht.
 */
export async function removeLabel(
  pool: Pool,
  workspaceId: string,
  labelId: string,
): Promise<void> {
  const out = await pool.query('DELETE FROM labels WHERE id = $1 AND workspace_id = $2', [
    labelId,
    workspaceId,
  ]);
  if (out.rowCount === 0) throw new LabelTrouble('dieses Schlagwort gibt es nicht');
}
