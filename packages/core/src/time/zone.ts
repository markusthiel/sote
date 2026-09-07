/**
 * SOTE — Wanduhr und Zeitpunkt.
 *
 * Der Fehler, der das nötig machte, war gemeldet und eindeutig: „morgen 9 Uhr"
 * eingetippt, „morgen, 11:00" angezeigt. Der Parser läuft auf dem Server, der
 * Container steht auf UTC, also baute er 09:00 **UTC** — und im Browser in
 * Berlin liest sich das als 11:00.
 *
 * `views.ts` sagte den Grund selbst: „gerechnet in UTC, weil der Server keine
 * Zeitzone hat. Die Zeitzone gehört dem Browser." Der Gedanke war richtig, die
 * Umsetzung nicht: der Browser schickte einen **Zeitpunkt** mit, keine
 * **Zeitzone**. Ein Zeitpunkt sagt nicht, in welchem Tag jemand steht, und
 * „9 Uhr" ist keine Angabe über einen Zeitpunkt, sondern über eine Wanduhr.
 *
 * ## Die Wendung, die alles andere unangetastet lässt
 *
 * Der Parser rechnet durchgehend mit `getUTC*`. Statt vierzig Stellen
 * umzuschreiben, wird **die Uhr verschoben**:
 *
 * 1. `now` um den Zonenversatz nach vorn schieben — dann lesen alle `getUTC*`
 *    die Wanduhr der Person.
 * 2. Den Parser unverändert laufen lassen.
 * 3. Jedes Ergebnis zurückschieben.
 *
 * Ein verschobenes `Date` ist **kein gültiger Zeitpunkt**, sondern eine
 * Wanduhrablesung, die zufällig in einem `Date` liegt. Damit man das nicht
 * verwechselt, heißen die Funktionen `toWallClock` und `fromWallClock` und
 * nicht `add`/`subtract`.
 *
 * ## Sommerzeit
 *
 * Der Versatz **am Zieltag** kann ein anderer sein als heute: wer im Januar
 * „am 1. Juli 9 Uhr" tippt, meint 9 Uhr Sommerzeit, und ein Rückschieben mit
 * dem Januarversatz ergibt 10 Uhr. Also werden beide möglichen Versätze
 * abgeklopft — zwölf Stunden vor und nach der gesuchten Zeit liegt garantiert
 * je eine Seite jeder Umstellung.
 *
 * Zwei Randfälle, die bleiben, und beide sind entschieden statt übersehen:
 *
 * - **Die Stunde, die es nicht gibt** (Umstellung nach vorn, 02:00 → 03:00).
 *   „02:30" existiert an diesem Tag nicht. Wir nehmen den Zeitpunkt, der nach
 *   der Umstellung liegt — also 03:30. Ein Fehler wäre die Alternative, und
 *   eine Fehlermeldung über eine Stunde, die es nicht gibt, hilft niemandem,
 *   der einen Termin eintragen will.
 * - **Die Stunde, die es zweimal gibt** (Umstellung zurück). „02:30" gibt es
 *   doppelt; wir nehmen das erste Vorkommen, also noch Sommerzeit. Das ist die
 *   Lesart, die eine Stunde *früher* liegt, und bei einer Erinnerung ist zu früh
 *   besser als zu spät.
 */

