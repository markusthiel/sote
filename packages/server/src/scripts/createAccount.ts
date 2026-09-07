/**
 * SOTE — ein Konto anlegen.
 *
 * Es gibt noch keine Einladung, also braucht das erste Konto einen Weg. Dass
 * der Weg ein Skript ist, ist Absicht: eine Anmeldemaske, die beim ersten
 * Aufruf ein Konto anlegt, ist eine Anmeldemaske, die das auch beim
 * tausendsten kann, wenn eine Bedingung einmal falsch steht.
 *
 * Das Kennwort kommt aus der Umgebung und nicht aus einem Argument:
 * Kommandozeilen landen in der Shell-Geschichte und in `ps`.
 *
 *   SOTE_DATABASE_URL=… SOTE_NEW_PASSWORD=… \
 *     node packages/server/dist/scripts/createAccount.js m@example.org "Markus Thiel"
 */

import { setPassword } from '../auth.js';
import { makePool, queryOne, withTransaction } from '../db.js';
import { loadConfig } from '../env.js';

const [email, displayName, workspaceName = 'Mein Arbeitsbereich'] = process.argv.slice(2);
const password = process.env['SOTE_NEW_PASSWORD'];

if (email === undefined || displayName === undefined) {
  console.error(
    'Aufruf: createAccount <e-mail> <name> [arbeitsbereich]\n' +
      'Das Kennwort kommt aus SOTE_NEW_PASSWORD.',
  );
  process.exit(2);
}
if (password === undefined || password.length < 8) {
  console.error('SOTE_NEW_PASSWORD fehlt oder ist kürzer als acht Zeichen.');
  process.exit(2);
}

const pool = makePool(loadConfig().databaseUrl);

const existing = await queryOne<{ id: string }>(
  pool,
  'SELECT id FROM users WHERE lower(email) = lower($1)',
  [email],
);
if (existing !== undefined) {
  // Kein stilles Überschreiben: ein Skript, das ein Kennwort ersetzt, ohne es
  // zu sagen, ist ein Skript, mit dem man jemanden aussperrt.
  console.error(
    `${email} gibt es schon. Zum Ändern des Kennworts gibt es noch kein Werkzeug.`,
  );
  await pool.end();
  process.exit(1);
}

const userId = await withTransaction(pool, async (client) => {
  const user = await queryOne<{ id: string }>(
    client,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [email, displayName],
  );
  if (user === undefined) throw new Error('INSERT ohne Zeile');

  const workspace = await queryOne<{ id: string }>(
    client,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [workspaceName],
  );
  if (workspace === undefined) throw new Error('INSERT ohne Zeile');

  // Die vier Systemrollen aus SONE, gleiche Bedeutung: `list_level = NULL`
  // heißt wirklich nichts — wer eine Rolle ohne Stufe bekommt, ist Gast
  // (ADR-0110).
  const roles: [name: string, level: string | null, rights: string[]][] = [
    ['owner', 'admin', ['people.manage', 'roles.manage', 'groups.manage']],
    ['admin', 'admin', ['people.manage', 'roles.manage', 'groups.manage']],
    ['member', 'editor', []],
    ['guest', null, []],
  ];
  let ownerRole: string | undefined;
  for (const [name, level, rights] of roles) {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO roles (workspace_id, name, list_level, rights)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [workspace.id, name, level, rights],
    );
    if (name === 'owner') ownerRole = row?.id;
  }
  if (ownerRole === undefined) throw new Error('owner-Rolle fehlt');

  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [workspace.id, user.id, ownerRole],
  );
  return user.id;
});

await setPassword(pool, userId, password);
await pool.end();

console.log(`Konto ${email} angelegt, Arbeitsbereich „${workspaceName}".`);
