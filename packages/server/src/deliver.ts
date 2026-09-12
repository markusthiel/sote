/**
 * SOTE — eine Meldung zustellen, über alle Kanäle, die gewählt sind.
 *
 * GEWÜNSCHT: „Können wir das hier auch einbauen und konfigurierbar machen, was
 * per E-Mail benachrichtigt wird, über die Oberfläche oder per App?"
 *
 * ## Warum es EINE Stelle gibt
 *
 * Vorher schrieb `notify()` eine Zeile in den Posteingang, und der Versand per
 * Mail hing woanders (bei den Erinnerungen). Mit drei Kanälen und fünf Arten
 * wären das fünfzehn Entscheidungen, verteilt über den Code — und die erste,
 * die jemand vergisst, ist eine Meldung, die still nirgends ankommt.
 *
 * Hier steht sie einmal: Posteingang immer, Mail und App nach Wahl.
 *
 * ## Der Posteingang ist kein Kanal
 *
 * Er ist der Ort, an dem eine Meldung ohnehin steht. Ihn abschaltbar zu machen
 * hiesse, Meldungen zu erzeugen, die niemand je sieht — und dann eine Zahl
 * daneben anzuzeigen, die niemand erklären kann.
 *
 * ## Die Zeile entsteht in DERSELBEN Transaktion, der Versand nicht
 *
 * `notify()` nimmt eine Verbindung und schreibt mit: sonst gäbe es einen
 * Zustand, in dem jemand zugewiesen ist und niemand es erfährt. Mail und App
 * gehen als AUFTRAG hinaus, also nach dem Festschreiben — ein Zustelldienst,
 * der gerade nicht erreichbar ist, darf keine Zuweisung zurückrollen.
 */

import { channelDefaults, type NoteKind } from '@sote/core';
import type { Pool } from 'pg';

import type { PoolClient } from './db.js';
import { queryOne } from './db.js';
import { notify } from './notifications.js';

export interface Channels {
  readonly email: boolean;
  readonly push: boolean;
}

/**
 * Was für diese Person und diese Art gilt.
 *
 * Keine Zeile heisst Vorgabe — und die steht im Kern. Eine Vorgabe in der
 * Datenbank müsste beim Anlegen jedes Kontos für jede Art eine Zeile schreiben
 * und bei jeder neuen Art über alle Konten wandern.
 */
export async function channelsFor(
  q: Pool | PoolClient,
  userId: string,
  kind: NoteKind,
): Promise<Channels> {
  const row = await queryOne<{ email: boolean; push: boolean }>(
    q,
    'SELECT email, push FROM notification_channels WHERE user_id = $1 AND kind = $2',
    [userId, kind],
  );
  return row ?? channelDefaults(kind);
}

/** Setzen — und `null` in beiden Feldern nimmt die Wahl zurück auf die Vorgabe. */
export async function setChannels(
  pool: Pool,
  userId: string,
  kind: NoteKind,
  channels: Channels | null,
): Promise<void> {
  if (channels === null) {
    await pool.query('DELETE FROM notification_channels WHERE user_id = $1 AND kind = $2', [
      userId,
      kind,
    ]);
    return;
  }
  await pool.query(
    `INSERT INTO notification_channels (user_id, kind, email, push)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, kind) DO UPDATE SET email = EXCLUDED.email, push = EXCLUDED.push`,
    [userId, kind, channels.email, channels.push],
  );
}

/**
 * Eine Meldung: in den Posteingang, und je nach Wahl weiter.
 *
 * Nimmt eine VERBINDUNG, weil die Zeile in dieselbe Transaktion gehört wie das
 * Ereignis. Die Aufträge für Mail und App werden in derselben Transaktion
 * gelegt und laufen erst nach dem Festschreiben — die Auftragstabelle ist
 * derselbe Speicher, also hängt beides an einem Faden.
 *
 * Über sich selbst meldet niemand: das prüft `notify()`, und wenn es dort
 * abbricht, soll auch keine Mail hinausgehen. Darum fragt diese Funktion
 * dieselbe Bedingung noch einmal, statt sich auf ein stilles Nichts zu
 * verlassen.
 */
export async function deliver(
  q: PoolClient,
  input: {
    userId: string;
    actorId: string | null;
    workspaceId: string;
    kind: NoteKind;
    taskId: string;
    /** Was in Mail und App steht. Der Posteingang baut seinen Satz selbst. */
    title: string;
    body: string;
    url: string;
  },
): Promise<void> {
  if (input.userId === input.actorId) return;

  /*
   * NUR AN MITGLIEDER.
   *
   * Wer den Arbeitsbereich verlassen hat oder entfernt wurde, bekommt keine
   * neuen Inhalte mehr — nicht in den Posteingang, nicht per Mail, nicht
   * aufs Gerät. Die Empfänger kommen aus Urheber und Zuständigen einer
   * Aufgabe, und beides überlebt den Austritt: der Urheber steht in der
   * Zeile, die Zuweisung wird beim Entfernen zwar gelöscht (`removePerson`),
   * aber `deliver` darf sich nicht darauf verlassen, dass jeder Weg dorthin
   * aufgeräumt hat. Bis zum Audit vom 12.09.2026 (F13) bekam ein
   * entferntes Konto weiter Mails mit Aufgabentitel und Kommentartext —
   * am empfindlichsten beim Ausscheiden Externer.
   *
   * Hier und nicht beim Aufrufer: es gibt fünf Aufrufer, und die Prüfung
   * gehört an die Stelle, an der die Meldung entsteht. Für `reminder` gilt
   * dasselbe — eine Erinnerung an eine Aufgabe, die man nicht mehr sieht,
   * ist eine Auskunft über sie.
   */
  const mitglied = await queryOne<{ ok: boolean }>(
    q,
    `SELECT true AS ok FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2`,
    [input.workspaceId, input.userId],
  );
  if (mitglied === undefined) return;

  /*
   * `commented`, `assigned`, `mentioned`, `replied` stehen im Posteingang;
   * `reminder` nicht — sie ist keine Nachricht von jemandem, sondern eine
   * Verabredung mit sich selbst, und sie steht schon als Aufgabe da.
   */
  if (input.kind !== 'reminder') {
    await notify(q, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      kind: input.kind === 'assigned' ? 'assigned' : 'commented',
      taskId: input.taskId,
      actorId: input.actorId,
    });
  }

  const wohin = await channelsFor(q, input.userId, input.kind);

  if (wohin.email) {
    const wer = await queryOne<{ email: string }>(
      q,
      'SELECT email FROM users WHERE id = $1',
      [input.userId],
    );
    if (wer !== undefined) {
      await q.query(`INSERT INTO jobs (kind, payload) VALUES ('mail.send', $1)`, [
        {
          to: wer.email,
          subject: input.title,
          text: `${input.body}\n\n${input.url}`,
        },
      ]);
    }
  }

  if (wohin.push) {
    await q.query(`INSERT INTO jobs (kind, payload) VALUES ('push.send', $1)`, [
      {
        userId: input.userId,
        note: {
          title: input.title,
          body: input.body,
          url: input.url,
          /*
           * Zwei Meldungen zu derselben Aufgabe ersetzen einander. Wer drei
           * Sätze hintereinander schreibt, soll nicht drei Meldungen erzeugen
           * — die dritte sagt ohnehin alles, was die ersten beiden sagten:
           * „sieh in diese Aufgabe".
           */
          tag: `task:${input.taskId}`,
        },
      },
    ]);
  }
}
