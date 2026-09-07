/**
 * SOTE — Wiederholungen.
 *
 * Zwei Arten, und sie sind absichtlich zwei Typen und nicht ein Feld mit einem
 * Schalter (Konzept, Abschnitt 3):
 *
 * - **kalenderfest** — „jeden zweiten Dienstag". Als RRULE gespeichert, weil
 *   CalDAV das ohnehin sprechen muss (Blatt 13). Der nächste Termin hängt nur
 *   am Kalender und am Anker `dtstart`.
 * - **erledigungsbezogen** — „drei Tage nach dem Abhaken". Hat in RRULE kein
 *   Gegenstück, bekommt also eigene Felder. Der nächste Termin **existiert
 *   nicht**, solange nicht abgehakt wurde; `nextOccurrence` gibt dafür `null`
 *   und nicht ein gerechnetes Datum zurück.
 *
 * Alles hier ist rein: `now` wird übergeben, nie gelesen. Der Browser rechnet
 * den Zeitpunkt aus (wie beim Zurückstellen in SONE, ADR-0075), der Server
 * prüft nur.
 *
 * Vom RRULE-Umfang ist bewusst nur die Teilmenge umgesetzt, die die Oberfläche
 * anbieten kann: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, BYDAY,
 * BYMONTHDAY, COUNT, UNTIL. Was nicht darin steht, wird beim Lesen abgelehnt
 * statt still ignoriert — eine Wiederholung, die anders läuft als sie dasteht,
 * ist schlimmer als eine, die sich weigert.
 */

export type Unit = 'day' | 'week' | 'month' | 'year';

export type Recurrence =
  | {
      readonly kind: 'calendar';
      /** RRULE ohne das Präfix `RRULE:`. */
      readonly rrule: string;
      /** Anker. Bestimmt bei INTERVAL > 1, welche Wochen/Monate zählen. */
      readonly dtstart: Date;
    }
  | {
      readonly kind: 'afterCompletion';
      readonly n: number;
      readonly unit: Unit;
    };

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
type Freq = (typeof FREQS)[number];

const KNOWN_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'COUNT',
  'UNTIL',
  'WKST',
]);

export interface Rule {
  readonly freq: Freq;
  readonly interval: number;
  readonly byDay: readonly Weekday[];
  readonly byMonthDay: readonly number[];
  readonly count: number | undefined;
  readonly until: Date | undefined;
}

/** `20260916T080000Z` oder `20260916`. */
function parseIcsDate(raw: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (!m) throw new RecurrenceError(`UNTIL ist kein Zeitpunkt: ${raw}`);
  const [, y, mo, d, hh, mm, ss] = m;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(hh ?? '0'),
      Number(mm ?? '0'),
      Number(ss ?? '0'),
    ),
  );
}

