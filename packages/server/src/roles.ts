/**
 * SOTE — Rollen: was jemand hier darf.
 *
 * Die Form ist SONEs (ADR-0087): eine Rolle ist **(eine Stufe, eine Menge von
 * Rechten)** und kein Sack voll Rechte. Die Stufe ist eine Leiter, die Rechte
 * sind eine Menge — „darf Leute verwalten" und „darf Einstellungen ändern"
 * haben nichts miteinander zu tun und keine Reihenfolge.
 *
 * „Nur lesend" fällt daraus heraus, statt gebaut zu werden: eine Rolle mit
 * `viewer` und keinen Rechten.
 *
 * ## Systemrollen sind nicht änderbar
 *
 * `owner`, `admin`, `member`, `guest` legt die Einrichtung an. Sie zu ändern
 * hieße, die Bedeutung zu verschieben, auf die sich Bestehendes verlässt — und
 * `guest` mit Schreibrecht wäre kein Gast. Änderbar ist, was jemand selbst
 * angelegt hat.
 *
 * In SONE sind sie Zeilen mit `workspace_id IS NULL`, in **jedem**
 * Arbeitsbereich dieselben. In SOTE gehören sie je Arbeitsbereich dazu (die
 * Einrichtung schreibt sie), und darum erkennt sie hier ihr **Name** und nicht
 * ein fehlender Arbeitsbereich. Das ist schwächer — ein Name lässt sich
 * theoretisch zweimal vergeben, wenn auch nicht in derselben Zeile — und
 * benannt statt versteckt: sobald Rollen über Arbeitsbereiche hinweg gelten
 * sollen, ist das die Stelle, die sich ändert.
 *
 * ## Eigentümerschaft ist keine Rolle
 *
 * ADR-0087, und der Grund ist nicht Ordnungsliebe: „der letzte Eigentümer kann
 * nicht gehen" lässt sich gegen eine **Spalte** durchsetzen. Gegen eine Rolle
 * würde daraus „die letzte Person mit einer Rolle, die Löschen enthält" — und
 * das müsste bei jeder Rollenänderung neu gerechnet werden. Ein
 * Arbeitsbereich, dessen letzte eigentümerähnliche Rolle aus Versehen
 * bearbeitet wurde, wäre einer, den niemand mehr verwaltet.
 */

import { isListLevel, readRights, type ListLevel, type Right } from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { NameTaken } from './projects.js';
import { NotFound, OutOfOrder } from './tasks.js';

/** Die Namen, die die Einrichtung vergibt — nicht änderbar, nicht löschbar. */
const SYSTEM = new Set(['owner', 'admin', 'member', 'guest']);

export interface Role {
  id: string;
  name: string;
  listLevel: ListLevel | null;
  rights: Right[];
  system: boolean;
  /** Wie viele halten sie — die Zahl, die „darf ich das löschen" beantwortet. */
  members: number;
}

export async function list(pool: Pool, workspaceId: string): Promise<Role[]> {
  const rows = await queryRows<{
    id: string;
    name: string;
    list_level: string | null;
    rights: string[];
    members: string;
  }>(
    pool,
    `SELECT r.id, r.name, r.list_level, r.rights,
            (SELECT count(*) FROM workspace_members m WHERE m.role_id = r.id) AS members
       FROM roles r
      WHERE r.workspace_id = $1
      ORDER BY r.name`,
    [workspaceId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    listLevel: isListLevel(r.list_level) ? r.list_level : null,
    rights: readRights(r.rights),
    system: SYSTEM.has(r.name),
    members: Number(r.members),
  }));
}

async function mustBeCustom(pool: Pool, id: string, workspaceId: string): Promise<string> {
  const row = await queryOne<{ name: string }>(
    pool,
    'SELECT name FROM roles WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId],
  );
  if (row === undefined) throw new NotFound('diese Rolle gibt es hier nicht');
  if (SYSTEM.has(row.name)) {
    throw new OutOfOrder(
      `„${row.name}" ist eine Systemrolle — leg eine eigene an, statt diese zu ändern`,
    );
  }
  return row.name;
}

