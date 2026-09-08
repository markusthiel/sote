/**
 * SOTE — wie ein Arbeitsbereich aussieht.
 *
 * Übernommen aus SONE (`core/src/doc/theme.ts`, ADR-0023), und was hier zählt,
 * sind nicht die Wertelisten, sondern **warum es Listen sind**.
 *
 * ## Eine Beziehung, niemals eine Farbe
 *
 * SONEs Satz dazu, und er trägt die ganze Entscheidung: `#101010` auf der
 * Schiene ist in beiden Themen schwarz — ein Arbeitsbereich, der das setzt,
 * hätte für jeden, der im Dunkeln liest, eine schwarze Leiste auf einer
 * schwarzen Seite. **`inverted` ist das Argument in einem Wort:** hell auf
 * dunkel für den im hellen Thema, dunkel auf hell für den im dunklen, aus
 * **einem** gespeicherten Wert.
 *
 * ## Stufen statt Zahlen
 *
 * Bei den Ecken derselbe Grund wie bei allem anderen hier: ein kleines
 * Bedienelement mit großem Radius liest sich versehentlich als Pille, und wer
 * es gesetzt hat, sieht nicht, dass das passiert ist. Drei Stufen bewegen sich
 * zusammen.
 *
 * ## Abwesend ist die Vorgabe
 *
 * `follow` und `soft` werden **als nichts gespeichert**. Abwesend und „wie der
 * Entwurf entscheidet" sind derselbe Zustand — und eine gespeicherte Vorgabe
 * hört in dem Moment auf richtig zu sein, in dem der Entwurf sich darunter
 * ändert. Genau deshalb prüft `readLook()` nicht, ob ein Wert der Vorgabe
 * entspricht, sondern lässt ihn dann weg.
 */

import { readColor, type ChosenColor } from './color.js';

/**
 * Welche Flächen sich einstellen lassen.
 *
 * Drei, und die Auswahl ist begründet: die **Seite selbst** ist nicht dabei —
 * wer draußen in der Sonne sitzt, will hell, was auch ein Arbeitsbereich lieber
 * hätte, und das ist dasselbe Argument, das das Stylesheet für
 * `prefers-color-scheme` ohnehin macht. Die **Zeile über dem Inhalt** ist auch
 * nicht dabei: sie sitzt absichtlich auf der Seitenfläche, damit der Titel als
 * Teil dessen liest, was darunter steht, und nicht als Kopfzeile darüber.
 */
export const SURFACES = ['rail', 'sidebar', 'detail'] as const;
export type Surface = (typeof SURFACES)[number];

/** Was einer Fläche gesagt werden kann. Eine Beziehung, keine Farbe. */
export const TREATMENTS = ['follow', 'raised', 'sunken', 'inverted', 'accent'] as const;
export type Treatment = (typeof TREATMENTS)[number];

/** Was wirklich gespeichert wird: alles außer dem Zurückstellen. */
export type StoredTreatment = Exclude<Treatment, 'follow'>;

/** Wie rund alles ist. Drei Stufen, keine Länge. */
export const CORNERS = ['sharp', 'soft', 'round'] as const;
export type Corners = (typeof CORNERS)[number];

export interface Look {
  /** Je Fläche eine Beziehung. Fehlt sie, entscheidet der Entwurf. */
  readonly surfaces?: Partial<Record<Surface, StoredTreatment>>;
  readonly corners?: Exclude<Corners, 'soft'>;
  /**
   * Der Akzent, für Links, Hervorgehobenes und gefüllte Knöpfe.
   *
   * Ein Palettenname oder ein Hex-Wert (siehe `color.ts`). Ein **Name** folgt
   * der Palette und ist damit in beiden Themen richtig; ein Hex-Wert ist in
   * beiden derselbe und darum die Wahl derer, die genau diesen einen Ton
   * wollen.
   */
  readonly accent?: ChosenColor;
}

const isTreatment = (v: unknown): v is StoredTreatment =>
  typeof v === 'string' && v !== 'follow' && (TREATMENTS as readonly string[]).includes(v);

