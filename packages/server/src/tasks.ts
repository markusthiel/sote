/**
 * SOTE — Aufgaben schreiben und lesen.
 *
 * Die Entscheidungen aus dem Konzept liegen hier und nicht in einer Route:
 * eine Route soll HTTP übersetzen, nicht bestimmen, was Abhaken bedeutet.
 */

import {
  generateKeyBetween,
  nextAfterCompletion,
  nextOccurrence,
  parseQuickAdd,
  type Priority,
  type Recurrence,
} from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction, type PoolClient } from './db.js';

export interface TaskRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  note: string;
  planned_at: Date | null;
  planned_all_day: boolean;
  due_at: Date | null;
  due_all_day: boolean;
  priority: number;
  completed_at: Date | null;
  recur_rrule: string | null;
  recur_dtstart: Date | null;
  recur_after_n: number | null;
  recur_after_unit: string | null;
  sort_key: string;
}

/**
 * Aus den vier Spalten wieder der Union-Typ aus `core`.
 *
 * Die Datenbank kann keinen Union speichern, also hält ein CHECK die Regel und
 * diese Funktion stellt sie wieder her. Wenn die Zeile beides oder halb etwas
 * trägt, ist der CHECK umgangen worden — dann ist das ein Fehler und keine
 * Aufgabe ohne Wiederholung.
 */
export function recurrenceOf(row: TaskRow): Recurrence | undefined {
  if (row.recur_rrule !== null && row.recur_dtstart !== null) {
    return { kind: 'calendar', rrule: row.recur_rrule, dtstart: row.recur_dtstart };
  }
  if (row.recur_after_n !== null && row.recur_after_unit !== null) {
    return {
      kind: 'afterCompletion',
      n: row.recur_after_n,
      unit: row.recur_after_unit as 'day' | 'week' | 'month' | 'year',
    };
  }
  if (
    row.recur_rrule !== null ||
    row.recur_dtstart !== null ||
    row.recur_after_n !== null ||
    row.recur_after_unit !== null
  ) {
    throw new Error(
      `Aufgabe ${row.id} trägt eine halbe Wiederholung — der CHECK wurde umgangen`,
    );
  }
  return undefined;
}

const SELECT = `
  SELECT id, workspace_id, project_id, parent_id, title, note,
         planned_at, planned_all_day, due_at, due_all_day, priority,
         completed_at, recur_rrule, recur_dtstart, recur_after_n,
         recur_after_unit, sort_key
    FROM tasks`;

/** Der nächste Sortierschlüssel am Ende einer Liste. */
async function keyAtEnd(
  q: Pool | PoolClient,
  workspaceId: string,
  projectId: string | null,
): Promise<string> {
  const last = await queryOne<{ sort_key: string }>(
    q,
    `SELECT sort_key FROM tasks
      WHERE workspace_id = $1
        AND project_id IS NOT DISTINCT FROM $2
        AND trashed_at IS NULL
      ORDER BY sort_key DESC LIMIT 1`,
    [workspaceId, projectId],
  );
  return generateKeyBetween(last?.sort_key ?? null, null);
}

export interface CreateFromLine {
  readonly workspaceId: string;
  readonly userId: string;
  readonly line: string;
  readonly now: Date;
  /** Projekt, in dem die Zeile getippt wurde. `#name` schlägt es. */
  readonly projectId?: string | null;
}

export interface Created {
  readonly task: TaskRow;
  /** Ein `#name`, den es im Arbeitsbereich nicht gibt. Wird gemeldet, nicht angelegt. */
  readonly unknownProject: string | undefined;
  readonly unknownAssignees: readonly string[];
}

/**
 * Eine Zeile wird eine Aufgabe.
 *
 * Was der Parser nicht auflösen kann — ein Projekt- oder Personenname, den es
 * nicht gibt —, wird **gemeldet und nicht erfunden**. Ein `#finanzen`, das
 * stillschweigend ein neues Projekt anlegt, produziert Karteileichen; eines,
 * das stillschweigend verschwindet, verliert, was jemand gemeint hat.
 */
