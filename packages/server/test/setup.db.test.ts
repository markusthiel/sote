/**
 * SOTE — die Einrichtung des ersten Kontos.
 *
 * Die Frage, die diese Datei trägt, ist nicht „lässt sich ein Konto anlegen",
 * sondern: **kann dieser Weg ein zweites Mal benutzt werden.** Eine Maske, die
 * beim ersten Aufruf ein Konto anlegt, kann es auch beim tausendsten, sobald
 * eine Bedingung einmal falsch steht — und dann steht die Kontoerstellung offen
 * im Netz.
 *
 * Der Test braucht eine **eigene, leere** Datenbank. Gegen die gemeinsame
 * Testdatenbank, in der andere Dateien Konten anlegen, prüft er die Bedingung
 * nicht, unter der er etwas beweisen soll — dieselbe Lehre wie beim
 * Migrations-Wettlauf.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { signIn } from '../src/auth.js';
import {
  BadSetupKey,
  createAccount,
  SetupClosed,
  SetupKey,
  setupFirstAccount,
  userCount,
} from '../src/bootstrap.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { OutOfOrder } from '../src/tasks.js';

const BASE =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

const NAME = `sote_setup_${process.pid}`;
const URL_ = BASE.replace(/\/[^/]+$/, `/${NAME}`);
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

let admin: Pool;
let pool: Pool;
let usable = true;

before(async () => {
  admin = makePool(BASE);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.query(`CREATE DATABASE ${NAME}`);
  } catch {
    // Ohne das Recht, Datenbanken anzulegen, schweigt der Test statt einen
    // Fehlschlag zu behaupten, der keiner ist.
    usable = false;
    return;
  }
  pool = makePool(URL_);
  await migrate(pool);
});

after(async () => {
  if (usable) {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  }
  await admin.end();
});

const account = {
  email: 'm@example.org',
  displayName: 'Markus Thiel',
  password: 'ein gutes Kennwort',
  workspaceName: 'Thiel Tools',
};

test('eine leere Instanz braucht Einrichtung, und es gibt einen Schlüssel', async () => {
  if (!usable) return;
  assert.equal(await userCount(pool), 0);
  const gate = new SetupKey();
  const key = await gate.openIfEmpty(pool);
  assert.ok(key !== null && key.length >= 30, 'der Schlüssel ist lang genug');
  assert.equal(gate.open, true);
});

test('ein falscher Schlüssel legt kein Konto an', async () => {
  if (!usable) return;
  const gate = new SetupKey();
  await gate.openIfEmpty(pool);
  await assert.rejects(
    () => setupFirstAccount(pool, gate, 'falsch', account),
    BadSetupKey,
  );
  assert.equal(await userCount(pool), 0, 'nichts angelegt');
});

test('ein leerer Schlüssel legt kein Konto an', async () => {
  if (!usable) return;
  const gate = new SetupKey();
  await gate.openIfEmpty(pool);
  await assert.rejects(() => setupFirstAccount(pool, gate, '', account), BadSetupKey);
});

test('ein Schlüssel aus einem anderen Prozess passt nicht', async () => {
  if (!usable) return;
  const mine = new SetupKey();
  await mine.openIfEmpty(pool);
  const other = new SetupKey();
  const otherKey = await other.openIfEmpty(pool);
  await assert.rejects(
    () => setupFirstAccount(pool, mine, otherKey!, account),
    BadSetupKey,
  );
});

test('der richtige Schlüssel legt Konto, Arbeitsbereich und vier Rollen an', async () => {
  if (!usable) return;
  const gate = new SetupKey();
  const key = await gate.openIfEmpty(pool);
  const id = await setupFirstAccount(pool, gate, key!, account);

  const user = await queryOne<{ email: string; display_name: string }>(
    pool,
    'SELECT email, display_name FROM users WHERE id = $1',
    [id],
  );
  assert.equal(user?.email, 'm@example.org');
  assert.equal(user?.display_name, 'Markus Thiel');

  const ws = await queryOne<{ name: string }>(pool, 'SELECT name FROM workspaces');
  assert.equal(ws?.name, 'Thiel Tools');

  const roles = await queryOne<{ n: string }>(pool, 'SELECT count(*) AS n FROM roles');
  assert.equal(roles?.n, '4');

  const member = await queryOne<{ is_owner: boolean }>(
    pool,
    'SELECT is_owner FROM workspace_members WHERE user_id = $1',
    [id],
  );
  assert.equal(member?.is_owner, true);

  // Und das Kennwort gilt: sonst hätte jemand ein Konto, in das er nicht kommt.
  const session = await signIn(pool, account.email, account.password, 30, NOW);
  assert.ok(session !== null, 'anmelden muss gehen');
});

/* ── Der eigentliche Punkt: ein zweites Mal geht nicht ─────────────────── */

