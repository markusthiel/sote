/**
 * SOTE — die Kalender-Ausgabe.
 *
 * Ein iCalendar-Dokument (RFC 5545) aus Aufgaben, die ein Datum haben. Reine
 * Funktion, damit sie prüfbar ist: das Format hat genug Ecken, dass „sieht im
 * Kalender richtig aus" keine Prüfung ist, die man von Hand macht.
 *
 * ## VEVENT und nicht VTODO
 *
 * VTODO ist das, was inhaltlich gemeint ist — eine Aufgabe mit Fälligkeit. Aber
 * es wird schlecht unterstützt: Apple zeigt VTODO in Erinnerungen und nicht im
 * Kalender, Google ignoriert es in abonnierten Kalendern vollständig. Ein
 * Dokument, das formal richtig und im Kalender unsichtbar ist, beantwortet die
 * Bitte („die Kalender-Ausgabe") nicht.
 *
 * Also VEVENT: das sieht man, überall, und genau darum geht es.
 *
 * ## Zwei Zeitpunkte sind zwei Einträge
 *
 * Eine Aufgabe kann beides haben: `planned` („dann mache ich das") und `due`
 * („dann muss es fertig sein"). Das sind zwei verschiedene Aussagen über
 * denselben Vorgang, und beide gehören in einen Kalender — wer nur den einen
 * zeigt, versteckt die Hälfte.
 *
 * Darum zwei Einträge mit eigenen UIDs (`…-plan@` und `…-due@`). Nicht ein
 * Eintrag, der von `planned` bis `due` reicht: das wäre ein Termin über drei
 * Tage für etwas, das eine halbe Stunde dauert, und würde jeden Tag dazwischen
 * zumauern.
 *
 * ## Die Dauer zahlt sich hier aus
 *
 * `~90` an einer Aufgabe wird ein Block von neunzig Minuten. Ohne Dauer gibt es
 * kein DTEND — ein Zeitpunkt, kein Block. Eine erfundene Vorgabe („dauert schon
 * mal eine Stunde") wäre eine Angabe, die niemand gemacht hat, und sie würde im
 * Kalender genauso aussehen wie eine echte.
 */

/** Was aus einer Aufgabe in den Kalender kommt. */
export interface IcsTask {
  readonly id: string;
  readonly title: string;
  readonly planned: Date | null;
  readonly plannedAllDay: boolean;
  readonly due: Date | null;
  readonly dueAllDay: boolean;
  /** Minuten, `null` heißt keine Angabe — dann gibt es kein DTEND. */
  readonly duration: number | null;
  readonly note: string | null;
  readonly projectName: string | null;
  /** Für LAST-MODIFIED, damit ein Kalender Änderungen erkennt. */
  readonly updatedAt: Date;
}

/**
 * Ein TEXT-Wert nach RFC 5545 §3.3.11.
 *
 * Vier Zeichen, und die Reihenfolge ist zwingend: der Rückstrich ZUERST, sonst
 * verdoppelt der letzte Schritt die Rückstriche, die die anderen gerade
 * eingefügt haben. Ein Titel „a;b" wäre dann `a\\;b` — und das liest ein
 * Kalender als Rückstrich gefolgt von einem Trenner.
 */
