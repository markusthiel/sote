/**
 * SOTE — Erinnerungen an einer Aufgabe.
 *
 * Die zweite Hälfte dessen, was TickTick und Todoist „Reminder" nennen. Die
 * erste ist die Tagesmail (`reminders.ts`): ein Brief am Morgen mit dem
 * Überblick. Hier geht es um mehrere Erinnerungen JE AUFGABE, jede mit ihrem
 * eigenen Zeitpunkt.
 *
 * ## Genau einmal, oder gar nicht
 *
 * Quittung und Mailauftrag stehen in **einer** Transaktion — dasselbe Muster
 * wie bei der Tagesmail, und aus demselben Grund: bräche es dazwischen, käme
 * derselbe Brief beim nächsten Durchgang noch einmal (oder gar nicht mehr).
 * Die Quittung ist `sent_at` an der Zeile selbst; zwei Tabellen wären zwei
 * Wahrheiten über denselben Brief.
 *
 * ## Ohne Mailweg gibt es das nicht
 *
 * `scheduleTaskReminders` gibt `false` zurück, wenn keine Mail konfiguriert
 * ist, und legt dann keinen Auftrag an. Ein Bearbeiter, der stündlich läuft und
 * nichts schicken kann, ist ein Bearbeiter, der Protokoll füllt — und die
 * Oberfläche fragt dieselbe Bedingung, damit dort kein Feld steht, das nichts
 * tut.
 */

import { describeTaskReminder, readTaskReminder, taskReminderDueAt, type TaskReminder } from '@sote/core';
import type { Pool } from 'pg';

import { queryRows, withTransaction } from './db.js';
import { handle } from './jobs.js';
import { enqueue } from './jobs.js';
import { mailConfig } from './mail.js';

/** Wie oft der Bearbeiter nachsieht. */
const EVERY_MS = 5 * 60 * 1000;

export interface StoredReminder {
  readonly id: string;
  readonly userId: string;
  readonly reminder: TaskReminder;
  readonly sentAt: Date | null;
  /** Wann sie klingelt — `null`, wenn die Aufgabe (noch) keinen Termin hat. */
  readonly dueAt: Date | null;
  readonly says: string;
}

interface Row {
  id: string;
  user_id: string;
  offset_minutes: number | null;
  at: Date | null;
  sent_at: Date | null;
}

/**
 * Die Erinnerungen einer Aufgabe.
 *
 * Alle, nicht nur die eigenen: wer eine Aufgabe sieht, sieht auch, dass jemand
 * anders daran erinnert wird — sonst setzt man eine zweite, weil man die erste
 * nicht kennt. Wessen sie ist, steht dran.
 */
export async function remindersOf(
  pool: Pool,
  taskId: string,
  plannedAt: Date | null,
  zone?: string,
): Promise<StoredReminder[]> {
  const rows = await queryRows<Row>(
    pool,
    `SELECT id, user_id, offset_minutes, at, sent_at
       FROM task_reminders WHERE task_id = $1
      ORDER BY coalesce(offset_minutes, 0) DESC, at ASC`,
    [taskId],
  );
  return rows.map((r) => {
    const reminder = readTaskReminder(r);
    const due = taskReminderDueAt(reminder, plannedAt);
    return {
      id: r.id,
      userId: r.user_id,
      reminder,
      sentAt: r.sent_at,
      dueAt: due ?? null,
      says: describeTaskReminder(reminder, zone),
    };
  });
}

/**
 * Eine setzen. Zweimal dieselbe ist keine zweite.
 *
 * `ON CONFLICT DO NOTHING` gegen `reminder_not_twice`: ein Doppelklick ist
 * keine Ansage, dass man zweimal erinnert werden will.
 */
