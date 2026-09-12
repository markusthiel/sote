/**
 * SOTE — Einladungen.
 *
 * **Die Instanz lädt ein** (SONEs ADR-0073). Wer schon ein Konto hat, wird
 * unter „Leute" in einen Arbeitsbereich geholt; wer noch keines hat, braucht
 * eines, und darüber entscheidet die Instanz. Eine Einladung hängt darum an
 * keinem Arbeitsbereich.
 *
 * ## Der Token reist nie in der Anfrage
 *
 * SONEs ADR-0126, und die Begründung ist die schärfste in diesem Bereich:
 *
 * > A route that accepted a URL to mail would be **a route that mails any URL,
 * > from an authenticated account, to anywhere**. That is a small open relay
 * > with this instance's name on the envelope, and it would have looked like
 * > the obvious way to write it, because the browser has the URL on screen.
 *
 * Also: der Browser schickt eine **Adresse**, der Server baut den Link selbst
 * und verschickt ihn. Ein Test auf jeder Seite hält das fest — die eine, die
 * versucht wäre, die URL mitzuschicken, ist die Oberfläche, weil sie sie schon
 * anzeigt.
 *
 * ## Woher der Server seine eigene Adresse kennt
 *
 * Aus `SOTE_BASE_URL`, und wenn die fehlt, wird **keine Mail verschickt** —
 * mit einem Satz, der sagt, welche Variable fehlt. Die Alternative wäre, sie
 * aus der Anfrage zu nehmen (`Host`-Kopfzeile), und das ist eine Angabe des
 * Aufrufers: wer sie fälscht, lässt diesen Server Einladungslinks auf einen
 * fremden Namen verschicken.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { baseUrl } from './env.js';

/* Weiterhin von hier zu haben: die Einladungen benutzen sie am meisten. */
export { baseUrl };
import { queryOne, queryRows } from './db.js';
import { queueMail } from './mail.js';
import { seal, unseal } from './secretbox.js';
import { NotFound, OutOfOrder } from './tasks.js';

/** Wie lange eine Einladung gilt. Sieben Tage: lang genug für einen Urlaub. */
const DAYS = 7;

const digest = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface Invitation {
  id: string;
  email: string;
  token: string | null;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
}

/** Die eigene Adresse, oder nichts. */

export async function listInvitations(pool: Pool): Promise<Invitation[]> {
  const rows = await queryRows<{
    id: string;
    email: string;
    token_enc: string;
    expires_at: Date;
    created_at: Date;
    accepted_at: Date | null;
  }>(
    pool,
    `SELECT id, email, token_enc, expires_at, created_at, accepted_at
       FROM invitations
      WHERE revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    token: unseal(r.token_enc),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
  }));
}

/**
 * Einladen.
 *
 * **Wer schon ein Konto hat, wird abgelehnt** — mit dem Hinweis, wo die
 * richtige Frage steht. Eine zweite Einladung an eine bestehende Adresse wäre
 * ein Link, der ein Konto anlegen will, das es gibt, und der beim Einlösen
 * fehlschlägt: ein Fehler, der eine Woche später bei jemand anderem auftritt.
 */
export async function invite(
  pool: Pool,
  email: string,
  userId: string,
  now: Date,
): Promise<{ id: string; token: string; mailed: boolean }> {
  const adresse = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse)) {
    throw new OutOfOrder('das sieht nicht wie eine E-Mail-Adresse aus');
  }
  const da = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE email = $1', [
    adresse,
  ]);
  if (da !== undefined) {
    throw new OutOfOrder(
      'dieses Konto gibt es schon — in einen Arbeitsbereich holst du es unter „Leute"',
    );
  }

  const token = randomBytes(32).toString('base64url');
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invitations (email, token_hash, token_enc, expires_at, invited_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      adresse,
      digest(token),
      seal(token),
      new Date(now.getTime() + DAYS * 86_400_000),
      userId,
    ],
  );

  /*
   * Der Link wird HIER gebaut, aus der eigenen Adresse (ADR-0126).
   *
   * Und wenn die fehlt, wird nichts verschickt — die Einladung gilt trotzdem
   * und steht mit ihrem Link in der Liste, zum Weitergeben von Hand. Das ist
   * die ehrliche Aufteilung: der Vorgang ist eine Sache, die Mail eine andere.
   */
  const base = baseUrl();
  if (base !== undefined) {
    await queueMail(pool, {
      to: adresse,
      subject: 'Du bist zu SOTE eingeladen',
      text: [
        'Jemand hat dich zu SOTE eingeladen — einer Aufgabenverwaltung.',
        '',
        `Mit diesem Link legst du dein Konto an:`,
        `${base}/einladung/${token}`,
        '',
        `Der Link gilt ${DAYS} Tage.`,
        '',
        'Wenn du damit nichts zu tun hast, kannst du diese Mail wegwerfen —',
        'ohne den Link passiert nichts.',
      ].join('\n'),
    });
  }

  return { id: row!.id, token, mailed: base !== undefined };
}

export async function revokeInvitation(pool: Pool, id: string): Promise<void> {
  const res = await pool.query(
    'UPDATE invitations SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id],
  );
  if (res.rowCount === 0) {
    throw new NotFound('diese Einladung gibt es nicht oder ist schon zurückgenommen');
  }
}

/**
 * Was hinter einem Einladungslink steht.
 *
 * **Ein Satz für alle Fälle**, wie bei Freigaben und aus demselben Grund: hier
 * fragt ein Fremder, und „abgelaufen" gegen „zurückgenommen" gegen „gibt es
 * nicht" wäre eine Auskunft darüber, ob ein geratener Token einmal gültig war.
 */
export async function openInvitation(
  pool: Pool,
  token: string,
  now: Date,
): Promise<{ id: string; email: string } | null> {
  if (token.length < 20 || token.length > 200) return null;
  const row = await queryOne<{ id: string; email: string }>(
    pool,
    // Alle drei Bedingungen in DERSELBEN Abfrage: eine Zeile zu holen und dann
    // zu entscheiden, ob sie noch gilt, sind zwei Schritte, und der zweite
    // lässt sich vergessen.
    `SELECT id, email FROM invitations
      WHERE token_hash = $1
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > $2`,
    [digest(token), now],
  );
  return row ?? null;
}
