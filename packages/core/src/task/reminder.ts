/**
 * SOTE — wann eine Erinnerung fällig ist.
 *
 * Im Kern und nicht im Server, aus demselben Grund wie die Wiederholung: das
 * ist eine Rechnung über Daten, keine Frage an die Datenbank. Und der Test
 * dafür braucht kein Postgres.
 *
 * ## Zwei Formen, eine Antwort
 *
 * Eine Erinnerung ist entweder **relativ** — so viele Minuten vor dem
 * geplanten Zeitpunkt — oder **absolut**: dann und nicht anders. Beide geben
 * hier einen Zeitpunkt zurück oder `undefined`, wenn es keinen gibt.
 *
 * Relativ gespeichert, weil ein absoluter Zeitpunkt nach jedem Verschieben der
 * Aufgabe falsch wäre — und ein Programm, das nach dem Verschieben zur alten
 * Zeit klingelt, ist eines, dem man nicht mehr glaubt.
 */

/** Eine Erinnerung, wie sie an der Aufgabe steht. */
/*
 * `TaskReminder` und nicht `TaskReminder`: `Reminders` heißt schon die EINSTELLUNG
 * (ob und wann die Tagesmail kommt, `look/reminders.ts`). Zwei Namen, die sich
 * um einen Buchstaben unterscheiden und Verschiedenes meinen, sind zwei Namen,
 * die jemand verwechselt.
 */
export type TaskReminder =
  | {
      readonly kind: 'before';
      /** Vorlauf in Minuten. `0` heißt „pünktlich". */
      readonly minutes: number;
    }
  | {
      readonly kind: 'at';
      readonly at: Date;
    };

export class TaskReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderError';
  }
}

/**
 * Die üblichen Vorläufe, in der Reihenfolge, in der man sie anbietet.
 *
 * Eine kurze Liste und kein Zahlenfeld: „37 Minuten vorher" ist eine Angabe,
 * die niemand macht, und ein Feld dafür wäre eines, in dem man erst rechnet.
 * Wer eine feste Uhrzeit will, nimmt die absolute Form.
 */
export const COMMON_LEAD_MINUTES = [0, 10, 30, 60, 24 * 60] as const;

/** Was so ein Vorlauf auf Deutsch heißt. */
export function saysLead(minutes: number): string {
  if (minutes === 0) return 'pünktlich';
  if (minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return d === 1 ? 'einen Tag vorher' : `${d} Tage vorher`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? 'eine Stunde vorher' : `${h} Stunden vorher`;
  }
  return `${minutes} Minuten vorher`;
}

/** Was eine Erinnerung auf Deutsch sagt. */
export function describeTaskReminder(r: TaskReminder, zone?: string): string {
  if (r.kind === 'before') return saysLead(r.minutes);
  return r.at.toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(zone === undefined ? {} : { timeZone: zone }),
  });
}

/**
 * Wann sie klingelt — oder `undefined`.
 *
 * Eine relative Erinnerung an einer Aufgabe **ohne geplanten Zeitpunkt** hat
 * keinen: „30 Minuten vor nichts" ist keine Zeit. Sie bleibt gespeichert und
 * wird fällig, sobald die Aufgabe einen Termin bekommt — das ist der Grund,
 * warum hier `undefined` steht und nicht ein Fehler.
 */
export function taskReminderDueAt(r: TaskReminder, plannedAt: Date | null): Date | undefined {
  if (r.kind === 'at') return r.at;
  if (plannedAt === null) return undefined;
  return new Date(plannedAt.getTime() - r.minutes * 60_000);
}

/**
 * Ist sie jetzt fällig?
 *
 * `sentAt` zählt mit: eine verschickte Erinnerung ist nicht mehr fällig, auch
 * wenn ihr Zeitpunkt in der Vergangenheit liegt. Sonst schickt der Bearbeiter
 * beim nächsten Durchgang denselben Brief noch einmal.
 */
export function taskReminderIsDue(
  r: TaskReminder,
  input: { readonly plannedAt: Date | null; readonly sentAt: Date | null; readonly now: Date },
): boolean {
  if (input.sentAt !== null) return false;
  const due = taskReminderDueAt(r, input.plannedAt);
  if (due === undefined) return false;
  return due.getTime() <= input.now.getTime();
}

/**
 * Aus den Spalten eine Erinnerung machen — oder werfen.
 *
 * Geworfen und nicht stillschweigend übergangen: eine Zeile, die beides oder
 * keines trägt, kann die Datenbank nicht enthalten (`reminder_is_one_kind`).
 * Kommt sie doch, ist etwas kaputt, und das gehört gesagt.
 */
export function readTaskReminder(row: {
  readonly offset_minutes: number | null;
  readonly at: Date | null;
}): TaskReminder {
  if (row.offset_minutes !== null && row.at === null) {
    return { kind: 'before', minutes: row.offset_minutes };
  }
  if (row.at !== null && row.offset_minutes === null) return { kind: 'at', at: row.at };
  throw new TaskReminderError('eine Erinnerung ist entweder relativ oder absolut, nicht beides');
}
