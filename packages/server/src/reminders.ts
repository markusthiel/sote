/**
 * SOTE — Erinnerungen: ein Brief am Tag, zur gewählten Zeit.
 *
 * ## Genau einmal je Tag, obwohl der Läufer „mindestens einmal" zusagt
 *
 * Der Trick ist keiner: Quittung und Mailauftrag entstehen **in derselben
 * Transaktion**. Beides sind Zeilen in derselben Datenbank, also ist das
 * Einreihen wirklich genau einmal — läuft der Auftrag zweimal, scheitert die
 * zweite Quittung am Primärschlüssel und es entsteht kein zweiter Brief.
 *
 * Das **Zustellen** bleibt „mindestens einmal", denn das verlässt den Server.
 * Diese Grenze steht hier, weil sie der Unterschied zwischen einer Zusage und
 * einer Hoffnung ist.
 *
 * ## Die Zeit ist die der Person
 *
 * Gerechnet wird in ihrer Zone, und auch das Datum der Quittung ist ihr Datum.
 * Wer in Tokio um 8 Uhr erinnert wird, soll seinen Brief am japanischen
 * Dienstag bekommen — sonst gibt es einen Tag mit zwei Briefen und einen ohne.
 *
 * ## Ein Fenster, kein Zeitpunkt
 *
 * Der Tick läuft alle fünfzehn Minuten, also kann er 8:00 nie genau treffen.
 * Geschickt wird darum, sobald die gewählte Zeit **heute schon vorbei** ist —
 * und die Quittung verhindert, dass daraus jeden Tick ein Brief wird. Wer
 * SOTE mittags neu startet, bekommt seinen 8-Uhr-Brief also mittags: spät,
 * aber nicht gar nicht, und nicht zweimal.
 */

import type { Pool } from 'pg';

import { queryRows, withTransaction } from './db.js';
import { enqueue, handle, type JobContext } from './jobs.js';
import { baseUrl } from './invitations.js';
import { mailConfig } from './mail.js';

/** Wie oft nachgesehen wird, ob jemand fällig ist. */
const EVERY_MS = 15 * 60_000;

interface Fällig {
  user_id: string;
  email: string;
  display_name: string;
  for_date: string;
  heute: string;
  ueberfaellig: string;
}

/**
 * Wer jetzt einen Brief bekommt — und was drinsteht.
 *
 * **Eine Abfrage für alles**, und das ist hier mehr als Sparsamkeit: die
 * Auswahl („wer ist fällig") und die Zählung („was steht an") in zwei Schritten
 * zu machen hieße, dass zwischen ihnen eine Aufgabe abgehakt werden kann — und
 * dann steht im Brief eine Zahl, die es nie gab.
 */
async function fällige(pool: Pool): Promise<Fällig[]> {
  return queryRows<Fällig>(
    pool,
    `WITH person AS (
       SELECT u.id AS user_id, u.email, u.display_name,
              coalesce(s.data->>'zone', 'UTC') AS zone,
              s.data->'reminders'->>'at' AS at
         FROM users u
         JOIN settings s ON s.scope = 'user' AND s.scope_id = u.id
        WHERE s.data->'reminders'->>'at' IS NOT NULL
     ),
     jetzt AS (
       SELECT p.*,
              (now() AT TIME ZONE p.zone)::date AS heute_datum,
              to_char(now() AT TIME ZONE p.zone, 'HH24:MI') AS ortszeit
         FROM person p
     )
     SELECT j.user_id, j.email, j.display_name,
            j.heute_datum::text AS for_date,
            -- Was heute anliegt und was überfällig ist: zwei Zahlen, weil es
            -- zwei Sachen sind. „5 Aufgaben" sagt nicht, ob etwas brennt.
            (SELECT count(*) FROM tasks t
              WHERE t.completed_at IS NULL AND t.trashed_at IS NULL
                AND t.created_by = j.user_id
                AND (t.planned_at AT TIME ZONE j.zone)::date = j.heute_datum
            )::text AS heute,
            (SELECT count(*) FROM tasks t
              WHERE t.completed_at IS NULL AND t.trashed_at IS NULL
                AND t.created_by = j.user_id
                AND t.due_at < now()
            )::text AS ueberfaellig
       FROM jetzt j
      WHERE j.ortszeit >= j.at
        -- Die Quittung: für diesen Tag wurde noch nicht geschrieben. Auch hier
        -- geprüft und nicht nur beim Schreiben — sonst holt die Abfrage jeden
        -- Tick alle wieder, und die Arbeit wächst mit den Leuten.
        AND NOT EXISTS (
              SELECT 1 FROM reminders_sent r
               WHERE r.user_id = j.user_id AND r.for_date = j.heute_datum
            )`,
  );
}

