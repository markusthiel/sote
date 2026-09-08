/**
 * SOTE — Einstellungen lesen und schreiben.
 *
 * Drei Ebenen aus einer Tabelle (Migration 0008). Was hier steht, ist die
 * **eine** Stelle, die aus drei Zeilen eine Antwort macht — der Kern rechnet
 * (`resolveSettings`), dieses Modul holt.
 *
 * ## Wer was ändern darf
 *
 * - **Die eigene** Person: immer. Es sind die eigenen.
 * - Den **Arbeitsbereich**: wer `roles.manage` hat oder Eigentümer ist. Ein
 *   Thema für den Inhalt ist eine Ansage an alle Mitglieder, und die soll
 *   nicht jeder machen können.
 * - Die **Instanz**: nur wer den Arbeitsbereich besitzt, in dem er gerade ist —
 *   SOTE hat noch keinen Instanzadministrator. **Das ist zu grob**, und es
 *   steht hier statt in einem Bugtracker: sobald es Rollen über Arbeitsbereiche
 *   hinweg gibt, gehört diese Prüfung dorthin.
 */

import {
  readSettings,
  resolveLanding,
  resolveLook,
  resolveSettings,
  type Settings,
} from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction, type PoolClient } from './db.js';
import { OutOfOrder } from './tasks.js';

export type Scope = 'instance' | 'workspace' | 'user';

/**
 * Die drei Zeilen, in einer Abfrage.
 *
 * Drei einzelne Abfragen wären drei Umläufe für etwas, das bei jedem Aufruf von
 * `/api/me` gebraucht wird — und der Fall „Arbeitsbereich hat keine Zeile" ist
 * der Normalfall, nicht die Ausnahme.
 */
export async function levelsFor(
  q: Pool | PoolClient,
  userId: string,
  workspaceId: string | null,
): Promise<{ instance: Settings; workspace: Settings; user: Settings }> {
  const rows = await queryRows<{ scope: Scope; scope_id: string | null; data: unknown }>(
    q,
    `SELECT scope, scope_id, data FROM settings
      WHERE (scope = 'instance')
         OR (scope = 'user' AND scope_id = $1)
         OR (scope = 'workspace' AND scope_id = $2)`,
    [userId, workspaceId],
  );
  const pick = (scope: Scope): Settings => {
    const row = rows.find((r) => r.scope === scope);
    return row === undefined ? {} : readSettings(row.data);
  };
  return { instance: pick('instance'), workspace: pick('workspace'), user: pick('user') };
}

/** Was für diese Person hier gilt, plus die Ebenen einzeln. */
export async function effectiveFor(
  q: Pool | PoolClient,
  userId: string,
  workspaceId: string | null,
): Promise<{
  effective: ReturnType<typeof resolveSettings> & {
    look: ReturnType<typeof resolveLook>;
    landing: ReturnType<typeof resolveLanding>;
  };
  levels: { instance: Settings; workspace: Settings; user: Settings };
}> {
  const levels = await levelsFor(q, userId, workspaceId);
  return {
    effective: {
      ...resolveSettings(levels.user, levels.workspace, levels.instance),
      // Anders aufgelöst als das Schema, und mit Absicht: das Aussehen des
      // Arbeitsbereichs gestaltet, was alle sehen (ADR-0028). Die Person kommt
      // darin nicht vor.
      look: resolveLook(levels.workspace, levels.instance),
      /*
       * Wieder eine andere Reihenfolge, und wieder mit Grund (ADR-0032): wo
       * jemand landet, ist die Wahl EINER Person für ihre eigene Sitzung —
       * zwei Mitglieder haben verschiedene Antworten, also kann es keine
       * Eigenschaft des Arbeitsbereichs sein. Der setzt nur eine Vorgabe für
       * alle, die selbst nichts gewählt haben. Die Instanz kommt nicht vor:
       * „wo du landest" ist keine Servereinstellung.
       */
      landing: resolveLanding(levels.user.landing, levels.workspace.landing),
    },
    levels,
  };
}

/**
 * Ändern, ohne zu überschreiben, was man nicht angefasst hat.
 *
 * `null` leert ein Feld, ein fehlender Schlüssel lässt es stehen — dieselbe
 * Regel wie überall in SOTE. Und **was der Kern nicht kennt, bleibt liegen**:
 * eine ältere Fassung darf die Werte einer neueren nicht wegwerfen, nur weil
 * sie sie nicht lesen kann. Deshalb wird das vorhandene Dokument gelesen,
 * ergänzt und zurückgeschrieben, statt ein neues zu bauen.
 */
export async function patchSettings(
  pool: Pool,
  scope: Scope,
  scopeId: string | null,
  changes: Record<string, unknown>,
): Promise<Settings> {
  if (scope === 'instance' && scopeId !== null) {
    throw new OutOfOrder('die Instanz hat kein Gegenüber');
  }
  if (scope !== 'instance' && scopeId === null) {
    throw new OutOfOrder(`für ${scope} fehlt, wessen Einstellung es ist`);
  }

  return withTransaction(pool, async (client) => {
    /*
     * Gesperrt gelesen.
     *
     * Zwei Fenster derselben Person, beide ändern etwas anderes: ohne Sperre
     * liest das zweite den alten Stand und schreibt die Änderung des ersten
     * weg. Der Fall ist selten und die Sperre billig.
     */
    const row = await queryOne<{ data: unknown }>(
      client,
      `SELECT data FROM settings
        WHERE scope = $1 AND scope_id IS NOT DISTINCT FROM $2
        FOR UPDATE`,
      [scope, scopeId],
    );

    const before = (row?.data ?? {}) as Record<string, unknown>;
    const after: Record<string, unknown> = { ...before };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete after[key];
      else after[key] = value;
    }

    // Geprüft wird vor dem Schreiben, nicht beim Lesen: ein ungültiger Wert in
    // der Datenbank wäre still, ein abgelehnter Aufruf ist es nicht.
    const kept = readSettings(after);
    for (const key of Object.keys(changes)) {
      if (changes[key] !== null && !(key in kept)) {
        throw new OutOfOrder(`„${key}" nimmt diesen Wert nicht`);
      }
    }

    await client.query(
      `INSERT INTO settings (scope, scope_id, data)
       VALUES ($1,$2,$3)
       ON CONFLICT (scope, scope_id) DO UPDATE
         SET data = EXCLUDED.data, updated_at = now()`,
      [scope, scopeId, JSON.stringify(after)],
    );
    return kept;
  });
}

/**
 * Darf diese Person auf dieser Ebene ändern?
 *
 * Die eigene immer; die anderen beiden nur als Eigentümer oder mit
 * `roles.manage`. Siehe den Vorbehalt zur Instanz im Kopf dieser Datei.
 */
export async function mayChange(
  q: Pool | PoolClient,
  scope: Scope,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  if (scope === 'user') return true;
  const row = await queryOne<{ ok: boolean }>(
    q,
    `SELECT (m.is_owner OR 'roles.manage' = ANY(r.rights)) AS ok
       FROM workspace_members m
       JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = $1 AND m.workspace_id = $2`,
    [userId, workspaceId],
  );
  return row?.ok === true;
}
