/** SOTE — Datenbankzugang. */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type { PoolClient };

export function makePool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

export async function queryRows<T extends QueryResultRow>(
  q: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await q.query<T>(sql, params as unknown[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow>(
  q: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryRows<T>(q, sql, params);
  return rows[0];
}

/**
 * Eine Transaktion, und der Fehler rollt sie zurück.
 *
 * Wird von jeder Stelle benutzt, die mehr als eine Zeile schreibt — der
 * teuerste Fehler in SONE war eine Projektion, die mitten in einer Transaktion
 * warf und alles mitnahm (ADR-0092). Zwei Schreibzugriffe ohne Transaktion sind
 * dieselbe Klasse Fehler von der anderen Seite.
 */
export async function withTransaction<T>(
  pool: Pool,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await body(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
