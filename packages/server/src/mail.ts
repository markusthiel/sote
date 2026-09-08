/**
 * SOTE — der Mailweg.
 *
 * ## Mail geht durch die Warteschlange, immer
 *
 * Kein Aufruf schickt eine Mail direkt. Eine Anfrage, die auf einen fremden
 * Server wartet, ist eine Anfrage, die hängt, wenn der fremde Server hängt —
 * und ein Mailserver, der nicht antwortet, würde damit ein Einladen oder ein
 * Abhaken langsam machen. Also: `queueMail` legt einen Auftrag, der Läufer
 * schickt ihn, und sein Fehlschlag wird zu einem Wiederversuch statt zu einer
 * Fehlermeldung an jemanden, der gerade etwas anderes tat.
 *
 * Das gibt außerdem, was der Läufer ohnehin kann: fünf Versuche mit
 * wachsendem Abstand, und ein Fehlschlag bleibt unter „Wartung" sichtbar,
 * statt still zu verschwinden.
 *
 * ## Mindestens einmal heißt hier: eine Mail kann doppelt kommen
 *
 * Das ist die Zusage des Läufers (Migration 0015), und bei Mail ist sie
 * spürbar. Sie ist trotzdem die richtige: die Gegenrichtung wäre „höchstens
 * einmal", also eine Mail, die manchmal **nicht** kommt — und eine Einladung,
 * die nicht ankommt, ist schlimmer als eine, die zweimal ankommt.
 *
 * ## Nodemailer und nicht selbst gebaut
 *
 * SMTP ist ein altes Protokoll mit vielen Ecken: STARTTLS, Authentifizierung,
 * Kodierung von Kopfzeilen, Zeilenlängen, `.` am Zeilenanfang. Das selbst zu
 * schreiben wäre Sparsamkeit an der falschen Stelle — die Fehler zeigen sich
 * nicht im Test, sondern bei dem einen Empfänger, dessen Server streng ist.
 *
 * ## Die Einstellungen gehören der Instanz
 *
 * Ein Mailserver ist eine Eigenschaft dieses Servers und nicht eines
 * Arbeitsbereichs (ADR-0032). Und sie stehen in der **Umgebung** und nicht in
 * der Datenbank: es sind Zugangsdaten, und dieselbe Überlegung wie beim
 * Freigabeschlüssel gilt — was in der Datenbank neben den Daten liegt, die es
 * schützt, schützt sie nicht.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { Pool } from 'pg';

import { enqueue, handle, type JobContext } from './jobs.js';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Was in der Umgebung steht — oder nichts.
 *
 * `undefined` heißt „dieser Server verschickt keine Mail", und das wird
 * **gesagt**, nicht stillschweigend angenommen: eine Einladung, die nie
 * ankommt, weil niemand einen Mailserver eingetragen hat, ist genau der
 * Fehler, den SONE vierzehn Mal hatte (ADR-0112).
 */
export function mailConfig(): MailConfig | undefined {
  const host = process.env['SOTE_SMTP_HOST'] ?? '';
  const from = process.env['SOTE_MAIL_FROM'] ?? '';
  if (host === '' || from === '') return undefined;
  const port = Number(process.env['SOTE_SMTP_PORT'] ?? '587');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  const user = process.env['SOTE_SMTP_USER'] ?? '';
  const pass = process.env['SOTE_SMTP_PASS'] ?? '';
  return {
    host,
    port,
    // 465 ist von Anfang an verschlüsselt, 587 verschlüsselt mit STARTTLS.
    // Abgeleitet und nicht als eigene Variable: eine dritte Angabe, die zu den
    // beiden anderen passen muss, ist eine, die irgendwann nicht passt.
    secure: (process.env['SOTE_SMTP_SECURE'] ?? '') === '' ? port === 465 : process.env['SOTE_SMTP_SECURE'] === 'true',
    ...(user === '' ? {} : { user }),
    ...(pass === '' ? {} : { pass }),
    from,
  };
}

let transport: Transporter | undefined;

function transporter(cfg: MailConfig): Transporter {
  // Einmal gebaut und behalten: eine Verbindung je Mail wäre ein Handschlag je
  // Mail, und bei einer Erinnerungsrunde sind das dreißig.
  transport ??= createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user === undefined ? {} : { auth: { user: cfg.user, pass: cfg.pass ?? '' } }),
  });
  return transport;
}

/** Nur für Tests: den gemerkten Versender wegwerfen. */
export function resetTransport(): void {
  transport = undefined;
}

export interface Letter {
  to: string;
  subject: string;
  /** Nur Text. Siehe unten, warum kein HTML. */
  text: string;
}

/**
 * Eine Mail in die Warteschlange legen.
 *
 * **Nur Text, kein HTML.** Nicht aus Sparsamkeit: eine Mail von SOTE sagt
 * einen Satz und trägt einen Link. HTML dazu bringt eine zweite Fassung
 * desselben Inhalts, die auseinanderlaufen kann, dazu Bilder, die geblockt
 * werden, und eine Gestaltung, die in jedem Programm anders bricht. Wenn eine
 * Mail eines Tages mehr sagen muss, ist das der Moment für die Entscheidung —
 * nicht jetzt, vorsorglich.
 */
export async function queueMail(pool: Pool, letter: Letter): Promise<void> {
  await enqueue(pool, 'mail.send', { payload: { ...letter } });
}

async function sendMail({ job }: JobContext): Promise<void> {
  const cfg = mailConfig();
  if (cfg === undefined) {
    /*
     * Ein Fehler und kein stilles Überspringen.
     *
     * Der Auftrag bleibt liegen und steht unter „Wartung" — mit einem Satz,
     * der die fehlenden Variablen nennt. Ihn wegzuwerfen wäre eine Mail, die
     * niemand vermisst, bis jemand fragt, warum keine Einladung ankam.
     */
    throw new Error(
      'dieser Server verschickt keine Mail: SOTE_SMTP_HOST und SOTE_MAIL_FROM fehlen',
    );
  }
  const to = String(job.payload['to'] ?? '');
  const subject = String(job.payload['subject'] ?? '');
  const text = String(job.payload['text'] ?? '');
  if (to === '' || subject === '' || text === '') {
    throw new Error('diese Mail hat keinen Empfänger, keinen Betreff oder keinen Text');
  }
  await transporter(cfg).sendMail({ from: cfg.from, to, subject, text });
}

handle('mail.send', sendMail);
