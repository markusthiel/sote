/**
 * SOTE — Migrationen ausführen.
 *
 * Reihenfolge nach Dateiname, eine Zeile pro gelaufener Datei, und **jede in
 * ihrer eigenen Transaktion**: eine halb gelaufene Migration ist schlimmer als
 * eine, die gar nicht gelaufen ist.
 *
 * **Und einer nach dem anderen, über einen Advisory Lock.** Gefunden in der CI,
 * nicht hier: `pnpm -r test` fährt die Testdateien **parallel**, jede ruft
 * `migrate` auf, und mehrere führten 0001 gleichzeitig aus. Postgres antwortet
 * dann mit `duplicate key value violates unique constraint
 * "pg_type_typname_nsp_index"` — `CREATE TYPE` und `CREATE EXTENSION IF NOT
 * EXISTS` sind gegen Nebenläufigkeit nicht sicher, und `IF NOT EXISTS` prüft
 * vorher und schreibt danach.
 *
 * Lokal fiel es nie auf, weil ich die Dateien einzeln gefahren habe. Und es ist
 * nicht bloß ein Testproblem: **zwei Container, die gleichzeitig starten,
 * migrieren gleichzeitig.** Der Lock gehört also hierhin und nicht in ein
 * Testskript.
 *
 * Der Schlüssel ist eine willkürliche, aber feste Zahl. Sitzungsweit und nicht
 * transaktionsweit, weil jede Migration ihre eigene Transaktion hat und der
 * Lock über alle halten muss.
 */

/** Willkürlich, aber fest: „SOTE" als Zahl. */
const MIGRATION_LOCK = 0x50a7e_001;

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
  // Eine eigene Verbindung für den Lock: er ist sitzungsweit, also muss dieselbe
  // Verbindung ihn halten, bis alles durch ist. Aus dem Pool geholte Clients
  // für die einzelnen Transaktionen können beliebige andere sein.
  const gate = await pool.connect();
  try {
    await gate.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    return await run(pool, dir);
  } finally {
    // Auch bei einem Fehlschlag: ein gehaltener Lock lässt jeden weiteren Start
    // stumm warten, und das sieht aus wie ein hängender Server.
    await gate.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    gate.release();
  }
}

async function run(pool: Pool, dir: string): Promise<string[]> {
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
