/** SOTE — Serverstart. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SetupKey } from './bootstrap.js';
import { makePool } from './db.js';
import { loadConfig } from './env.js';
import { migrate } from './migrate.js';
import { makeServer } from './routes.js';

const config = loadConfig();
const pool = makePool(config.databaseUrl);

const ran = await migrate(pool);
if (ran.length > 0) console.log(`migriert: ${ran.join(', ')}`);

// Die gebaute Oberfläche, falls sie da ist. Ohne sie ist SOTE eine API und
// sagt das auch, statt auf jeden Pfad 404 zu antworten.
const here = dirname(fileURLToPath(import.meta.url));
const candidate = join(here, '..', '..', 'web', 'dist');
const webRoot = existsSync(join(candidate, 'index.html')) ? candidate : undefined;
if (webRoot === undefined) console.log('keine Oberfläche gefunden — nur API');

/*
 * Solange es kein Konto gibt, steht der Einrichtungsschlüssel im Protokoll.
 *
 * Ins Protokoll und nicht in eine Datei: `docker compose logs server` ist der
 * eine Ort, an dem jemand nach einem ersten Start ohnehin nachsieht. Und
 * auffällig, weil eine Zeile zwischen Migrationsmeldungen keine ist.
 */
const setup = new SetupKey();
const key = await setup.openIfEmpty(pool);
if (key !== null) {
  console.log(
    [
      '',
      '  ┌─ Einrichtung ────────────────────────────────────────────',
      '  │  Es gibt noch kein Konto. Öffne SOTE im Browser und gib',
      '  │  diesen Schlüssel ein:',
      '  │',
      `  │      ${key}`,
      '  │',
      '  │  Er gilt für dieses eine Konto und verfällt beim Neustart.',
      '  └──────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

const server = makeServer({ pool, config, now: () => new Date(), webRoot, setup });
server.listen(config.port, () => {
  console.log(`SOTE hört auf :${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
