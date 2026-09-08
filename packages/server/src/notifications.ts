/**
 * SOTE — Benachrichtigungen.
 *
 * ## Die Zahlen kommen aus der Liste, die man schon hat
 *
 * SONEs `InboxPanel` sagt, warum:
 *
 * > Every view here is counted from the list already in hand rather than asked
 * > for separately, which is what lets the numbers sit beside the names. **A
 * > menu that says „Mentions" without saying how many is a menu you have to
 * > click to learn anything from.**
 *
 * Also gibt `list` alles zurück, was in die Liste gehört, und die Oberfläche
 * zählt daraus ihre Ansichten. Eine Abfrage je Ansicht wäre eine Abfrage je
 * Zahl, und die Zahlen stimmten dann untereinander nicht — sie kämen aus
 * verschiedenen Augenblicken.
 *
 * ## Über Arbeitsbereiche hinweg
 *
 * Wie in SONE (dessen ADR-0052 dafür angeführt wird): eine Benachrichtigung
 * betrifft **mich**, nicht den Arbeitsbereich, in dem ich gerade stehe. Wer sie
 * nur im richtigen Bereich sähe, müsste die Bereiche durchgehen, um zu wissen,
 * ob etwas liegt — und genau das soll eine Glocke ersparen.
 *
 * Der Arbeitsbereich steht darum **an** der Zeile und ist eine Achse im Menü.
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows } from './db.js';

export type Kind = 'assigned' | 'commented';

export interface Notification {
  id: string;
  kind: Kind;
  taskId: string;
  taskTitle: string;
  workspaceId: string;
  workspaceName: string;
  actorName: string | null;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * Eine Benachrichtigung anlegen — oder eben nicht.
 *
 * **Nie über sich selbst**, und die Prüfung steht hier: eine Zeile, die niemand
 * sehen soll, soll nicht entstehen. Als Filter beim Lesen wäre sie eine Zeile
 * in der Datenbank, die in jeder Zählung mitläuft, bis jemand den Filter
 * vergisst.
 *
 * Nimmt eine Verbindung, nicht den Pool: sie entsteht **in derselben
 * Transaktion** wie das Ereignis, das sie meldet. Sonst gibt es einen Zustand,
 * in dem jemand zugewiesen ist und niemand es erfährt — oder umgekehrt eine
 * Meldung über eine Zuweisung, die zurückgerollt wurde.
 */
export async function notify(
  q: PoolClient,
  input: {
    userId: string;
    workspaceId: string;
    kind: Kind;
    taskId: string;
    actorId: string | null;
  },
): Promise<void> {
  if (input.userId === input.actorId) return;
  await q.query(
    `INSERT INTO notifications (user_id, workspace_id, kind, task_id, actor_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.userId, input.workspaceId, input.kind, input.taskId, input.actorId],
  );
}

/**
 * Was für mich liegt.
 *
 * Ein Deckel, und zwar hoch: hundert Zeilen sind mehr, als jemand durchgeht,
 * und die Zahlen im Menü sollen trotzdem stimmen. Wer mehr hat, hat ein
 * anderes Problem als eine Liste.
 */
export async function list(pool: Pool, userId: string): Promise<Notification[]> {
  const rows = await queryRows<{
    id: string;
    kind: Kind;
    task_id: string;
    task_title: string;
    workspace_id: string;
    workspace_name: string;
    actor_name: string | null;
    created_at: Date;
    read_at: Date | null;
  }>(
    pool,
    `SELECT n.id, n.kind, n.task_id, t.title AS task_title,
            n.workspace_id, w.name AS workspace_name,
            u.display_name AS actor_name,
            n.created_at, n.read_at
       FROM notifications n
       JOIN tasks t ON t.id = n.task_id
       JOIN workspaces w ON w.id = n.workspace_id
       LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = $1
        -- Eine Benachrichtigung über eine weggeworfene Aufgabe ist eine
        -- Auskunft über etwas, das man nicht mehr tun kann. Sie bleibt in der
        -- Datenbank (der Papierkorb kann sie zurückholen) und fehlt in der
        -- Liste.
        AND t.trashed_at IS NULL
      ORDER BY n.created_at DESC
      LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    taskId: r.task_id,
    taskTitle: r.task_title,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    actorName: r.actor_name,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

/** Die Zahl an der Glocke. Eine eigene Abfrage, weil sie überall gebraucht wird. */
export async function unreadCount(pool: Pool, userId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*) AS n FROM notifications n
       JOIN tasks t ON t.id = n.task_id
      WHERE n.user_id = $1 AND n.read_at IS NULL AND t.trashed_at IS NULL`,
    [userId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Gelesen.
 *
 * Ohne Id: alles. Mit Id: diese eine. Zwei Wege wären zwei Routen für dieselbe
 * Sache, und „alles gelesen" ist der häufigere Klick.
 *
 * Immer auf **meine** Zeilen begrenzt — auch bei einer Id. Eine fremde Id würde
 * sonst eine fremde Benachrichtigung als gelesen markieren, und das ist keine
 * große Tat, aber es ist eine, die niemand tun können soll.
 */
export async function markRead(pool: Pool, userId: string, id?: string): Promise<void> {
  if (id === undefined) {
    await pool.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return;
  }
  await pool.query(
    'UPDATE notifications SET read_at = now() WHERE id = $2 AND user_id = $1 AND read_at IS NULL',
    [userId, id],
  );
}
