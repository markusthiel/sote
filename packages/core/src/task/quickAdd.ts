/**
 * SOTE — die Schnellerfassung.
 *
 * Die Kernfähigkeit, nicht ein Detail (Konzept, Abschnitt 4). Eine Zeile geht
 * herein, eine Aufgabe kommt heraus, und **was gelesen wurde, wird
 * zurückgemeldet** — die Oberfläche interpretiert nichts nach. Dieselbe Regel
 * wie bei SONEs Suche: das Vokabular wird im Nachhinein auffindbar, statt
 * vorher in einer Dokumentation zu stehen.
 *
 * Zwei Ausgaben, und sie sind absichtlich getrennt:
 *
 * - die **Werte** (`planned`, `due`, `recurrence`, …) — daraus zeichnet die
 *   Oberfläche die Chips, ein Chip je Wert.
 * - `read` — die **Stellen in der Eingabe**, aus denen die Werte kommen, für
 *   die Hervorhebung im Feld. Ein Wert kann aus mehreren Stellen kommen:
 *   „morgen 9 Uhr" sind zwei Stücke, die zusammen einen Zeitpunkt ergeben, und
 *   beide sollen leuchten. `read` ist deshalb keine Liste von Chips.
 *
 * Rein: `now` wird übergeben. Ohne das wäre kein Test über „morgen" möglich.
 *
 * Zeichen:
 *   `#projekt`   Projekt
 *   `@schlagwort` Schlagwort, mehrfach
 *   `+person`    Zuweisung, mehrfach
 *   `!` `!!` `!!!` bzw. `p1`–`p4`  Priorität
 *
 * Was **nicht** erkannt wird, bleibt Titel. Eine Erfassung, die bei
 * Unbekanntem stehen bleibt, ist eine, die man nicht benutzt.
 */

import { fromWallClock, toWallClock } from '../time/zone.js';
import type { Recurrence, Unit } from './recurrence.js';

/** 1 = dringend … 4 = später. Vier innen, drei nach draußen (Blatt 13). */
export type Priority = 1 | 2 | 3 | 4;

export interface ReadToken {
  /** Was gelesen wurde: `planned`, `due`, `recurrence`, … */
  readonly field:
    | 'planned'
    | 'due'
    | 'recurrence'
    | 'project'
    | 'label'
    | 'assignee'
    | 'priority';
  /** Der Ausschnitt der Eingabe, aus dem es kommt. Für die Hervorhebung. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface QuickAdd {
  readonly title: string;
  readonly planned: Date | undefined;
  readonly due: Date | undefined;
  readonly recurrence: Recurrence | undefined;
  /** Name, nicht Id: das Auflösen gehört dem Server. */
  readonly project: string | undefined;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly priority: Priority | undefined;
  readonly read: readonly ReadToken[];
}

export interface QuickAddOptions {
  readonly now: Date;
  /** Vorgabe für „9 Uhr" ohne Minuten ist voll; hier nur die Stunde ohne Zeit. */
  readonly defaultHour?: number;
  /**
   * Die Zeitzone, in der „9 Uhr" gemeint ist.
   *
   * Fehlt sie, wird in UTC gerechnet — wie bisher. Das ist die Vorgabe für
   * Tests, die selbst UTC annehmen, und für nichts sonst: **jeder Aufruf aus
   * einer Route gibt eine Zone mit**, sonst baut der Server 09:00 UTC und der
   * Browser in Berlin liest 11:00. Genau das war der gemeldete Fehler.
   */
  readonly zone?: string;
}

const WEEKDAY_WORDS: Record<string, number> = {
  sonntag: 0, so: 0, sunday: 0, sun: 0,
  montag: 1, mo: 1, monday: 1, mon: 1,
  dienstag: 2, di: 2, tuesday: 2, tue: 2,
  mittwoch: 3, mi: 3, wednesday: 3, wed: 3,
  donnerstag: 4, do: 4, thursday: 4, thu: 4,
  freitag: 5, fr: 5, friday: 5, fri: 5,
  samstag: 6, sa: 6, sonnabend: 6, saturday: 6, sat: 6,
};

const WEEKDAY_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const ORDINAL_WORDS: Record<string, number> = {
  zweiten: 2, zweite: 2, second: 2,
  dritten: 3, dritte: 3, third: 3,
  vierten: 4, vierte: 4, fourth: 4,
};

const UNIT_WORDS: Record<string, Unit> = {
  tag: 'day', tage: 'day', tagen: 'day', day: 'day', days: 'day',
  woche: 'week', wochen: 'week', week: 'week', weeks: 'week',
  monat: 'month', monate: 'month', monaten: 'month', month: 'month', months: 'month',
  jahr: 'year', jahre: 'year', jahren: 'year', year: 'year', years: 'year',
};

