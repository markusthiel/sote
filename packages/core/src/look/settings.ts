/**
 * SOTE — was eingestellt werden kann, und wie sich drei Ebenen einigen.
 *
 * Nachgebaut aus SONEs ADR-0124: **Person, dann Arbeitsbereich über Instanz,
 * dann das Gerät.** Und aus ADR-0028 die Regel, die dabei am leichtesten
 * verlorengeht:
 *
 * > Das Thema des Arbeitsbereichs gestaltet den **Inhalt** und gehört dem
 * > Arbeitsbereich, weil ein Dokument für alle gleich aussehen soll. Das Thema
 * > der Anwendung gestaltet die **Oberfläche** und gehört der Person. Mein
 * > Dunkelmodus geht dich nichts an, auch während wir dieselbe Seite bearbeiten.
 *
 * Beides zu vermischen hieße, dass die Vorliebe einer Person ändert, was eine
 * andere sieht — offensichtlich, sobald es dasteht, und überhaupt nicht
 * offensichtlich beim Bauen.
 *
 * ## Was hier steht und was nicht
 *
 * **Hier:** das Farbschema und die Zeitzone. Beides gehört zur Person und
 * reist mit ihr; wer auf dem Rechner dunkel gewählt hat, will am Telefon nicht
 * hell.
 *
 * **Nicht hier, sondern im Browser:** Textgröße und Dichte. SONEs Begründung,
 * und sie ist gut: „a scale that suits a phone is wrong on a 27-inch monitor,
 * and syncing it would make one device's setting the other's problem." Eine
 * Größe ist eine Eigenschaft des Bildschirms, vor dem jemand sitzt, und keine
 * der Person.
 *
 * ## Unbekanntes zählt als „nichts gesagt"
 *
 * Jede Prüfung hier gibt bei einem unbekannten Wert `null` zurück und nicht
 * einen Fehler. Der Grund steht in SONEs `resolveScheme`: ein Konto, in dem ein
 * Wort aus einer künftigen Fassung steht, soll die gewöhnliche Antwort
 * bekommen und keine Oberfläche, die sich nicht entscheiden kann, welche Farbe
 * sie hat.
 */

import { isZone } from '../time/zone.js';

/**
 * Die vier Antworten auf „hell oder dunkel".
 *
 * `system` ist eine **Wahl** und kein fehlender Wert: die Entscheidung, das
 * Gerät entscheiden zu lassen. Sie schlägt einen Arbeitsbereich, der dunkel
 * sagt. Wer gar nichts gewählt hat, hat `null` — und das ist die vierte
 * Antwort: „wie der Arbeitsbereich sagt".
 */
export const SCHEMES = ['system', 'light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

export const isScheme = (value: unknown): value is Scheme =>
  typeof value === 'string' && (SCHEMES as readonly string[]).includes(value);

/** Was auf einer Ebene stehen darf. Alles optional — eine Ebene sagt, was sie sagt. */
export interface Settings {
  /** Hell, dunkel, oder dem Gerät folgen. */
  readonly scheme?: Scheme;
  /**
   * Die Zeitzone, in der „9 Uhr" gemeint ist.
   *
   * Nur auf Personen- und Instanzebene sinnvoll, aber nicht künstlich
   * eingeschränkt: ein Arbeitsbereich mit einem Ort ist denkbar, und eine
   * Prüfung, die ein sinnvolles Feld verbietet, wäre eine Regel gegen etwas,
   * das niemand gefragt hat.
   *
   * Vorrang hat trotzdem immer der Browser, wenn er eine mitschickt — er weiß,
   * wo jemand gerade *ist*. Diese hier ist für alles, was ohne Browser
   * passiert: nächtliche Erinnerungen etwa.
   */
  readonly zone?: string;
}

/** Liest, was in der Datenbank steht — und lässt weg, was keinen Sinn ergibt. */
export function readSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const scheme = isScheme(raw['scheme']) ? raw['scheme'] : undefined;
  const zone = typeof raw['zone'] === 'string' && isZone(raw['zone']) ? raw['zone'] : undefined;
  return {
    ...(scheme === undefined ? {} : { scheme }),
    ...(zone === undefined ? {} : { zone }),
  };
}

/**
 * Was für diese Person in diesem Arbeitsbereich gilt.
 *
 * **Eine** Funktion, weil es zwei Aufrufer gibt, die sich nicht widersprechen
 * dürfen: der Server, der antwortet, und die Zeile im Browser, die die
 * gemerkte Antwort anwendet, bevor die Anwendung geladen ist. SONEs Satz dazu:
 * „an interface that changes colour a second after it appears is worse than one
 * that was the wrong colour to begin with."
 */
export function resolveSettings(
  person: Settings,
  workspace: Settings,
  instance: Settings,
): { scheme: Scheme; zone: string | undefined } {
  return {
    // Person, dann Arbeitsbereich über Instanz, dann das Gerät.
    scheme: person.scheme ?? workspace.scheme ?? instance.scheme ?? 'system',
    // Bei der Zeitzone gibt es kein „das Gerät" als Vorgabe: der Browser
    // schickt seine mit, und diese hier ist die Rückfallebene für alles ohne
    // Browser. `undefined` heißt darum wirklich „nirgends gesagt".
    zone: person.zone ?? workspace.zone ?? instance.zone,
  };
}