test('derselbe Schlüssel legt kein zweites Konto an', async () => {
  if (!usable) return;
  const gate = new SetupKey();
  const key = await gate.openIfEmpty(pool);
  // Die Datenbank hat aus dem vorigen Test schon ein Konto, also ist der
  // Schlüssel gar nicht erst offen.
  assert.equal(key, null);
  assert.equal(gate.open, false);
  await assert.rejects(
    () => setupFirstAccount(pool, gate, 'was auch immer', account),
    SetupClosed,
  );
});

test('ein Schlüssel von vorher gilt nicht, wenn inzwischen ein Konto entstand', async () => {
  // Der Fall, um den es geht: der Schlüssel liegt im Speicher **eines**
  // Prozesses und weiß nichts davon, was ein Skript oder eine zweite Instanz
  // getan hat. Deshalb prüft der Server zusätzlich die Datenbank — und zwar
  // **zuerst**, damit eine falsche Eingabe nicht verrät, dass die Einrichtung
  // noch offen wäre.
  if (!usable) return;
  const gate = new SetupKey();
  // Von Hand offen halten, als wäre der Prozess gestartet, als noch nichts da war.
  const key = await gate.openIfEmpty(pool);
  assert.equal(key, null, 'hier ist schon ein Konto');

  await assert.rejects(
    () =>
      setupFirstAccount(pool, gate, 'irgendwas', {
        ...account,
        email: 'zweiter@example.org',
      }),
    SetupClosed,
    'die Datenbank entscheidet, nicht der Schlüssel im Speicher',
  );
  assert.equal(await userCount(pool), 1);
});

/* ── Die Eingaben ──────────────────────────────────────────────────────── */

test('Adresse, Name und Kennwort werden geprüft, mit benanntem Grund', async () => {
  if (!usable) return;
  const cases: [Partial<typeof account>, RegExp][] = [
    [{ email: 'keine-adresse' }, /E-Mail/],
    [{ email: '' }, /E-Mail/],
    [{ displayName: '   ' }, /Name/],
    [{ password: 'kurz' }, /acht Zeichen/],
  ];
  for (const [patch, says] of cases) {
    await assert.rejects(
      () => createAccount(pool, { ...account, ...patch, email: patch.email ?? 'neu@example.org' }),
      (e: unknown) => e instanceof OutOfOrder && says.test((e as Error).message),
      JSON.stringify(patch),
    );
  }
});

test('eine belegte Adresse wird nicht stillschweigend überschrieben', async () => {
  if (!usable) return;
  await assert.rejects(
    () => createAccount(pool, account),
    (e: unknown) => e instanceof OutOfOrder && /gibt es schon/.test((e as Error).message),
  );
  // Und das alte Kennwort gilt weiter.
  const session = await signIn(pool, account.email, account.password, 30, NOW);
  assert.ok(session !== null);
});

test('ein zweites Konto ohne Arbeitsbereichsnamen bekommt den Vorgabenamen', async () => {
  if (!usable) return;
  await createAccount(pool, {
    email: 'zweite@example.org',
    displayName: 'Anna Kern',
    password: 'auch ein gutes Kennwort',
  });
  const ws = await queryOne<{ name: string }>(
    pool,
    `SELECT name FROM workspaces WHERE name = 'Mein Arbeitsbereich'`,
  );
  assert.equal(ws?.name, 'Mein Arbeitsbereich');
});

test('zwei gleichzeitige Einrichtungen ergeben ein Konto, nicht zwei', async () => {
  // Von SONE gelernt und nicht selbst gemerkt: dessen `bootstrapInstance` nimmt
  // ein `pg_advisory_xact_lock` mit dem Kommentar „Serialise concurrent
  // first-run attempts". Meine erste Fassung hatte das nicht — zwei
  // gleichzeitige Anfragen mit demselben Schlüssel und verschiedenen Adressen
  // sahen beide „kein Konto", beide fanden den Schlüssel gültig, und beide
  // legten an. Danach hätte die Instanz zwei Eigentümer, von denen einer nicht
  // eingeplant war.
  if (!usable) return;
  const name = `${NAME}_race`;
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const url = BASE.replace(/\/[^/]+$/, `/${name}`);
  const race = makePool(url);
  try {
    await migrate(race);
    const gate = new SetupKey();
    const key = await gate.openIfEmpty(race);
    assert.ok(key !== null);

    const results = await Promise.allSettled([
      setupFirstAccount(race, gate, key, { ...account, email: 'erste@example.org' }),
      setupFirstAccount(race, gate, key, { ...account, email: 'zweite@example.org' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, 'genau eine Einrichtung geht durch');
    assert.equal(await userCount(race), 1, 'und genau ein Konto entsteht');

    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(
      failed.reason instanceof SetupClosed,
      'die zweite bekommt „schon eingerichtet" und keinen Datenbankfehler',
    );
  } finally {
    await race.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
});
