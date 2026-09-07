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

/** Die Spaltenliste einmal. Viermal abgeschrieben ist viermal Gelegenheit. */
/**
 * Bei einer Schlüsselkollision denselben Vorgang wiederholen.
 *
 * `generateKeyBetween` ist deterministisch: zwei Transaktionen mit denselben
 * Nachbarn rechnen denselben Schlüssel. Der Unique-Index aus Migration 0003
 * lässt nur eine davon durch, und die andere bekommt `23505`. Wiederholt wird
 * der **ganze** Vorgang und nicht nur die Rechnung — die Transaktion ist
 * abgebrochen, und beim zweiten Lesen ist der Gewinner ein Nachbar, also fällt
 * der Schlüssel dazwischen und die Sache endet.
 *
 * Begrenzt, weil eine unbegrenzte Wiederholung aus einem seltenen Wettlauf eine
 * Endlosschleife macht, sobald die Ursache eine andere ist.
 */
const ORDER_CLASH = '23505';
const ORDER_INDEX = 'tasks_sibling_order';

async function retryOnOrderClash<T>(body: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await body();
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      const clash = err.code === ORDER_CLASH && err.constraint === ORDER_INDEX;
      if (!clash || i >= attempts) throw e;
    }
  }
}

const RETURNING = `
  id, workspace_id, project_id, parent_id, title, note,
  planned_at, planned_all_day, due_at, due_all_day, priority,
  completed_at, recur_rrule, recur_dtstart, recur_after_n,
  recur_after_unit, sort_key`;

const SELECT = `SELECT ${RETURNING} FROM tasks`;

/**
 * Der nächste Sortierschlüssel am Ende einer Liste.
 *
 * **Weggeworfene Zeilen zählen mit.** Sie sind aus jeder Ansicht verschwunden,
 * aber nicht aus der Tabelle — und der Unique-Index aus Migration 0003 kennt
 * keinen Papierkorb. Die erste Fassung filterte `trashed_at IS NULL` und
 * rechnete darum denselben Schlüssel, den eine weggeworfene Zeile noch hielt:
 * ein Projekt, aus dem einmal etwas weggeworfen wurde, nahm keine neue Aufgabe
 * mehr an. Gefunden von `trash.db.test.ts`.
 *
 * Die Lehre ist allgemeiner als der Fall: **eine Abfrage, die einen Schlüssel
 * für einen Index rechnet, muss denselben Umfang haben wie der Index.**
 */
export async function keyAtEnd(
  q: Pool | PoolClient,
  workspaceId: string,
  projectId: string | null,
  parentId: string | null = null,
): Promise<string> {
  const last = await queryOne<{ sort_key: string }>(
    q,
    `SELECT sort_key FROM tasks
      WHERE workspace_id = $1
        AND project_id IS NOT DISTINCT FROM $2
        AND parent_id IS NOT DISTINCT FROM $3
      ORDER BY sort_key DESC LIMIT 1`,
    [workspaceId, projectId, parentId],
  );
  return generateKeyBetween(last?.sort_key ?? null, null);
}

export interface CreateFromLine {
  readonly workspaceId: string;
  readonly userId: string;
  readonly line: string;
  readonly now: Date;
  /** Die Zone, in der „9 Uhr" gemeint ist. Fehlt sie: UTC, wie vorher. */
  readonly zone?: string;
  /** Projekt, in dem die Zeile getippt wurde. `#name` schlägt es. */
  readonly projectId?: string | null;
}