/**
 * Liest, was gespeichert ist — und lässt weg, was die Vorgabe ist.
 *
 * `follow` und `soft` fliegen hier heraus, auch wenn sie ausdrücklich
 * dastehen: sie **sind** die Abwesenheit. Ein gespeichertes `follow` wäre eine
 * zweite Schreibweise für denselben Zustand, und zwei Schreibweisen für einen
 * Zustand laufen auseinander.
 *
 * Unbekanntes zählt als nichts gesagt, nicht als Fehler — dieselbe Regel wie
 * bei den Einstellungen: ein Arbeitsbereich, in dem ein Wort aus einer
 * künftigen Fassung steht, soll die gewöhnliche Antwort bekommen und keine
 * Oberfläche, die sich nicht entscheiden kann.
 */
export function readLook(value: unknown): Look {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;

  const surfaces: Partial<Record<Surface, StoredTreatment>> = {};
  const given = raw['surfaces'];
  if (typeof given === 'object' && given !== null) {
    for (const surface of SURFACES) {
      const v = (given as Record<string, unknown>)[surface];
      if (isTreatment(v)) surfaces[surface] = v;
    }
  }

  const corners = raw['corners'];
  const accent = readColor(raw['accent']);

  return {
    ...(Object.keys(surfaces).length === 0 ? {} : { surfaces }),
    ...(corners === 'sharp' || corners === 'round' ? { corners } : {}),
    ...(accent === null ? {} : { accent }),
  };
}

/**
 * Was daraus im Stylesheet landet.
 *
 * Als **Datenattribute** und nicht als Farbwerte: die Zuordnung „umgekehrt →
 * diese Töne" gehört ins Stylesheet, wo beide Themen ohnehin definiert sind.
 * Würde hier ein Farbwert entstehen, müsste diese Datei die Themen kennen —
 * und dann gäbe es zwei Orte, an denen steht, was dunkel bedeutet.
 *
 * Der Akzent ist die Ausnahme und geht als Wert hinaus, weil er einer ist: eine
 * gewählte Farbe hat kein Gegenstück im Entwurf, das man benennen könnte.
 */
export function lookAttributes(look: Look): {
  readonly attributes: Record<string, string>;
  readonly properties: Record<string, string>;
} {
  const attributes: Record<string, string> = {};
  for (const surface of SURFACES) {
    const t = look.surfaces?.[surface];
    if (t !== undefined) attributes[`data-surface-${surface}`] = t;
  }
  if (look.corners !== undefined) attributes['data-corners'] = look.corners;

  const properties: Record<string, string> = {};
  if (look.accent !== undefined) {
    // Über `colorValue` und nicht roh — ein Palettenname ist keine CSS-Farbe.
    const value = look.accent.startsWith('#')
      ? look.accent
      : `var(--sote-palette-${look.accent})`;
    properties['--accent'] = value;
    properties['--accent-line'] = value;
    /*
     * Dieselbe Farbe unter einem zweiten Namen, der nie überschrieben wird.
     *
     * Eine Akzentfläche muss die Akzentfarbe LESEN und gleichzeitig `--accent`
     * für ihre Kinder umdefinieren (Akzent auf Akzent ist nichts, ADR-0131).
     * Beides im selben Block ist in CSS ein **Kreis**: `--surface:
     * var(--accent)` und `--accent: var(--accent-on)` machen einander
     * ungültig, und ungültig heißt hier durchsichtig. Im Browser war der Grund
     * der Schiene `rgba(0,0,0,0)` und das Signet unsichtbar — genau der
     * Fehlschlag, den ADR-0131 in SONE behoben hat, nur mit einer anderen
     * Ursache.
     *
     * `--accent-base` ist die Kopie, die außerhalb jedes Flächenblocks steht
     * und darum immer noch die gewählte Farbe trägt.
     */
    properties['--accent-base'] = value;
  }
  return { attributes, properties };
}
