/**
 * SOTE — eine Aufgabe im Detail.
 *
 * Eine Abfrage pro Sache und nicht eine große mit Joins: Kommentare und
 * Teilaufgaben sind Listen, und ein Join über zwei Listen multipliziert die
 * Zeilen. Vier kleine Abfragen in einer Transaktion sind ehrlicher als eine,
 * deren Ergebnis man wieder auseinandersortieren muss.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction } from './db.js';
import { NotFound, OutOfOrder, keyAtEnd, type TaskRow } from './tasks.js';

export interface Comment {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
  /** Genau eines von beiden. Ein Gast ist keine uuid (ADR-0091). */
  readonly authorName: string | null;
  readonly authorGuest: string | null;
}

export interface Assignee {
  readonly userId: string | null;
  readonly name: string | null;
  readonly guestKey: string | null;
}

export interface Origin {
  readonly url: string;
  readonly pageTitle: string;
  readonly seenAt: Date;
}

export interface Detail {
  readonly task: TaskRow;
  readonly projectName: string | null;
  readonly children: readonly TaskRow[];
  readonly comments: readonly Comment[];
  readonly assignees: readonly Assignee[];
  /**
   * Nur vorhanden, wenn es eine Herkunft gibt.
   *
   * Kein Feld „Herkunft: keine" — jede Stelle, an der SONE vorkommt, hat einen
   * Zustand für „nicht verbunden", und der ist „gar nicht da" und nicht
   * „ausgegraut" (Konzept, Abschnitt 10).
   */
  readonly origin: Origin | undefined;
}

const COLUMNS = `
  id, workspace_id, project_id, parent_id, title, note,
  planned_at, planned_all_day, due_at, due_all_day, priority,
  completed_at, recur_rrule, recur_dtstart, recur_after_n,
  recur_after_unit, sort_key`;

export async function detail(
  pool: Pool,
  taskId: string,
  workspaceId: string,
): Promise<Detail> {
  return withTransaction(pool, async (client) => {
    const task = await queryOne<TaskRow>(
      client,
      `SELECT ${COLUMNS} FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
      [taskId, workspaceId],
    );
    if (task === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);

    const project =
      task.project_id === null
        ? undefined
        : await queryOne<{ name: string }>(client, 'SELECT name FROM projects WHERE id = $1', [
            task.project_id,
          ]);

    const children = await queryRows<TaskRow>(
      client,
      `SELECT ${COLUMNS} FROM tasks
        WHERE parent_id = $1 AND trashed_at IS NULL
        ORDER BY completed_at IS NOT NULL, sort_key`,
      [taskId],
    );

    const comments = await queryRows<{
      id: string;
      body: string;
      created_at: Date;
      author_guest: string | null;
      author_name: string | null;
    }>(
      client,
      `SELECT c.id, c.body, c.created_at, c.author_guest, u.display_name AS author_name
         FROM task_comments c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.task_id = $1 ORDER BY c.created_at`,
      [taskId],
    );

    const assignees = await queryRows<{
      user_id: string | null;
      guest_key: string | null;
      name: string | null;
    }>(
      client,
      `SELECT a.user_id, a.guest_key, u.display_name AS name
         FROM task_assignees a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.task_id = $1`,
      [taskId],
    );

    const origin = await queryOne<{ url: string; page_title: string; seen_at: Date }>(
      client,
      'SELECT url, page_title, seen_at FROM task_origins WHERE task_id = $1',
      [taskId],
    );

    return {
      task,
      projectName: project?.name ?? null,
      children,
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        authorName: c.author_name,
        authorGuest: c.author_guest,
      })),
      assignees: assignees.map((a) => ({
        userId: a.user_id,
        name: a.name,
        guestKey: a.guest_key,
      })),
      origin:
        origin === undefined
          ? undefined
          : { url: origin.url, pageTitle: origin.page_title, seenAt: origin.seen_at },
    };
  });
}

/**
 * Eine Teilaufgabe.
 *
 * Erbt Projekt und Arbeitsbereich vom Elternteil und **nicht** aus der
 * Anfrage: eine Teilaufgabe in einem anderen Projekt als ihre Aufgabe wäre in
 * zwei Listen zu Hause, und die Frage „wo gehört das hin" hätte zwei Antworten.
 *
 * Eine Ebene tief. `parent_id` einer Teilaufgabe zu setzen wird abgelehnt —
 * beliebig tiefe Bäume in einer Liste sind der Anfang von Projektmanagement,
 * und die Oberfläche könnte sie nicht ruhig zeigen.
 */
export async function addChild(
  pool: Pool,
  parentId: string,
  workspaceId: string,
  userId: string,
  title: string,
): Promise<TaskRow> {
  const clean = title.trim();
  if (clean === '') throw new OutOfOrder('ohne Text keine Teilaufgabe');

  return withTransaction(pool, async (client) => {
    const parent = await queryOne<{ project_id: string | null; parent_id: string | null }>(
      client,
      `SELECT project_id, parent_id FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
      [parentId, workspaceId],
    );
    if (parent === undefined) throw new NotFound(`Aufgabe ${parentId} gibt es nicht`);
    if (parent.parent_id !== null) {
      throw new OutOfOrder('eine Teilaufgabe bekommt keine Teilaufgaben');
    }

    const key = await keyAtEnd(client, workspaceId, parent.project_id, parentId);
    const row = await queryOne<TaskRow>(
      client,
      `INSERT INTO tasks (workspace_id, project_id, parent_id, title, sort_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
      [workspaceId, parent.project_id, parentId, clean, key, userId],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');
    return row;
  });
}

/** Ein Kommentar. Der Verfasser ist eine Person — Gäste schreiben über Links. */
export async function addComment(
  pool: Pool,
  taskId: string,
  workspaceId: string,
  userId: string,
  body: string,
): Promise<Comment> {
  const clean = body.trim();
  if (clean === '') throw new OutOfOrder('ein leerer Kommentar ist keiner');

  return withTransaction(pool, async (client) => {
    const exists = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
      [taskId, workspaceId],
    );
    if (exists === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);

    const row = await queryOne<{ id: string; created_at: Date }>(
      client,
      `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1,$2,$3)
       RETURNING id, created_at`,
      [taskId, userId, clean],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');

    const me = await queryOne<{ display_name: string }>(
      client,
      'SELECT display_name FROM users WHERE id = $1',
      [userId],
    );
    return {
      id: row.id,
      body: clean,
      createdAt: row.created_at,
      authorName: me?.display_name ?? null,
      authorGuest: null,
    };
  });
}