export async function create(
  pool: Pool,
  workspaceId: string,
  input: { name: string; listLevel: ListLevel | null; rights: readonly string[] },
): Promise<Role> {
  const name = input.name.trim();
  if (name === '') throw new OutOfOrder('eine Rolle braucht einen Namen');
  if (SYSTEM.has(name)) {
    // Nicht „gibt es schon", sondern warum: ein Name, der belegt ist, und ein
    // Name, der reserviert ist, sind zwei verschiedene Auskünfte.
    throw new OutOfOrder(`„${name}" ist der Name einer Systemrolle`);
  }
  try {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO roles (workspace_id, name, list_level, rights)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [workspaceId, name.slice(0, 60), input.listLevel, readRights(input.rights)],
    );
    const alle = await list(pool, workspaceId);
    const neu = alle.find((r) => r.id === row!.id);
    if (neu === undefined) throw new Error('INSERT ohne Zeile');
    return neu;
  } catch (e) {
    /*
     * Zwei Codes, und beide stehen hier mit Namen.
     *
     * Meine erste Fassung dieses Blocks enthielt erfundene Werte
     * (`'23_505'`, `'23_'`) — abgeschrieben aus dem Gedächtnis und nie
     * geprüft. Ein `catch`, das auf einen Code hört, den es nicht gibt, ist
     * ein `catch`, das nichts fängt und dabei aussieht wie eine Behandlung.
     *
     * 23505 = eindeutiger Index verletzt, 23514 = CHECK verletzt.
     */
    const err = e as { code?: string };
    if (err.code === '23505') throw new NameTaken(`„${name}" gibt es hier schon`);
    if (err.code === '23514') {
      // Der CHECK aus Migration 0013. `readRights` hat das schon gefiltert —
      // das hier ist die zweite Verteidigung und keine Ausrede für die erste.
      throw new OutOfOrder('dieses Recht gibt es nicht');
    }
    throw e;
  }
}

export async function update(
  pool: Pool,
  id: string,
  workspaceId: string,
  input: { name?: string; listLevel?: ListLevel | null; rights?: readonly string[] },
): Promise<void> {
  await mustBeCustom(pool, id, workspaceId);
  const sets: string[] = [];
  const params: unknown[] = [id, workspaceId];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === '') throw new OutOfOrder('eine Rolle braucht einen Namen');
    if (SYSTEM.has(name)) throw new OutOfOrder(`„${name}" ist der Name einer Systemrolle`);
    params.push(name.slice(0, 60));
    sets.push(`name = $${params.length}`);
  }
  if (input.listLevel !== undefined) {
    params.push(input.listLevel);
    sets.push(`list_level = $${params.length}`);
  }
  if (input.rights !== undefined) {
    params.push(readRights(input.rights));
    sets.push(`rights = $${params.length}`);
  }
  if (sets.length === 0) throw new OutOfOrder('nichts zu ändern');

  try {
    await pool.query(
      `UPDATE roles SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2`,
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
 * Eine Rolle löschen.
 *
 * **Nur, wenn niemand sie hält.** Sie zu löschen, während jemand sie hält,
 * hieße zu entscheiden, was der dann darf — und die stille Antwort wäre
 * „nichts" oder „alles", beides falsch. Wer eine Rolle loswerden will, gibt
 * ihren Leuten erst eine andere; dann sagt diese Route, was übrig ist.
 *
 * Dieselbe Bauart wie beim Löschen eines Kontos, und aus demselben Grund: still
 * ist bei Löschen das falsche Wort.
 */
export async function remove(pool: Pool, id: string, workspaceId: string): Promise<void> {
  await mustBeCustom(pool, id, workspaceId);
  const row = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*) AS n FROM workspace_members WHERE role_id = $1',
    [id],
  );
  if (Number(row?.n ?? 0) > 0) {
    throw new OutOfOrder('diese Rolle hält noch jemand — gib ihm zuerst eine andere');
  }
  await pool.query('DELETE FROM roles WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
}
