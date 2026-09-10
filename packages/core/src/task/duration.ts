/**
 * SOTE — die Dauer einer Aufgabe.
 *
 * Eine SCHÄTZUNG, keine Messung. Zeiterfassung ist etwas anderes und steht
 * nicht im Konzept: sie braucht Start und Stopp, eine Historie und eine Antwort
 * auf „was, wenn ich es vergessen habe" — drei Fragen, die eine Zahl neben dem
 * Titel nicht stellt. Was hier steht, ist die Zahl, aus der sich ein Tag
 * planen lässt: *wie lange das etwa dauert.*
 *
 * MINUTEN, EINE ZAHL, KEINE EINHEIT DANEBEN. Eine zweite Spalte für „Stunden
 * oder Minuten" wäre ein zweiter Ort für dieselbe Angabe, und die Summe zweier
 * Zeilen mit verschiedenen Einheiten müsste sie erst wieder zusammenrechnen.
 * Die Einheit gehört ins Lesen und ins Schreiben, nicht in die Daten.
 *
 * ## Warum das Parsen hier liegt und nicht im Feld
 *
 * Drei Stellen schreiben eine Dauer: der Schnellerfasser (`~90`), das
 * Detailfeld und später vielleicht eine Einfuhr. Drei eigene Auslegungen von
 * „1h30" wären drei Auslegungen, und die eine hätte irgendwann Komma und die
 * andere nicht. Dasselbe für das Anzeigen: die Zeile, das Detail und die Summe
 * im Kopf einer Liste sagen dieselbe Zahl, also sagen sie sie mit derselben
 * Funktion.
 */

/**
 * Die Obergrenze: eine Woche.
 *
 * Nicht Willkür, sondern die Grenze, an der die Angabe die Sorte wechselt. Eine
 * Aufgabe, die länger als eine Woche dauert, ist keine Aufgabe mit einer
 * Schätzung, sondern ein Projekt mit Teilaufgaben — und dafür gibt es beides
 * schon. Ohne Grenze wäre ausserdem jede Summe im Kopf einer Liste eine Zahl,
 * die ein Tippfehler („~9000") unlesbar macht.
 */
export const MAX_DURATION = 7 * 24 * 60;

/**
 * Eine geschriebene Dauer in Minuten — oder `undefined`, wenn es keine ist.
 *
 * Erkannt wird, was Leute tippen, und das ist mehr als eine Form:
 *
 *   `90`  `90m`  `90min`  `90 Minuten`   → 90
 *   `2h`  `2 Std`  `2 Stunden`           → 120
 *   `1h30`  `1h30m`  `1:30`              → 90
 *   `1,5h`  `1.5h`                       → 90
 *
 * EINE NACKTE ZAHL SIND MINUTEN, nicht Stunden. „30" ist die häufigere Absicht,
 * und wer Stunden meint, schreibt sie hin — die Umkehrung („1" heisst eine
 * Stunde) macht aus jedem „5" fünf Stunden.
 *
 * `undefined` und nicht ein Wurf: der Aufrufer im Schnellerfasser fragt jedes
 * getippte Zeichen, und ein Wurf pro Tastendruck wäre eine Ausnahme als
 * Normalfall. Wer eine Ablehnung braucht, prüft auf `undefined`.
 */
export function parseDuration(text: string): number | undefined {
  const raw = text.trim().toLowerCase().replace(/\s+/g, '');
  if (raw === '') return undefined;

  // `1:30` — die Uhrzeitform. Zuerst, weil der Doppelpunkt sie eindeutig macht.
  //
  // Die Einheit dahinter ist ERLAUBT und nicht Zierde: `formatDuration` gibt
  // „1:30 h" aus, und was angezeigt wird, muss man zurücktippen können. Ohne
  // das optionale `h` wäre der eigene Anzeigewert eine Eingabe, die das Feld
  // ablehnt — vom Ringschluss-Test bei 61 Minuten gefunden.
  const clock = /^(\d{1,3}):([0-5]\d)(?:h|std|stunde|stunden)?$/.exec(raw);
  if (clock) return bounded(Number(clock[1]) * 60 + Number(clock[2]));

  // `1,5h` / `1.5h` — Dezimalstunden. Vor der Stunden-Minuten-Form, sonst liest
  // die das Komma als Trenner und `1,5h` würde eine Stunde und fünf Minuten.
  const decimal = /^(\d{1,3})[.,](\d{1,2})(h|std|stunde|stunden)$/.exec(raw);
  if (decimal) {
    const hours = Number(`${decimal[1]}.${decimal[2]}`);
    // Gerundet, weil 1,7 h keine ganze Minutenzahl sind — und eine Schätzung
    // auf die Sekunde ist keine Schätzung.
    return bounded(Math.round(hours * 60));
  }

  // `2h`, `2h30`, `2h30m`
  const both = /^(\d{1,3})(?:h|std|stunde|stunden)(?:(\d{1,2})(?:m|min|minute|minuten)?)?$/.exec(
    raw,
  );
  if (both) {
    const minutes = both[2] === undefined ? 0 : Number(both[2]);
    if (minutes > 59) return undefined;
    return bounded(Number(both[1]) * 60 + minutes);
  }

  // `90`, `90m`, `90min`, `90minuten`
  const minutes = /^(\d{1,5})(?:m|min|minute|minuten)?$/.exec(raw);
  if (minutes) return bounded(Number(minutes[1]));

  return undefined;
}

/**
 * Aussen die Grenzen, innen nur Rechnen.
 *
 * Null ist keine Dauer, sondern das Fehlen einer — und dafür gibt es
 * `undefined`, sonst gäbe es zwei Schreibweisen für „keine Angabe" und die
 * Summe müsste beide kennen.
 */
function bounded(minutes: number): number | undefined {
  if (!Number.isInteger(minutes) || minutes <= 0) return undefined;
  if (minutes > MAX_DURATION) return undefined;
  return minutes;
}

/**
 * Minuten als Text — die EINE Schreibweise, überall.
 *
 * Drei Formen, und jede ist für sich eindeutig:
 *
 *   `45 min`   unter einer Stunde
 *   `2 h`      volle Stunden
 *   `1:30 h`   dazwischen
 *
 * Die Doppelpunktform statt „1 h 30 min": in einer Zeile steht sie neben Datum,
 * Frist und Projekt, und dort zählt jedes Zeichen. Und sie ist dieselbe Form,
 * die man eingeben kann — was angezeigt wird, lässt sich zurücktippen.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h}:${String(m).padStart(2, '0')} h`;
}
