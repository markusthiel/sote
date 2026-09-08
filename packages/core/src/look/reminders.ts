/**
 * SOTE — Erinnerungen: eine Mail am Tag.
 *
 * ## Warum nicht eine je Aufgabe
 *
 * Eine Mail je fälliger Aufgabe heißt an einem normalen Dienstag dreißig
 * Mails, und dreißig Mails am Tag heißt einen Filter im Postfach — danach
 * erinnert nichts mehr an nichts. Also ein Brief, der sagt, was heute anliegt
 * und was überfällig ist.
 *
 * ## Die Einstellung gehört der Person
 *
 * Wie „wo du landest" (ADR-0032): der Wert ist die Wahl **einer** Person für
 * ihr eigenes Postfach. Zwei Mitglieder haben verschiedene Antworten, also
 * kann es keine Eigenschaft des Arbeitsbereichs sein — und die Instanz kommt
 * nicht vor, denn wann jemand Post will, ist keine Servereinstellung.
 *
 * ## Aus, bis jemand ja sagt
 *
 * `undefined` heißt aus. Wer sich anmeldet, hat nicht um Mail gebeten — und
 * eine Anwendung, die von selbst anfängt zu schreiben, ist eine, die man
 * abstellt, bevor man sie kennt.
 */

export interface Reminders {
  /** Ortszeit der Person, `HH:MM`. */
  readonly at: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isReminderTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v);

/**
 * Liest, was gespeichert ist.
 *
 * Eine Zeit, die keine ist, zählt als **aus** und nicht als Vorgabe: „08:00,
 * weil ich deine Eingabe nicht verstand" wäre Post zu einer Zeit, die niemand
 * gewählt hat.
 */
export function readReminders(value: unknown): Reminders | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const at = (value as Record<string, unknown>)['at'];
  return isReminderTime(at) ? { at } : undefined;
}
