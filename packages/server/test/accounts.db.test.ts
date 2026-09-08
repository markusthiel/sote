/**
 * SOTE — Konten, und wer die Instanz verwaltet.
 *
 * Die Regel, die hier zweimal vorkommt und beide Male dieselbe ist: **der
 * letzte kann nicht gehen.** Eine Instanz ohne Administrator lässt sich von
 * innen nicht heilen, nur noch über die Datenbank.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { accounts, deleteAccount, setAdmin } from '../src/accounts.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { isAdmin, mayChange } from '../src/settings.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;

const mk = async (email: string, name: string, admin = false): Promise<string> => {
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name, is_admin) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name,
                                       is_admin = EXCLUDED.is_admin
     RETURNING id`,
    [email, name, admin],
  );
  return u!.id;
};

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  // Alle Administratorenrechte einsammeln, damit die Zählung dieses Laufs
  // nicht von der Migration abhängt: sie setzt das älteste Konto, und welches
  // das ist, entscheidet die Reihenfolge der anderen Testdateien.
  await pool.query('UPDATE users SET is_admin = false');
});

after(async () => {
  await pool.end();
});

test('wer die Instanz verwaltet, steht am Konto und nicht am Arbeitsbereich', async () => {
  /*
   * Die Lücke, die in `settings.ts` als Kommentar stand: vorher durfte
   * Instanzeinstellungen ändern, wer irgendeinen Arbeitsbereich besitzt — also
   * konnte jeder Eigentümer Vorgaben für **alle anderen** setzen.
   */
  const chef = await mk('chef@example.org', 'Chefin', true);
  const wer = await mk('wer@example.org', 'Wer Anders');

  const w = await queryOne<{ id: string }>(
    pool,
    "INSERT INTO workspaces (name) VALUES ('a-eigen') RETURNING id",
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor') RETURNING id`,
    [w!.id],
  );
  // „Wer Anders" BESITZT diesen Arbeitsbereich — und darf die Instanz trotzdem
  // nicht ändern.
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [w!.id, wer, r!.id],
  );

  assert.equal(await mayChange(pool, 'instance', wer, w!.id), false);
  assert.equal(await mayChange(pool, 'workspace', wer, w!.id), true, 'seinen eigenen schon');
  assert.equal(await mayChange(pool, 'instance', chef, w!.id), true);
  // Und der Administrator ist NICHT automatisch Verwalter fremder
  // Arbeitsbereiche: zwei Rechte, zwei Fragen.
  assert.equal(await mayChange(pool, 'workspace', chef, w!.id), false);
});

test('der letzte Administrator kann das Recht nicht abgeben', async () => {
  await pool.query('UPDATE users SET is_admin = false');
  const chef = await mk('chef@example.org', 'Chefin', true);
  await assert.rejects(() => setAdmin(pool, chef, false), OutOfOrder);
  assert.equal(await isAdmin(pool, chef), true);
});

test('mit zwei Administratoren darf einer gehen — auch er selbst', async () => {
  /*
   * Die Prüfung fragt nicht „bist du das", sondern zählt. „Bist du das" würde
   * den Fall „zwei Administratoren, einer nimmt sich das Recht" fälschlich
   * verbieten — und das ist der gewöhnliche Weg, ein Recht abzugeben.
   */
  await pool.query('UPDATE users SET is_admin = false');
  const a = await mk('chef@example.org', 'Chefin', true);
  const b = await mk('zwei@example.org', 'Zweiter', true);
  await setAdmin(pool, a, false);
  assert.equal(await isAdmin(pool, a), false);
  assert.equal(await isAdmin(pool, b), true);
});

test('ein Konto, das noch mitarbeitet, wird nicht gelöscht', async () => {
  /*
   * Es zu löschen hieße zu entscheiden, was mit seinen Aufgaben passiert — und
   * das ist eine Frage an den Arbeitsbereich, nicht an die Instanz. Bewusst
   * unbequem: die bequeme Fassung ließe Aufgaben still verwaisen, und still ist
   * bei Löschen das falsche Wort.
   */
  await pool.query('UPDATE users SET is_admin = false');
  await mk('chef@example.org', 'Chefin', true);
  const drin = await mk('drin@example.org', 'Ist Drin');
  const w = await queryOne<{ id: string }>(
    pool,
    "INSERT INTO workspaces (name) VALUES ('a-drin') RETURNING id",
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor') RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id) VALUES ($1,$2,$3)`,
    [w!.id, drin, r!.id],
  );
  await assert.rejects(() => deleteAccount(pool, drin), OutOfOrder);

  // Ohne Mitgliedschaft geht es.
  await pool.query('DELETE FROM workspace_members WHERE user_id = $1', [drin]);
  await deleteAccount(pool, drin);
  assert.equal((await accounts(pool)).some((a) => a.id === drin), false);
});

test('ein Konto, das es nicht gibt', async () => {
  await assert.rejects(
    () => setAdmin(pool, '00000000-0000-4000-8000-000000000000', true),
    NotFound,
  );
  await assert.rejects(
    () => deleteAccount(pool, '00000000-0000-4000-8000-000000000000'),
    NotFound,
  );
});

test('die Liste nennt Administratoren zuerst und zählt Arbeitsbereiche', async () => {
  await pool.query('UPDATE users SET is_admin = false');
  await mk('chef@example.org', 'Chefin', true);
  const liste = await accounts(pool);
  assert.equal(liste[0]!.isAdmin, true, 'wer verwaltet, steht oben');
  // Die Zahl beantwortet „ist dieses Konto in Gebrauch" — und genau die Frage
  // stellt sich, bevor man es löscht.
  assert.ok(liste.every((a) => Number.isInteger(a.workspaces)));
});
