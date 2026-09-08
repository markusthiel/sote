/**
 * SOTE — Einladungen.
 *
 * Die zwei Regeln, die hier zählen:
 *
 * 1. **Die Instanz lädt ein** (ADR-0073) — eine Einladung erzeugt ein Konto und
 *    hängt an keinem Arbeitsbereich.
 * 2. **Der Token reist nie in der Anfrage** (ADR-0126) — der Server baut den
 *    Link selbst. Eine Route, die eine übergebene URL verschickt, wäre ein
 *    kleiner offener Verteiler mit dem Namen dieser Instanz auf dem Umschlag.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne, queryRows } from '../src/db.js';
import {
  invite,
  listInvitations,
  openInvitation,
  revokeInvitation,
} from '../src/invitations.js';
import { migrate } from '../src/migrate.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let chef: string;

before(async () => {
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 11).toString('hex');
  process.env['SOTE_BASE_URL'] = 'https://sote.example/';
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Chefin')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Chefin' RETURNING id`,
    [`inv-chef-${process.pid}@example.org`],
  );
  chef = u!.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM invitations');
  await pool.query("DELETE FROM jobs WHERE kind = 'mail.send'");
});

after(async () => {
  await pool.end();
});

const mails = async () =>
  queryRows<{ payload: Record<string, unknown> }>(
    pool,
    "SELECT payload FROM jobs WHERE kind = 'mail.send' ORDER BY created_at",
  );

test('der Server baut den Link selbst und verschickt ihn', async () => {
  /*
   * ADR-0126. Der Aufruf bekommt **nur eine Adresse** — es gibt keinen
   * Parameter, in dem eine URL stehen könnte, und das ist der ganze Punkt.
   */
  const out = await invite(pool, 'neu@example.org', chef, new Date());
  assert.equal(out.mailed, true);
  const [brief] = await mails();
  assert.equal(brief!.payload['to'], 'neu@example.org');
  const text = String(brief!.payload['text']);
  assert.match(text, /https:\/\/sote\.example\/einladung\/[A-Za-z0-9_-]{20,}/);
  // Und der Link im Brief trägt WIRKLICH den Token dieser Einladung.
  assert.ok(text.includes(out.token), 'derselbe Token');
});

test('ohne eigene Adresse geht keine Mail — die Einladung gilt trotzdem', async () => {
  /*
   * Die ehrliche Aufteilung: der Vorgang ist eine Sache, die Mail eine andere.
   * Die Adresse aus der Anfrage zu nehmen (`Host`) wäre eine Angabe des
   * Aufrufers — wer sie fälscht, lässt diesen Server Links auf einen fremden
   * Namen verschicken.
   */
  const keep = process.env['SOTE_BASE_URL'];
  delete process.env['SOTE_BASE_URL'];
  try {
    const out = await invite(pool, 'ohnemail@example.org', chef, new Date());
    assert.equal(out.mailed, false);
    assert.equal((await mails()).length, 0);
    // Sie steht mit ihrem Link in der Liste, zum Weitergeben von Hand.
    const liste = await listInvitations(pool);
    assert.equal(liste[0]!.token, out.token);
  } finally {
    process.env['SOTE_BASE_URL'] = keep;
  }
});

test('wer schon ein Konto hat, wird nicht eingeladen', async () => {
  /*
   * Sonst wäre es ein Link, der ein Konto anlegen will, das es gibt, und der
   * beim Einlösen fehlschlägt: ein Fehler, der eine Woche später bei jemand
   * anderem auftritt. Die Meldung sagt, wo die richtige Frage steht.
   */
  const eigene = await queryOne<{ email: string }>(pool, 'SELECT email FROM users WHERE id = $1', [
    chef,
  ]);
  await assert.rejects(
    () => invite(pool, eigene!.email, chef, new Date()),
    (e: unknown) => e instanceof OutOfOrder && /„Leute"/.test((e as Error).message),
  );
});

test('eine Adresse, die keine ist, wird abgelehnt', async () => {
  for (const müll of ['', 'kein-at', 'a@b', 'a b@c.de']) {
    await assert.rejects(() => invite(pool, müll, chef, new Date()), OutOfOrder, müll);
  }
});

test('abgelaufen, zurückgenommen, eingelöst: alle drei führen nirgendwohin', async () => {
  const jetzt = new Date();

  const a = await invite(pool, 'a@example.org', chef, jetzt);
  await pool.query("UPDATE invitations SET expires_at = now() - interval '1 day' WHERE id = $1", [
    a.id,
  ]);
  assert.equal(await openInvitation(pool, a.token, jetzt), null, 'abgelaufen');

  const b = await invite(pool, 'b@example.org', chef, jetzt);
  await revokeInvitation(pool, b.id);
  assert.equal(await openInvitation(pool, b.token, jetzt), null, 'zurückgenommen');

  const c = await invite(pool, 'c@example.org', chef, jetzt);
  await pool.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [c.id]);
  assert.equal(await openInvitation(pool, c.token, jetzt), null, 'eingelöst');

  // Und eine gültige führt hin.
  const d = await invite(pool, 'd@example.org', chef, jetzt);
  assert.equal((await openInvitation(pool, d.token, jetzt))?.email, 'd@example.org');
});

test('Unsinn als Token führt nirgendwohin und wirft nicht', async () => {
  for (const müll of ['', 'x', 'a'.repeat(500), '../../etc/passwd', "' OR 1=1 --"]) {
    assert.equal(await openInvitation(pool, müll, new Date()), null, müll.slice(0, 12));
  }
});

test('zweimal zurücknehmen ist ein Fehler', async () => {
  // Wie bei Freigaben: wer aus einer Liste zurücknimmt, hat es dort gesehen —
  // und es stand nicht mehr darin.
  const a = await invite(pool, 'e@example.org', chef, new Date());
  await revokeInvitation(pool, a.id);
  await assert.rejects(() => revokeInvitation(pool, a.id), NotFound);
});

test('mit dem falschen Schlüssel bleibt die Einladung sichtbar', async () => {
  // Der Fall, den ein Betreiber erlebt. Nur der Klartext fehlt — und
  // zurücknehmen muss man sie können, das ist die Funktion, auf die es ankommt.
  const a = await invite(pool, 'f@example.org', chef, new Date());
  const keep = process.env['SOTE_SHARE_KEY'];
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 12).toString('hex');
  try {
    const liste = await listInvitations(pool);
    assert.equal(liste.length, 1);
    assert.equal(liste[0]!.token, null);
    // Der Link selbst geht weiter: nachgeschlagen wird über den Hash.
    assert.notEqual(await openInvitation(pool, a.token, new Date()), null);
  } finally {
    process.env['SOTE_SHARE_KEY'] = keep;
  }
});
