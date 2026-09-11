/**
 * SOTE — der Kalender-Link.
 *
 * Das Format prüft `core/test/ics.test.ts`. Hier geht es um den LINK: dass er
 * gilt, dass er sich widerrufen lässt, dass ein widerrufener nichts mehr
 * herausgibt — und dass ein unbekannter genauso aussieht wie ein abgeschalteter.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { feedOf, icsByToken, newFeed, NoCalendar, revokeFeed } from '../src/calendar.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createFromLine, patch } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  // Ohne Schlüssel gibt es keine Links — hier steht er, damit die Tests die
  // Sache prüfen und nicht das Fehlen der Einstellung.
  process.env['SOTE_SHARE_KEY'] = 'a'.repeat(64);
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Kalendermensch') RETURNING id`,
    [`cal-${process.pid}-${Date.now()}@example.org`],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(name: string): Promise<string> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`${name}-${Date.now()}-${Math.random()}`],
  );
  return w!.id;
}

test('vor dem ersten Mal gibt es keinen, und das ist kein Fehler', async () => {
  const ws = await scratch('cal-keiner');
  assert.equal(await feedOf(pool, ws, userId), undefined);
});

test('ein neuer Link holt das Dokument', async () => {
  const ws = await scratch('cal-neu');
  await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Heizung entlüften morgen 9 Uhr ~90',
    now: NOW,
  });
  const { token } = await newFeed(pool, ws, userId);
  const text = await icsByToken(pool, token, NOW, 'https://sote.example');
  assert.notEqual(text, undefined);
  assert.ok(text!.includes('BEGIN:VCALENDAR'));
  assert.ok(text!.includes('SUMMARY:Heizung entlüften'));
  // Die Dauer ist ein Block — der Lohn für das Dauer-Feld.
  assert.ok(text!.includes('DTEND:'));
});

test('der Klartext lässt sich wieder anzeigen', async () => {
  /*
   * Gehasht allein könnte man den Link nie wieder zeigen, und wer ihn beim
   * ersten Mal nicht eingesetzt hat, müsste einen neuen machen. Darum
   * versiegelt und nicht nur gehasht — dieselbe Abwägung wie bei den
   * Freigaben.
   */
  const ws = await scratch('cal-klartext');
  const { token } = await newFeed(pool, ws, userId);
  const feed = await feedOf(pool, ws, userId);
  assert.equal(feed?.token, token);
});

test('neu machen tötet den alten', async () => {
  // „Neu machen“ heißt für den, der es drückt, dass der alte nicht mehr gilt.
  // Zwei gültige wären zwei Dinge zu widerrufen.
  const ws = await scratch('cal-neuer');
  const erst = await newFeed(pool, ws, userId);
  const dann = await newFeed(pool, ws, userId);
  assert.notEqual(erst.token, dann.token);
  assert.equal(await icsByToken(pool, erst.token, NOW, undefined), undefined);
  assert.notEqual(await icsByToken(pool, dann.token, NOW, undefined), undefined);
});

test('höchstens ein gültiger je Person und Bereich — auch am Code vorbei', async () => {
  const ws = await scratch('cal-einer');
  await newFeed(pool, ws, userId);
  await assert.rejects(() =>
    pool.query(
      `INSERT INTO calendar_feeds (workspace_id, user_id, token_hash, token_enc)
       VALUES ($1,$2,'deadbeef','x')`,
      [ws, userId],
    ),
  );
});

test('abgeschaltet gibt nichts mehr heraus', async () => {
  const ws = await scratch('cal-aus');
  const { token } = await newFeed(pool, ws, userId);
  await revokeFeed(pool, ws, userId);
  assert.equal(await icsByToken(pool, token, NOW, undefined), undefined);
  assert.equal(await feedOf(pool, ws, userId), undefined);
});

test('zweimal abschalten sagt, dass nichts offen war', async () => {
  const ws = await scratch('cal-zweimal');
  await newFeed(pool, ws, userId);
  await revokeFeed(pool, ws, userId);
  await assert.rejects(
    () => revokeFeed(pool, ws, userId),
    (e: Error) => e instanceof NoCalendar,
  );
});

