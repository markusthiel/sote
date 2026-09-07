/**
 * SOTE — die Ansichten.
 *
 * **Eine** Stelle entscheidet, was „Heute" heißt. Vorher stand die Bedingung in
 * `tasks.ts` neben dem Schreiben, und die nächste Ansicht hätte ihre eigene
 * Kopie bekommen — das ist der Weg zu zwei Antworten auf eine Frage (SONE,
 * ADR-0086). Die Zähler im Panel lesen dieselben Bedingungen wie die Listen;
 * ein zweiter Weg zur Zahl ist, wie Zahl und Liste sich uneins werden
 * (ADR-0092).
 *
 * Die vier Ansichten und ihre Bedeutung:
 *
 * - **Heute** — geplant für heute oder früher, **oder** die Frist läuft heute
 *   oder früher ab. Zwei Felder, eine Ansicht: das ist der Sinn der Trennung.
 * - **Demnächst** — hat einen Zeitpunkt, aber er liegt nach heute.
 * - **Irgendwann** — hat keinen Zeitpunkt. Nicht „unwichtig", sondern
 *   „ungeplant"; hier liegt auch die erledigungsbezogene Wiederholung vor ihrem
 *   ersten Abhaken.
 * - **Ein Projekt** — alles darin, ungeachtet der Zeit.
 */

import type { Pool } from 'pg';

import { queryRows, type PoolClient } from './db.js';
import type { TaskRow } from './tasks.js';

export type ViewId = 'today' | 'upcoming' | 'someday' | 'project';

const COLUMNS = `
  id, workspace_id, project_id, parent_id, title, note,
  planned_at, planned_all_day, due_at, due_all_day, priority,
  completed_at, recur_rrule, recur_dtstart, recur_after_n,
  recur_after_unit, sort_key`;

/** Immer wahr für jede Zeile, die überhaupt in einer Ansicht auftauchen darf. */
const ALIVE = `completed_at IS NULL AND trashed_at IS NULL`;

export interface Bounds {
  readonly startOfDay: Date;
  readonly endOfDay: Date;
}

/**
 * Der Tag, in dem `now` liegt.
 *
 * Gerechnet in UTC, weil der Server keine Zeitzone hat. Die Zeitzone gehört dem
 * Browser: er weiß, in welchem Tag jemand steht, und der Server weiß es nicht
 * (dieselbe Aufteilung wie beim Zurückstellen in SONE, ADR-0075). Solange die
 * Oberfläche `now` mitschickt, ist das hier richtig; sobald ein Job nachts
 * Erinnerungen verschickt, braucht er die Zeitzone der Person und nicht diese
 * Funktion.
 */
export function boundsOf(now: Date): Bounds {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return {
    startOfDay: new Date(Date.UTC(y, m, d)),
    endOfDay: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
  };
}

interface Where {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly order: string;
}

function whereFor(
  view: ViewId,
  workspaceId: string,
  bounds: Bounds,
  projectId: string | null,
): Where {
  switch (view) {
    case 'today':
      return {
        sql: `workspace_id = $1 AND ${ALIVE}
              AND (planned_at <= $2 OR due_at <= $2)`,
        params: [workspaceId, bounds.endOfDay],
        order: 'priority ASC, COALESCE(planned_at, due_at) ASC, sort_key ASC',
      };
    case 'upcoming':
      return {
        sql: `workspace_id = $1 AND ${ALIVE}
              AND (planned_at IS NOT NULL OR due_at IS NOT NULL)
              AND COALESCE(planned_at, due_at) > $2`,
        params: [workspaceId, bounds.endOfDay],
        order: 'COALESCE(planned_at, due_at) ASC, priority ASC, sort_key ASC',
      };
    case 'someday':
      return {
        sql: `workspace_id = $1 AND ${ALIVE}
              AND planned_at IS NULL AND due_at IS NULL`,
        params: [workspaceId],
        order: 'priority ASC, sort_key ASC',
      };
    case 'project':
      return {
        // Ein Projekt zeigt auch Erledigtes, aber unten und begrenzt: „was habe
        // ich hier geschafft" ist eine Frage, die dieser Bildschirm beantworten
        // soll, und `Heute` soll sie nicht beantworten.
        sql: `workspace_id = $1 AND project_id = $2 AND trashed_at IS NULL`,
        params: [workspaceId, projectId],
        order: 'completed_at IS NOT NULL, sort_key ASC',
      };
  }
}

export async function list(
  q: Pool | PoolClient,
  view: ViewId,
  workspaceId: string,
  now: Date,
  projectId: string | null = null,
): Promise<TaskRow[]> {
  const bounds = boundsOf(now);
  const where = whereFor(view, workspaceId, bounds, projectId);
  return queryRows<TaskRow>(
    q,
    `SELECT ${COLUMNS} FROM tasks WHERE ${where.sql} ORDER BY ${where.order}`,
    where.params,
  );
}

/**
 * Die Zahlen für das Panel — aus **denselben** Bedingungen wie die Listen.
 *
 * In einer Abfrage und nicht in drei: drei Runden für drei Zahlen sind drei
 * Zeitpunkte, und dann zeigt das Panel eine Summe, die es nie gegeben hat.
 */
export async function counts(
  q: Pool | PoolClient,
  workspaceId: string,
  now: Date,
): Promise<{ today: number; upcoming: number; someday: number; overdue: number }> {
  const bounds = boundsOf(now);
  const rows = await queryRows<{
    today: string;
    upcoming: string;
    someday: string;
    overdue: string;
  }>(
    q,
    `SELECT
       count(*) FILTER (WHERE planned_at <= $2 OR due_at <= $2)          AS today,
       count(*) FILTER (WHERE (planned_at IS NOT NULL OR due_at IS NOT NULL)
                          AND COALESCE(planned_at, due_at) > $2)         AS upcoming,
       count(*) FILTER (WHERE planned_at IS NULL AND due_at IS NULL)     AS someday,
       count(*) FILTER (WHERE COALESCE(planned_at, due_at) < $3)         AS overdue
     FROM tasks WHERE workspace_id = $1 AND ${ALIVE}`,
    [workspaceId, bounds.endOfDay, bounds.startOfDay],
  );
  const r = rows[0];
  return {
    today: Number(r?.today ?? 0),
    upcoming: Number(r?.upcoming ?? 0),
    someday: Number(r?.someday ?? 0),
    overdue: Number(r?.overdue ?? 0),
  };
}

/** Was heute überfällig ist, aus einer bereits geholten Liste. */
export function splitOverdue(
  rows: readonly TaskRow[],
  now: Date,
): { overdue: TaskRow[]; rest: TaskRow[] } {
  const { startOfDay } = boundsOf(now);
  const overdue: TaskRow[] = [];
  const rest: TaskRow[] = [];
  for (const row of rows) {
    const marker = row.planned_at ?? row.due_at;
    if (marker !== null && marker.getTime() < startOfDay.getTime()) overdue.push(row);
    else rest.push(row);
  }
  return { overdue, rest };
}