interface Cut {
  readonly start: number;
  readonly end: number;
}

/** Sammelt Funde und schneidet sie am Ende in einem Durchgang aus dem Titel. */
class Reader {
  readonly tokens: ReadToken[] = [];
  private readonly cuts: Cut[] = [];

  constructor(private readonly input: string) {}

  take(field: ReadToken['field'], start: number, end: number): void {
    this.tokens.push({
      field,
      text: this.input.slice(start, end),
      start,
      end,
    });
    this.cuts.push({ start, end });
  }

  /** Ist dieser Bereich noch frei? Verhindert doppeltes Lesen. */
  free(start: number, end: number): boolean {
    return !this.cuts.some((c) => start < c.end && end > c.start);
  }

  title(): string {
    let out = '';
    let at = 0;
    for (const c of [...this.cuts].sort((a, b) => a.start - b.start)) {
      if (c.start > at) out += this.input.slice(at, c.start);
      at = Math.max(at, c.end);
    }
    out += this.input.slice(at);
    return out.replace(/\s+/g, ' ').trim();
  }
}

function atTime(day: Date, hour: number, minute: number): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute),
  );
}

const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Der nächste Wochentag dieses Namens, heute nicht mitgezählt. */
function nextWeekday(now: Date, weekday: number): Date {
  const today = startOfDay(now);
  const shift = (weekday - today.getUTCDay() + 7) % 7;
  return addDays(today, shift === 0 ? 7 : shift);
}

/**
 * Eine Zeile lesen, in der Zeitzone der Person.
 *
 * Der Parser darunter rechnet durchgehend mit `getUTC*`. Statt vierzig Stellen
 * umzuschreiben, wird **die Uhr verschoben**: `now` geht als Wanduhrablesung
 * hinein, und jedes Datum, das herauskommt, wird zurückgeschoben. Ein
 * verschobenes `Date` ist kein Zeitpunkt, sondern eine Ablesung — daher die
 * Namen `toWallClock`/`fromWallClock` und nicht `plus`/`minus`.
 */
export function parseQuickAdd(input: string, options: QuickAddOptions): QuickAdd {
  const zone = options.zone;
  if (zone !== undefined && zone !== 'UTC') {
    const inWall = parseInUtc(input, {
      ...options,
      now: toWallClock(zone, options.now),
    });
    return {
      ...inWall,
      ...(inWall.planned === undefined
        ? {}
        : { planned: fromWallClock(zone, inWall.planned) }),
      ...(inWall.due === undefined ? {} : { due: fromWallClock(zone, inWall.due) }),
    };
  }
  return parseInUtc(input, options);
}

