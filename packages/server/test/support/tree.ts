/**
 * SOTE — Ordner und Projekte für Tests.
 *
 * Seit Konzept 10d liegt ein Projekt **immer in einem Ordner**, und Aufgaben
 * hängen nur an Projekten. Sieben Testdateien legten Projekte per SQL direkt an
 * der Wurzel an — was jetzt gegen den CHECK läuft.
 *
 * Das ließe sich in jeder Datei einzeln nachziehen. Ein Helfer ist besser, und
 * zwar aus einem Grund, der über die Bequemlichkeit hinausgeht: **wenn sich die
 * Form noch einmal ändert, gibt es eine Stelle statt sieben.** Sieben
 * angepasste Stellen sind sieben Gelegenheiten, eine zu vergessen — und ein
 * vergessener Test ist einer, der still das Falsche prüft.
 */

import type { Pool } from 'pg';

import { queryOne, type PoolClient } from '../../src/db.js';

/**
 * Ein Ordner mit einem gleichnamigen Projekt darin, und die Id des Projekts.
 *
 * Genau die Form, die Migration 0009 aus einem alten Projekt macht — damit
 * Tests dieselbe Gestalt vorfinden wie eine migrierte Instanz und nicht eine
 * aufgeräumtere, die es in freier Wildbahn nicht gibt.
 */
export async function makeList(
  q: Pool | PoolClient,
  workspaceId: string,
  name: string,
  sortKey = 'a0',
): Promise<string> {
  const folder = await queryOne<{ id: string }>(
    q,
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,$2,'folder',$3) RETURNING id`,
    [workspaceId, name, sortKey],
  );
  const list = await queryOne<{ id: string }>(
    q,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,$3,'list','a0') RETURNING id`,
    [workspaceId, folder!.id, name],
  );
  return list!.id;
}

/** Nur der Ordner, für Tests über den Baum selbst. */
export async function makeFolder(
  q: Pool | PoolClient,
  workspaceId: string,
  name: string,
  sortKey = 'a0',
  parentId: string | null = null,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    q,
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     VALUES ($1,$2,$3,'folder',$4) RETURNING id`,
    [workspaceId, parentId, name, sortKey],
  );
  return row!.id;
}
