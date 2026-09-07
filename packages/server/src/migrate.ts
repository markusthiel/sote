/**
 * SOTE — Migrationen ausführen.
 *
 * Reihenfolge nach Dateiname, eine Zeile pro gelaufener Datei, und **jede in
 * ihrer eigenen Transaktion**: eine halb gelaufene Migration ist schlimmer als
 * eine, die gar nicht gelaufen ist.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

import { makePool, queryRows, withTransaction } from './db.js';
import { loadConfig } from './env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

export async function migrate(pool: Pool, dir = MIGRATIONS): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name      text PRIMARY KEY,
      sha256    text NOT NULL,
      ran_at    timestamptz NOT NULL DEFAULT now()
    )`);

  const done = new Map(
    (
      await queryRows<{ name: string; sha256: string }>(
        pool,
        'SELECT name, sha256 FROM schema_migrations',
      )
    ).map((r) => [r.name, r.sha256]),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    const before = done.get(file);
    if (before !== undefined) {
      // Eine gelaufene Migration wird nicht bearbeitet, sondern ergänzt. Wer
      // sie doch ändert, soll es hier erfahren und nicht an einer Spalte, die
      // in einer Umgebung fehlt.
      if (before !== sha) {
        throw new Error(
          `${file} hat sich seit dem Lauf geändert — neue Migration anlegen, nicht diese ändern`,
        );
      }
      continue;
    }
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)',
        [file, sha],
      );
    });
    ran.push(file);
  }
  return ran;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = makePool(loadConfig().databaseUrl);
  const ran = await migrate(pool);
  console.log(ran.length === 0 ? 'nichts zu migrieren' : `gelaufen: ${ran.join(', ')}`);
  await pool.end();
}
