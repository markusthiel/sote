/**
 * SOTE — ein Thema als Datei.
 *
 * Aus SONEs ADR-0125, und zwei Entscheidungen davon gelten hier wörtlich.
 *
 * ## Es ist kein zweiter Weg in ein Thema
 *
 * Was aus einer Datei kommt, geht durch **dieselbe** Prüfung wie das Formular
 * und der Server (`readLook`, `readSettings`). Eine geladene Datei kann darum
 * nichts, was man nicht auch tippen könnte — und genau das macht es
 * unbedenklich, eine von einem Fremden anzunehmen: es gibt darin nichts
 * Ausdrückbares, das ein Arbeitsbereich nicht schon eingeben könnte.
 *
 * Deshalb gibt es **keine Route**. Der Browser liest die Datei und schickt sie
 * über den Weg, der ohnehin existiert. Ein zweiter Endpunkt wäre eine zweite
 * Stelle, an der ein Thema geprüft wird.
 *
 * ## Und sie verweigert, was sie nicht erkennt
 *
 * Überall sonst in diesem Bereich gilt das Gegenteil — unbrauchbares Feld
 * weglassen, den Rest behalten — und dort ist es richtig, weil die Eingabe ein
 * Formular ist, das jemand füllt, und ein veralteter Wert nicht seine
 * Einstellungen kosten darf.
 *
 * Hier ist die Eingabe eine Datei, die jemand **ausgewählt** hat, und die
 * falsche auszuwählen ist der gewöhnliche Fehler. `readLook` würde aus den
 * Angaben eines Urlaubsfotos ein `{}` machen, und das zu laden würde das
 * Aussehen eines Arbeitsbereichs still leeren — mit einer Oberfläche, die
 * zurückgesetzt aussieht, ohne Grund. Die Datei sagt darum, was sie ist
 * (`"sote": "theme"`), und alles ohne diese Marke wird **ganz** abgelehnt.
 *
 * Die Marke und nicht die Gestalt, weil ein Thema fast nur aus wahlfreien
 * Feldern besteht: „sieht aus wie ein Thema" passt auf beinahe jedes Objekt,
 * `{}` eingeschlossen.
 *
 * ## Die Fassungsnummer wird geschrieben und nicht gelesen
 *
 * `version: 1` steht in der Datei und wird bewusst nicht abgefragt: die Prüfung
 * wirft ohnehin weg, was sie nicht kennt, also kostet ein später hinzugefügtes
 * Feld einer älteren Fassung nichts. Auf eine Zahl zu verweigern würde eine
 * verträgliche Datei ohne Gewinn zu einer Fehlermeldung machen. Sie ist da,
 * damit eine **brechende** Umbenennung eines Tages etwas zum Ansehen hat.
 *
 * ## Wo SOTE abweicht, und warum
 *
 * In SONE füllt das Laden das **Formular**; gespeichert wird erst mit
 * „Speichern". SOTE hat kein solches Formular — jeder Klick im
 * Einstellungsbildschirm wirkt sofort, und das ist dort eine bewusste
 * Entscheidung („eine Einstellung, die man ändert und nicht sieht, ist eine,
 * die man zweimal ändert").
 *
 * Ein Zwischenzustand nur für den Dateiweg wäre also ein **zweites
 * Bedienmodell in einem Bildschirm**: einmal wirkt ein Klick, einmal muss man
 * bestätigen. Das Laden wirkt darum sofort, und der Knopf sagt es —
 * „Laden und übernehmen". Rückgängig ist es wie jede andere Änderung: durch
 * eine andere Wahl oder „Wie entworfen".
 */

import { readSettings, type Settings } from './settings.js';
import { readLook, type Look } from './theme.js';

/** Was in der Datei steht. */
export interface ThemeFile {
  readonly sote: 'theme';
  readonly version: 1;
  readonly scheme?: Settings['scheme'];
  readonly look?: Look;
}

/**
 * Aus dem, was gerade gilt, eine Datei.
 *
 * Die **eigene** Angabe des Arbeitsbereichs und nicht die aufgelöste: wer das
 * Aufgelöste ausgäbe, schriebe die Werte der Instanz in die Datei, als wären
 * sie die des Arbeitsbereichs — und beim Laden auf einem anderen Server würden
 * sie zu seinen eigenen. Eine Ausgabe soll sagen, was hier gesetzt ist, und
 * nicht, was hier zu sehen ist.
 */
export function themeFile(level: Settings): ThemeFile {
  return {
    sote: 'theme',
    version: 1,
    ...(level.scheme === undefined ? {} : { scheme: level.scheme }),
    ...(level.look === undefined ? {} : { look: level.look }),
  };
}

/** Was beim Ablehnen gesagt wird — ein Fall, ein Satz. */
export type ThemeRefusal = 'kein_json' | 'keine_marke';

/**
 * Liest eine Datei, oder lehnt sie ab.
 *
 * Zwei Gründe, und beide sagen etwas anderes: `kein_json` heißt „das ist keine
 * Datei dieser Art" und `keine_marke` heißt „das ist eine Datei, aber kein
 * Thema". Ein gemeinsamer Satz für beide ließe jemanden nach einem Tippfehler
 * suchen, wo er die falsche Datei erwischt hat.
 */
export function readThemeFile(
  text: string,
): { ok: true; theme: { scheme?: Settings['scheme']; look?: Look } } | { ok: false; why: ThemeRefusal } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: 'kein_json' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'keine_marke' };
  if ((raw as Record<string, unknown>)['sote'] !== 'theme') {
    return { ok: false, why: 'keine_marke' };
  }

  /*
   * Innerhalb einer Datei, die ein Thema IST, gilt die gewöhnliche Regel
   * wieder: der Inhalt wird gefiltert, nicht abgelehnt. Ein Feld aus einer
   * neueren Fassung soll eine ältere nicht daran hindern, den Rest zu nehmen.
   *
   * Über `readSettings` und nicht über eine eigene Prüfung — dieselbe
   * Funktion, die der Server für jede Eingabe benutzt. Eine zweite wäre eine
   * zweite Wahrheit darüber, was ein Thema sagen darf.
   */
  const wie = readSettings(raw);
  const look = readLook((raw as Record<string, unknown>)['look']);
  return {
    ok: true,
    theme: {
      ...(wie.scheme === undefined ? {} : { scheme: wie.scheme }),
      ...(Object.keys(look).length === 0 ? {} : { look }),
    },
  };
}
