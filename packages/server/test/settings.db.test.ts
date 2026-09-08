/**
 * SOTE — Einstellungen auf drei Ebenen.
 *
 * Zwei Dinge stehen hier auf dem Spiel, und beide sind stille Fehler:
 *
 * 1. Die **Reihenfolge** — wer die Instanz über die Person gewinnen lässt,
 *    merkt es erst, wenn jemand fragt, warum seine Wahl nichts tut.
 * 2. Dass ein Schreiben **nicht wegwirft**, was es nicht kennt. Eine ältere
 *    Fassung, die die Werte einer neueren löscht, ist Datenverlust, der wie
 *    ein Speichern aussieht.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { createAccountIn } from '../src/bootstrap.js';
import { makePool, queryOne, withTransaction } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { effectiveFor, mayChange, patchSettings } from '../src/settings.js';
import { OutOfOrder } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
let workspaceId: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  // Ein eigenes Konto je Lauf, damit parallele Testdateien sich nicht in die
  // Quere kommen — Adressen sind eindeutig.
  userId = await withTransaction(pool, (c) =>
    createAccountIn(c, {
      email: `settings-${process.pid}@example.org`,
      displayName: 'Probe',
      password: 'ein gutes Kennwort',
      workspaceName: `Einstellungen ${process.pid}`,
    }),
  );
  const ws = await queryOne<{ workspace_id: string }>(
    pool,
    'SELECT workspace_id FROM workspace_members WHERE user_id = $1',
    [userId],
  );
  workspaceId = ws!.workspace_id;
});

after(async () => {
  await pool.query(`DELETE FROM settings WHERE scope_id IN ($1, $2) OR scope = 'instance'`, [
    userId,
    workspaceId,
  ]);
  await pool.end();
});

test('ohne jede Einstellung entscheidet das Gerät', async () => {
  const { effective } = await effectiveFor(pool, userId, workspaceId);
  assert.equal(effective.scheme, 'system');
  assert.equal(effective.zone, undefined);
});

test('die Instanz gilt, solange niemand darüber etwas sagt', async () => {
  await patchSettings(pool, 'instance', null, { scheme: 'dark' });
  const { effective, levels } = await effectiveFor(pool, userId, workspaceId);
  assert.equal(effective.scheme, 'dark');
  assert.deepEqual(levels.instance, { scheme: 'dark' });
  assert.deepEqual(levels.user, {}, 'die Person hat nichts gesagt');
});

test('der Arbeitsbereich schlägt die Instanz, die Person schlägt beide', async () => {
  await patchSettings(pool, 'workspace', workspaceId, { scheme: 'light' });
  assert.equal((await effectiveFor(pool, userId, workspaceId)).effective.scheme, 'light');

  await patchSettings(pool, 'user', userId, { scheme: 'dark' });
  assert.equal((await effectiveFor(pool, userId, workspaceId)).effective.scheme, 'dark');
});

test('„system" gewinnt gegen einen Arbeitsbereich, der dunkel sagt', async () => {
  // Die Stelle, an der eine Vorrangregel typischerweise kippt: wer
  // ausdrücklich „wie das Gerät" wählt, will das auch dann.
  await patchSettings(pool, 'user', userId, { scheme: 'system' });
  assert.equal((await effectiveFor(pool, userId, workspaceId)).effective.scheme, 'system');
});

test('null leert, ein fehlender Schlüssel lässt stehen', async () => {
  await patchSettings(pool, 'user', userId, { scheme: 'dark', zone: 'Europe/Berlin' });
  // Nur die Zone anfassen — das Schema bleibt.
  await patchSettings(pool, 'user', userId, { zone: 'Pacific/Auckland' });
  let levels = (await effectiveFor(pool, userId, workspaceId)).levels;
  assert.deepEqual(levels.user, { scheme: 'dark', zone: 'Pacific/Auckland' });

  await patchSettings(pool, 'user', userId, { scheme: null });
  levels = (await effectiveFor(pool, userId, workspaceId)).levels;
  assert.deepEqual(levels.user, { zone: 'Pacific/Auckland' });
});

test('was der Kern nicht kennt, bleibt liegen statt gelöscht zu werden', async () => {
  // Der Fall: eine neuere Fassung hat etwas gespeichert, eine ältere schreibt
  // daneben. Sie darf den fremden Wert nicht wegwerfen, nur weil sie ihn nicht
  // lesen kann — das wäre Datenverlust, der wie ein Speichern aussieht.
  await pool.query(
    `INSERT INTO settings (scope, scope_id, data) VALUES ('user', $1, $2)
     ON CONFLICT (scope, scope_id) DO UPDATE SET data = EXCLUDED.data`,
    [userId, JSON.stringify({ scheme: 'dark', ausDerZukunft: { was: 'auch immer' } })],
  );
  await patchSettings(pool, 'user', userId, { zone: 'Europe/Berlin' });

  const row = await queryOne<{ data: Record<string, unknown> }>(
    pool,
    `SELECT data FROM settings WHERE scope = 'user' AND scope_id = $1`,
    [userId],
  );
  assert.deepEqual(row?.data['ausDerZukunft'], { was: 'auch immer' }, 'liegt noch da');
  assert.equal(row?.data['zone'], 'Europe/Berlin');
});

test('ein Wert, der keiner ist, wird abgelehnt statt still verworfen', async () => {
  // Ein ungültiger Wert in der Datenbank wäre still; ein abgelehnter Aufruf
  // ist es nicht.
  await assert.rejects(
    () => patchSettings(pool, 'user', userId, { scheme: 'sepia' }),
    OutOfOrder,
  );
  await assert.rejects(
    () => patchSettings(pool, 'user', userId, { zone: 'Europa/Berlin' }),
    OutOfOrder,
  );
});

test('die Instanz hat kein Gegenüber, die anderen brauchen eines', async () => {
  await assert.rejects(
    () => patchSettings(pool, 'instance', workspaceId, { scheme: 'dark' }),
    OutOfOrder,
  );
  await assert.rejects(() => patchSettings(pool, 'user', null, { scheme: 'dark' }), OutOfOrder);
});

test('die eigenen darf man immer, die anderen als Eigentümer', async () => {
  assert.equal(await mayChange(pool, 'user', userId, workspaceId), true);
  // Das Konto aus der Einrichtung ist Eigentümer seines Arbeitsbereichs.
  assert.equal(await mayChange(pool, 'workspace', userId, workspaceId), true);
});

test('wer nicht Mitglied ist, darf am Arbeitsbereich nichts ändern', async () => {
  const stranger = await withTransaction(pool, (c) =>
    createAccountIn(c, {
      email: `fremd-${process.pid}@example.org`,
      displayName: 'Fremd',
      password: 'ein gutes Kennwort',
    }),
  );
  assert.equal(await mayChange(pool, 'workspace', stranger, workspaceId), false);
  // Die eigenen aber schon — es sind seine.
  assert.equal(await mayChange(pool, 'user', stranger, workspaceId), true);
});

test('„Wie entworfen" beim letzten Feld ist ein Zurücknehmen, kein Fehler', async () => {
  /*
   * Der Fehler, den es gab, gemeldet mit Bild: die schmale Leiste auf
   * „Vertieft" und dann zurück auf „Wie entworfen" antwortete
   * *„look" nimmt diesen Wert nicht*.
   *
   * Warum: das Formular schickt dann `look: { surfaces: {} }`, `readLook` macht
   * daraus `{}`, und `readSettings` lässt ein leeres `look` weg — es ist ja
   * nichts gesetzt. Die Prüfung sah „Schlüssel nicht in `kept`" und schloss auf
   * einen ungültigen Wert.
   *
   * „Nichts gesetzt" und „nicht vorhanden" sind derselbe Zustand.
   */
  await patchSettings(pool, 'instance', null, { look: { surfaces: { rail: 'sunken' } } });
  const zurück = await patchSettings(pool, 'instance', null, { look: { surfaces: {} } });
  assert.equal('look' in zurück, false, 'nichts gesetzt');

  // Und dasselbe für ein ganz leeres `look` und für ein leeres `landing`.
  await patchSettings(pool, 'instance', null, { look: { corners: 'round' } });
  await patchSettings(pool, 'instance', null, { look: {} });
  const stand = await patchSettings(pool, 'instance', null, {});
  assert.equal('look' in stand, false);
});

test('ein wirklich ungültiger Wert wird weiter abgelehnt', async () => {
  // Die Grenze: „leer" ist ein Zurücknehmen, „Unsinn" nicht. Ohne diesen Test
  // wäre die Behebung oben eine, die alles durchlässt.
  await assert.rejects(
    () => patchSettings(pool, 'instance', null, { look: { corners: '999px' } }),
    (e: unknown) => /nimmt diesen Wert nicht/.test((e as Error).message),
  );
  await assert.rejects(
    () => patchSettings(pool, 'instance', null, { scheme: 'mondlicht' }),
    (e: unknown) => /nimmt diesen Wert nicht/.test((e as Error).message),
  );
});