export async function createFromLine(pool: Pool, input: CreateFromLine): Promise<Created> {
  const q = parseQuickAdd(input.line, { now: input.now });

  return withTransaction(pool, async (client) => {
    let projectId = input.projectId ?? null;
    let unknownProject: string | undefined;
    if (q.project !== undefined) {
      const found = await queryOne<{ id: string }>(
        client,
        `SELECT id FROM projects
          WHERE workspace_id = $1 AND lower(name) = lower($2) AND trashed_at IS NULL
          LIMIT 1`,
        [input.workspaceId, q.project],
      );
      if (found) projectId = found.id;
      else unknownProject = q.project;
    }

    const rec = q.recurrence;
    const sortKey = await keyAtEnd(client, input.workspaceId, projectId);

    const row = await queryOne<TaskRow>(
      client,
      `INSERT INTO tasks (
         workspace_id, project_id, title,
         planned_at, planned_all_day, due_at, due_all_day, priority,
         recur_rrule, recur_dtstart, recur_after_n, recur_after_unit,
         sort_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, workspace_id, project_id, parent_id, title, note,
                 planned_at, planned_all_day, due_at, due_all_day, priority,
                 completed_at, recur_rrule, recur_dtstart, recur_after_n,
                 recur_after_unit, sort_key`,
      [
        input.workspaceId,
        projectId,
        q.title,
        q.planned ?? null,
        // Eine Uhrzeit ist eine Erinnerung (Konzept, Abschnitt 9). Ob eine
        // gesetzt wurde, steht in genau diesem Feld — nicht in einem zweiten
        // Schalter, den niemand pflegt.
        q.planned === undefined ? true : !hasTime(q.planned),
        q.due ?? null,
        q.due === undefined ? true : !hasTime(q.due),
        (q.priority ?? 4) satisfies Priority | 4,
        rec?.kind === 'calendar' ? rec.rrule : null,
        rec?.kind === 'calendar' ? rec.dtstart : null,
        rec?.kind === 'afterCompletion' ? rec.n : null,
        rec?.kind === 'afterCompletion' ? rec.unit : null,
        sortKey,
        input.userId,
      ],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');

    const unknownAssignees: string[] = [];
    for (const name of q.assignees) {
      const person = await queryOne<{ id: string }>(
        client,
        `SELECT u.id FROM users u
           JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
          WHERE lower(u.display_name) = lower($2) OR lower(u.email) = lower($2)
          LIMIT 1`,
        [input.workspaceId, name],
      );
      if (person) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, person.id],
        );
      } else {
        unknownAssignees.push(name);
      }
    }

    for (const label of q.labels) {
      const l = await queryOne<{ id: string }>(
        client,
        `INSERT INTO labels (workspace_id, name) VALUES ($1,$2)
         ON CONFLICT (workspace_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [input.workspaceId, label],
      );
      if (l) {
        await client.query(
          'INSERT INTO task_labels (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, l.id],
        );
      }
    }

    return { task: row, unknownProject, unknownAssignees };
  });
}

const hasTime = (d: Date) =>
  d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;

export interface Completion {
  readonly completed: TaskRow;
  /** Die nächste Instanz, falls die Aufgabe wiederkehrt. */
  readonly next: TaskRow | undefined;
}

/**
 * Abhaken.
 *
 * **Zwei Zeilen, nicht eine umdatierte** (Blatt 08): die erledigte bleibt als
 * Beleg stehen, die nächste erscheint. Eine umdatierte Zeile hätte keine
 * Geschichte, und „wann habe ich das zuletzt gemacht" wäre nicht beantwortbar —
 * was bei der erledigungsbezogenen Wiederholung ausgerechnet die Frage ist, aus
 * der der nächste Termin entsteht.
 *
 * Beides in **einer** Transaktion: eine erledigte Aufgabe ohne Nachfolger ist
 * eine verschwundene Aufgabe.
 */
export async function complete(
  pool: Pool,
  taskId: string,
  userId: string,
  at: Date,
): Promise<Completion> {
  return withTransaction(pool, async (client) => {
    const rows = await queryRows<TaskRow>(
      client,
      `${SELECT} WHERE id = $1 AND trashed_at IS NULL FOR UPDATE`,
      [taskId],
    );
    const task = rows[0];
    if (task === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);
    if (task.completed_at !== null) return { completed: task, next: undefined };

    const done = await queryOne<TaskRow>(
      client,
      `UPDATE tasks SET completed_at = $2, completed_by = $3, updated_at = $2
        WHERE id = $1
       RETURNING id, workspace_id, project_id, parent_id, title, note,
                 planned_at, planned_all_day, due_at, due_all_day, priority,
                 completed_at, recur_rrule, recur_dtstart, recur_after_n,
                 recur_after_unit, sort_key`,
      [taskId, at, userId],
    );
    if (done === undefined) throw new Error('UPDATE ohne Zeile');

    const rec = recurrenceOf(task);
    if (rec === undefined) return { completed: done, next: undefined };

    const when =
      rec.kind === 'calendar'
        ? nextOccurrence(rec, task.planned_at ?? at)
        : nextAfterCompletion(rec, at);
    if (when === null) return { completed: done, next: undefined };

    const sortKey = generateKeyBetween(task.sort_key, null);
    const next = await queryOne<TaskRow>(
      client,
      `INSERT INTO tasks (
         workspace_id, project_id, parent_id, title, note,
         planned_at, planned_all_day, due_at, due_all_day, priority,
         recur_rrule, recur_dtstart, recur_after_n, recur_after_unit,
         sort_key, created_by)
       SELECT workspace_id, project_id, parent_id, title, note,
              $2::timestamptz, planned_all_day,
              CASE WHEN due_at IS NULL THEN NULL
                   ELSE $2::timestamptz + (due_at - COALESCE(planned_at, created_at))
              END,
              due_all_day, priority,
              recur_rrule, $3::timestamptz, recur_after_n, recur_after_unit,
              $4, $5
         FROM tasks WHERE id = $1
       RETURNING id, workspace_id, project_id, parent_id, title, note,
                 planned_at, planned_all_day, due_at, due_all_day, priority,
                 completed_at, recur_rrule, recur_dtstart, recur_after_n,
                 recur_after_unit, sort_key`,
      [
        taskId,
        when,
        // Der Anker wandert mit, damit „jeden zweiten Dienstag" beim nächsten
        // Abhaken wieder von der richtigen Woche aus rechnet.
        rec.kind === 'calendar' ? when : null,
        sortKey,
        userId,
      ],
    );
    return { completed: done, next: next ?? undefined };
  });
}

export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}

export interface TodaySections {
  readonly overdue: readonly TaskRow[];
  readonly today: readonly TaskRow[];
}

/**
 * Die Heute-Ansicht.
 *
 * „Heute" heißt: geplant für heute oder früher, **oder** die Frist läuft heute
 * oder früher ab. Zwei Felder, eine Ansicht — das ist der Sinn der Trennung.
 * Überfällig ist alles, dessen Tag vorbei ist; es steht in einem eigenen
 * Abschnitt, weil „heute zu tun" und „liegengeblieben" zwei Nachrichten sind.
 */
export async function today(
  pool: Pool,
  workspaceId: string,
  now: Date,
): Promise<TodaySections> {
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const rows = await queryRows<TaskRow>(
    pool,
    `${SELECT}
      WHERE workspace_id = $1
        AND completed_at IS NULL
        AND trashed_at IS NULL
        AND (planned_at <= $2 OR due_at <= $2)
      ORDER BY priority ASC, COALESCE(planned_at, due_at) ASC, sort_key ASC`,
    [workspaceId, endOfDay],
  );

  const overdue: TaskRow[] = [];
  const rest: TaskRow[] = [];
  for (const row of rows) {
    const marker = row.planned_at ?? row.due_at;
    if (marker !== null && marker.getTime() < startOfDay.getTime()) overdue.push(row);
    else rest.push(row);
  }
  return { overdue, today: rest };
}
