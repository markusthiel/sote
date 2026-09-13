/**
 * SOTE — der Kalender rechnet mit Tagen, nicht mit Zeitpunkten.
 *
 * Rein und ohne `window`: alles hier nimmt ein Datum und gibt Daten zurück,
 * damit ein Test darüber möglich ist. Die Zone ist die des Browsers — ein
 * `Date` ist in ihr, und `getDay()`, `setDate()` rechnen in ihr. Das ist
 * richtig: der Kalender zeigt Tage, wie die Person sie erlebt, und der Server
 * bekommt die Grenzen als Augenblicke (`toISOString`), nicht als Tage.
 *
 * ## Die Woche beginnt am Montag
 *
 * Wie jeder Kalender hierzulande. `getDay()` zählt ab Sonntag, darum das
 * `(d + 6) % 7`.
 *
 * ## Ein Tag als `YYYY-MM-DD` in der Adresse
 *
 * Kein Zeitpunkt in der Adresse: `/kalender/woche/2026-09-14` heisst „die
 * Woche, in der der 14. liegt", egal in welcher Zone die Adresse gelesen wird.
 * Ein ISO-Zeitpunkt in der Adresse wäre in einer anderen Zone ein anderer Tag.
 */

export type CalendarSpan = 'month' | 'week' | 'day';

export const isCalendarSpan = (v: unknown): v is CalendarSpan =>
  v === 'month' || v === 'week' || v === 'day';

/** Mitternacht dieses Tages, örtlich. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  // Auf den Ersten, damit der 31. Januar plus ein Monat nicht der 3. März wird.
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return out;
}

/** Der Montag der Woche, in der `d` liegt. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** `2026-09-14` — der Tag, wie er in der Adresse steht. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

/** Liest `YYYY-MM-DD` als örtliche Mitternacht; Unsinn wird `undefined`. */
export function parseIsoDate(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return undefined;
  // Der 31.02. wird von `Date` zum 3.3. — das ist kein Tag, den jemand gemeint hat.
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return undefined;
  return d;
}

/**
 * Das Fenster einer Ansicht: `from` einschliesslich, `to` ausschliesslich —
 * so, wie `/api/span` es nimmt — und die Tage, die gezeichnet werden.
 *
 * Der Monat wird als volle Wochen gezeichnet (Montag bis Sonntag), also mit
 * Rand aus dem Vormonat und dem nächsten: sechs Zeilen, damit die Höhe nicht
 * von Monat zu Monat springt.
 */
export function spanOf(span: CalendarSpan, date: Date): { from: Date; to: Date; days: Date[] } {
  if (span === 'day') {
    const from = startOfDay(date);
    return { from, to: addDays(from, 1), days: [from] };
  }
  if (span === 'week') {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
  }
  const from = startOfWeek(startOfMonth(date));
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, 42), days };
}

/** Einen Schritt vor oder zurück — in der Einheit der Ansicht. */
export function step(span: CalendarSpan, date: Date, n: 1 | -1): Date {
  if (span === 'day') return addDays(date, n);
  if (span === 'week') return addDays(date, 7 * n);
  return addMonths(date, n);
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const SHORT_DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Die Kalenderwoche nach ISO 8601 — die, die auf jedem Kalender hierzulande steht.
 */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
}

/** Die Überschrift der Ansicht. */
export function titleOf(span: CalendarSpan, date: Date): string {
  if (span === 'month') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  if (span === 'day') {
    return `${DAYS[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }
  const from = startOfWeek(date);
  const to = addDays(from, 6);
  const gleicherMonat = from.getMonth() === to.getMonth();
  const anfang = gleicherMonat ? `${from.getDate()}.` : `${from.getDate()}. ${MONTHS[from.getMonth()]}`;
  return `KW ${isoWeek(from)} · ${anfang} – ${to.getDate()}. ${MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

/** `9:00` — die Uhrzeit eines Blocks, ohne Sekunden und ohne führende Null. */
export const clock = (d: Date): string =>
  `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
