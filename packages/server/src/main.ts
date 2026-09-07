/** SOTE — Serverstart. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const server = makeServer({ pool, config, now: () => new Date(), webRoot });
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
