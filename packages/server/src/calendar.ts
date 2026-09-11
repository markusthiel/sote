/**
 * SOTE — die Kalender-Ausgabe.
 *
 * Die Aufgaben mit Datum als abonnierbarer Kalender. Was hier steht, ist der
 * Umgang mit dem LINK; das Dokument selbst baut `buildIcs` im Kern.
 *
 * ## Ein Link ohne Anmeldung ist ein Passwort
 *
 * Ein Kalenderprogramm kann sich nicht anmelden — es holt eine Adresse ab, in
 * einem Rutsch, ohne Konto. Also trägt die Adresse das Geheimnis, und damit
 * gilt für sie, was für die Freigaben gilt (`shares.ts`): 32 Bytes aus
 * `randomBytes`, `token_hash` zum Nachschlagen, `token_enc` zum Wiederzeigen,
 * der Schlüssel aus der Umgebung.
 *
 * Und widerrufbar, sofort. Wer glaubt, den Link verloren zu haben, macht einen
 * neuen — und weil höchstens einer je Person und Bereich gilt, ist der alte
 * damit tot. Zwei gültige wären zwei Dinge zu widerrufen.
 *
 * ## Was drinsteht
 *
 * Offene Aufgaben des Arbeitsbereichs, die ein Datum haben. Drei Entscheidungen
 * dazu, jede mit einem Grund:
 *
 * - **Nur offene.** Ein Kalender sagt, was ansteht. Erledigtes steht in der
 *   Anwendung, und im Kalender wäre es eine zweite Geschichte derselben Woche.
 * - **Der ganze Bereich, nicht nur „meine".** Wer den Bereich sehen darf, sieht
 *   dort ohnehin alles — ein Kalender, der weniger zeigt als die Liste daneben,
 *   wäre ein zweiter Begriff von „meine Aufgaben".
 * - **Kein Papierkorb.** Selbstverständlich, aber es steht als Bedingung da und
 *   nicht als Selbstverständlichkeit.
 */

import { createHash, randomBytes } from 'node:crypto';

import { buildIcs, type IcsTask } from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { keyPresent, seal, unseal } from './secretbox.js';

export class NoCalendar extends Error {
  override name = 'NoCalendar';
}

/** Ob die Ausgabe überhaupt geht — also ob der Instanzschlüssel da ist. */
export const calendarKeyPresent = keyPresent;

const digest = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface FeedRow {
  id: string;
  created_at: Date;
  last_used_at: Date | null;
}

/**
 * Der gültige Link dieser Person in diesem Bereich — mit Klartext.
 *
 * `undefined`, wenn es keinen gibt: das ist kein Fehler, sondern der
 * Normalzustand vor dem ersten Mal.
 */
export async function feedOf(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<(FeedRow & { token: string | null }) | undefined> {
  const row = await queryOne<FeedRow & { token_enc: string }>(
    pool,
    `SELECT id, created_at, last_used_at, token_enc FROM calendar_feeds
      WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [workspaceId, userId],
  );
  if (row === undefined) return undefined;
  return {
    id: row.id,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    token: unseal(row.token_enc),
  };
}

/**
 * Einen neuen machen — und den alten dabei widerrufen.
 *
 * Beides zusammen, in einer Anweisung je Schritt, aber in derselben Sitzung:
 * „neu machen" heißt für den, der es drückt, dass der alte nicht mehr gilt.
 * Zwei Knöpfe dafür wären zwei Handgriffe für einen Gedanken — und wer den
 * zweiten vergisst, hat einen Link mehr in der Welt, als er glaubt.
 */
export async function newFeed(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<{ token: string }> {
  if (!keyPresent()) {
    throw new NoCalendar(
      'dieser Server hat keinen SOTE_SHARE_KEY — ohne ihn gibt es keine Kalender-Links',
    );
  }
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `UPDATE calendar_feeds SET revoked_at = now()
      WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [workspaceId, userId],
  );
  await pool.query(
    `INSERT INTO calendar_feeds (workspace_id, user_id, token_hash, token_enc)
     VALUES ($1,$2,$3,$4)`,
    [workspaceId, userId, digest(token), seal(token)],
  );
  return { token };
}

/** Abschalten. Danach ist der Link tot, und kein Kalender bekommt mehr etwas. */
export async function revokeFeed(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const out = await pool.query(
    `UPDATE calendar_feeds SET revoked_at = now()
      WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [workspaceId, userId],
  );
  if (out.rowCount === 0) throw new NoCalendar('hier ist kein Kalender-Link offen');
}

/**
 * Das Dokument zu einem Token.
 *
 * `undefined` bei einem unbekannten oder widerrufenen Token — und zwar ohne
 * Unterschied. Ein „widerrufen" in der Antwort wäre die Auskunft, dass es
 * diesen Link einmal gab, und die schuldet ein Server niemandem, der ihn nicht
 * (mehr) hat.
 */
export async function icsByToken(
  pool: Pool,
  token: string,
  now: Date,
  base: string | undefined,
): Promise<string | undefined> {
  const feed = await queryOne<{ id: string; workspace_id: string }>(
    pool,
    `SELECT id, workspace_id FROM calendar_feeds
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [digest(token)],
  );
  if (feed === undefined) return undefined;

  /*
   * Die Quittung, bevor gearbeitet wird.
   *
   * Sie ist die einzige Auskunft darüber, ob das Abonnement lebt — und ohne
   * sie sieht ein vergessener Link aus wie ein benutzter. Kein Grund zu
   * warten, bis das Dokument steht: dass jemand gefragt hat, ist schon wahr.
   */
  await pool.query('UPDATE calendar_feeds SET last_used_at = now() WHERE id = $1', [feed.id]);

  const name = await queryOne<{ name: string }>(
    pool,
    'SELECT name FROM workspaces WHERE id = $1',
    [feed.workspace_id],
  );

  const rows = await queryRows<{
    id: string;
    title: string;
    note: string | null;
    planned_at: Date | null;
    planned_all_day: boolean;
    due_at: Date | null;
    due_all_day: boolean;
    duration_min: number | null;
    updated_at: Date;
    project_name: string | null;
  }>(
    pool,
    `SELECT t.id, t.title, t.note, t.planned_at, t.planned_all_day,
            t.due_at, t.due_all_day, t.duration_min, t.updated_at,
            p.name AS project_name
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.workspace_id = $1
        AND t.trashed_at IS NULL
        AND t.completed_at IS NULL
        AND (t.planned_at IS NOT NULL OR t.due_at IS NOT NULL)
      ORDER BY COALESCE(t.planned_at, t.due_at)`,
    [feed.workspace_id],
  );

  const tasks: IcsTask[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    planned: r.planned_at,
    plannedAllDay: r.planned_all_day,
    due: r.due_at,
    dueAllDay: r.due_all_day,
    duration: r.duration_min,
    note: r.note,
    projectName: r.project_name,
    updatedAt: r.updated_at,
  }));

  return buildIcs({
    tasks,
    name: `SOTE — ${name?.name ?? 'Aufgaben'}`,
    base,
    now,
  });
}