test('ein erfundenes Token sieht aus wie ein abgeschaltetes', async () => {
  // Ein Unterschied wäre die Auskunft, dass es diesen Link einmal gab.
  assert.equal(await icsByToken(pool, 'x'.repeat(43), NOW, undefined), undefined);
});

test('das Abholen wird quittiert', async () => {
  /*
   * Die einzige Auskunft darüber, ob das Abonnement lebt. Ohne sie sieht ein
   * vergessener Link aus wie ein benutzter — und dann räumt niemand auf.
   */
  const ws = await scratch('cal-quittung');
  const { token } = await newFeed(pool, ws, userId);
  assert.equal((await feedOf(pool, ws, userId))?.last_used_at, null);
  await icsByToken(pool, token, NOW, undefined);
  assert.notEqual((await feedOf(pool, ws, userId))?.last_used_at, null);
});

test('Erledigtes und Weggeworfenes kommen nicht mit', async () => {
  const ws = await scratch('cal-weg');
  const offen = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Bleibt morgen 9 Uhr',
    now: NOW,
  });
  const fertig = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Fertig morgen 9 Uhr',
    now: NOW,
  });
  const muell = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Muell morgen 9 Uhr',
    now: NOW,
  });
  await pool.query('UPDATE tasks SET completed_at = now() WHERE id = $1', [fertig.task.id]);
  await pool.query('UPDATE tasks SET trashed_at = now() WHERE id = $1', [muell.task.id]);

  const { token } = await newFeed(pool, ws, userId);
  const text = (await icsByToken(pool, token, NOW, undefined))!;
  assert.ok(text.includes('SUMMARY:Bleibt'));
  assert.equal(text.includes('SUMMARY:Fertig'), false);
  assert.equal(text.includes('SUMMARY:Muell'), false);
});

test('eine Aufgabe ohne Datum steht nicht im Kalender', async () => {
  const ws = await scratch('cal-datumslos');
  await createFromLine(pool, { workspaceId: ws, userId, line: 'Irgendwann mal', now: NOW });
  const { token } = await newFeed(pool, ws, userId);
  const text = (await icsByToken(pool, token, NOW, undefined))!;
  assert.equal(text.includes('BEGIN:VEVENT'), false);
});

test('der Kalender zeigt nur DIESEN Arbeitsbereich', async () => {
  /*
   * Sonst wäre ein Link auf einen Bereich ein Link auf alle — und jemand, dem
   * man den Kalender eines Vereins gibt, sähe die Aufgaben der Familie mit.
   */
  const meins = await scratch('cal-meins');
  const fremd = await scratch('cal-fremd');
  await createFromLine(pool, { workspaceId: meins, userId, line: 'Hier morgen 9 Uhr', now: NOW });
  await createFromLine(pool, { workspaceId: fremd, userId, line: 'Dort morgen 9 Uhr', now: NOW });
  const { token } = await newFeed(pool, meins, userId);
  const text = (await icsByToken(pool, token, NOW, undefined))!;
  assert.ok(text.includes('SUMMARY:Hier'));
  assert.equal(text.includes('SUMMARY:Dort'), false);
});

test('eine Frist steht als eigener Eintrag daneben', async () => {
  const ws = await scratch('cal-frist');
  const t = await createFromLine(pool, {
    workspaceId: ws,
    userId,
    line: 'Steuer morgen 9 Uhr',
    now: NOW,
  });
  await patch(pool, t.task.id, ws, { dueAt: new Date(Date.UTC(2026, 8, 30, 12, 0)) });
  const { token } = await newFeed(pool, ws, userId);
  const text = (await icsByToken(pool, token, NOW, undefined))!;
  assert.equal(text.split('BEGIN:VEVENT').length - 1, 2);
  assert.ok(text.includes('SUMMARY:Frist: Steuer'));
});
