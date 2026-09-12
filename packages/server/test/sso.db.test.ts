/**
 * SOTE — Single-Sign-on.
 *
 * Kein echter Anbieter im Spiel: ein Test, der einen mitbringt, prüft vor allem
 * den Mitbringer. Geprüft wird, was **ohne** ihn gilt — und das ist genau die
 * Rechtefläche: welche Einstellungen zählen, dass ein `state` nur einmal gilt,
 * und dass SSO **kein Konto anlegt**.
 */

import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { findAccount, readWhoami, resetDiscovery, safeNextPath, ssoConfig, sweepFlows, takeFlow } from '../src/sso.js';
import { OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let wer: string;
const ADR = `sso-${process.pid}@example.org`;
/**
 * Subjekte sind **global** eindeutig (`users.sso_subject UNIQUE`), also muss
 * jeder Lauf seine eigenen erfinden.
 *
 * Zwei Anläufe, zwei Lehren. Erst nahm ich `'abc'` — das lag aus einem früheren
 * Lauf schon an einem anderen Konto, die Suche am Subjekt fand das falsche, und
 * der Test meldete „keine Ausnahme", wo der Code richtig war. Dann nahm ich die
 * Prozessnummer, und **die wiederholt sich**: derselbe Fehler eine Stunde
 * später.
 *
 * Jetzt eine Zufallszahl je Lauf. Die Lehre, die bleibt: ein Test, der einen
 * global eindeutigen Wert *erfindet*, prüft irgendwann ein anderes Konto — und
 * die Prozessnummer ist keine Zufallszahl.
 */
const RUN = randomUUID().slice(0, 8);
const SUB = (n: string): string => `sub-${RUN}-${n}`;

const setzen = (v: Record<string, string | undefined>): void => {
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) delete process.env[k];
    else process.env[k] = x;
  }
  resetDiscovery();
};

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'SSO Person')
     ON CONFLICT (email) DO UPDATE SET display_name = 'SSO Person' RETURNING id`,
    [ADR],
  );
  wer = u!.id;
});

beforeEach(async () => {
  await pool.query('UPDATE users SET sso_subject = NULL WHERE id = $1', [wer]);
  // Auch Reste dieses Prozesses aus einem früheren Test derselben Datei.
  await pool.query('UPDATE users SET sso_subject = NULL WHERE sso_subject LIKE $1', [
    `sub-${RUN}-%`,
  ]);
  await pool.query('DELETE FROM sso_flows');
  setzen({
    SOTE_OIDC_ISSUER: 'https://anbieter.example',
    SOTE_OIDC_CLIENT_ID: 'sote',
    SOTE_OIDC_CLIENT_SECRET: 'geheim',
  });
});

after(async () => {
  await pool.end();
});

/* ── Was als Einstellung zählt ───────────────────────────────────────────── */

test('ohne alle drei Angaben gibt es kein SSO', async () => {
  // Ein halb eingerichtetes SSO ist ein Anmeldeknopf, der ins Leere führt.
  for (const fehlt of ['SOTE_OIDC_ISSUER', 'SOTE_OIDC_CLIENT_ID', 'SOTE_OIDC_CLIENT_SECRET']) {
    const keep = process.env[fehlt];
    setzen({ [fehlt]: undefined });
    assert.equal(ssoConfig(), undefined, fehlt);
    setzen({ [fehlt]: keep });
  }
  assert.notEqual(ssoConfig(), undefined);
});

test('http:// zählt nicht als Anbieter, auch nicht „nur im Netz drinnen"', async () => {
  /*
   * Über diese Verbindung geht das Client-Geheimnis und kommen die Angaben über
   * die Person zurück. Eine Ausnahme für Testaufbauten wäre eine, die jemand im
   * Betrieb stehen lässt.
   */
  setzen({ SOTE_OIDC_ISSUER: 'http://anbieter.example' });
  assert.equal(ssoConfig(), undefined);
  setzen({ SOTE_OIDC_ISSUER: 'https://anbieter.example/' });
  // Und der Schrägstrich am Ende fällt weg, sonst entstehen doppelte.
  assert.equal(ssoConfig()?.issuer, 'https://anbieter.example');
});

/* ── Der Zwischenzustand ─────────────────────────────────────────────────── */

async function flow(state: string, minuten = 10, next: string | null = null): Promise<void> {
  await pool.query(
    `INSERT INTO sso_flows (state, code_verifier, next_path, expires_at)
     VALUES ($1,'verifier',$2, now() + ($3 || ' minutes')::interval)`,
    [state, next, String(minuten)],
  );
}

test('ein state gilt genau einmal', async () => {
  /*
   * `DELETE ... RETURNING` und nicht lesen-dann-löschen: zwei Schritte wären
   * ein Fenster, in dem derselbe `state` zweimal gilt — und genau das soll er
   * nicht.
   */
  const s = 'S'.repeat(43);
  await flow(s);
  assert.notEqual(await takeFlow(pool, s, new Date()), null);
  assert.equal(await takeFlow(pool, s, new Date()), null, 'beim zweiten Mal nicht');
});

test('ein abgelaufener state gilt nicht', async () => {
  const s = 'T'.repeat(43);
  await flow(s, -1);
  assert.equal(await takeFlow(pool, s, new Date()), null);
});

test('Unsinn als state führt nirgendwohin und wirft nicht', async () => {
  for (const müll of ['', 'x', 'a'.repeat(500), "' OR 1=1 --"]) {
    assert.equal(await takeFlow(pool, müll, new Date()), null, müll.slice(0, 12));
  }
});

test('nur ein Pfad wird gemerkt, keine URL', async () => {
  /*
   * Eine URL aus der Anfrage wäre eine offene Weiterleitung: wer sie setzt,
   * schickt jemanden nach dem Anmelden auf eine fremde Seite, die aussieht wie
   * diese. Geprüft an der Stelle, die es entscheidet — `begin` filtert, und
   * hier steht, was durchkommt.
   */
  const gut = ['/posteingang', '/p/abc-123', '/'];
  /*
   * `//attacker` steht hier, seit der Audit vom 12.09.2026 (F11) ihn fand:
   * die alte Prüfung hier war eine KOPIE der Regel, und beide liessen ihn
   * durch — `//boese.example` scheiterte am Punkt, nicht am Prinzip. Ein
   * Test, der eine Kopie prüft, kann nur beweisen, dass die Kopie stimmt.
   * Jetzt fragt er die Funktion.
   */
  const schlecht = ['https://boese.example', '//boese.example', '//attacker', 'javascript:alert(1)', '/a b'];
  for (const p of gut) assert.equal(safeNextPath(p), p, p);
  for (const p of schlecht) assert.equal(safeNextPath(p), null, p);
  assert.equal(safeNextPath(undefined), null);
});