export function parseRrule(rrule: string): Rule {
  let freq: Freq | undefined;
  let interval = 1;
  const byDay: Weekday[] = [];
  const byMonthDay: number[] = [];
  let count: number | undefined;
  let until: Date | undefined;

  for (const part of rrule.split(';')) {
    if (part.trim() === '') continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new RecurrenceError(`RRULE-Teil ohne Wert: ${part}`);
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    if (!KNOWN_PARTS.has(key)) {
      throw new RecurrenceError(`RRULE-Teil wird nicht unterstützt: ${key}`);
    }
    switch (key) {
      case 'FREQ': {
        const f = value.toUpperCase() as Freq;
        if (!FREQS.includes(f)) {
          throw new RecurrenceError(`FREQ wird nicht unterstützt: ${value}`);
        }
        freq = f;
        break;
      }
      case 'INTERVAL': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) {
          throw new RecurrenceError(`INTERVAL ist keine Zahl ab 1: ${value}`);
        }
        interval = n;
        break;
      }
      case 'BYDAY': {
        for (const d of value.split(',')) {
          const w = d.trim().toUpperCase() as Weekday;
          if (!WEEKDAYS.includes(w)) {
            throw new RecurrenceError(`BYDAY kennt diesen Tag nicht: ${d}`);
          }
          byDay.push(w);
        }
        break;
      }
      case 'BYMONTHDAY': {
        for (const d of value.split(',')) {
          const n = Number(d.trim());
          if (!Number.isInteger(n) || n < 1 || n > 31) {
            throw new RecurrenceError(`BYMONTHDAY ist kein Tag: ${d}`);
          }
          byMonthDay.push(n);
        }
        break;
      }
      case 'COUNT': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) {
          throw new RecurrenceError(`COUNT ist keine Zahl ab 1: ${value}`);
        }
        count = n;
        break;
      }
      case 'UNTIL':
        until = parseIcsDate(value);
        break;
      case 'WKST':
        // Gelesen und verworfen: die Oberfläche bietet BYDAY-Mengen an, keine
        // Wochenanfänge. Ein Wert hier ändert nichts an der Auswertung unten,
        // also wird er nicht behauptet.
        break;
    }
  }

  if (freq === undefined) throw new RecurrenceError('RRULE ohne FREQ');
  return { freq, interval, byDay, byMonthDay, count, until };
}

const DAY = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function withTimeOf(day: Date, anchor: Date): Date {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
    ),
  );
}

/** Ganze Tage zwischen zwei Kalendertagen, vorzeichenbehaftet. */
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime()) / DAY);
}

/** Wochen zwischen zwei Tagen, gezählt ab dem Wochentag des Ankers. */
function weekIndex(day: Date, anchor: Date): number {
  return Math.floor(dayDiff(day, weekStart(anchor)) / 7);
}

/** Wochenanfang = derselbe Wochentag wie der Anker, oder früher. */
function weekStart(anchor: Date): Date {
  return startOfUtcDay(anchor);
}