export async function addReminder(
  pool: Pool,
  input: { taskId: string; userId: string; reminder: TaskReminder },
): Promise<void> {
  const r = input.reminder;
  await pool.query(
    `INSERT INTO task_reminders (task_id, user_id, offset_minutes, at)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [
      input.taskId,
      input.userId,
      r.kind === 'before' ? r.minutes : null,
      r.kind === 'at' ? r.at : null,
    ],
  );
}

/**
 * Eine wegnehmen — nur die eigene.
 *
 * Die Bedingung steht im Schreibweg und nicht als Prüfung davor: sonst gibt es
 * einen Augenblick zwischen „darf ich" und „ich tue", in dem sich die Antwort
 * ändern kann.
 */
export async function removeReminder(
  pool: Pool,
  input: { id: string; taskId: string; userId: string },
): Promise<boolean> {
  const res = await pool.query(
    'DELETE FROM task_reminders WHERE id = $1 AND task_id = $2 AND user_id = $3',
    [input.id, input.taskId, input.userId],
  );
  return (res.rowCount ?? 0) > 0;
}

interface DueRow {
  id: string;
  offset_minutes: number | null;
  at: Date | null;
  sent_at: Date | null;
  planned_at: Date | null;
  title: string;
  email: string;
  display_name: string;
  zone: string | null;
}

/**
 * Was fällig ist, verschicken.
 *
 * Die Auswahl grenzt in SQL vor (offen, und die Aufgabe ist weder erledigt noch
 * im Papierkorb) und rechnet die Fälligkeit im Kern — `taskReminderDueAt` ist
 * dieselbe Funktion, die die Oberfläche benutzt, damit dort nicht „in 5
 * Minuten" steht, während der Server anders rechnet.
 */
export async function sendTaskReminders(pool: Pool, now = new Date()): Promise<void> {
  const base = process.env['SOTE_BASE_URL'];
  const rows = await queryRows<DueRow>(
    pool,
    `SELECT tr.id, tr.offset_minutes, tr.at, tr.sent_at,
            t.planned_at, t.title,
            u.email, u.display_name,
            -- Die Zone der Person, abgesehen bei der Tagesmail und nicht
            -- erfunden: mein erster Anlauf fragte s.value und s.key, die es
            -- beide nicht gibt. (Und KEINE Backticks in diesem Kommentar --
            -- er steht in einem Template-Literal, und ein Backtick darin
            -- beendet die Zeichenkette. Der Übersetzer meldete dann einen
            -- Klammerfehler zwanzig Zeilen weiter.)
            (SELECT s.data ->> 'zone' FROM settings s
              WHERE s.scope = 'user' AND s.scope_id = u.id) AS zone
       FROM task_reminders tr
       JOIN tasks t ON t.id = tr.task_id
       JOIN users u ON u.id = tr.user_id
      WHERE tr.sent_at IS NULL
        AND t.completed_at IS NULL
        AND t.trashed_at IS NULL`,
  );

  for (const row of rows) {
    const reminder = readTaskReminder(row);
    const due = taskReminderDueAt(reminder, row.planned_at);
    if (due === undefined || due.getTime() > now.getTime()) continue;

    /*
     * Quittung und Brief in EINER Transaktion, und die Quittung zuerst mit
     * `sent_at IS NULL` als Bedingung: läuft der Bearbeiter zweimal
     * gleichzeitig, gewinnt einer und der andere sieht `rowCount === 0`.
     */
    await withTransaction(pool, async (client) => {
      const res = await client.query(
        'UPDATE task_reminders SET sent_at = now() WHERE id = $1 AND sent_at IS NULL',
        [row.id],
      );
      if (res.rowCount === 0) return;
      const wann = describeTaskReminder(reminder, row.zone ?? undefined);
      await client.query(`INSERT INTO jobs (kind, payload) VALUES ('mail.send', $1)`, [
        {
          to: row.email,
          subject: `SOTE: ${row.title}`,
          text: [
            `${row.display_name.split(' ')[0] ?? row.display_name},`,
            '',
            `Erinnerung: ${row.title}`,
            reminder.kind === 'before' ? `(${wann})` : '',
            ...(base === undefined ? [] : ['', base]),
            '',
            'Diese Erinnerung hast du an der Aufgabe selbst gesetzt.',
          ]
            .filter((l) => l !== '')
            .join('\n'),
        },
      ]);
    });
  }

  // Der nächste Durchgang steht im Auftrag selbst — ein Ort, an dem steht, wie
  // oft etwas läuft (dieselbe Bauart wie bei der Tagesmail).
  await enqueue(pool, 'taskReminders.tick', {
    runAt: new Date(now.getTime() + EVERY_MS),
    uniqueKey: 'taskReminders.tick',
  });
}

/*
 * Der Bearbeiter nimmt einen `JobContext` (pool, now, job) — nachgesehen in
 * `jobs.ts`, nachdem der Übersetzer meine direkte Übergabe abgelehnt hat.
 * `now` kommt aus dem Auftrag und nicht aus `new Date()`: so kann ein Test den
 * Zeitpunkt setzen.
 */
handle('taskReminders.tick', (ctx) => sendTaskReminders(ctx.pool, ctx.now));

/** Startet den Bearbeiter — nur wenn es einen Mailweg gibt. */
export async function scheduleTaskReminders(pool: Pool): Promise<boolean> {
  if (mailConfig() === undefined) return false;
  await enqueue(pool, 'taskReminders.tick', { uniqueKey: 'taskReminders.tick' });
  return true;
}
