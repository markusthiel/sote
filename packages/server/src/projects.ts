/**
 * SOTE — Projekte anlegen, umbenennen, verschieben.
 *
 * Bis hierher gab es Projekte nur per SQL. Der Baum ist derselbe Gegenstand wie
 * SONEs Seitenbaum, also gilt dieselbe Sortierung (Fractional Index) und
 * dieselbe Vorsicht: ein Projekt darf nicht sein eigener Nachfahre werden.
 */

import { generateKeyBetween, readColor, readIcon, type ProjectIcon } from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction, type PoolClient } from './db.js';
import { NotFound, OutOfOrder } from './tasks.js';

/** Ordner ordnen, Projekte halten (Konzept 10d). */
export type Kind = 'folder' | 'list';

export interface ProjectRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  icon: unknown;
  kind: Kind;
  sort_key: string;
}

const COLUMNS = 'id, workspace_id, parent_id, name, color, icon, kind, sort_key';

/**
 * Die Regeln der Form, mit Namen statt mit Datenbankfehlern.
 *
 * Die Datenbank hält sie ohnehin (Migration 0009: ein CHECK und zwei Trigger) —
 * eine Regel, die nur im Anwendungscode steht, kennt der nächste Schreibweg
 * nicht. Hier stehen sie ein zweites Mal, damit die Oberfläche einen Satz
 * bekommt statt eines Constraint-Namens.
 */
function checkShape(kind: Kind, parentId: string | null): void {
  if (kind === 'list' && parentId === null) {
    throw new OutOfOrder('ein Projekt liegt immer in einem Ordner');
  }
}

/** Die Art, wenn niemand eine genannt hat. */
function kindOr(kind: Kind | undefined, parentId: string | null): Kind {
  if (kind !== undefined) return kind;
  // Ganz oben kann nur ein Ordner stehen; darunter ist ein Projekt das, was
  // man meistens will — Unterordner sagt man dazu.
  return parentId === null ? 'folder' : 'list';
}

/**
 * Eine Farbe ist ein Palettenname oder ein Hex-Wert.
 *
 * Vorher stand hier nur `/^#[0-9a-f]{6}$/` — ein Name war nicht möglich, also
 * folgte keine Projektfarbe je einer Palette. Die Prüfung liegt jetzt im Kern
 * (`readColor`), damit Server und Oberfläche dieselbe Antwort geben.
 */
function checkColor(value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  if (readColor(value) === null) {
    throw new OutOfOrder(
      'eine Farbe ist ein Name aus der Palette oder ein Wert wie #2f7d6f',
    );
  }
}

const NAME_CLASH = '23505';
const NAME_INDEX = 'projects_sibling_name';

function nameClash(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err.code === NAME_CLASH && err.constraint === NAME_INDEX;
}

/**
 * Was die Datenbank über die Form sagt, in Worten.
 *
 * Die Trigger aus Migration 0009 werfen deutsche Sätze; der CHECK wirft einen
 * Constraint-Namen. Beides wird hier zu `OutOfOrder`, damit die Route eine
 * Meldung hat statt eines 500ers — ein Formfehler ist eine falsche Eingabe und
 * kein Serverfehler.
 */
function shapeError(e: unknown): OutOfOrder | null {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code !== '23514') return null;
  if (err.constraint === 'projects_list_needs_parent') {
    return new OutOfOrder('ein Projekt liegt immer in einem Ordner');
  }
  return new OutOfOrder(err.message ?? 'das geht an dieser Stelle nicht');
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
  input: {
    name: string;
    parentId?: string | null;
    color?: string | null;
    icon?: unknown;
    kind?: Kind;
  },
): Promise<ProjectRow> {
  const name = input.name.trim();
  if (name === '') throw new OutOfOrder('ein Projekt braucht einen Namen');
  checkColor(input.color);
  const kind = kindOr(input.kind, input.parentId ?? null);
  checkShape(kind, input.parentId ?? null);

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
        `INSERT INTO projects (workspace_id, parent_id, name, color, icon, kind, sort_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLUMNS}`,
        [
          workspaceId,
          parentId,
          name,
          input.color ?? null,
          // `readIcon` wirft weg, was keine Form hat — ein leeres Objekt in
          // der Spalte würde behaupten, jemand hätte etwas gewählt.
          input.icon === undefined || input.icon === null
            ? null
            : JSON.stringify(readIcon(input.icon)),
          kind,
          key,
        ],
      );
      if (row === undefined) throw new Error('INSERT ohne Zeile');
      return row;
    });
  } catch (e) {
    if (nameClash(e)) {
      throw new NameTaken(`„${name}" gibt es hier schon`);
    }
    const shape = shapeError(e);
    if (shape !== null) throw shape;
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
  fields: {
    name?: string;
    color?: string | null;
    parentId?: string | null;
    /** `null` leert das Zeichen, ein fehlender Schlüssel lässt es stehen. */
    icon?: unknown;
  },
): Promise<ProjectRow> {
  checkColor(fields.color);
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
      /*
       * `null` leert, ein fehlender Schlüssel lässt stehen — dieselbe Regel wie
       * überall in SOTE. Und `readIcon` wirft weg, was keine Form hat: ein
       * leeres Objekt in der Spalte würde behaupten, jemand hätte etwas
       * gewählt.
       */
      if (fields.icon !== undefined) {
        const icon: ProjectIcon | null = fields.icon === null ? null : readIcon(fields.icon);
        set('icon', icon === null ? null : JSON.stringify(icon));
      }

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
    // Dieselbe Uebersetzung wie beim Anlegen. Sie stand zuerst nur dort, und
    // ein Umhaengen, das gegen die Form laeuft, kam als Constraint-Name bei der
    // Oberflaeche an — die Regel griff, nur ohne Satz.
    const shape = shapeError(e);
    if (shape !== null) throw shape;
    throw e;
  }
}
