/**
 * SOTE — Anmeldung.
 *
 * scrypt aus Nodes eigener Kryptografie, kein Fremdpaket. Sitzungen liegen in
 * der Datenbank: eine Abmeldung, die nur der Browser kennt, ist keine — und ein
 * signierter Keks lässt sich nicht zurückziehen.
 *
 * Im Keks steht ein Zufallswert, in der Datenbank nur sein Hash. Wer die
 * Tabelle liest, kann sich damit nicht anmelden.
 */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { Pool } from 'pg';

import { queryOne, type PoolClient } from './db.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

export async function setPassword(
  pool: Pool,
  userId: string,
  password: string,
): Promise<void> {
  await setPasswordIn(pool, userId, password);
}

/**
 * Dasselbe auf einer vorhandenen Verbindung.
 *
 * Damit das Anlegen eines Kontos **eine** Transaktion sein kann: ein Konto ohne
 * Kennwort ist ein Konto, in das niemand kommt, und ein halb angelegtes Konto
 * ist ein Fall, den man nur von Hand aufräumt.
 */
export async function setPasswordIn(
  q: Pool | PoolClient,
  userId: string,
  password: string,
): Promise<void> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  await q.query(
    `INSERT INTO user_passwords (user_id, salt, hash) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET salt = EXCLUDED.salt,
       hash = EXCLUDED.hash, set_at = now()`,
    [userId, salt, hash],
  );
}

export interface Session {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Anmelden.
 *
 * Ein unbekanntes Konto und ein falsches Kennwort geben dieselbe Antwort und
 * brauchen ungefähr dieselbe Zeit: sonst ist die Anmeldemaske ein Verzeichnis,
 * wer auf diesem Server ein Konto hat.
 */
export async function signIn(
  pool: Pool,
  email: string,
  password: string,
  sessionDays: number,
  now: Date,
): Promise<Session | null> {
  const row = await queryOne<{ id: string; salt: Buffer; hash: Buffer }>(
    pool,
    `SELECT u.id, p.salt, p.hash
       FROM users u JOIN user_passwords p ON p.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );

  // Auch ohne Treffer wird gerechnet, damit die Antwortzeit nichts verrät.
  const salt = row?.salt ?? randomBytes(16);
  const expected = row?.hash ?? randomBytes(KEY_LEN);
  const got = await scrypt(password, salt, KEY_LEN);
  const ok =
    row !== undefined &&
    expected.length === got.length &&
    timingSafeEqual(expected, got);
  if (!ok) return null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + sessionDays * 86_400_000);
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [row.id, hashToken(token), expiresAt],
  );
  return { token, userId: row.id, expiresAt };
}

export async function userOfToken(
  pool: Pool,
  token: string,
  now: Date,
): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    pool,
    `UPDATE sessions SET last_seen = $3
      WHERE token_hash = $1 AND expires_at > $2
     RETURNING user_id`,
    [hashToken(token), now, now],
  );
  return row?.user_id ?? null;
}

export async function signOut(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}
