/**
 * SOTE — wer hier mitarbeitet.
 *
 * ## Zugang ist keine Einladung (SONEs ADR-0073)
 *
 * Ein **Konto** anzulegen ist Sache der Instanz — sie entscheidet, wer auf
 * diesem Server überhaupt existiert. Wer in einem **Arbeitsbereich**
 * mitarbeiten darf, ist Sache seines Eigentümers, und das ist eine Frage über
 * Leute, die es schon gibt. Ein Formular, das beides täte, ließe einen
 * Arbeitsbereich fremde Konten auf dem Server erzeugen.
 *
 * Hier steht darum nur die zweite Frage. Einladungen kommen mit dem Mailweg,
 * und der ist nicht gebaut.
 *
 * ## Gesucht wird, nicht getippt (ADR-0119, das ADR-0073 hier überholt)
 *
 * ADR-0073 entschied „nach Adresse, nicht aus einer Liste", mit dem Grund, ein
 * Wähler über alle Konten mache jeden Eigentümer zum Leser des
 * Instanzverzeichnisses. **Die Sorge ist richtig, der Schluss war zu stark** —
 * und der Beweis stand zwanzig Zeilen darunter im selben Dokument: die Route
 * sagt „dieses Konto gibt es nicht" deutlich, also konnte derselbe Aufrufer
 * jede Adresse ohnehin bestätigen, eine Anfrage nach der anderen. Das Feld
 * machte nur die ehrliche Frage — *ist das die richtige Person?* — vor dem
 * Klick unbeantwortbar.
 *
 * Also ein Suchfeld, mit denselben Rechten wie das Hinzufügen:
 *
 * - **Nichts unter zwei Zeichen.** Das ist der ganze Unterschied zwischen
 *   *bestätigen* und *auflisten*: ohne Eingabe keine Zeilen, also wird hier
 *   nie ein Verzeichnis gelesen. Die ehrliche Grenze dieser Aussage: wer
 *   entschlossen ist, kann Präfixe abgehen — gewonnen ist, dass das
 *   Verzeichnis unbequem statt offen ist, und über Adressen ging es vorher
 *   ohnehin.
 * - **Wer schon hier ist, wird mitgeliefert und markiert**, nicht gefiltert.
 *   Verborgen liest er sich als „gibt es nicht" — dieselbe Verwirrung, die
 *   diese Änderung behebt, nur von der anderen Seite.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction } from './db.js';
import { NotFound, OutOfOrder } from './tasks.js';

export interface Person {
  userId: string;
  displayName: string;
  email: string;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
}

/** Wer in diesem Arbeitsbereich ist. */
export async function people(pool: Pool, workspaceId: string): Promise<Person[]> {
  const rows = await queryRows<{
    user_id: string;
    display_name: string;
    email: string;
    is_owner: boolean;
    role_id: string | null;
    role_name: string | null;
  }>(
    pool,
    `SELECT u.id AS user_id, u.display_name, u.email, m.is_owner,
            r.id AS role_id, r.name AS role_name
       FROM workspace_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN roles r ON r.id = m.role_id
      WHERE m.workspace_id = $1
      -- Eigentümer zuerst, dann nach Namen: eine Liste von Leuten, die nach
      -- einer Id sortiert ist, ist eine Liste, in der man nicht sucht.
      ORDER BY m.is_owner DESC, u.display_name`,
    [workspaceId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    isOwner: r.is_owner,
    roleId: r.role_id,
    roleName: r.role_name,
  }));
}

/** Die Rollen, die dieser Arbeitsbereich kennt. */
export async function roles(
  pool: Pool,
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  return queryRows<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM roles WHERE workspace_id = $1 ORDER BY name',
    [workspaceId],
  );
}

/**
 * Jemanden finden — mit Marke, wenn er schon hier ist.
 *
 * Nichts unter zwei Zeichen, höchstens acht Zeilen. Beides steht hier und nicht
 * beim Aufrufer: eine Grenze, die jeder Aufrufer selbst einhalten muss, ist
 * eine Grenze, die ein Aufrufer nicht einhält (ADR-0087).
 */
export async function findPeople(
  pool: Pool,
  workspaceId: string,
  q: string,
): Promise<{ userId: string; displayName: string; email: string; alreadyMember: boolean }[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const rows = await queryRows<{
    id: string;
    display_name: string;
    email: string;
    member: boolean;
  }>(
    pool,
    `SELECT u.id, u.display_name, u.email,
            EXISTS (
              SELECT 1 FROM workspace_members m
               WHERE m.workspace_id = $2 AND m.user_id = u.id
            ) AS member
       FROM users u
      WHERE u.display_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
      ORDER BY u.display_name
      LIMIT 8`,
    [needle, workspaceId],
  );
  return rows.map((r) => ({
    userId: r.id,
    displayName: r.display_name,
    email: r.email,
    alreadyMember: r.member,
  }));
}

