/** SOTE — Datenbankzugang. */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type { PoolClient };

const transactionClients = new WeakMap<Pool, PoolClient>();
/** Fachfunktionen in dieselbe äußere Transaktion einbinden, ohne zweiten COMMIT. */
export async function atomic<T>(pool: Pool, body: (scope: Pool) => Promise<T>): Promise<T> {
  return withTransaction(pool, async client => {
    const scope = Object.create(pool) as Pool;
    scope.query = client.query.bind(client) as Pool['query'];
    transactionClients.set(scope, client);
    try { return await body(scope); } finally { transactionClients.delete(scope); }
  });
}

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
  const nested = transactionClients.get(pool);
  if (nested) {
    // Fachfunktionen dürfen ihre Sortierkollision innerhalb der äußeren
    // Transaktion wiederholen. Ein SAVEPOINT setzt dafür den Fehlerzustand zurück.
    await nested.query('SAVEPOINT integration_nested');
    try {
      const result = await body(nested);
      await nested.query('RELEASE SAVEPOINT integration_nested');
      return result;
    } catch (e) {
      await nested.query('ROLLBACK TO SAVEPOINT integration_nested');
      await nested.query('RELEASE SAVEPOINT integration_nested');
      throw e;
    }
  }
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
