/**
 * SOTE — echte Benachrichtigungen.
 *
 * GEWUENSCHT: „Wenn ich als App installiere, dass es richtige
 * App-Benachrichtigungen sendet."
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { enqueue, knownKinds, runOne } from '../src/jobs.js';
import { isPushEndpoint, pushKeys, subscribePush, unsubscribePush } from '../src/push.js';

let pool: Pool;
let userId: string;

before(async () => {
  pool = makePool(process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test');
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Push') RETURNING id`,
    [`push-${process.pid}@example.org`],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

test('der Schluessel wird einmal erzeugt und bleibt', async () => {
  /*
   * Das ist die wichtigste Eigenschaft dieser Tabelle: mit einem NEUEN
   * Schluessel sind alle Abonnements ungueltig, und niemand merkt es -- ausser
   * dass keine Meldung mehr ankommt.
   */
  const a = await pushKeys(pool);
  const b = await pushKeys(pool);
  assert.equal(a.publicKey, b.publicKey);
  assert.ok(a.publicKey.length > 20);
  assert.ok(a.privateKey.length > 20);

  const zeilen = await queryRows<{ n: string }>(pool, 'SELECT count(*) AS n FROM push_keys');
  assert.equal(zeilen[0]!.n, '1');
});

test('dasselbe Geraet meldet sich an, ohne sich zu verdoppeln', async () => {
  // Ein Geraet, das sich neu anmeldet, bekommt denselben Endpunkt. Eine zweite
  // Zeile dafuer hiesse zwei Meldungen fuer einen Bildschirm.
  const endpoint = `https://push.example/${process.pid}/a`;
  await subscribePush(pool, { userId, endpoint, p256dh: 'p1', auth: 'a1', says: 'iPhone' });
  await subscribePush(pool, { userId, endpoint, p256dh: 'p2', auth: 'a2' });

  const zeilen = await queryRows<{ p256dh: string; says: string | null }>(
    pool,
    'SELECT p256dh, says FROM push_subscriptions WHERE endpoint = $1',
    [endpoint],
  );
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0]!.p256dh, 'p2');
  // Der Name bleibt, wenn der neue Aufruf keinen mitbringt: „iPhone" sagt mehr
  // als eine Adresse mit 200 Zeichen, und ein Auffrischen soll ihn nicht
  // wegnehmen.
  assert.equal(zeilen[0]!.says, 'iPhone');
});

test('abmelden nimmt genau dieses Geraet', async () => {
  const a = `https://push.example/${process.pid}/b`;
  const b = `https://push.example/${process.pid}/c`;
  await subscribePush(pool, { userId, endpoint: a, p256dh: 'p', auth: 'a' });
  await subscribePush(pool, { userId, endpoint: b, p256dh: 'p', auth: 'a' });
  await unsubscribePush(pool, userId, a);

  const uebrig = await queryRows<{ endpoint: string }>(
    pool,
    'SELECT endpoint FROM push_subscriptions WHERE user_id = $1 ORDER BY endpoint',
    [userId],
  );
  assert.equal(uebrig.some((r) => r.endpoint === a), false);
  assert.equal(uebrig.some((r) => r.endpoint === b), true);
});

test('ein geloeschtes Konto nimmt seine Geraete mit', async () => {
  // Kein Aufraeumen, sondern der Unterschied zwischen „abgemeldet" und
  // „bekommt weiter Post".
  const weg = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Weg') RETURNING id`,
    [`push-weg-${process.pid}@example.org`],
  );
  await subscribePush(pool, {
    userId: weg!.id,
    endpoint: `https://push.example/${process.pid}/weg`,
    p256dh: 'p',
    auth: 'a',
  });
  await pool.query('DELETE FROM users WHERE id = $1', [weg!.id]);
  const rest = await queryRows(pool, 'SELECT id FROM push_subscriptions WHERE user_id = $1', [
    weg!.id,
  ]);
  assert.equal(rest.length, 0);
});

test('push.send hat einen Bearbeiter — und der Auftrag wird erledigt', async () => {
  /*
   * Audit 12.09.2026, F08: `deliver()` legte `push.send`-Aufträge, und kein
   * Modul bearbeitete sie. Jeder lief in „kein Bearbeiter", fünfmal, und
   * blieb liegen. Der Fehler war von aussen unsichtbar, weil die Aufgaben-
   * erinnerungen `pushTo` direkt rufen und darum ankamen.
   *
   * Hier ein Konto ohne Geräte: `pushTo` schickt nichts, und genau das ist
   * die Erledigung — keine Verbindung nach aussen, kein Fehler.
   */
  assert.ok(knownKinds().includes('push.send'), 'der Bearbeiter ist angemeldet');

  const leer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Ohne Geraet') RETURNING id`,
    [`push-leer-${process.pid}@example.org`],
  );
  await pool.query("DELETE FROM jobs WHERE kind = 'push.send'");
  await enqueue(pool, 'push.send', {
    payload: { userId: leer!.id, note: { title: 'Dir zugewiesen', url: '/t/x' } },
  });
  assert.equal(await runOne(pool, new Date(), ['push.send']), true);
  const row = await queryOne<{ done_at: Date | null; last_error: string | null }>(
    pool,
    "SELECT done_at, last_error FROM jobs WHERE kind = 'push.send'",
  );
  assert.notEqual(row!.done_at, null, 'erledigt');
  assert.equal(row!.last_error, null);
});

test('ein push.send ohne Konto oder Titel ist ein Fehler im Auftrag, keine leere Meldung', async () => {
  await pool.query("DELETE FROM jobs WHERE kind = 'push.send'");
  await enqueue(pool, 'push.send', { payload: { note: { title: 'ohne Konto' } } });
  assert.equal(await runOne(pool, new Date(), ['push.send']), true);
  const row = await queryOne<{ done_at: Date | null; last_error: string | null; attempts: number }>(
    pool,
    "SELECT done_at, last_error, attempts FROM jobs WHERE kind = 'push.send'",
  );
  assert.equal(row!.done_at, null);
  assert.match(row!.last_error ?? '', /ohne Konto/);
  assert.equal(row!.attempts, 1);
  await pool.query("DELETE FROM jobs WHERE kind = 'push.send'");
});

test('abmelden nimmt nur das EIGENE Geraet', async () => {
  // Audit 12.09.2026, F14: DELETE ging ueber den Endpunkt allein.
  const fremd = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Fremd') RETURNING id`,
    [`push-fremd-${process.pid}@example.org`],
  );
  const endpoint = `https://push.example/${process.pid}/fremd`;
  await subscribePush(pool, { userId: fremd!.id, endpoint, p256dh: 'p', auth: 'a' });
  await unsubscribePush(pool, userId, endpoint);
  const noch = await queryRows(pool, 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  assert.equal(noch.length, 1, 'das Geraet des anderen bleibt');
  await unsubscribePush(pool, fremd!.id, endpoint);
  assert.equal((await queryRows(pool, 'SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).length, 0);
});

test('ein Push-Endpunkt ist https und zeigt nicht nach innen', () => {
  for (const gut of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://ntfy.example.org/up/abc', // UnifiedPush -- keine Liste, absichtlich
  ]) {
    assert.equal(isPushEndpoint(gut), true, gut);
  }
  for (const schlecht of [
    'http://push.example/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest',
    'https://[::1]/x',
    'https://[fd00::1]/x',
    'https://drucker.local/x',
    'kein url',
  ]) {
    assert.equal(isPushEndpoint(schlecht), false, schlecht);
  }
});