function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** `20260907T090000Z` — immer UTC, weil das keine Zeitzonen-Definition braucht. */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** `20260907` — für Ganztagswerte. */
function day(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Zeilen falten auf 75 Oktette (RFC 5545 §3.1).
 *
 * Nach ZEICHEN wäre falsch: ein Umlaut ist in UTF-8 zwei Oktette, und ein
 * Kalender, der bei 75 Zeichen mit Umlauten eine zu lange Zeile bekommt,
 * schneidet sie ab oder lehnt die ganze Datei ab. Deshalb wird hier gezählt,
 * was tatsächlich hinausgeht.
 *
 * Und nie MITTEN in eine Mehrbyte-Folge: die Fortsetzungszeile beginnt mit
 * einem Leerzeichen, das Kalender wieder wegnehmen — aber ein halber Umlaut
 * davor bleibt ein halber Umlaut.
 */
function fold(line: string): string {
  /*
   * `TextEncoder` und nicht `Buffer`: der Kern läuft auch im Browser, und
   * `Buffer` gibt es dort nicht. Ein Aufruf, der im Test unter Node durchgeht
   * und in der Oberfläche wirft, ist die unangenehmste Sorte — er fällt erst
   * dem Benutzer auf.
   */
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder();
  const parts: string[] = [];
  let at = 0;
  let limit = 75;
  while (at < bytes.length) {
    let end = Math.min(at + limit, bytes.length);
    // Zurück, bis die Grenze nicht mehr in einer Folge liegt: 10xxxxxx ist ein
    // Folgeoktett und nie ein Anfang.
    while (end > at && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    parts.push(dec.decode(bytes.subarray(at, end)));
    at = end;
    // Fortsetzungszeilen tragen ein Leerzeichen, das nicht zum Wert gehört.
    limit = 74;
  }
  return parts.join('\r\n ');
}

/**
 * Das Dokument.
 *
 * CRLF überall, auch wenn es auf einem Unix-Server seltsam aussieht: das Format
 * schreibt es vor, und Kalender, die es genau nehmen, lehnen LF-Dateien ab.
 */
export function buildIcs(input: {
  readonly tasks: readonly IcsTask[];
  /** Wie der Kalender im Programm heißt. */
  readonly name: string;
  /** Womit jeder Eintrag verlinkt wird — die Basis, ohne Schrägstrich am Ende. */
  readonly base?: string | undefined;
  /** Für DTSTAMP. Als Parameter, damit derselbe Stand dasselbe Dokument ergibt. */
  readonly now: Date;
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SOTE//Aufgaben//DE',
    'CALSCALE:GREGORIAN',
    // Abonnierte Kalender sind gelesen und nicht bearbeitet.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(input.name)}`,
    /*
     * Wie oft nachgesehen werden soll. Zwei Namen für eine Sache, weil sich
     * die Programme nicht einig sind: RFC 7986 sagt REFRESH-INTERVAL, Outlook
     * und ältere Apple-Versionen lesen X-PUBLISHED-TTL. Ohne Angabe fragen
     * manche alle vier Minuten.
     */
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const task of input.tasks) {
    if (task.planned !== null) {
      lines.push(
        ...event({
          uid: `${task.id}-plan@sote`,
          summary: task.title,
          at: task.planned,
          allDay: task.plannedAllDay,
          // Die Dauer gilt für das TUN, nicht für die Frist: ein Block von
          // neunzig Minuten am Fälligkeitstag wäre eine Angabe, die niemand
          // gemacht hat.
          duration: task.duration,
          task,
          now: input.now,
          base: input.base,
        }),
      );
    }
    if (task.due !== null) {
      lines.push(
        ...event({
          uid: `${task.id}-due@sote`,
          /*
           * Das Wort davor, damit die beiden Einträge im Kalender
           * unterscheidbar sind. Sonst steht dieselbe Aufgabe zweimal an
           * verschiedenen Tagen und sieht wie ein Doppeleintrag aus — also wie
           * ein Fehler.
           */
          summary: `Frist: ${task.title}`,
          at: task.due,
          allDay: task.dueAllDay,
          duration: null,
          task,
          now: input.now,
          base: input.base,
        }),
      );
    }
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Ein einzelnes CalDAV-Objekt. METHOD gehört in Abos, niemals in einen CalDAV-PUT. */
export function buildCalDavEvent(input: {
  task: IcsTask; kind: 'plan' | 'due'; uid: string; timezone: string; base?: string | undefined;
  /** iCloud-Kompatibilität: bei Zeitpunkten DTEND=DTSTART statt fehlendem DTEND. */
  explicitInstantEnd?: boolean;
}): string {
  const { task, kind } = input;
  let at = kind === 'plan' ? task.planned : task.due;
  if (at === null) throw new Error('Ein Kalendereintrag braucht einen Zeitpunkt.');
  const allDay = kind === 'plan' ? task.plannedAllDay : task.dueAllDay;
  if (allDay) {
    // Aufgaben speichern Augenblicke; die beim Einrichten gewählte Zone sagt,
    // welchen Kalendertag die Person damit gemeint hat.
    const parts = new Intl.DateTimeFormat('en', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    at = new Date(Date.UTC(n('year'), n('month') - 1, n('day')));
  }
  const duration = kind === 'plan' ? task.duration : null;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SOTE//Aufgaben//DE', 'CALSCALE:GREGORIAN',
    ...event({ uid: input.uid, summary: kind === 'due' ? `Frist: ${task.title}` : task.title,
      at, allDay, duration: duration ?? (input.explicitInstantEnd ? 0 : null), task, now: task.updatedAt, base: input.base }),
    'END:VCALENDAR', ''].map(fold).join('\r\n');
}

function event(input: {
  uid: string;
  summary: string;
  at: Date;
  allDay: boolean;
  duration: number | null;
  task: IcsTask;
  now: Date;
  base: string | undefined;
}): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${input.uid}`, `DTSTAMP:${stamp(input.now)}`];

  if (input.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${day(input.at)}`);
    /*
     * DTEND ist AUSSCHLIESSEND (RFC 5545 §3.8.2.2): ein Ganztagstermin an
     * einem Tag endet am Folgetag. Ohne den Tag dazu zeigen manche Programme
     * einen Termin ohne Dauer und andere gar keinen.
     */
    const next = new Date(input.at.getTime() + 86_400_000);
    lines.push(`DTEND;VALUE=DATE:${day(next)}`);
  } else {
    lines.push(`DTSTART:${stamp(input.at)}`);
    if (input.duration !== null) {
      lines.push(`DTEND:${stamp(new Date(input.at.getTime() + input.duration * 60_000))}`);
    }
  }

  lines.push(`SUMMARY:${esc(input.summary)}`);

  /*
   * Die Beschreibung trägt, was in der Zeile stand, und den Link zurück.
   *
   * Der Link ist der Punkt: ein Kalendereintrag, von dem man nicht zur Aufgabe
   * kommt, ist eine Sackgasse — man liest ihn und wechselt dann von Hand in die
   * Anwendung und sucht.
   *
   * `/a/<id>` ist die Adresse einer Aufgabe. Die gab es vorher nicht, und sie
   * ist wegen dieser Zeile entstanden: ein Link, der auf „Heute" landet, hält
   * nicht, was er sagt.
   */
  const teile: string[] = [];
  if (input.task.projectName !== null) teile.push(input.task.projectName);
  if (input.task.note !== null && input.task.note.trim() !== '') teile.push(input.task.note.trim());
  if (input.base !== undefined) teile.push(`${input.base}/a/${input.task.id}`);
  if (teile.length > 0) lines.push(`DESCRIPTION:${esc(teile.join('\n\n'))}`);

  if (input.base !== undefined) lines.push(`URL:${input.base}/a/${input.task.id}`);

  lines.push(`LAST-MODIFIED:${stamp(input.task.updatedAt)}`);
  // Gelesen und nicht verhandelt: niemand sagt hier zu oder ab.
  lines.push('TRANSP:TRANSPARENT');
  lines.push('END:VEVENT');
  return lines;
}
