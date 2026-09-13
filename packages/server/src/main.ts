/** SOTE — Serverstart. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SetupKey } from './bootstrap.js';
import { makePool } from './db.js';
import { loadConfig } from './env.js';
import { scheduleRecurring } from './handlers.js';
import { startRunner } from './jobs.js';
import { startListening } from './nudge.js';
import { scheduleReminders } from './reminders.js';
import { scheduleFeeds } from './calendarSources.js';
import { scheduleCalendarWrites } from './calendarWriters.js';
import { scheduleFileSweep } from './taskFiles.js';
import { scheduleTaskReminders } from './taskReminders.js';
import { migrate } from './migrate.js';
import { makeServer } from './routes.js';

const config = loadConfig();
const pool = makePool(config.databaseUrl);

const ran = await migrate(pool);
if (ran.length > 0) console.log(`migriert: ${ran.join(', ')}`);

// Die gebaute Oberfläche, falls sie da ist. Ohne sie ist SOTE eine API und
// sagt das auch, statt auf jeden Pfad 404 zu antworten.
const here = dirname(fileURLToPath(import.meta.url));
const candidate = join(here, '..', '..', 'web', 'dist');
const webRoot = existsSync(join(candidate, 'index.html')) ? candidate : undefined;
if (webRoot === undefined) console.log('keine Oberfläche gefunden — nur API');

/*
 * Solange es kein Konto gibt, steht der Einrichtungsschlüssel im Protokoll.
 *
 * Ins Protokoll und nicht in eine Datei: `docker compose logs server` ist der
 * eine Ort, an dem jemand nach einem ersten Start ohnehin nachsieht. Und
 * auffällig, weil eine Zeile zwischen Migrationsmeldungen keine ist.
 */
const setup = new SetupKey();
const key = await setup.openIfEmpty(pool);
if (key !== null) {
  console.log(
    [
      '',
      '  ┌─ Einrichtung ────────────────────────────────────────────',
      '  │  Es gibt noch kein Konto. Öffne SOTE im Browser und gib',
      '  │  diesen Schlüssel ein:',
      '  │',
      `  │      ${key}`,
      '  │',
      '  │  Er gilt für dieses eine Konto und verfällt beim Neustart.',
      '  └──────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

const server = makeServer({ pool, config, now: () => new Date(), webRoot, setup });
/*
 * Der Läufer für Aufträge, die später laufen.
 *
 * Im Serverprozess und nicht als eigener Dienst (Migration 0015 begründet es):
 * SOTE wird selbst betrieben, und ein zweites Ding zum Ausrollen und
 * Überwachen wäre für eine Handvoll Leute mit Aufgabenlisten die falsche
 * Rechnung.
 *
 * Nach `listen` und nicht davor: ein Läufer, der beim Start eine Datenbank
 * belegt, verzögert den ersten Anfragedienst — und der ist das, wofür der
 * Prozess da ist.
 */
server.listen(config.port, () => {
  void scheduleCalendarWrites(pool).catch((e: unknown) => console.error('Kalenderschreiben:', e));
  void scheduleRecurring(pool).catch((e: unknown) => console.error('Zeitplan:', e));
  /*
   * Erinnerungen nur, wenn dieser Server Mail verschicken kann — und wenn
   * nicht, wird es GESAGT. Ein Bearbeiter, der ohne seinen Ausgang läuft,
   * verbraucht die Quittungen für Briefe, die niemand zustellt.
   */
  void scheduleReminders(pool)
    .then((an) => {
      if (!an) console.log('Erinnerungen aus: dieser Server verschickt keine Mail');
    })
    .catch((e: unknown) => console.error('Erinnerungen:', e));
  /*
   * Und der Bearbeiter für die Erinnerungen AN AUFGABEN — ein zweiter, weil es
   * zwei verschiedene Dinge sind: die Tagesmail kommt einmal am Morgen, diese
   * kommen zu ihrer Zeit. Ein Bearbeiter für beides müsste zwei Zeitpläne
   * kennen.
   */
  void scheduleTaskReminders(pool)
    .then((an) => {
      if (!an) console.log('Aufgaben-Erinnerungen aus: dieser Server verschickt keine Mail');
    })
    .catch((e: unknown) => console.error('Aufgaben-Erinnerungen:', e));
  /*
   * Und der Aufräumer für verwaiste Anhänge. Kein Mailweg nötig — hier geht es
   * um Platz auf dem Datenträger, nicht um Briefe.
   */
  void scheduleFileSweep(pool)
    .then((an) => {
      if (!an) console.log('Anhänge aus: SOTE_FILES_DIR fehlt');
    })
    .catch((e: unknown) => console.error('Anhang-Aufräumer:', e));
  /*
   * Und der Takt für fremde Kalender — nur mit Schlüssel, denn ohne ihn
   * lässt sich keine Adresse entsiegeln, und ein Takt, der nichts lesen
   * kann, ist nur ein Fehler je Stunde im Protokoll.
   */
  void scheduleFeeds(pool)
    .then((an) => {
      if (!an) console.log('Fremde Kalender aus: SOTE_SHARE_KEY fehlt');
    })
    .catch((e: unknown) => console.error('Fremde Kalender:', e));
  startRunner(pool);
  /*
   * Die lauschende Verbindung, außerhalb des Pools.
   *
   * `LISTEN` bindet eine Verbindung dauerhaft — aus dem Pool genommen wäre sie
   * eine, die nie zurückkommt, und der Pool würde bei genug Neustarts
   * verhungern.
   */
  startListening(config.databaseUrl);
  console.log(`SOTE hört auf :${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