/** Nimmt jede Zone, die die Laufzeit kennt. Alles andere ist ein Tippfehler. */
export function isZone(name: string): boolean {
  if (name === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Die Wanduhr in `zone` zum Zeitpunkt `at`, als Felder.
 *
 * `hourCycle: 'h23'` ist nicht Kosmetik: ohne das liefern manche Umgebungen für
 * Mitternacht die Stunde „24", und `Date.UTC(…, 24, …)` ist der nächste Tag.
 */
function partsIn(zone: string, at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const got: Record<string, string> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') got[p.type] = p.value;
  return {
    year: Number(got['year']),
    month: Number(got['month']),
    day: Number(got['day']),
    hour: Number(got['hour']),
    minute: Number(got['minute']),
    second: Number(got['second']),
  };
}

/** Der Versatz von `zone` gegen UTC zum Zeitpunkt `at`, in Millisekunden. */
export function offsetMs(zone: string, at: Date): number {
  const p = partsIn(zone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Sekundenbruchteile spielen für einen Zonenversatz keine Rolle, aber sie
  // machen den Vergleich unten sonst nie exakt.
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/**
 * Ein Zeitpunkt als Wanduhrablesung.
 *
 * **Das Ergebnis ist kein Zeitpunkt.** Es ist ein `Date`, dessen `getUTC*`
 * genau das liefern, was eine Uhr in `zone` gerade zeigt — damit Code, der mit
 * `getUTC*` rechnet, in der Zone der Person rechnet.
 */
export function toWallClock(zone: string, at: Date): Date {
  return new Date(at.getTime() + offsetMs(zone, at));
}

/**
 * Der Zeitpunkt, an dem die Uhr in `zone` das zeigt.
 *
 * Der Rückweg. Der Versatz am Zieltag kann ein anderer sein als heute, also
 * werden beide möglichen abgeklopft — siehe den Kopf dieser Datei.
 */
export function fromWallClock(zone: string, wall: Date): Date {
  /*
   * Beide möglichen Versätze abklopfen, statt einmal zu raten.
   *
   * Zwölf Stunden vor und nach der gesuchten Wanduhrzeit liegt garantiert je
   * eine Seite jeder Umstellung — eine Umstellung verschiebt die Uhr um eine
   * Stunde, nie um zwölf. Damit hat man beide in Frage kommenden Versätze,
   * ohne die Umstellungsregeln der Zone zu kennen.
   */
  const half = 12 * 3_600_000;
  const candidates = [
    new Date(wall.getTime() - offsetMs(zone, new Date(wall.getTime() - half))),
    new Date(wall.getTime() - offsetMs(zone, new Date(wall.getTime() + half))),
  ];

  // Die, die die gesuchte Uhrzeit wirklich zeigen.
  const fitting = candidates.filter(
    (c) => toWallClock(zone, c).getTime() === wall.getTime(),
  );

  if (fitting.length === 0) {
    /*
     * Diese Wanduhrzeit gibt es nicht — die Stunde, die bei der Umstellung
     * nach vorn übersprungen wird. Beide Kandidaten liegen hinter der Lücke;
     * der spätere ist der nach der Umstellung, und genau den wollen wir.
     */
    return new Date(Math.max(candidates[0]!.getTime(), candidates[1]!.getTime()));
  }

  /*
   * Passt mehr als einer, gibt es die Uhrzeit zweimal — die Stunde, die bei
   * der Umstellung zurück doppelt vorkommt. Wir nehmen das **frühere**
   * Vorkommen: bei einer Erinnerung ist zu früh besser als zu spät.
   *
   * Mein erster Wurf ratete einmal und prüfte nach, und der lieferte hier das
   * späte Vorkommen — also das Gegenteil dessen, was ich zwanzig Zeilen weiter
   * oben als Entscheidung hingeschrieben hatte. Der Test hat den Widerspruch
   * gefunden, nicht ich.
   */
  return new Date(Math.min(...fitting.map((c) => c.getTime())));
}

/** Mitternacht des Tages, in dem `at` in `zone` liegt. */
export function startOfDayIn(zone: string, at: Date): Date {
  const w = toWallClock(zone, at);
  const midnight = new Date(
    Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()),
  );
  return fromWallClock(zone, midnight);
}

/** Die letzte Millisekunde des Tages, in dem `at` in `zone` liegt. */
export function endOfDayIn(zone: string, at: Date): Date {
  const w = toWallClock(zone, at);
  const last = new Date(
    Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), 23, 59, 59, 999),
  );
  return fromWallClock(zone, last);
}