function monthIndex(day: Date, anchor: Date): number {
  return (
    (day.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (day.getUTCMonth() - anchor.getUTCMonth())
  );
}

function matchesRule(day: Date, rule: Rule, dtstart: Date): boolean {
  const wd = WEEKDAYS[day.getUTCDay()]!;

  switch (rule.freq) {
    case 'DAILY': {
      const diff = dayDiff(day, dtstart);
      if (diff < 0 || diff % rule.interval !== 0) return false;
      return rule.byDay.length === 0 || rule.byDay.includes(wd);
    }
    case 'WEEKLY': {
      if (dayDiff(day, dtstart) < 0) return false;
      // Wochen ab dem Anker gezählt. Genau hier entscheidet sich
      // „jeden zweiten Dienstag": die Woche des Ankers ist Woche 0.
      const shift = (day.getUTCDay() - dtstart.getUTCDay() + 7) % 7;
      const alignedStart = new Date(startOfUtcDay(dtstart).getTime() + shift * DAY);
      const w = Math.floor(dayDiff(day, alignedStart) / 7);
      if (w < 0 || w % rule.interval !== 0) return false;
      const days = rule.byDay.length === 0 ? [WEEKDAYS[dtstart.getUTCDay()]!] : rule.byDay;
      return days.includes(wd);
    }
    case 'MONTHLY': {
      if (dayDiff(day, dtstart) < 0) return false;
      const m = monthIndex(day, dtstart);
      if (m < 0 || m % rule.interval !== 0) return false;
      if (rule.byMonthDay.length > 0) {
        return rule.byMonthDay.includes(day.getUTCDate());
      }
      if (rule.byDay.length > 0) return rule.byDay.includes(wd);
      return day.getUTCDate() === dtstart.getUTCDate();
    }
    case 'YEARLY': {
      if (dayDiff(day, dtstart) < 0) return false;
      const y = day.getUTCFullYear() - dtstart.getUTCFullYear();
      if (y < 0 || y % rule.interval !== 0) return false;
      return (
        day.getUTCMonth() === dtstart.getUTCMonth() &&
        day.getUTCDate() === dtstart.getUTCDate()
      );
    }
  }
}

/**
 * Wie weit vorausgesucht wird, bevor aufgegeben wird.
 *
 * Eine Regel wie BYMONTHDAY=31 überspringt Monate, YEARLY überspringt Jahre;
 * eine Obergrenze in Tagen wäre also entweder zu klein oder sinnlos groß. Zehn
 * Jahre sind die Grenze, und sie wird als Fehler gemeldet und nicht als „keine
 * Wiederholung" — der Unterschied zwischen „läuft aus" und „findet nichts" darf
 * nicht verschwinden.
 */
const MAX_SEARCH_DAYS = 3660;

export interface OccurrenceOptions {
  /** Wie oft die Aufgabe bereits gelaufen ist. Nur für COUNT nötig. */
  readonly completed?: number;
}

/**
 * Der nächste Termin **nach** `after`.
 *
 * `null` heißt: es gibt keinen. Bei `afterCompletion` heißt es „noch nicht
 * abgehakt" — dafür ist `nextAfterCompletion` da.
 */
export function nextOccurrence(
  rec: Recurrence,
  after: Date,
  options: OccurrenceOptions = {},
): Date | null {
  if (rec.kind === 'afterCompletion') return null;

  const rule = parseRrule(rec.rrule);
  const already = options.completed ?? 0;
  if (rule.count !== undefined && already >= rule.count) return null;

  const from = Math.max(startOfUtcDay(after).getTime(), startOfUtcDay(rec.dtstart).getTime());
  for (let i = 0; i <= MAX_SEARCH_DAYS; i += 1) {
    const day = new Date(from + i * DAY);
    if (!matchesRule(day, rule, rec.dtstart)) continue;
    const at = withTimeOf(day, rec.dtstart);
    if (at.getTime() <= after.getTime()) continue;
    if (rule.until !== undefined && at.getTime() > rule.until.getTime()) return null;
    return at;
  }
  throw new RecurrenceError(
    `kein Termin in ${MAX_SEARCH_DAYS} Tagen — die Regel trifft nichts: ${rec.rrule}`,
  );
}

/** Die nächsten `n` Termine. Kürzer als `n`, wenn die Regel ausläuft. */
export function nextOccurrences(
  rec: Recurrence,
  after: Date,
  n: number,
  options: OccurrenceOptions = {},
): Date[] {
  const out: Date[] = [];
  let cursor = after;
  let completed = options.completed ?? 0;
  for (let i = 0; i < n; i += 1) {
    const next = nextOccurrence(rec, cursor, { completed });
    if (next === null) break;
    out.push(next);
    cursor = next;
    completed += 1;
  }
  return out;
}

/**
 * Der nächste Termin einer erledigungsbezogenen Wiederholung.
 *
 * Getrennt von `nextOccurrence`, weil er ein Argument braucht, das es beim
 * kalenderfesten Fall nicht gibt: den Zeitpunkt des Abhakens. Zwei Funktionen
 * statt eines optionalen Arguments, damit keine Aufrufstelle vergessen kann,
 * welchen Fall sie vor sich hat.
 */
export function nextAfterCompletion(rec: Recurrence, completedAt: Date): Date | null {
  if (rec.kind !== 'afterCompletion') return null;
  return addUnits(completedAt, rec.n, rec.unit);
}

export function addUnits(at: Date, n: number, unit: Unit): Date {
  const d = new Date(at.getTime());
  switch (unit) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + n);
      return d;
    case 'week':
      d.setUTCDate(d.getUTCDate() + n * 7);
      return d;
    case 'month': {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      // Der 31. in einem kurzen Monat wird der Letzte und nicht der Erste des
      // Folgemonats: „in einem Monat" darf nicht einen Monat überspringen.
      const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      return d;
    }
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + n);
      return d;
  }
}

