/**
 * SOTE — Freigaben: ein Link auf ein Projekt.
 *
 * Konzept 10e, und die Entscheidungen dort sind mit Markus abgestimmt.
 *
 * ## Wo der Schlüssel liegt, und warum das die eigentliche Frage war
 *
 * Beschlossen war „verschlüsselt, nicht gehasht" (SONEs ADR-0113: der Link
 * behält den Link). Beim Bauen fällt auf, was in der Abwägung nicht stand:
 * **läge der Schlüssel in derselben Datenbank wie die Tokens, wäre die
 * Verschlüsselung Theater** — wer die Tabelle liest, liest den Schlüssel
 * daneben.
 *
 * Der Schlüssel kommt darum aus der **Umgebung** (`SOTE_SHARE_KEY`, 32 Bytes
 * hex oder base64). Damit ist klar, wogegen die Verschlüsselung schützt und
 * wogegen nicht:
 *
 * - **Nicht** gegen jemanden, der Datenbank *und* Umgebung hat. Der hat die
 *   Aufgaben ohnehin, und dafür ist ein Token nicht nötig.
 * - **Doch** gegen eine Sicherung, einen Datenbankauszug, ein Protokoll — also
 *   gegen die Kopien, die weiter herumkommen als die laufende Anwendung. Genau
 *   da liegt ein Token in Klartext falsch.
 *
 * ## Ohne Schlüssel gibt es keine Freigaben, und das wird gesagt
 *
 * Nicht „still keine": eine Einstellung für eine Sache, die nicht wirkt, ist
 * der Fehler, den SONE vierzehn Mal hatte (ADR-0112) — der Betreiber füllt
 * etwas aus, es passiert nichts, und nichts sagt warum. Hier ist es umgekehrt
 * herum dieselbe Regel: fehlt der Schlüssel, antwortet die Route mit einem
 * Satz, der sagt, welche Variable fehlt.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows } from './db.js';
import { NotFound, OutOfOrder } from './tasks.js';

export type RightLevel = 'read' | 'edit';

export interface ShareRow {
  id: string;
  workspace_id: string;
  project_id: string;
  right_level: RightLevel;
  token_enc: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, workspace_id, project_id, right_level, token_enc,
  expires_at, revoked_at, last_used_at, created_at`;

/** Der Schlüssel fehlt — mit dem Namen der Variable, die ihn liefern würde. */
export class NoShareKey extends OutOfOrder {
  constructor() {
    super(
      'Freigaben brauchen einen Schlüssel: SOTE_SHARE_KEY (32 Bytes, hex oder base64)',
    );
  }
}

function key(): Buffer {
  const raw = process.env['SOTE_SHARE_KEY'] ?? '';
  if (raw === '') throw new NoShareKey();
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new NoShareKey();
  return buf;
}

/** Ob Freigaben überhaupt gehen — für eine Antwort, die das sagen kann. */
export function shareKeyPresent(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/*
 * AES-256-GCM, und der Zufallswert steht vorn.
 *
 * GCM und nicht CBC, weil eine veränderte Zeile auffallen soll: ohne
 * Authentifizierung wäre ein zusammengesetzter Geheimtext ein Token, das
 * entschlüsselt und nicht stimmt — und dann müsste eine Stelle weiter oben
 * entscheiden, was das bedeutet.
 */
function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function open(sealed: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[0]!, 'base64'));
    d.setAuthTag(Buffer.from(parts[1]!, 'base64'));
    return Buffer.concat([d.update(Buffer.from(parts[2]!, 'base64')), d.final()]).toString('utf8');
  } catch {
    // Falscher Schlüssel oder veränderte Zeile. `null` und nicht ein Fehler:
    // die Oberfläche soll sagen „diesen Link können wir nicht mehr anzeigen"
    // und nicht abstürzen — die Freigabe selbst gilt weiter, und widerrufen
    // lässt sie sich auch ohne ihren Klartext.
    return null;
  }
}