export interface Created {
  readonly task: TaskRow;
  /** Ein `#name`, den es im Arbeitsbereich nicht gibt. Wird gemeldet, nicht angelegt. */
  readonly unknownProject: string | undefined;
  /**
   * Ein `#name`, auf den mehrere passen.
   *
   * „Kabel" darf es unter „Haus" und unter „Büro" geben — das sind zwei
   * verschiedene Dinge, und der Index in Migration 0004 lässt sie zu Recht
   * beide zu. Also entscheidet hier niemand: dieselbe Regel wie bei
   * `ambiguousAssignees`.
   */
  readonly ambiguousProject: string | undefined;
  readonly unknownAssignees: readonly string[];
  /**
   * Ein `+name`, auf den **mehrere** passen.
   *
   * Getrennt von `unknownAssignees`, weil es eine andere Nachricht ist: „gibt
   * es hier nicht" gegen „wen von beiden meinst du". Eine von zwei Personen
   * still auszuwählen wäre schlimmer als keine — die Aufgabe hätte einen
   * Zuständigen, der nichts davon weiß.
   */
  readonly ambiguousAssignees: readonly string[];
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
  const q = parseQuickAdd(input.line, {
    now: input.now,
    ...(input.zone === undefined ? {} : { zone: input.zone }),
  });