function parseInUtc(input: string, options: QuickAddOptions): QuickAdd {
  const r = new Reader(input);
  const now = options.now;

  let planned: Date | undefined;
  let due: Date | undefined;
  let recurrence: Recurrence | undefined;
  let project: string | undefined;
  let priority: Priority | undefined;
  const labels: string[] = [];
  const assignees: string[] = [];

  // ── Zeichen zuerst: sie sind eindeutig und verkleinern den Suchraum.
  // Eine Aufgabe hat **ein** Projekt. Das erste `#` ist es; jedes weitere wird
  // als Schlagwort gelesen und nicht stehen gelassen. Ein Zeichen, das erkennbar
  // Syntax ist und trotzdem im Titel landet, sieht wie ein Fehler aus — und
  // stillschweigend wegzuwerfen verliert, was jemand gemeint hat.
  for (const m of input.matchAll(/(^|\s)#([^\s#@+!]+)/g)) {
    const at = m.index + m[1]!.length;
    const end = at + 1 + m[2]!.length;
    if (!r.free(at, end)) continue;
    if (project === undefined) {
      project = m[2]!;
      r.take('project', at, end);
    } else {
      labels.push(m[2]!);
      r.take('label', at, end);
    }
  }
  for (const m of input.matchAll(/(^|\s)@([^\s#@+!]+)/g)) {
    const at = m.index + m[1]!.length;
    if (!r.free(at, at + 1 + m[2]!.length)) continue;
    labels.push(m[2]!);
    r.take('label', at, at + 1 + m[2]!.length);
  }
  for (const m of input.matchAll(/(^|\s)\+([^\s#@+!]+)/g)) {
    const at = m.index + m[1]!.length;
    if (!r.free(at, at + 1 + m[2]!.length)) continue;
    assignees.push(m[2]!);
    r.take('assignee', at, at + 1 + m[2]!.length);
  }
  for (const m of input.matchAll(/(^|\s)(!{1,3}|[pP][1-4])(?=\s|$)/g)) {
    const at = m.index + m[1]!.length;
    if (!r.free(at, at + m[2]!.length)) continue;
    const raw = m[2]!;
    const level = raw.startsWith('!')
      ? ((4 - raw.length) as Priority)
      : (Number(raw[1]) as Priority);
    priority = level;
    r.take('priority', at, at + raw.length);
  }

  // ── Wiederholung vor dem Datum: „jeden zweiten Dienstag" enthält einen
  //    Wochentag, der sonst als einmaliges Datum gelesen würde.
  const afterDone =
    /(?:wieder\s+in\s+)?(\d+)\s+(tag|tage|tagen|woche|wochen|monat|monate|monaten|jahr|jahre|jahren)\s+nach\s+(?:dem\s+)?(abhaken|erledigung|erledigen|fertigstellung)/i.exec(
      input,
    );
  if (afterDone && r.free(afterDone.index, afterDone.index + afterDone[0].length)) {
    const unit = UNIT_WORDS[afterDone[2]!.toLowerCase()]!;
    recurrence = { kind: 'afterCompletion', n: Number(afterDone[1]), unit };
    r.take('recurrence', afterDone.index, afterDone.index + afterDone[0].length);
  }

  if (recurrence === undefined) {
    const weekly =
      /jeden?\s+(zweiten?|dritten?|vierten?)?\s*(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend)/i.exec(
        input,
      ) ??
      /alle\s+(\d+)\s+wochen(?:\s+am\s+(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag))?/i.exec(
        input,
      );
    const monthly =
      /am\s+(\d{1,2})\.\s*(?:jedes|jeden)\s+monats?/i.exec(input) ??
      /jeden\s+monat\s+am\s+(\d{1,2})\./i.exec(input);
    const daily = /(täglich|jeden\s+tag|daily)/i.exec(input);
    const weeklyPlain = /(wöchentlich|weekly)/i.exec(input);
    const monthlyPlain = /(monatlich|monthly)/i.exec(input);

    const pick = weekly ?? monthly ?? daily ?? weeklyPlain ?? monthlyPlain;
    if (pick && r.free(pick.index, pick.index + pick[0].length)) {
      let rrule: string | undefined;
      let anchorDay: Date = startOfDay(now);

      if (pick === weekly) {
        const ord = pick[1]?.toLowerCase();
        const interval =
          ord === undefined
            ? 1
            : /^\d+$/.test(ord)
              ? Number(ord)
              : (ORDINAL_WORDS[ord] ?? 1);
        const dayWord = pick[2]?.toLowerCase();
        const wd = dayWord === undefined ? undefined : WEEKDAY_WORDS[dayWord];
        if (wd !== undefined) {
          anchorDay = nextWeekday(now, wd);
          rrule = `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${WEEKDAY_ICS[wd]}`;
        } else {
          rrule = `FREQ=WEEKLY;INTERVAL=${interval}`;
        }
      } else if (pick === monthly) {
        const dom = Number(pick[1]);
        rrule = `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${dom}`;
        const candidate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dom),
        );
        anchorDay =
          candidate.getTime() >= startOfDay(now).getTime()
            ? candidate
            : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dom));
      } else if (pick === daily) {
        rrule = 'FREQ=DAILY;INTERVAL=1';
      } else if (pick === weeklyPlain) {
        rrule = 'FREQ=WEEKLY;INTERVAL=1';
      } else {
        rrule = 'FREQ=MONTHLY;INTERVAL=1';
      }

      recurrence = { kind: 'calendar', rrule, dtstart: anchorDay };
      r.take('recurrence', pick.index, pick.index + pick[0].length);
    }
  }

  // ── Uhrzeit. Wird an das Datum gehängt, das gleich gefunden wird.
  let hour: number | undefined;
  let minute = 0;
  const time =
    /(^|\s)(?:um\s+)?(\d{1,2}):(\d{2})(?:\s*uhr)?(?=\s|$)/i.exec(input) ??
    /(^|\s)(?:um\s+)?(\d{1,2})\s*uhr(?=\s|$)/i.exec(input);
  if (time) {
    const at = time.index + time[1]!.length;
    const end = time.index + time[0].length;
    if (r.free(at, end)) {
      const h = Number(time[2]);
      if (h >= 0 && h <= 23) {
        hour = h;
        minute = time[3] === undefined ? 0 : Number(time[3]);
        r.take('planned', at, end);
      }
    }
  }

  // ── Frist: „bis <datum>" oder „fällig <datum>". Zuerst, damit das Wort
  //    „Freitag" in „Donnerstag bis Freitag" nicht als geplant gelesen wird.
  const dueLead = /(^|\s)(bis|fällig(?:\s+am)?|deadline)\s+/i.exec(input);
  if (dueLead) {
    const after = dueLead.index + dueLead[0].length;
    const found = readDate(input, after, now, r);
    if (found) {
      due = found.date;
      r.take('due', dueLead.index + dueLead[1]!.length, found.end);
    }
  }

  // ── Geplant: das erste Datum, das noch frei ist.
  const plannedFound = readDate(input, 0, now, r, true);
  if (plannedFound) {
    planned = plannedFound.date;
    r.take('planned', plannedFound.start, plannedFound.end);
  }

  // Eine Uhrzeit ohne Datum heißt heute. Und eine Uhrzeit **ist** eine
  // Erinnerung (Konzept, Abschnitt 9) — die Entscheidung fällt nicht hier,
  // aber sie hängt daran, dass die Stunde erhalten bleibt.
  //
  // Die beiden Wiederholungsarten werden hier getrennt behandelt, und der
  // Typprüfer erzwingt das: nur die kalenderfeste hat einen Anker, den eine
  // Uhrzeit verschieben kann. Die erledigungsbezogene hat keinen — bei ihr ist
  // eine Uhrzeit nichts als eine Uhrzeit für heute.
  if (hour !== undefined) {
    const anchor =
      planned ??
      (recurrence?.kind === 'calendar' ? recurrence.dtstart : undefined) ??
      startOfDay(now);
    const withTime = atTime(anchor, hour, minute);
    planned = withTime;
    if (recurrence?.kind === 'calendar') {
      recurrence = { ...recurrence, dtstart: withTime };
    }
  } else if (planned === undefined && recurrence?.kind === 'calendar') {
    planned = recurrence.dtstart;
  }

  return {
    title: r.title(),
    planned,
    due,
    recurrence,
    project,
    labels,
    assignees,
    priority,
    read: r.tokens,
  };
}

interface FoundDate {
  readonly date: Date;
  readonly start: number;
  readonly end: number;
}

/** Ein einzelnes Datum ab `from`. `scan` = irgendwo, sonst nur direkt dort. */
function readDate(
  input: string,
  from: number,
  now: Date,
  r: Reader,
  scan = false,
): FoundDate | null {
  const hay = scan ? input : input.slice(from);
  const offset = scan ? 0 : from;

  const patterns: [RegExp, (m: RegExpExecArray) => Date | null][] = [
    [/(^|\s)(heute|today)(?=\s|$)/i, () => startOfDay(now)],
    [/(^|\s)(morgen|tomorrow)(?=\s|$)/i, () => addDays(startOfDay(now), 1)],
    [/(^|\s)(übermorgen)(?=\s|$)/i, () => addDays(startOfDay(now), 2)],
    [
      /(^|\s)in\s+(\d+)\s+(tag|tagen|days?)(?=\s|$)/i,
      (m) => addDays(startOfDay(now), Number(m[2])),
    ],
    [
      /(^|\s)in\s+(\d+)\s+(woche|wochen|weeks?)(?=\s|$)/i,
      (m) => addDays(startOfDay(now), Number(m[2]) * 7),
    ],
    [
      /(^|\s)(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})(?=\s|$)/,
      (m) => new Date(Date.UTC(Number(m[4]), Number(m[3]) - 1, Number(m[2]))),
    ],
    [
      /(^|\s)(?:am\s+)?(\d{1,2})\.(\d{1,2})\.?(?=\s|$)/,
      (m) => {
        const d = Number(m[2]);
        const mo = Number(m[3]) - 1;
        const thisYear = new Date(Date.UTC(now.getUTCFullYear(), mo, d));
        return thisYear.getTime() >= startOfDay(now).getTime()
          ? thisYear
          : new Date(Date.UTC(now.getUTCFullYear() + 1, mo, d));
      },
    ],
    [
      /(^|\s)(?:am\s+)?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s|$)/i,
      (m) => nextWeekday(now, WEEKDAY_WORDS[m[2]!.toLowerCase()]!),
    ],
  ];

  for (const [re, build] of patterns) {
    const m = re.exec(hay);
    if (!m) continue;
    const start = offset + m.index + (m[1]?.length ?? 0);
    const end = offset + m.index + m[0].length;
    if (!r.free(start, end)) continue;
    const date = build(m);
    if (date === null) continue;
    return { date, start, end };
  }
  return null;
}
