/**
 * SOTE — wo jemand von der Vorgabe abweicht.
 *
 * Die Vorgabe des Arbeitsbereichs steht in `settings`; hier steht nur, welche
 * Liste eine Person anders sehen will. Zwei Ebenen, aufgelöst in der
 * Oberfläche (`resolveListView` im Kern) — der Server gibt beide heraus und
 * entscheidet nicht.
 *
 * ## Alles auf einmal und nicht je Liste
 *
 * Gelesen wird beim Öffnen eines Arbeitsbereichs, in einem Rutsch. Die
 * Alternative wäre eine Frage je Liste, also eine Abfrage bei jedem Wechsel —
 * und ein Flackern zwischen „voll" und der gewählten Form, weil die Antwort
 * nach dem ersten Zeichnen kommt.
 *
 * Es sind wenige Zeilen: eine Person weicht bei einer Handvoll Listen ab, nicht
 * bei allen. Wer nirgends abweicht, hat null Zeilen.
 */

import { isListPlace, isListView, type ListView } from '@sote/core';
import type { Pool } from 'pg';

import { queryRows } from './db.js';

export class ViewTrouble extends Error {
  override name = 'ViewTrouble';
}

/**
 * Was diese Person in diesem Bereich abweichend eingestellt hat.
 *
 * Zwei Karten statt einer: eine Liste wird über ihre Id genannt, eine feste
 * Ansicht über ihr Wort. Eine gemeinsame Karte müsste die beiden Schlüssel
 * unterscheidbar halten — und „ist das eine uuid?" ist keine Frage, die eine
 * Oberfläche stellen sollte.
 */
export interface ListViewChoices {
  readonly projects: Record<string, ListView>;
  readonly places: Record<string, ListView>;
}

export async function listViewsOf(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<ListViewChoices> {
  const rows = await queryRows<{
    project_id: string | null;
    place: string | null;
    display: string;
  }>(
    pool,
    `SELECT project_id, place, display FROM list_views
      WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId],
  );

  const projects: Record<string, ListView> = {};
  const places: Record<string, ListView> = {};
  for (const row of rows) {
    // Unbekanntes wird ÜBERGANGEN und nicht gemeldet: stünde dort eines Tages
    // ein Wort aus einer neueren Fassung (weil jemand zurückgerollt hat), soll
    // die Liste die gewöhnliche Form bekommen und keinen Fehler.
    if (!isListView(row.display)) continue;
    if (row.project_id !== null) projects[row.project_id] = row.display;
    else if (row.place !== null) places[row.place] = row.display;
  }
  return { projects, places };
}

/**
 * Eine Wahl setzen — oder zurücknehmen.
 *
 * `display === null` LÖSCHT die Zeile, statt „full" hineinzuschreiben. Der
 * Unterschied ist sichtbar: eine gelöschte Zeile folgt der Vorgabe des
 * Bereichs weiter, auch wenn die sich morgen ändert; ein hineingeschriebenes
 * „full" wäre eine Entscheidung, die dann stehen bleibt. „Wie der
 * Arbeitsbereich sagt" ist eine eigene Antwort und nicht dieselbe wie „voll".
 */
export async function setListView(
  pool: Pool,
  input: {
    workspaceId: string;
    userId: string;
    projectId?: string | undefined;
    place?: string | undefined;
    display: ListView | null;
  },
): Promise<void> {
  const { projectId, place } = input;
  if ((projectId === undefined) === (place === undefined)) {
    throw new ViewTrouble('entweder eine Liste oder eine feste Ansicht, nicht beides');
  }
  if (place !== undefined && !isListPlace(place)) {
    throw new ViewTrouble(`„${place}“ ist keine Ansicht`);
  }
  if (input.display !== null && !isListView(input.display)) {
    throw new ViewTrouble(`„${String(input.display)}“ ist keine Anzeigeform`);
  }

  if (input.display === null) {
    await pool.query(
      projectId !== undefined
        ? 'DELETE FROM list_views WHERE user_id = $1 AND project_id = $2'
        : `DELETE FROM list_views
            WHERE user_id = $1 AND workspace_id = $3 AND place = $2`,
      projectId !== undefined
        ? [input.userId, projectId]
        : [input.userId, place, input.workspaceId],
    );
    return;
  }

  try {
    if (projectId !== undefined) {
      /*
       * Der Arbeitsbereich kommt aus der LISTE und nicht aus dem Aufruf.
       *
       * Sonst könnte eine Zeile entstehen, die eine Liste des einen Bereichs
       * mit dem anderen verknüpft — der eindeutige Index steht auf
       * (user, project), also bliebe das unbemerkt und die Einstellung wäre in
       * keinem der beiden zu finden.
       */
      await pool.query(
        `INSERT INTO list_views (user_id, workspace_id, project_id, display)
         SELECT $1, p.workspace_id, p.id, $3 FROM projects p
          WHERE p.id = $2 AND p.workspace_id = $4
         ON CONFLICT (user_id, project_id) WHERE project_id IS NOT NULL
         DO UPDATE SET display = EXCLUDED.display`,
        [input.userId, projectId, input.display, input.workspaceId],
      );
      return;
    }
    await pool.query(
      `INSERT INTO list_views (user_id, workspace_id, place, display)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, workspace_id, place) WHERE place IS NOT NULL
       DO UPDATE SET display = EXCLUDED.display`,
      [input.userId, input.workspaceId, place, input.display],
    );
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23514') throw new ViewTrouble('diese Anzeigeform gibt es nicht');
    throw e;
  }
}