test('ein Vorgang gehört zu dem Browser, der ihn begonnen hat', async () => {
  /*
   * Audit 12.09.2026, F11 (Login-CSRF). Der Vorgang trägt den Hash eines
   * Geheimnisses, das nur als Keks im Browser liegt. Ein fremder Browser
   * bringt ihn nicht mit — und verbrennt den Vorgang dabei.
   */
  const s = 'B'.repeat(43);
  const geheim = 'browser-geheimnis-' + RUN;
  await pool.query(
    `INSERT INTO sso_flows (state, code_verifier, browser_hash, expires_at)
     VALUES ($1,'verifier', encode(sha256($2::bytea), 'hex'), now() + interval '10 minutes')`,
    [s, geheim],
  );
  assert.equal(await takeFlow(pool, s, new Date()), null, 'ohne Keks nicht');
  assert.equal(await takeFlow(pool, s, new Date(), geheim), null, 'und danach auch nicht mehr — verbrannt');

  const t = 'C'.repeat(43);
  await pool.query(
    `INSERT INTO sso_flows (state, code_verifier, browser_hash, expires_at)
     VALUES ($1,'verifier', encode(sha256($2::bytea), 'hex'), now() + interval '10 minutes')`,
    [t, geheim],
  );
  assert.equal(await takeFlow(pool, t, new Date(), 'falsch'), null, 'mit dem falschen Keks nicht');

  const u = 'D'.repeat(43);
  await pool.query(
    `INSERT INTO sso_flows (state, code_verifier, browser_hash, expires_at)
     VALUES ($1,'verifier', encode(sha256($2::bytea), 'hex'), now() + interval '10 minutes')`,
    [u, geheim],
  );
  assert.notEqual(await takeFlow(pool, u, new Date(), geheim), null, 'mit dem richtigen ja');

  // Ein Vorgang aus der Minute vor Migration 0040 hat keinen Hash — er kommt einmal durch.
  await flow('E'.repeat(43));
  assert.notEqual(await takeFlow(pool, 'E'.repeat(43), new Date()), null);
});