function brief(f: Fällig, base: string | undefined): string {
  const heute = Number(f.heute);
  const spät = Number(f.ueberfaellig);
  const zeilen = [`Guten Morgen, ${f.display_name.split(' ')[0] ?? f.display_name}.`, ''];

  /*
   * Auch wenn nichts anliegt, wird geschrieben — und zwar genau dann anders.
   *
   * Ein Brief, der nur bei Arbeit kommt, ist ein Brief, dessen Ausbleiben
   * zweierlei heißen kann: nichts zu tun, oder SOTE ist kaputt. Ein kurzer
   * Satz an einem leeren Tag ist die billigste Auskunft darüber, dass die
   * Erinnerung noch läuft.
   */
  if (heute === 0 && spät === 0) {
    zeilen.push('Heute steht nichts an, und nichts ist überfällig.');
  } else {
    if (heute > 0) zeilen.push(`Heute: ${heute} ${heute === 1 ? 'Aufgabe' : 'Aufgaben'}.`);
    if (spät > 0) {
      zeilen.push(`Überfällig: ${spät} ${spät === 1 ? 'Aufgabe' : 'Aufgaben'}.`);
    }
  }

  if (base !== undefined) {
    zeilen.push('', base);
  }
  zeilen.push(
    '',
    'Diese Erinnerung stellst du in SOTE unter Einstellungen › Erinnerungen ab.',
  );
  return zeilen.join('\n');
}

async function sendReminders({ pool, now }: JobContext): Promise<void> {
  const base = baseUrl();
  for (const f of await fällige(pool)) {
    /*
     * Quittung und Mailauftrag in EINER Transaktion.
     *
     * Umgekehrt herum — erst Mail, dann Quittung — wäre ein Brief, der bei
     * einem Absturz dazwischen morgen nochmal kommt. Und die Quittung zuerst
     * ohne Transaktion wäre ein Tag ohne Brief. Beides sind Zeilen, also gibt
     * es keinen Grund, es nicht zusammen zu tun.
     *
     * `ON CONFLICT DO NOTHING` plus die Prüfung auf `rowCount`: liefen zwei
     * Läufer gleichzeitig, gewinnt einer und der andere schreibt nichts.
     */
    await withTransaction(pool, async (client) => {
      const res = await client.query(
        'INSERT INTO reminders_sent (user_id, for_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [f.user_id, f.for_date],
      );
      if (res.rowCount === 0) return;
      await client.query(
        `INSERT INTO jobs (kind, payload) VALUES ('mail.send', $1)`,
        [
          {
            to: f.email,
            subject:
              Number(f.ueberfaellig) > 0
                ? `SOTE: ${f.ueberfaellig} überfällig`
                : 'SOTE: was heute anliegt',
            text: brief(f, base),
          },
        ],
      );
    });
  }

  // Der nächste Tick, im Auftrag selbst — ein Ort, an dem steht, wie oft etwas
  // läuft (dieselbe Bauart wie beim Papierkorb).
  await enqueue(pool, 'reminders.tick', {
    runAt: new Date(now.getTime() + EVERY_MS),
    uniqueKey: 'reminders.tick',
  });
}

handle('reminders.tick', sendReminders);

/**
 * Beim Start einreihen — aber nur, wenn dieser Server Mail verschicken kann.
 *
 * Sonst liefe ein Auftrag alle fünfzehn Minuten, reihte Briefe ein, die
 * niemand zustellt, und **verbrauchte die Quittungen dabei**: nach einem Tag
 * ohne Mailserver hätte jeder eine Quittung und niemand einen Brief, und das
 * Nachholen wäre unmöglich. Ein Bearbeiter, der ohne seinen Ausgang läuft,
 * ist schlimmer als einer, der wartet.
 */
export async function scheduleReminders(pool: Pool): Promise<boolean> {
  if (mailConfig() === undefined) return false;
  await enqueue(pool, 'reminders.tick', { uniqueKey: 'reminders.tick' });
  return true;
}
