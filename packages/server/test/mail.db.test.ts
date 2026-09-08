/**
 * SOTE — der Mailweg.
 *
 * Geprüft wird hier **nicht**, dass eine Mail ankommt — dafür bräuchte es einen
 * Mailserver, und ein Test, der einen mitbringt, prüft vor allem den Mitbringer.
 * Geprüft wird, was ohne ihn gilt: dass nichts direkt verschickt wird, dass
 * fehlende Einstellungen **gesagt** werden, und dass ein Fehlschlag sichtbar
 * bleibt.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { mailConfig, queueMail, sendMail } from '../src/mail.js';
import { migrate } from '../src/migrate.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;

/** Eine eigene Domäne je Prozess — die Testdateien teilen sich eine Datenbank. */
const DOM = `mail${process.pid}.example`;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
});

beforeEach(async () => {
  // Nur die eigenen: die Testdateien teilen sich eine Datenbank.
  await pool.query(
    "DELETE FROM jobs WHERE kind = 'mail.send' AND payload->>'to' LIKE $1",
    [`%@${DOM}`],
  );
});

after(async () => {
  await pool.end();
});

test('eine Mail geht in die Warteschlange und nicht sofort hinaus', async () => {
  /*
   * Der Grund: eine Anfrage, die auf einen fremden Server wartet, hängt, wenn
   * der fremde Server hängt — ein Mailserver ohne Antwort würde damit ein
   * Einladen langsam machen.
   */
  await queueMail(pool, { to: `a@${DOM}`, subject: 'Hallo', text: 'Text' });
  const job = await queryOne<{ kind: string; payload: Record<string, unknown> }>(
    pool,
    "SELECT kind, payload FROM jobs WHERE payload->>'to' LIKE $1",
    [`%@${DOM}`],
  );
  assert.equal(job!.kind, 'mail.send');
  assert.equal(job!.payload['to'], `a@${DOM}`);
});

test('ohne Einstellungen bleibt der Auftrag liegen und sagt, was fehlt', async () => {
  /*
   * Kein stilles Überspringen: eine Mail, die niemand vermisst, bis jemand
   * fragt, warum keine Einladung ankam, ist der Fehler aus ADR-0112. Der
   * Auftrag steht mit diesem Satz unter „Wartung".
   */
  const keep = { h: process.env['SOTE_SMTP_HOST'], f: process.env['SOTE_MAIL_FROM'] };
  delete process.env['SOTE_SMTP_HOST'];
  delete process.env['SOTE_MAIL_FROM'];
  try {
    assert.equal(mailConfig(), undefined);
    /*
     * Der Bearbeiter DIREKT aufgerufen und nicht über die Schlange geholt:
     * `mail.send` benutzen drei Testdateien, die sich eine Datenbank teilen,
     * also griff der Lauf der einen den Auftrag der anderen. Was hier zählt,
     * ist ohnehin die Ausnahme — dass der Läufer sie in `last_error` schreibt,
     * prüfen seine eigenen Tests.
     */
    await assert.rejects(
      () =>
        sendMail({
          pool,
          now: new Date(),
          job: { id: 'x', kind: 'mail.send', payload: { to: 'a@x', subject: 's', text: 't' }, attempts: 1 },
        }),
      (e: unknown) =>
        /SOTE_SMTP_HOST/.test((e as Error).message) &&
        /SOTE_MAIL_FROM/.test((e as Error).message),
    );
  } finally {
    if (keep.h !== undefined) process.env['SOTE_SMTP_HOST'] = keep.h;
    if (keep.f !== undefined) process.env['SOTE_MAIL_FROM'] = keep.f;
  }
});

test('die Verschlüsselung wird aus dem Port abgeleitet', async () => {
  // Abgeleitet und nicht als eigene Variable: eine dritte Angabe, die zu den
  // beiden anderen passen muss, ist eine, die irgendwann nicht passt.
  const setzen = (port: string, secure?: string): void => {
    process.env['SOTE_SMTP_HOST'] = 'mail.example';
    process.env['SOTE_MAIL_FROM'] = 'sote@example';
    process.env['SOTE_SMTP_PORT'] = port;
    if (secure === undefined) delete process.env['SOTE_SMTP_SECURE'];
    else process.env['SOTE_SMTP_SECURE'] = secure;
  };
  setzen('465');
  assert.equal(mailConfig()?.secure, true, '465 ist von Anfang an verschlüsselt');
  setzen('587');
  assert.equal(mailConfig()?.secure, false, '587 verschlüsselt mit STARTTLS');
  // Und wer es ausdrücklich sagt, gewinnt.
  setzen('587', 'true');
  assert.equal(mailConfig()?.secure, true);
});

test('ein unmöglicher Port zählt als keine Einstellung', async () => {
  process.env['SOTE_SMTP_HOST'] = 'mail.example';
  process.env['SOTE_MAIL_FROM'] = 'sote@example';
  for (const p of ['0', '99999', 'zwei']) {
    process.env['SOTE_SMTP_PORT'] = p;
    assert.equal(mailConfig(), undefined, p);
  }
  delete process.env['SOTE_SMTP_PORT'];
});

test('eine Mail ohne Empfänger ist ein Fehler', async () => {
  process.env['SOTE_SMTP_HOST'] = 'mail.example';
  process.env['SOTE_MAIL_FROM'] = 'sote@example';
  await assert.rejects(
    () =>
      sendMail({
        pool,
        now: new Date(),
        job: { id: 'x', kind: 'mail.send', payload: { subject: 'x', text: 'y' }, attempts: 1 },
      }),
    /Empfänger/,
  );
});