test('eine unbestätigte Adresse meldet niemanden an', async () => {
  /*
   * Audit 12.09.2026, F10. Die Adresse ist der Schlüssel, mit dem das erste
   * Anmelden ein bestehendes Konto findet. Ein Anbieter, der unbestätigte,
   * selbst gewählte Adressen ausgibt, liesse damit jeden ein fremdes Konto
   * beanspruchen. `email_verified` fehlt → nein; `false` → nein; `true` → ja.
   */
  const basis = { sub: SUB('v'), email: 'Wer@Example.org', name: 'Wer' };
  assert.throws(() => readWhoami(basis), /nicht bestätigt/);
  assert.throws(() => readWhoami({ ...basis, email_verified: false }), /nicht bestätigt/);
  assert.throws(() => readWhoami({ ...basis, email_verified: 'true' }), /nicht bestätigt/);
  const ok = readWhoami({ ...basis, email_verified: true });
  assert.equal(ok.email, 'wer@example.org');
  assert.equal(ok.subject, SUB('v'));
});

test('alte Zwischenzustände werden weggeräumt', async () => {
  await flow('U'.repeat(43), -5);
  await flow('V'.repeat(43), 10);
  await sweepFlows(pool, new Date());
  const rest = await queryOne<{ n: string }>(pool, 'SELECT count(*) AS n FROM sso_flows');
  assert.equal(Number(rest!.n), 1);
});

/* ── SSO meldet an, es lädt nicht ein ────────────────────────────────────── */

test('wer kein Konto hat, bekommt keines', async () => {
  /*
   * Der Grundsatz (ADR-0073): die Instanz lädt ein. Ein SSO, das Konten von
   * selbst anlegt, hieße, dass jeder eines bekommt, der im Verzeichnis des
   * Anbieters steht — und die Instanz hätte aufgehört zu entscheiden, wer hier
   * existiert.
   */
  const vorher = await queryOne<{ n: string }>(pool, 'SELECT count(*) AS n FROM users');
  assert.equal(
    await findAccount(pool, { subject: SUB('fremd'), email: 'niemand@example.org', name: 'X' }),
    null,
  );
  const nachher = await queryOne<{ n: string }>(pool, 'SELECT count(*) AS n FROM users');
  assert.equal(nachher!.n, vorher!.n, 'kein Konto entstanden');
});

test('das erste Anmelden findet über die Adresse und merkt das Subjekt', async () => {
  assert.equal(await findAccount(pool, { subject: SUB('a'), email: ADR, name: 'X' }), wer);
  const row = await queryOne<{ sso_subject: string | null }>(
    pool,
    'SELECT sso_subject FROM users WHERE id = $1',
    [wer],
  );
  assert.equal(row!.sso_subject, SUB('a'));
});

test('danach gilt das Subjekt, auch wenn die Adresse wechselt', async () => {
  /*
   * Eine Adresse wechselt (Heirat, Firmenübernahme), ein Subjekt nicht. Wer
   * über die Adresse verknüpft, verliert bei einem Wechsel den Zugang.
   */
  await findAccount(pool, { subject: SUB('a'), email: ADR, name: 'X' });
  assert.equal(
    await findAccount(pool, { subject: SUB('a'), email: 'neue-adresse@example.org', name: 'X' }),
    wer,
  );
});

test('dieselbe Adresse mit anderem Subjekt wird abgelehnt', async () => {
  /*
   * Kein Anmeldefehler, sondern ein Hinweis: entweder hat der Anbieter die
   * Adresse neu vergeben, oder jemand anderes trägt sie jetzt. Hereinlassen
   * hieße, ein Konto an den Nächsten weiterzugeben, der eine freigewordene
   * Adresse bekommt.
   */
  await findAccount(pool, { subject: SUB('a'), email: ADR, name: 'X' });
  await assert.rejects(
    () => findAccount(pool, { subject: SUB('b'), email: ADR, name: 'X' }),
    // „anderen Anmeldung", nicht „andere" — mein erster Regex passte nicht auf
    // meinen eigenen Satz, und der Test meldete das als Fehler im Code.
    (e: unknown) => e instanceof OutOfOrder && /anderen Anmeldung/.test((e as Error).message),
  );
});
