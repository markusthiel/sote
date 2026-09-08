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

import { readLanding, type Landing } from './landing.js';
import { readReminders, type Reminders } from './reminders.js';
import { readLook, type Look } from './theme.js';
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
  /**
   * Wie es aussieht: Flächen, Ecken, Akzent.
   *
   * Steht **nur auf Instanz- und Arbeitsbereichsebene** sinnvoll, und wird
   * trotzdem nicht künstlich verboten — eine Regel gegen etwas, das niemand
   * gefragt hat, ist eine Regel zu viel. Aufgelöst wird sie anders als das
   * Schema: siehe `resolveLook`.
   */
  readonly look?: Look;
  /** Wo eine Sitzung aufgeht (ADR-0072, ADR-0032). */
  readonly landing?: Landing;
  /**
   * Wann eine Erinnerung kommt — oder gar nicht.
   *
   * Nur auf der Personen-Ebene sinnvoll: wann jemand Post will, ist keine
   * Eigenschaft eines Arbeitsbereichs und keine des Servers. Der Typ ist
   * derselbe für alle Ebenen, weil `Settings` einer ist; der Bearbeiter liest
   * ausschließlich die Personen-Zeile.
   */
  readonly reminders?: Reminders;
}

/** Liest, was in der Datenbank steht — und lässt weg, was keinen Sinn ergibt. */
export function readSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const scheme = isScheme(raw['scheme']) ? raw['scheme'] : undefined;
  const zone = typeof raw['zone'] === 'string' && isZone(raw['zone']) ? raw['zone'] : undefined;
  const look = readLook(raw['look']);
  const landing = readLanding(raw['landing']);
  const reminders = readReminders(raw['reminders']);
  return {
    ...(scheme === undefined ? {} : { scheme }),
    ...(zone === undefined ? {} : { zone }),
    ...(Object.keys(look).length === 0 ? {} : { look }),
    ...(landing === undefined ? {} : { landing }),
    ...(reminders === undefined ? {} : { reminders }),
  };
}

/**
 * Wie es aussieht, aus drei Ebenen.
 *
 * **Nicht dieselbe Reihenfolge wie beim Schema, und das ist der Punkt**
 * (ADR-0028): das Aussehen des Arbeitsbereichs gestaltet, was alle sehen — es
 * gehört dem Arbeitsbereich und nicht der Person. Eine Person, die ihre
 * Schiene grün färbt, färbt sonst die Schiene aller anderen mit, sobald sie
 * dasselbe Feld benutzt.
 *
 * Also: **Arbeitsbereich über Instanz**, und die Person kommt hier nicht vor.
 * Was ihr gehört, ist hell oder dunkel — und das ist eine andere Achse.
 *
 * Gefüllt statt ersetzt, Feld für Feld: ein Arbeitsbereich, der nur die
 * Schiene setzt, soll die Ecken der Instanz behalten. Ein Ersetzen des ganzen
 * Objekts würde eine Angabe zu einem Verzicht auf alle anderen machen.
 */
export function resolveLook(workspace: Settings, instance: Settings): Look {
  const w = workspace.look ?? {};
  const i = instance.look ?? {};
  /*
   * Feld für Feld, und das ist die Stelle, an der ein neues Feld vergessen
   * wird.
   *
   * Genau passiert: `tint` war im Typ, in `readLook` und in
   * `lookAttributes` — und hier nicht. Der Server speicherte die Tönung
   * korrekt und antwortete mit `effective.look = {}`; im Browser änderte sich
   * nichts, und die Tests waren grün, weil sie `readLook` und
   * `lookAttributes` prüften und nicht diese Funktion.
   *
   * Ein `{...i, ...w}` wäre kürzer und würde neue Felder mitnehmen — es wäre
   * aber falsch: eine Angabe des Arbeitsbereichs würde alle Angaben der
   * Instanz verdrängen, statt nur die eigene zu setzen. Die Ausführlichkeit
   * ist der Preis für „gefüllt statt ersetzt", und der Test unten ist der
   * Preis für die Ausführlichkeit.
   */
  return {
    ...(w.surfaces !== undefined || i.surfaces !== undefined
      ? { surfaces: { ...i.surfaces, ...w.surfaces } }
      : {}),
    ...(w.corners ?? i.corners ? { corners: (w.corners ?? i.corners)! } : {}),
    ...(w.accent ?? i.accent ? { accent: (w.accent ?? i.accent)! } : {}),
    ...(w.tint ?? i.tint ? { tint: (w.tint ?? i.tint)! } : {}),
    ...(w.fonts ?? i.fonts ? { fonts: (w.fonts ?? i.fonts)! } : {}),
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
