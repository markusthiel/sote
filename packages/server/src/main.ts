/** SOTE — Serverstart. */

import { makePool } from './db.js';
import { loadConfig } from './env.js';
import { migrate } from './migrate.js';
import { makeServer } from './routes.js';

const config = loadConfig();
const pool = makePool(config.databaseUrl);

const ran = await migrate(pool);
if (ran.length > 0) console.log(`migriert: ${ran.join(', ')}`);

const server = makeServer({ pool, config, now: () => new Date() });
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
