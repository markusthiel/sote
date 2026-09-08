/**
 * SOTE — einen Arbeitsbereich mitnehmen oder wegwerfen.
 *
 * ## Der Export ist eine Datei, kein Dienst
 *
 * Alles in einer Antwort, JSON, ohne Zwischenstand auf der Platte. Das geht,
 * solange ein Arbeitsbereich in den Speicher passt — bei Aufgaben tut er das
 * mit weitem Abstand, und die **ehrliche Grenze** steht hier statt in einem
 * Bugtracker: bei sehr vielen Zeilen bräuchte das einen Strom und einen
 * Job-Läufer, den SOTE nicht hat.
 *
 * Was drin ist, ist das, was jemand **wiederherstellen** könnte: Projekte,
 * Aufgaben, Kommentare, Rollen, Gruppen, Einstellungen. Was **nicht** drin ist,
 * steht genauso ausdrücklich da:
 *
 * - **Keine Kennwörter**, auch nicht ihre Hashes. Ein Export ist eine Datei,
 *   die per Mail wandert; Anmeldedaten haben darin nichts zu suchen.
 * - **Keine Freigabe-Tokens.** Sie sind Zugang, und ein Export wäre der
 *   bequemste Weg, ihn weiterzugeben, ohne es zu merken.
 * - **Keine Sitzungen.**
 *
 * Leute stehen mit Name und Adresse drin, weil eine Aufgabe ohne ihren Urheber
 * die halbe Auskunft ist — und weil die Adressen dem gehören, der den Export
 * zieht: er sieht sie ohnehin unter „Leute".
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { OutOfOrder } from './tasks.js';

export async function exportWorkspace(
  pool: Pool,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const ws = await queryOne<{ name: string; icon: unknown; created_at: Date }>(
    pool,
    'SELECT name, icon, created_at FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  if (ws === undefined) throw new OutOfOrder('diesen Arbeitsbereich gibt es nicht');

  // `QueryResultRow` als Schranke, weil `queryRows` sie verlangt — und die
  // Zeilen hier sind ohnehin nur Daten, die weitergeschrieben werden.
  const q = async (sql: string): Promise<Record<string, unknown>[]> =>
    queryRows<Record<string, unknown>>(pool, sql, [workspaceId]);

  return {
    // Dieselbe Marke wie beim Thema (ADR-0125): eine Datei sagt, was sie ist.
    // Ohne sie wäre „sieht aus wie ein Export" die einzige Prüfung, und das
    // passt auf beinahe jedes Objekt.
    sote: 'workspace',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { name: ws.name, icon: ws.icon, createdAt: ws.created_at.toISOString() },
    /*
     * Bei Leuten wird AUFGEZÄHLT, und niemals `*`.
     *
     * Genau umgekehrt zu den Inhaltstabellen: was an `users` dazukommt, soll
     * nicht automatisch in eine Datei wandern, die per Mail unterwegs ist. Die
     * Kennwörter liegen ohnehin in `user_passwords` und kommen hier nirgends
     * vor — aber die Regel gilt auch für das nächste Feld, das noch niemand
     * kennt.
     */
    people: await q(`SELECT u.id, u.email, u.display_name, m.is_owner, m.role_id
                       FROM workspace_members m JOIN users u ON u.id = m.user_id
                      WHERE m.workspace_id = $1`),
    roles: await q('SELECT id, name, list_level, rights FROM roles WHERE workspace_id = $1'),
    groups: await q(`SELECT g.id, g.name, g.role_id,
                            (SELECT array_agg(gm.user_id) FROM group_members gm
                              WHERE gm.group_id = g.id) AS members
                       FROM groups g WHERE g.workspace_id = $1`),
    /*
     * `SELECT *` für den Inhalt, und das ist eine Entscheidung.
     *
     * Meine erste Fassung zählte Spalten auf — **aus dem Gedächtnis**, und
     * darum falsch: `recurrence` gibt es nicht (die Tabelle hat
     * `recur_rrule`, `recur_dtstart`, `recur_after_n`, `recur_after_unit`),
     * und eine Tabelle `comments` gibt es auch nicht, sie heißt
     * `task_comments`. Der Export antwortete mit 500.
     *
     * Für Inhaltstabellen ist `*` ohnehin das Richtige: ein neues Feld an der
     * Aufgabe soll im Export landen, ohne dass jemand daran denkt — eine
     * händische Liste ist eine, die beim nächsten Feld unvollständig wird und
     * es nicht sagt.
     *
     * Für `users` steht die Liste ausdrücklich da (unten), und dort ist das
     * genau umgekehrt richtig: was dazukommt, soll NICHT automatisch
     * hinauswandern.
     */
    projects: await q('SELECT * FROM projects WHERE workspace_id = $1 ORDER BY sort_key'),
    tasks: await q('SELECT * FROM tasks WHERE workspace_id = $1 ORDER BY created_at'),
    comments: await q(`SELECT c.* FROM task_comments c JOIN tasks t ON t.id = c.task_id
                        WHERE t.workspace_id = $1 ORDER BY c.created_at`),
    assignees: await q(`SELECT a.* FROM task_assignees a JOIN tasks t ON t.id = a.task_id
                         WHERE t.workspace_id = $1`),
    labels: await q('SELECT * FROM labels WHERE workspace_id = $1'),
    taskLabels: await q(`SELECT tl.* FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
                          WHERE t.workspace_id = $1`),
    settings: await q(`SELECT scope, scope_id, data FROM settings
                        WHERE scope = 'workspace' AND scope_id = $1`),
  };
}

/**
 * Einen Arbeitsbereich löschen.
 *
 * **Nicht den letzten**, und das ist dieselbe Regel wie beim letzten
 * Eigentümer und beim letzten Administrator: ein Konto ohne Arbeitsbereich
 * hätte keinen Ort, an dem es ankommt, und könnte sich keinen anlegen, wenn es
 * dafür einen bräuchte. Der Zustand ließe sich von innen nicht heilen.
 *
 * **Mit Namen bestätigen.** Der einzige Ort in SOTE, an dem etwas abgetippt
 * werden muss — und er ist es wert: hier ist nichts wiederherstellbar, und ein
 * Papierkorb für Arbeitsbereiche wäre ein Papierkorb für alles.
 */
export async function deleteWorkspace(
  pool: Pool,
  workspaceId: string,
  userId: string,
  confirmName: string,
): Promise<void> {
  const ws = await queryOne<{ name: string }>(
    pool,
    'SELECT name FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  if (ws === undefined) throw new OutOfOrder('diesen Arbeitsbereich gibt es nicht');
  if (confirmName.trim() !== ws.name) {
    throw new OutOfOrder(`tippe „${ws.name}" ab, um es zu bestätigen`);
  }
  const rest = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*) AS n FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND w.id <> $2 AND w.deleted_at IS NULL`,
    [userId, workspaceId],
  );
  if (Number(rest?.n ?? 0) === 0) {
    throw new OutOfOrder(
      'das ist dein letzter Arbeitsbereich — leg erst einen anderen an, sonst landest du nirgends',
    );
  }
  /*
   * Wirklich löschen und nicht `deleted_at` setzen.
   *
   * Die Spalte gibt es, und sie war die bequeme Antwort — aber „gelöscht, liegt
   * aber noch da" heißt, dass jede Abfrage im Projekt sie ab jetzt mitprüfen
   * muss, und eine, die es vergisst, zeigt einen Arbeitsbereich, den jemand
   * weggeworfen hat. Die Fremdschlüssel räumen mit `ON DELETE CASCADE` auf.
   */
  await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
}