/**
 * Jemanden hinzufügen, der schon ein Konto hat.
 *
 * **Hinzufügen ist nicht Befördern** (ADR-0073): wer schon Mitglied ist, wird
 * abgelehnt und bekommt nicht still eine andere Rolle. Das Ändern einer Rolle
 * ist eine eigene Handlung mit einem eigenen Bedienelement, und beides in einem
 * Weg zu haben heißt, dass ein Verklicken jemandem Rechte gibt.
 */
export async function addPerson(
  pool: Pool,
  workspaceId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const rolle = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM roles WHERE id = $1 AND workspace_id = $2',
    [roleId, workspaceId],
  );
  // Eine Rolle aus einem FREMDEN Arbeitsbereich wäre eine Rolle, deren Rechte
  // hier niemand gesetzt hat. Geprüft, statt sich auf den Fremdschlüssel zu
  // verlassen: der kennt die Zugehörigkeit nicht.
  if (rolle === undefined) throw new NotFound('diese Rolle gibt es hier nicht');

  const wer = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE id = $1', [userId]);
  if (wer === undefined) throw new NotFound('dieses Konto gibt es nicht');

  const res = await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [workspaceId, userId, roleId],
  );
  if (res.rowCount === 0) {
    throw new OutOfOrder('diese Person ist schon hier — ihre Rolle änderst du in der Liste');
  }
}

/** Eine Rolle ändern. Nicht die eines Eigentümers: dessen Recht ist eine Spalte. */
export async function setRole(
  pool: Pool,
  workspaceId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const rolle = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM roles WHERE id = $1 AND workspace_id = $2',
    [roleId, workspaceId],
  );
  if (rolle === undefined) throw new NotFound('diese Rolle gibt es hier nicht');
  const res = await pool.query(
    `UPDATE workspace_members SET role_id = $3
      WHERE workspace_id = $1 AND user_id = $2 AND is_owner = false`,
    [workspaceId, userId, roleId],
  );
  if (res.rowCount === 0) {
    /*
     * Ein Satz für zwei Fälle, und hier ist das richtig: „ist kein Mitglied"
     * und „ist Eigentümer" sind beide Antworten darauf, dass diese Zeile keine
     * Rolle hat, die man setzen kann — und wer fragen darf, sieht in derselben
     * Liste, welcher der beiden Fälle es ist.
     */
    throw new NotFound('diese Person hat hier keine Rolle, die sich ändern lässt');
  }
}

/**
 * Jemanden entfernen.
 *
 * **Nicht den letzten Eigentümer**, und nicht sich selbst als Eigentümer: ein
 * Arbeitsbereich ohne Eigentümer ist ein Arbeitsbereich, in dem niemand mehr
 * Leute verwalten kann — und das lässt sich von innen nicht heilen.
 */
export async function removePerson(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const row = await queryOne<{ is_owner: boolean; owners: string }>(
    pool,
    `SELECT m.is_owner,
            (SELECT count(*) FROM workspace_members o
              WHERE o.workspace_id = $1 AND o.is_owner) AS owners
       FROM workspace_members m
      WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [workspaceId, userId],
  );
  if (row === undefined) throw new NotFound('diese Person ist hier nicht');
  if (row.is_owner && Number(row.owners) <= 1) {
    throw new OutOfOrder('der letzte Eigentümer kann nicht gehen — sonst verwaltet niemand mehr');
  }
  await withTransaction(pool, async (client) => {
    await client.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [
      workspaceId,
      userId,
    ]);
    /*
     * UND die Zuständigkeiten dieser Person in diesem Arbeitsbereich.
     *
     * Eine Zuweisung ist ein Versprechen, an etwas zu arbeiten — wer nicht
     * mehr hier ist, kann es nicht halten, und die Aufgabe zeigte sonst
     * weiter auf jemanden, den niemand mehr in der Liste findet. Ausserdem
     * ist die Zuweisung ein Weg, auf dem Meldungen entstehen (`deliver`
     * prüft die Mitgliedschaft seitdem selbst, Audit 12.09.2026, F13 —
     * aber ein Verweis, der ins Leere zeigt, gehört trotzdem nicht stehen
     * gelassen). Kommentare und Urheberschaft bleiben: das ist Geschichte,
     * und Geschichte wird nicht umgeschrieben.
     *
     * Und die Gruppen: `group_members` hängt per Fremdschlüssel an `users`,
     * nicht an der Mitgliedschaft — wer den Arbeitsbereich verlässt, bliebe
     * in seinen Gruppen und hielte darüber weiter eine Rolle. Also hier, aus
     * demselben Grund: eine Gruppe im Arbeitsbereich ist eine Aussage über
     * Leute IM Arbeitsbereich.
     */
    await client.query(
      `DELETE FROM task_assignees a USING tasks t
        WHERE a.task_id = t.id AND t.workspace_id = $1 AND a.user_id = $2`,
      [workspaceId, userId],
    );
    await client.query(
      `DELETE FROM group_members gm USING groups g
        WHERE gm.group_id = g.id AND g.workspace_id = $1 AND gm.user_id = $2`,
      [workspaceId, userId],
    );
  });
}
