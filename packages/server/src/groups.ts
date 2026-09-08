/**
 * SOTE — Gruppen.
 *
 * Eine Gruppe ist eine Liste von Leuten, die **eine Rolle tragen kann**.
 *
 * ## Vereinigung und Maximum, niemals Abzug
 *
 * SONEs ADR-0087, und die Begründung stammt aus ADR-0026: **in eine Gruppe
 * aufgenommen zu werden darf niemals wegnehmen, was jemand schon durfte.** Ein
 * Modell, in dem Beitreten etwas nimmt, macht jede Gruppenmitgliedschaft zu
 * einer Sache, die man vor dem Vergeben prüfen muss — und dann traut sich
 * niemand mehr, jemanden hinzuzufügen.
 *
 * Also: die wirksame Rolle einer Person ist die **Vereinigung** der Rechte und
 * das **Maximum** der Stufen über ihre eigene Rolle und die Rollen aller ihrer
 * Gruppen. Das steht in `settings.ts` als SQL, weil dort auch die Prüfungen
 * stehen — zwei Orte für dieselbe Rechnung wären zwei Antworten.
 *
 * ## Eine Gruppe ohne Rolle ist erlaubt
 *
 * Sie ordnet dann nur. Das ist kein halber Zustand, sondern ein Zweck: „das
 * sind die Leute vom Umzug" ist eine nützliche Liste, auch wenn sie niemandem
 * etwas gibt.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { NameTaken } from './projects.js';
import { NotFound, OutOfOrder } from './tasks.js';

export interface Group {
  id: string;
  name: string;
  roleId: string | null;
  roleName: string | null;
  members: { userId: string; displayName: string }[];
}

export async function list(pool: Pool, workspaceId: string): Promise<Group[]> {
  const rows = await queryRows<{
    id: string;
    name: string;
    role_id: string | null;
    role_name: string | null;
  }>(
    pool,
    `SELECT g.id, g.name, g.role_id, r.name AS role_name
       FROM groups g LEFT JOIN roles r ON r.id = g.role_id
      WHERE g.workspace_id = $1
      ORDER BY g.name`,
    [workspaceId],
  );
  if (rows.length === 0) return [];

  /*
   * Eine Abfrage für alle Mitglieder, nicht eine je Gruppe.
   *
   * Bei fünf Gruppen sind das fünf Umläufe für eine Liste, die auf einen
   * Bildschirm passt — und die Zahl wächst mit den Gruppen, nicht mit der
   * Arbeit.
   */
  const mitglieder = await queryRows<{ group_id: string; user_id: string; display_name: string }>(
    pool,
    `SELECT gm.group_id, u.id AS user_id, u.display_name
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ANY($1)
      ORDER BY u.display_name`,
    [rows.map((r) => r.id)],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    roleId: r.role_id,
    roleName: r.role_name,
    members: mitglieder
      .filter((m) => m.group_id === r.id)
      .map((m) => ({ userId: m.user_id, displayName: m.display_name })),
  }));
}

export async function create(
  pool: Pool,
  workspaceId: string,
  name: string,
): Promise<{ id: string }> {
  const wie = name.trim();
  if (wie === '') throw new OutOfOrder('eine Gruppe braucht einen Namen');
  try {
    const row = await queryOne<{ id: string }>(
      pool,
      'INSERT INTO groups (workspace_id, name) VALUES ($1,$2) RETURNING id',
      [workspaceId, wie.slice(0, 60)],
    );
    return { id: row!.id };
  } catch (e) {
    // 23505 = eindeutiger Index. Der Code steht hier mit Namen, weil ich in
    // `roles.ts` schon einmal erfundene Codes hingeschrieben habe.
    if ((e as { code?: string }).code === '23505') {
      throw new NameTaken(`„${wie}" gibt es hier schon`);
    }
    throw e;
  }
}

async function mine(pool: Pool, id: string, workspaceId: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM groups WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId],
  );
  if (row === undefined) throw new NotFound('diese Gruppe gibt es hier nicht');
}

export async function update(
  pool: Pool,
  id: string,
  workspaceId: string,
  input: { name?: string; roleId?: string | null },
): Promise<void> {
  await mine(pool, id, workspaceId);
  const sets: string[] = [];
  const params: unknown[] = [id, workspaceId];

  if (input.name !== undefined) {
    const wie = input.name.trim();
    if (wie === '') throw new OutOfOrder('eine Gruppe braucht einen Namen');
    params.push(wie.slice(0, 60));
    sets.push(`name = $${params.length}`);
  }
  if (input.roleId !== undefined) {
    if (input.roleId !== null) {
      // Eine Rolle aus einem FREMDEN Arbeitsbereich wäre eine Rolle, deren
      // Rechte hier niemand gesetzt hat — dieselbe Prüfung wie bei Leuten.
      const rolle = await queryOne<{ id: string }>(
        pool,
        'SELECT id FROM roles WHERE id = $1 AND workspace_id = $2',
        [input.roleId, workspaceId],
      );
      if (rolle === undefined) throw new NotFound('diese Rolle gibt es hier nicht');
    }
    params.push(input.roleId);
    sets.push(`role_id = $${params.length}`);
  }
  if (sets.length === 0) throw new OutOfOrder('nichts zu ändern');

  try {
    await pool.query(
      `UPDATE groups SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2`,
      params,
    );
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw new NameTaken('diesen Namen gibt es hier schon');
    }
    throw e;
  }
}

/**
 * Eine Gruppe löschen.
 *
 * **Auch wenn Leute darin sind** — anders als bei Rollen und Konten, und der
 * Unterschied ist begründet: eine Gruppe zu löschen nimmt niemandem etwas, was
 * er ohne sie hätte. Vereinigung und Maximum heißt, dass ihre Rolle nur
 * *dazugab*; fällt sie weg, bleibt jeder bei seiner eigenen Rolle.
 *
 * Bei einer Rolle ist es umgekehrt: dort wäre die stille Antwort „nichts" oder
 * „alles". Deshalb steht die Verweigerung dort und hier nicht.
 */
export async function remove(pool: Pool, id: string, workspaceId: string): Promise<void> {
  await mine(pool, id, workspaceId);
  await pool.query('DELETE FROM groups WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
}

/** Jemanden aufnehmen — nur, wer im Arbeitsbereich ist. */
export async function add(
  pool: Pool,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await mine(pool, id, workspaceId);
  const drin = await queryOne<{ user_id: string }>(
    pool,
    'SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  /*
   * Eine Gruppe ist eine Ordnung INNERHALB eines Arbeitsbereichs.
   *
   * Jemanden aufzunehmen, der nicht Mitglied ist, hieße ihm über die Rolle der
   * Gruppe Rechte zu geben, ohne dass er hier ist — eine zweite Tür neben
   * „Leute", und eine, die niemand aufgesucht hätte.
   */
  if (drin === undefined) {
    throw new OutOfOrder('diese Person ist nicht im Arbeitsbereich — erst dort hinzufügen');
  }
  await pool.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [id, userId],
  );
}

/** Jemanden hinauslassen. Zweimal ist kein Fehler: er ist danach draußen. */
export async function drop(
  pool: Pool,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await mine(pool, id, workspaceId);
  await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
}