const UNIT_DE: Record<Unit, [one: string, many: string]> = {
  day: ['Tag', 'Tagen'],
  week: ['Woche', 'Wochen'],
  month: ['Monat', 'Monaten'],
  year: ['Jahr', 'Jahren'],
};

const WEEKDAY_DE: Record<Weekday, string> = {
  SU: 'Sonntag',
  MO: 'Montag',
  TU: 'Dienstag',
  WE: 'Mittwoch',
  TH: 'Donnerstag',
  FR: 'Freitag',
  SA: 'Samstag',
};

const ORDINAL_DE = ['', '', 'zweiten', 'dritten', 'vierten', 'fünften', 'sechsten'];

/**
 * Der Satz unter dem Bedienelement (Blatt 08).
 *
 * Er ist kein Beiwerk: das Bedienelement wird durch seine Ausgabe geprüft, und
 * eine Wiederholung, die man nicht zurücklesen kann, ist eine, der man nicht
 * traut. Darum liegt er hier neben der Auswertung und nicht in der Oberfläche —
 * sonst beschreibt der Satz irgendwann etwas anderes als die Regel tut.
 */
export function describe(rec: Recurrence): string {
  if (rec.kind === 'afterCompletion') {
    const [one, many] = UNIT_DE[rec.unit];
    const amount = rec.n === 1 ? `einem ${one}` : `${rec.n} ${many}`;
    return `${capitalize(amount)} nachdem du sie zuletzt abgehakt hast.`;
  }

  const rule = parseRrule(rec.rrule);
  const every = rule.interval === 1 ? 'Jeden' : `Jeden ${ORDINAL_DE[rule.interval] ?? `${rule.interval}.`}`;
  let core: string;

  switch (rule.freq) {
    case 'DAILY':
      core = rule.interval === 1 ? 'Jeden Tag' : `Alle ${rule.interval} Tage`;
      break;
    case 'WEEKLY': {
      const days = (rule.byDay.length > 0
        ? rule.byDay
        : [WEEKDAYS[rec.dtstart.getUTCDay()]!]
      ).map((d) => WEEKDAY_DE[d]);
      core =
        days.length === 1
          ? `${every} ${days[0]}`
          : rule.interval === 1
            ? `Jede Woche am ${joinDe(days)}`
            : `Alle ${rule.interval} Wochen am ${joinDe(days)}`;
      break;
    }
    case 'MONTHLY': {
      const which =
        rule.byMonthDay.length > 0
          ? `am ${joinDe(rule.byMonthDay.map((d) => `${d}.`))}`
          : `am ${rec.dtstart.getUTCDate()}.`;
      core =
        rule.interval === 1
          ? `Jeden Monat ${which}`
          : `Alle ${rule.interval} Monate ${which}`;
      break;
    }
    case 'YEARLY':
      core =
        rule.interval === 1
          ? `Jedes Jahr am ${rec.dtstart.getUTCDate()}.${rec.dtstart.getUTCMonth() + 1}.`
          : `Alle ${rule.interval} Jahre am ${rec.dtstart.getUTCDate()}.${rec.dtstart.getUTCMonth() + 1}.`;
      break;
  }

  const time =
    rec.dtstart.getUTCHours() !== 0 || rec.dtstart.getUTCMinutes() !== 0
      ? ` um ${pad(rec.dtstart.getUTCHours())}:${pad(rec.dtstart.getUTCMinutes())} Uhr`
      : '';

  const end =
    rule.count !== undefined
      ? `, ${rule.count} Mal`
      : rule.until !== undefined
        ? `, bis zum ${rule.until.getUTCDate()}.${rule.until.getUTCMonth() + 1}.${rule.until.getUTCFullYear()}`
        : ', ohne Ende';

  return `${core}${time}${end}.`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const capitalize = (s: string) => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

function joinDe(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}
