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
import { notify } from './notifications.js';
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
   * Die Schlagwörter, die es in diesem Arbeitsbereich SCHON gibt.
   *
   * Nicht die der Aufgabe — die stehen an `task.labels`. Das hier ist der
   * Vorschlagsvorrat für das Feld, und ohne ihn wäre das Feld ein leeres
   * Textfeld: wer nicht sieht, was es gibt, tippt `unterwegs`, wo `Unterwegs`
   * steht, und legt beim dritten Mal `unterweg` an. Ein Vorrat macht aus einem
   * Freitextfeld eine Auswahl mit Notausgang.
   */
  readonly known: readonly string[];
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
  recur_after_unit, duration_min, sort_key,
  labels_of(id) AS labels, marks_of(id) AS marks`;

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

    const known = await queryRows<{ name: string }>(
      client,
      `SELECT name FROM labels WHERE workspace_id = $1 ORDER BY lower(name)`,
      [workspaceId],
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
      known: known.map((l) => l.name),
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
  /**
   * Wer — oder **niemand**.
   *
   * `null` ist ein Gast über einen Link (Konzept 10e). Er erscheint als „über
   * einen Link" und nicht als jemand, und das ist ehrlicher als ein erfundener
   * Name. Die Spalte lässt es zu, weil der Fall vorgesehen ist.
   */
  userId: string | null,
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
  /** `null` ist ein Gast über einen Link — siehe `addChild`. */
  userId: string | null,
  body: string,
  /**
   * Wie ein Gast heißt, wenn er keinen Namen hat.
   *
   * Die Spalte `author_guest` ist dafür vorgesehen, und ein CHECK in Migration
   * 0001 verlangt **genau eines von beiden** (`comment_author_is_one_kind`):
   * mit `author_id = NULL` allein bricht der Einfügeversuch. Das ist die Sorte
   * Regel, die man beim ersten Gast-Kommentar findet — und besser dort als
   * später in einer Zeile ohne Urheber.
   */
  guestName = 'über einen Link',
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
      `INSERT INTO task_comments (task_id, author_id, author_guest, body)
       VALUES ($1,$2,$3,$4)
       RETURNING id, created_at`,
      // Genau eines von beiden, wie der CHECK verlangt: ein Konto ODER ein Name.
      [taskId, userId, userId === null ? guestName : null, clean],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');

    /*
     * Wer die Aufgabe angelegt hat und wer daran arbeitet, erfährt davon.
     *
     * Beide, weil beide Antworten auf „wen geht das an" richtig sind: der
     * Urheber hat sie geschrieben, der Zuständige arbeitet daran. Und die
     * Liste ist eindeutig (`DISTINCT`), sonst bekäme jemand, der beides ist,
     * zwei Meldungen über einen Kommentar.
     *
     * In derselben Transaktion wie der Kommentar — sonst gibt es eine Meldung
     * über etwas, das nicht geschrieben wurde.
     */
    const betroffen = await queryRows<{ id: string }>(
      client,
      `SELECT DISTINCT x.id FROM (
                SELECT created_by AS id FROM tasks WHERE id = $1
         UNION   SELECT user_id AS id FROM task_assignees WHERE task_id = $1
       ) x WHERE x.id IS NOT NULL`,
      [taskId],
    );
    for (const wer of betroffen) {
      await notify(client, {
        userId: wer.id,
        workspaceId,
        kind: 'commented',
        taskId,
        actorId: userId,
      });
    }

    // Nur nachfragen, wenn es jemanden gibt: `WHERE id = NULL` trifft nie und
    // wäre eine Abfrage, deren Antwort schon feststeht.
    const me =
      userId === null
        ? undefined
        : await queryOne<{ display_name: string }>(
            client,
            'SELECT display_name FROM users WHERE id = $1',
            [userId],
          );
    return {
      id: row.id,
      body: clean,
      createdAt: row.created_at,
      authorName: me?.display_name ?? null,
      // Zurückgegeben, wie es in der Zeile steht — sonst zeigt die Oberfläche
      // direkt nach dem Schreiben einen Kommentar ohne Urheber und nach dem
      // Neuladen einen mit.
      authorGuest: userId === null ? guestName : null,
    };
  });
}
