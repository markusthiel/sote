/**
 * SOTE — Projekte anlegen, umbenennen, verschieben.
 *
 * Bis hierher gab es Projekte nur per SQL. Der Baum ist derselbe Gegenstand wie
 * SONEs Seitenbaum, also gilt dieselbe Sortierung (Fractional Index) und
 * dieselbe Vorsicht: ein Projekt darf nicht sein eigener Nachfahre werden.
 */

import { generateKeyBetween } from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction, type PoolClient } from './db.js';
import { NotFound, OutOfOrder } from './tasks.js';

export interface ProjectRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  sort_key: string;
}

const COLUMNS = 'id, workspace_id, parent_id, name, color, sort_key';

/** Ein Farbwert ist ein Farbwert und kein beliebiger String im Stylesheet. */
const COLOR = /^#[0-9a-f]{6}$/i;

const NAME_CLASH = '23505';
const NAME_INDEX = 'projects_sibling_name';

function nameClash(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err.code === NAME_CLASH && err.constraint === NAME_INDEX;
}

export class NameTaken extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NameTaken';
  }
}

async function keyAtEnd(
  q: Pool | PoolClient,
  workspaceId: string,
  parentId: string | null,
): Promise<string> {
  // Wie bei den Aufgaben: **weggeworfene Zeilen zählen mit**, weil der
  // Sortierschlüssel-Index keinen Papierkorb kennt.
  const last = await queryOne<{ sort_key: string }>(
    q,
    `SELECT sort_key FROM projects
      WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2
      ORDER BY sort_key DESC LIMIT 1`,
    [workspaceId, parentId],
  );
  return generateKeyBetween(last?.sort_key ?? null, null);
}

export async function create(
  pool: Pool,
  workspaceId: string,
  input: { name: string; parentId?: string | null; color?: string | null },
): Promise<ProjectRow> {
  const name = input.name.trim();
  if (name === '') throw new OutOfOrder('ein Projekt braucht einen Namen');
  if (input.color !== undefined && input.color !== null && !COLOR.test(input.color)) {
    throw new OutOfOrder('eine Farbe ist ein Wert wie #2f7d6f');
  }

  try {
    return await withTransaction(pool, async (client) => {
      const parentId = input.parentId ?? null;
      if (parentId !== null) {
        const parent = await queryOne<{ id: string }>(
          client,
          `SELECT id FROM projects
            WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
          [parentId, workspaceId],
        );
        if (parent === undefined) throw new NotFound(`Projekt ${parentId} gibt es nicht`);
      }
      const key = await keyAtEnd(client, workspaceId, parentId);
      const row = await queryOne<ProjectRow>(
        client,
        `INSERT INTO projects (workspace_id, parent_id, name, color, sort_key)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${COLUMNS}`,
        [workspaceId, parentId, name, input.color ?? null, key],
      );
      if (row === undefined) throw new Error('INSERT ohne Zeile');
      return row;
    });
  } catch (e) {
    if (nameClash(e)) {
      throw new NameTaken(`„${name}" gibt es hier schon`);
    }
    throw e;
  }
}

/**
 * Umbenennen, umfärben, umhängen.
 *
 * Beim Umhängen wird geprüft, dass das Ziel **kein Nachfahre** ist. Ohne diese
 * Prüfung entsteht ein Kreis: das Projekt und alles darunter wäre aus dem Baum
 * verschwunden, aber noch in der Datenbank — und keine Abfrage über den Baum
 * würde je enden.
 */
export async function update(
  pool: Pool,
  id: string,
  workspaceId: string,
  fields: { name?: string; color?: string | null; parentId?: string | null },
): Promise<ProjectRow> {
  if (fields.color !== undefined && fields.color !== null && !COLOR.test(fields.color)) {
    throw new OutOfOrder('eine Farbe ist ein Wert wie #2f7d6f');
  }
  if (fields.name !== undefined && fields.name.trim() === '') {
    throw new OutOfOrder('ein Projekt braucht einen Namen');
  }

  try {
    return await withTransaction(pool, async (client) => {
      const me = await queryOne<{ parent_id: string | null }>(
        client,
        `SELECT parent_id FROM projects
          WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
        [id, workspaceId],
      );
      if (me === undefined) throw new NotFound(`Projekt ${id} gibt es nicht`);

      const sets: string[] = [];
      const params: unknown[] = [id, workspaceId];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      if (fields.name !== undefined) set('name', fields.name.trim());
      if (fields.color !== undefined) set('color', fields.color);

      if (fields.parentId !== undefined && fields.parentId !== me.parent_id) {
        const target = fields.parentId;
        if (target === id) throw new OutOfOrder('ein Projekt kann nicht in sich selbst liegen');
        if (target !== null) {
          const line = await queryRows<{ id: string }>(
            client,
            `WITH RECURSIVE down AS (
               SELECT id FROM projects WHERE id = $1
               UNION ALL
               SELECT p.id FROM projects p JOIN down d ON p.parent_id = d.id
             )
             SELECT id FROM down WHERE id = $2`,
            [id, target],
          );
          if (line.length > 0) {
            throw new OutOfOrder(
              'das Ziel liegt unter diesem Projekt — daraus würde ein Kreis',
            );
          }
          const exists = await queryOne<{ id: string }>(
            client,
            `SELECT id FROM projects
              WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
            [target, workspaceId],
          );
          if (exists === undefined) throw new NotFound(`Projekt ${target} gibt es nicht`);
        }
        set('parent_id', target);
        // Neuer Geschwisterkreis, neuer Schlüsselraum: der alte Schlüssel
        // könnte dort schon belegt sein.
        set('sort_key', await keyAtEnd(client, workspaceId, target));
      }

      if (sets.length === 0) throw new OutOfOrder('nichts zu ändern');

      const row = await queryOne<ProjectRow>(
        client,
        `UPDATE projects SET ${sets.join(', ')}
          WHERE id = $1 AND workspace_id = $2 RETURNING ${COLUMNS}`,
        params,
      );
      if (row === undefined) throw new NotFound(`Projekt ${id} gibt es nicht`);
      return row;
    });
  } catch (e) {
    if (nameClash(e)) {
      throw new NameTaken(`„${fields.name?.trim() ?? ''}" gibt es dort schon`);
    }
    throw e;
  }
}