const digest = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Ein neuer Link.
 *
 * 32 Bytes aus `randomBytes`, base64url — kein zählbarer Wert und keine Id, die
 * anderswo etwas bedeutet. Ein Token, das aus einer Projekt-Id abgeleitet wäre,
 * wäre ein Token, das man errät, sobald man eine Id kennt.
 */
export async function createShare(
  pool: Pool,
  input: {
    workspaceId: string;
    projectId: string;
    right: RightLevel;
    userId: string;
    expiresAt?: Date | null;
  },
): Promise<{ share: ShareRow; token: string }> {
  const token = randomBytes(32).toString('base64url');
  try {
    const row = await queryOne<ShareRow>(
      pool,
      `INSERT INTO shares
         (workspace_id, project_id, right_level, token_hash, token_enc, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${COLUMNS}`,
      [
        input.workspaceId,
        input.projectId,
        input.right,
        digest(token),
        seal(token),
        input.expiresAt ?? null,
        input.userId,
      ],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');
    return { share: row, token };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === '23514') {
      throw new OutOfOrder(err.message ?? 'das geht an dieser Stelle nicht');
    }
    if (err.code === '23503') {
      throw new NotFound('dieses Projekt gibt es hier nicht');
    }
    throw e;
  }
}

/** Was hinausgegeben ist — mit dem Klartext, damit man ihn wieder zeigen kann. */
export async function listShares(
  q: Pool | PoolClient,
  workspaceId: string,
): Promise<(ShareRow & { token: string | null; projectName: string })[]> {
  const rows = await queryRows<ShareRow & { project_name: string }>(
    q,
    `SELECT ${COLUMNS.split(',').map((c) => `s.${c.trim()}`).join(', ')}, p.name AS project_name
       FROM shares s JOIN projects p ON p.id = s.project_id
      WHERE s.workspace_id = $1 AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => ({ ...r, token: open(r.token_enc), projectName: r.project_name }));
}

/** Widerrufen: sofort und endgültig. */
export async function revokeShare(
  pool: Pool,
  id: string,
  workspaceId: string,
): Promise<void> {
  const res = await pool.query(
    `UPDATE shares SET revoked_at = now()
      WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
    [id, workspaceId],
  );
  if (res.rowCount === 0) {
    throw new NotFound('diese Freigabe gibt es nicht oder ist schon widerrufen');
  }
}

/**
 * Was ein Link darf.
 *
 * **Die Bedingung fragt selbst** — SONEs Regel aus ADR-0087, die dort dreimal
 * die Antwort war: *ein Parameter, den jeder Aufrufer richtig berechnen muss,
 * ist ein Parameter, den ein Aufrufer falsch berechnet.* Kein Aufrufer bekommt
 * ein `mayEdit` übergeben; jeder fragt hier.
 *
 * Widerruf und Ablauf werden **in derselben Abfrage** geprüft und nicht danach:
 * eine Zeile zu holen und dann zu entscheiden, ob sie noch gilt, ist zwei
 * Schritte, und der zweite lässt sich vergessen.
 *
 * Der Zeitstempel „zuletzt benutzt" wird beim Nachschlagen gesetzt, nicht beim
 * Ändern: eine Freigabe, die jemand nur liest, ist benutzt.
 */
export async function accessByToken(
  pool: Pool,
  token: string,
): Promise<{ shareId: string; workspaceId: string; projectId: string; right: RightLevel } | null> {
  if (token.length < 20 || token.length > 200) return null;
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    project_id: string;
    right_level: RightLevel;
  }>(
    pool,
    `UPDATE shares SET last_used_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        -- Auch der Pfad muss leben: liegt der Ordner über dem Projekt im
        -- Papierkorb, ist das Projekt nicht zu sehen — für Mitglieder nicht,
        -- und für einen Link erst recht nicht.
        AND NOT project_in_trash(project_id)
      RETURNING id, workspace_id, project_id, right_level`,
    [digest(token)],
  );
  if (row === undefined) return null;
  return {
    shareId: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    right: row.right_level,
  };
}
