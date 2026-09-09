/**
 * SOTE — wer hier mitarbeitet.
 *
 * Wieder eine Rechtefläche, also prüft der Lauf vor allem, was **nicht** geht.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addPerson, findPeople, people, removePerson, setRole } from '../src/people.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let anna: string;
const NACHNAME = `Bauer${process.pid}`;
let bert: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const mk = async (email: string, name: string): Promise<string> => {
    const u = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO users (email, display_name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [email, name],
    );
    return u!.id;
  };
  /*
   * Ein eigener Nachname je Lauf.
   *
   * Die Suche liefert höchstens acht Treffer, und ein Test, der immer „Bauer"
   * anlegt, hinterlässt auf einer nicht neu angelegten Datenbank nach zehn
   * Läufen zehn Bauers — dann fällt der aktuelle aus den acht heraus, und der
   * Test meldet einen Fehler in der Suche, den es nicht gibt. Auf frischer
   * Datenbank (wie in der CI) war er immer grün; hier lokal ein Wackler, den
   * ich zweimal weggeklickt habe, statt ihn zu beheben.
   */
  anna = await mk(`anna-${process.pid}@example.org`, `Anna ${NACHNAME}`);
  bert = await mk(`bert-${process.pid}@example.org`, 'Bert Kunz');
});

after(async () => {
  await pool.end();
});

async function scratch(name: string): Promise<{ ws: string; member: string; admin: string }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const member = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor') RETURNING id`,
    [w!.id],
  );
  const admin = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level, rights)
     VALUES ($1,'admin','editor','{people.manage}') RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [w!.id, anna, member!.id],
  );
  return { ws: w!.id, member: member!.id, admin: admin!.id };
}

/* ── Suchen ──────────────────────────────────────────────────────────────── */

test('nichts unter zwei Zeichen', async () => {
  /*
   * Der ganze Unterschied zwischen *bestätigen* und *auflisten* (ADR-0119):
   * ohne Eingabe keine Zeilen, also wird hier nie ein Verzeichnis gelesen.
   */
  const { ws } = await scratch('p-short');
  assert.deepEqual(await findPeople(pool, ws, ''), []);
  assert.deepEqual(await findPeople(pool, ws, 'a'), []);
  assert.deepEqual(await findPeople(pool, ws, '  '), []);
  assert.ok((await findPeople(pool, ws, 'an')).length > 0);
});

test('gesucht wird nach Name UND Adresse', async () => {
  // Das ist, was ADR-0119 wirklich neu bringt: Name → Adresse. Darum nimmt der
  // Weg dasselbe Recht wie das Hinzufügen und kein lockereres.
  const { ws } = await scratch('p-find');
  const nachName = await findPeople(pool, ws, NACHNAME);
  assert.ok(nachName.some((p) => p.userId === anna));
  const nachMail = await findPeople(pool, ws, `bert-${process.pid}`);
  assert.ok(nachMail.some((p) => p.userId === bert));
});

test('wer schon hier ist, wird mitgeliefert und markiert', async () => {
  /*
   * Nicht gefiltert: verborgen liest er sich als „gibt es nicht" — dieselbe
   * Verwirrung, die ADR-0119 behebt, nur von der anderen Seite.
   */
  const { ws } = await scratch('p-marked');
  const gefunden = await findPeople(pool, ws, NACHNAME);
  const treffer = gefunden.find((p) => p.userId === anna);
  assert.ok(treffer, 'Anna steht in der Liste');
  assert.equal(treffer.alreadyMember, true, 'und ist markiert');
});

/* ── Hinzufügen ──────────────────────────────────────────────────────────── */

test('hinzufügen ist nicht befördern', async () => {
  /*
   * ADR-0073. Wer schon Mitglied ist, wird abgelehnt und bekommt nicht still
   * eine andere Rolle — beides in einem Weg zu haben heißt, dass ein
   * Verklicken jemandem Rechte gibt.
   */
  const { ws, member, admin } = await scratch('p-add');
  await addPerson(pool, ws, bert, member);
  await assert.rejects(() => addPerson(pool, ws, bert, admin), OutOfOrder);
  // Und seine Rolle ist unverändert.
  const liste = await people(pool, ws);
  assert.equal(liste.find((p) => p.userId === bert)?.roleName, 'member');
});

test('eine Rolle aus einem fremden Arbeitsbereich geht nicht', async () => {
  // Sie wäre eine Rolle, deren Rechte hier niemand gesetzt hat. Geprüft, statt
  // sich auf den Fremdschlüssel zu verlassen: der kennt die Zugehörigkeit nicht.
  const a = await scratch('p-cross-a');
  const b = await scratch('p-cross-b');
  await assert.rejects(() => addPerson(pool, a.ws, bert, b.member), NotFound);
  assert.equal((await people(pool, a.ws)).some((p) => p.userId === bert), false);
});

test('ein Konto, das es nicht gibt, wird abgelehnt', async () => {
  const { ws, member } = await scratch('p-nouser');
  await assert.rejects(
    () => addPerson(pool, ws, '00000000-0000-4000-8000-000000000000', member),
    NotFound,
  );
});

/* ── Rollen und Gehen ────────────────────────────────────────────────────── */

test('die Rolle eines Eigentümers lässt sich nicht setzen', async () => {
  // Eigentümerschaft ist eine Spalte und kein Recht (SONEs ADR-0102) — sie
  // über das Rollenfeld zu ändern wäre ein zweiter Weg zu einer anderen Sache.
  const { ws, admin } = await scratch('p-owner-role');
  await assert.rejects(() => setRole(pool, ws, anna, admin), NotFound);
});

test('der letzte Eigentümer kann nicht gehen', async () => {
  /*
   * Ein Arbeitsbereich ohne Eigentümer ist einer, in dem niemand mehr Leute
   * verwalten kann — und das lässt sich von innen nicht heilen. Der eine Fall,
   * in dem eine Verweigerung freundlicher ist als ein Vollzug.
   */
  const { ws } = await scratch('p-last-owner');
  await assert.rejects(() => removePerson(pool, ws, anna), OutOfOrder);
  assert.equal((await people(pool, ws)).length, 1);
});

test('ein Mitglied kann gehen, und der Eigentümer bleibt', async () => {
  const { ws, member } = await scratch('p-leave');
  await addPerson(pool, ws, bert, member);
  assert.equal((await people(pool, ws)).length, 2);
  await removePerson(pool, ws, bert);
  const liste = await people(pool, ws);
  assert.equal(liste.length, 1);
  assert.equal(liste[0]!.isOwner, true);
});

test('wer nicht hier ist, kann nicht gehen', async () => {
  const { ws } = await scratch('p-notmember');
  await assert.rejects(() => removePerson(pool, ws, bert), NotFound);
});

test('der Eigentümer steht oben, dann nach Namen', async () => {
  // Eine Liste von Leuten, die nach einer Id sortiert ist, ist eine Liste, in
  // der man nicht sucht.
  const { ws, member } = await scratch('p-order');
  await addPerson(pool, ws, bert, member);
  const liste = await people(pool, ws);
  assert.equal(liste[0]!.isOwner, true);
  assert.equal(liste[1]!.displayName, 'Bert Kunz');
});