  return retryOnOrderClash(() => withTransaction(pool, async (client) => {
    let projectId = input.projectId ?? null;
    let unknownProject: string | undefined;
    let ambiguousProject: string | undefined;
    if (q.project !== undefined) {
      const found = await queryRows<{ id: string }>(
        client,
        `SELECT id FROM projects
          WHERE workspace_id = $1 AND lower(name) = lower($2) AND trashed_at IS NULL
          LIMIT 2`,
        [input.workspaceId, q.project],
      );
      if (found.length === 1) projectId = found[0]!.id;
      else if (found.length === 0) unknownProject = q.project;
      else ambiguousProject = q.project;
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
       RETURNING ${RETURNING}`,
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
    const ambiguousAssignees: string[] = [];
    for (const name of q.assignees) {
      // Vier Schreibweisen, weil niemand „+Markus Thiel" tippt: ein
      // Leerzeichen beendet das Zeichen, also muss der Vorname reichen. Und
      // der Teil vor dem @, weil Adressen kürzer sind als Namen.
      const people = await queryRows<{ id: string }>(
        client,
        `SELECT u.id FROM users u
           JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
          WHERE lower(u.display_name) = lower($2)
             OR lower(u.email) = lower($2)
             OR lower(split_part(u.display_name, ' ', 1)) = lower($2)
             OR lower(split_part(u.email, '@', 1)) = lower($2)
          LIMIT 2`,
        [input.workspaceId, name],
      );
      if (people.length === 1) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, people[0]!.id],
        );
      } else if (people.length === 0) {
        unknownAssignees.push(name);
      } else {
        // Mehr als einer: nicht raten. Die Aufgabe bleibt ohne Zuständigen und
        // die Antwort sagt, warum.
        ambiguousAssignees.push(name);
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

    return { task: row, unknownProject, ambiguousProject, unknownAssignees, ambiguousAssignees };
  }));
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
  return retryOnOrderClash(() => withTransaction(pool, async (client) => {
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
       RETURNING ${RETURNING}`,
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
       RETURNING ${RETURNING}`,
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
  }));
}

export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}

/**
 * Verschieben.
 *
 * Der neue Schlüssel wird **zwischen den Nachbarn** gerechnet und nicht als
 * Position gesetzt (SONE, ADR-0002). Zwei Leute, die gleichzeitig dieselbe
 * Lücke treffen, bekommen dann verschiedene Schlüssel, und beide Reihen
 * bleiben gültig — mit ganzzahligen Positionen würde eine sichtbar springen.
 *
 * **Der rechte Nachbar kommt aus der Datenbank, nicht aus der Anfrage.** Das
 * ist der Kern und war beim ersten Versuch falsch: `generateKeyBetween` ist
 * deterministisch, also rechnen zwei Transaktionen mit denselben Nachbar-Ids
 * denselben Schlüssel — auch beim Wiederholen, immer wieder. Gefragt wird
 * darum nach dem *nächsten vorhandenen* Schlüssel hinter dem linken Nachbarn.
 * Nach dem ersten Gewinner ist das seiner, die Lücke ist kleiner, und die
 * Sache endet.
 *
 * `beforeId` wird noch gelesen, aber nur zum Prüfen: es sagt, welche
 * Reihenfolge der Browser gesehen hat, und eine vertauschte Angabe ist eine
 * veraltete Ansicht und keine Anweisung.
 */
export async function move(
  pool: Pool,
  taskId: string,
  workspaceId: string,
  between: { afterId?: string | null; beforeId?: string | null },
): Promise<TaskRow> {
  return retryOnOrderClash(() =>
    withTransaction(pool, async (client) => {
      const me = await queryOne<{
        project_id: string | null;
        parent_id: string | null;
      }>(
        client,
        'SELECT project_id, parent_id FROM tasks WHERE id = $1 AND workspace_id = $2',
        [taskId, workspaceId],
      );
      if (me === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);

      /** Ein Nachbar muss im selben Geschwisterkreis liegen wie der Index. */
      const keyOf = async (id: string | null | undefined): Promise<string | null> => {
        if (id === null || id === undefined) return null;
        const row = await queryOne<{ sort_key: string }>(
          client,
          `SELECT sort_key FROM tasks
            WHERE id = $1 AND workspace_id = $2
              AND project_id IS NOT DISTINCT FROM $3
              AND parent_id IS NOT DISTINCT FROM $4`,
          [id, workspaceId, me.project_id, me.parent_id],
        );
        if (row === undefined) {
          throw new NotFound(`${id} ist hier kein Nachbar`);
        }
        return row.sort_key;
      };

      const after = await keyOf(between.afterId);
      const claimed = await keyOf(between.beforeId);
      if (after !== null && claimed !== null && after >= claimed) {
        throw new OutOfOrder(
          'die beiden Nachbarn stehen nicht in dieser Reihenfolge — die Ansicht ist veraltet',
        );
      }

      // Der tatsächliche rechte Nachbar: der kleinste Schlüssel, der größer ist
      // als der linke. Die eigene Zeile zählt nicht mit, sonst wäre sie beim
      // Verschieben um eine Stelle ihr eigener Nachbar.
      const next = await queryOne<{ sort_key: string }>(
        client,
        `SELECT sort_key FROM tasks
          WHERE workspace_id = $1
            AND project_id IS NOT DISTINCT FROM $2
            AND parent_id IS NOT DISTINCT FROM $3
            AND id <> $4
            AND ($5::text IS NULL OR sort_key > $5)
          ORDER BY sort_key ASC LIMIT 1`,
        [workspaceId, me.project_id, me.parent_id, taskId, after],
      );

      const key = generateKeyBetween(after, next?.sort_key ?? null);
      const row = await queryOne<TaskRow>(
        client,
        `UPDATE tasks SET sort_key = $3, updated_at = now()
          WHERE id = $1 AND workspace_id = $2
         RETURNING ${RETURNING}`,
        [taskId, workspaceId, key],
      );
      if (row === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);
      return row;
    }),
  );
}

export class OutOfOrder extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfOrder';
  }
}

/**
 * Einzelne Felder ändern — was das Anfasser-Menü schreibt.
 *
 * **Nur die genannten Felder.** Ein `undefined` heißt „nicht angefasst", ein
 * `null` heißt „leeren"; die beiden zu vermischen wäre ein Menü, das beim
 * Setzen eines Datums die Priorität mitnimmt. Dieselbe Regel wie beim
 * CalDAV-Fenster, nur von innen: wer ein Feld nicht trägt, darf es nicht
 * löschen.
 */
export interface Patch {
  readonly title?: string;
  readonly note?: string;
  readonly plannedAt?: Date | null;
  readonly plannedAllDay?: boolean;
  readonly dueAt?: Date | null;
  readonly dueAllDay?: boolean;
  readonly priority?: number;
  readonly projectId?: string | null;
}

export async function patch(
  pool: Pool,
  taskId: string,
  workspaceId: string,
  fields: Patch,
): Promise<TaskRow> {
  const sets: string[] = [];
  const params: unknown[] = [taskId, workspaceId];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (title === '') throw new OutOfOrder('ein Titel darf nicht leer werden');
    set('title', title);
  }
  if (fields.note !== undefined) set('note', fields.note);
  if (fields.plannedAt !== undefined) set('planned_at', fields.plannedAt);
  if (fields.plannedAllDay !== undefined) set('planned_all_day', fields.plannedAllDay);
  if (fields.dueAt !== undefined) set('due_at', fields.dueAt);
  if (fields.dueAllDay !== undefined) set('due_all_day', fields.dueAllDay);
  if (fields.priority !== undefined) {
    if (!Number.isInteger(fields.priority) || fields.priority < 1 || fields.priority > 4) {
      throw new OutOfOrder('die Priorität hat vier Stufen');
    }
    set('priority', fields.priority);
  }
  if (fields.projectId !== undefined) set('project_id', fields.projectId);

  if (sets.length === 0) throw new OutOfOrder('nichts zu ändern');

  const row = await queryOne<TaskRow>(
    pool,
    `UPDATE tasks SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 AND workspace_id = $2
     RETURNING ${RETURNING}`,
    params,
  );
  if (row === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);
  return row;
}

/* ── Papierkorb ────────────────────────────────────────────────────────────
   „Erledigt ist nicht gelöscht" (Konzept, Abschnitt 8a). Eine abgehakte
   Aufgabe ist ein Ergebnis und bleibt in ihrem Projekt; eine gelöschte ist ein
   Irrtum und liegt hier. Und **es gibt keinen Sweep**: eine Frist, die von
   selbst löscht, ist eine Löschung, die niemand angeordnet hat. */

export type TrashKind = 'task' | 'project';

export interface TrashEntry {
  readonly kind: TrashKind;
  readonly id: string;
  readonly title: string;
  readonly trashedAt: Date;
  readonly trashedBy: string | null;
  /** Bei einer Aufgabe: das Projekt, in das sie zurückwill. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  /** Ist dieses Projekt selbst im Papierkorb? Dann braucht das Zurück ein Ziel. */
  readonly projectTrashed: boolean;
  /** Bei einem Projekt: wie viele Aufgaben mitkommen. */
  readonly carries: number | null;
  /** Ein Blick hinein, ohne die Zeile zu öffnen. */
  readonly peek: string | null;
}

export async function trash(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const table = kind === 'task' ? 'tasks' : 'projects';
  const res = await pool.query(
    `UPDATE ${table} SET trashed_at = now(), trashed_by = $3
      WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
    [id, workspaceId, userId],
  );
  if (res.rowCount === 0) {
    throw new NotFound(`${kind} ${id} gibt es nicht oder liegt schon im Papierkorb`);
  }
}

/**
 * Zurückholen.
 *
 * **Ein Projekt nimmt seine Aufgaben mit**, in beide Richtungen: weggeworfen
 * verschwinden sie, zurückgeholt kommen sie wieder. Sie tragen dafür kein
 * eigenes `trashed_at` — dass ihr Projekt im Papierkorb liegt, genügt. Damit
 * gibt es auch keinen Zustand, in dem die Aufgaben zurück sind und das Projekt
 * nicht.
 *
 * Eine **einzeln** weggeworfene Aufgabe braucht ein Ziel, wenn ihr Projekt
 * inzwischen selbst im Papierkorb liegt: sonst wäre sie zurückgeholt und
 * trotzdem unsichtbar, und das ist der eine Ausgang, den ein Zurück-Knopf nicht
 * haben darf.
 */
export async function restore(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
  target?: string | null,
): Promise<void> {
  if (kind === 'project') {
    const res = await pool.query(
      `UPDATE projects SET trashed_at = NULL, trashed_by = NULL
        WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NOT NULL`,
      [id, workspaceId],
    );
    if (res.rowCount === 0) throw new NotFound(`Projekt ${id} liegt nicht im Papierkorb`);
    return;
  }

  await withTransaction(pool, async (client) => {
    const row = await queryOne<{ project_id: string | null; project_trashed: boolean }>(
      client,
      `SELECT t.project_id,
              COALESCE(p.trashed_at IS NOT NULL, false) AS project_trashed
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1 AND t.workspace_id = $2 AND t.trashed_at IS NOT NULL`,
      [id, workspaceId],
    );
    if (row === undefined) throw new NotFound(`Aufgabe ${id} liegt nicht im Papierkorb`);

    let projectId = row.project_id;
    if (row.project_trashed) {
      if (target === undefined) {
        throw new NeedsTarget(
          'das Projekt dieser Aufgabe liegt selbst im Papierkorb — wohin soll sie zurück?',
        );
      }
      if (target !== null) {
        const ok = await queryOne<{ id: string }>(
          client,
          `SELECT id FROM projects
            WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
          [target, workspaceId],
        );
        if (ok === undefined) throw new NotFound(`Projekt ${target} gibt es nicht`);
      }
      projectId = target;
    } else if (target !== undefined) {
      projectId = target;
    }

    // Am Ende der Zielliste, nicht an der alten Stelle: die Lücke ist längst
    // zu, und ein alter Schlüssel kollidiert mit dem Index aus 0003.
    const key = await keyAtEnd(client, workspaceId, projectId);
    await client.query(
      `UPDATE tasks SET trashed_at = NULL, trashed_by = NULL,
              project_id = $3, sort_key = $4, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId, projectId, key],
    );
  });
}

export class NeedsTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsTarget';
  }
}

/** Endgültig. Bei einem Projekt gehen seine Aufgaben mit (ON DELETE CASCADE). */
export async function purge(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
): Promise<void> {
  const table = kind === 'task' ? 'tasks' : 'projects';
  const res = await pool.query(
    `DELETE FROM ${table}
      WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NOT NULL`,
    [id, workspaceId],
  );
  // Nur aus dem Papierkorb: endgültig löschen ist kein Weg, der an ihm
  // vorbeiführt.
  if (res.rowCount === 0) throw new NotFound(`${kind} ${id} liegt nicht im Papierkorb`);
}

export async function listTrash(
  pool: Pool,
  workspaceId: string,
  kind: TrashKind,
): Promise<TrashEntry[]> {
  if (kind === 'project') {
    const rows = await queryRows<{
      id: string;
      name: string;
      trashed_at: Date;
      trashed_by: string | null;
      carries: string;
      peek: string | null;
    }>(
      pool,
      `SELECT p.id, p.name, p.trashed_at, p.trashed_by,
              count(t.id) FILTER (WHERE t.trashed_at IS NULL) AS carries,
              string_agg(t.title, ', ' ORDER BY t.sort_key)
                FILTER (WHERE t.trashed_at IS NULL) AS peek
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.workspace_id = $1 AND p.trashed_at IS NOT NULL
        GROUP BY p.id ORDER BY p.trashed_at DESC`,
      [workspaceId],
    );
    return rows.map((r) => ({
      kind: 'project' as const,
      id: r.id,
      title: r.name,
      trashedAt: r.trashed_at,
      trashedBy: r.trashed_by,
      projectId: null,
      projectName: null,
      projectTrashed: false,
      carries: Number(r.carries),
      peek: r.peek,
    }));
  }

  const rows = await queryRows<{
    id: string;
    title: string;
    note: string;
    trashed_at: Date;
    trashed_by: string | null;
    project_id: string | null;
    project_name: string | null;
    project_trashed: boolean;
  }>(
    pool,
    `SELECT t.id, t.title, t.note, t.trashed_at, t.trashed_by,
            t.project_id, p.name AS project_name,
            COALESCE(p.trashed_at IS NOT NULL, false) AS project_trashed
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.workspace_id = $1 AND t.trashed_at IS NOT NULL
      ORDER BY t.trashed_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => ({
    kind: 'task' as const,
    id: r.id,
    title: r.title,
    trashedAt: r.trashed_at,
    trashedBy: r.trashed_by,
    projectId: r.project_id,
    projectName: r.project_name,
    projectTrashed: r.project_trashed,
    carries: null,
    peek: r.note === '' ? null : r.note.slice(0, 200),
  }));
}
