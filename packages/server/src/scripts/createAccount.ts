/**
 * SOTE — ein Konto anlegen, von der Kommandozeile.
 *
 * Seit dem Einrichtungsbildschirm nicht mehr der Weg für das **erste** Konto —
 * dafür genügt ein Blick in `docker compose logs`. Dieses Skript bleibt für
 * alles, wofür es keinen Bildschirm gibt: ein zweites Konto, solange es keine
 * Einladungen gibt, und Automatisierung.
 *
 * Das Kennwort kommt aus der Umgebung und nicht aus einem Argument:
 * Kommandozeilen landen in der Shell-Geschichte und in `ps`.
 *
 *   SOTE_DATABASE_URL=… SOTE_NEW_PASSWORD=… \
 *     node packages/server/dist/scripts/createAccount.js m@example.org "Markus Thiel"
 */

import { createAccount } from '../bootstrap.js';
import { makePool } from '../db.js';
import { loadConfig } from '../env.js';

const [email, displayName, workspaceName] = process.argv.slice(2);
const password = process.env['SOTE_NEW_PASSWORD'];

if (email === undefined || displayName === undefined) {
  console.error(
    'Aufruf: createAccount <e-mail> <name> [arbeitsbereich]\n' +
      'Das Kennwort kommt aus SOTE_NEW_PASSWORD.',
  );
  process.exit(2);
}
if (password === undefined) {
  console.error('SOTE_NEW_PASSWORD fehlt.');
  process.exit(2);
}

const pool = makePool(loadConfig().databaseUrl);
try {
  await createAccount(pool, {
    email,
    displayName,
    password,
    ...(workspaceName === undefined ? {} : { workspaceName }),
  });
  console.log(
    `Konto ${email} angelegt, Arbeitsbereich „${workspaceName ?? 'Mein Arbeitsbereich'}".`,
  );
} catch (e) {
  // Der Grund kommt aus `bootstrap.ts` und wird nicht in „ging nicht" übersetzt.
  console.error((e as Error).message);
  await pool.end();
  process.exit(1);
}
await pool.end();
