/**
 * SOTE — wer auf diesem Server existiert.
 *
 * Die Instanzseite der Frage, die „Leute" für einen Arbeitsbereich beantwortet
 * (SONEs ADR-0073: *ein Arbeitsbereich gibt Zugang, die Instanz lädt ein*).
 * Zwei Bildschirme, zwei Fragen:
 *
 * - **Leute:** wer arbeitet in diesem Arbeitsbereich mit?
 * - **Konten:** wer existiert auf diesem Server überhaupt?
 *
 * ## Hier gibt es kein Suchfeld mit Grenze
 *
 * Anders als bei „Leute", und der Unterschied ist der Grund für die Grenze
 * dort: sie soll verhindern, dass ein Arbeitsbereichseigentümer das
 * Instanzverzeichnis **liest**. Wer diesen Bildschirm sehen darf, verwaltet die
 * Instanz — für den *ist* die Liste das Verzeichnis, und sie zu erschweren wäre
 * eine Hürde ohne Gewinn.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { NotFound, OutOfOrder } from './tasks.js';

export interface Account {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: Date;
  /** In wie vielen Arbeitsbereichen — die Zahl, die „ist das Konto in Gebrauch" beantwortet. */
  workspaces: number;
}

export async function accounts(pool: Pool): Promise<Account[]> {
  const rows = await queryRows<{
    id: string;
    email: string;
    display_name: string;
    is_admin: boolean;
    created_at: Date;
    spaces: string;
  }>(
    pool,
    `SELECT u.id, u.email, u.display_name, u.is_admin, u.created_at,
            (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id) AS spaces
       FROM users u
      -- Administratoren zuerst, dann nach Namen: wer verwaltet, ist die
      -- Auskunft, für die man diese Liste öffnet.
      ORDER BY u.is_admin DESC, u.display_name`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    isAdmin: r.is_admin,
    createdAt: r.created_at,
    workspaces: Number(r.spaces),
  }));
}

/**
 * Jemanden zum Administrator machen — oder es ihm nehmen.
 *
 * **Nicht den letzten.** Dieselbe Regel wie beim letzten Eigentümer eines
 * Arbeitsbereichs, und aus demselben Grund: eine Instanz ohne Administrator
 * ist eine, in der niemand mehr Konten verwaltet, und das lässt sich von innen
 * nicht heilen — nur noch über die Datenbank.
 *
 * **Auch sich selbst nicht**, und das ist derselbe Fall: wer sich das Recht
 * nimmt, während er der letzte ist, sperrt sich aus. Die Prüfung fragt darum
 * nicht „bist du das", sondern zählt — die Frage nach der Person wäre eine
 * Bedingung, die den Fall „zwei Administratoren, einer nimmt sich das Recht"
 * fälschlich verbietet.
 */
export async function setAdmin(pool: Pool, userId: string, admin: boolean): Promise<void> {
  const wer = await queryOne<{ is_admin: boolean; admins: string }>(
    pool,
    `SELECT u.is_admin,
            (SELECT count(*) FROM users a WHERE a.is_admin) AS admins
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (wer === undefined) throw new NotFound('dieses Konto gibt es nicht');
  if (!admin && wer.is_admin && Number(wer.admins) <= 1) {
    throw new OutOfOrder(
      'der letzte Administrator kann das Recht nicht abgeben — sonst verwaltet niemand mehr',
    );
  }
  await pool.query('UPDATE users SET is_admin = $2 WHERE id = $1', [userId, admin]);
}

/**
 * Ein Konto löschen.
 *
 * **Nur, wenn es nirgends mitarbeitet.** Ein Konto zu löschen, das Mitglied
 * ist, hieße zu entscheiden, was mit seinen Aufgaben passiert — und das ist
 * eine Frage an den Arbeitsbereich und nicht an die Instanz. Wer jemanden
 * loswerden will, nimmt ihn erst aus seinen Arbeitsbereichen; dann sagt diese
 * Route, was übrig ist.
 *
 * Das ist bewusst unbequem. Die bequeme Fassung wäre eine, die Aufgaben und
 * Erledigungen still verwaisen lässt — und still ist bei Löschen das falsche
 * Wort.
 */
export async function deleteAccount(pool: Pool, userId: string): Promise<void> {
  const wer = await queryOne<{ is_admin: boolean; spaces: string; admins: string }>(
    pool,
    `SELECT u.is_admin,
            (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id) AS spaces,
            (SELECT count(*) FROM users a WHERE a.is_admin) AS admins
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (wer === undefined) throw new NotFound('dieses Konto gibt es nicht');
  if (Number(wer.spaces) > 0) {
    throw new OutOfOrder(
      'dieses Konto arbeitet noch in einem Arbeitsbereich mit — dort zuerst entfernen',
    );
  }
  if (wer.is_admin && Number(wer.admins) <= 1) {
    throw new OutOfOrder('der letzte Administrator kann nicht gelöscht werden');
  }
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}
