/**
 * SOTE — eine gewählte Farbe.
 *
 * Übernommen aus SONE (`packages/core/src/doc/theme.ts`, ADR-0023), und zwar
 * die Entscheidung, nicht nur der Code: **eine gewählte Farbe ist entweder ein
 * Palettenname oder ein Hex-Wert.**
 *
 * Warum der Name mehr ist als eine Bequemlichkeit: `blau` gespeichert folgt der
 * Palette. Wer später die Palette ändert — pro Arbeitsbereich, wie in SONE —
 * ändert damit jedes blaue Ding, wo auch immer der Name steht. Ein
 * gespeichertes `#2563eb` bleibt für immer dieses eine Blau und weiß von
 * keiner Palette.
 *
 * Und warum trotzdem beides: acht Namen sind acht, und irgendwer will das Grün
 * seines Vereins. Ein geschlossener Satz allein wäre eine Bevormundung, ein
 * freier Wähler allein verliert die Verbindung zur Palette.
 *
 * ## Der Fehler, den SONE dabei gemacht hat
 *
 * Aus dem Kommentar in `WorkspaceMark.tsx`, wörtlich lehrreich: ein Name ist
 * **keine CSS-Farbe**. Ihn direkt in `style={{ color: name }}` zu schreiben
 * funktionierte für die eigenen Hex-Werte und tat für die acht Namen
 * *stillschweigend nichts* — „which is the worse half to get wrong: those are
 * the ones people pick." Deshalb gibt es hier `colorValue()` und keinen
 * direkten Zugriff.
 *
 * ## Dunkel
 *
 * Jede Palettenfarbe hat **einen Wert pro Thema** (ADR-0028): gesättigte
 * Farben, die auf Weiß richtig aussehen, glühen auf Schwarz unangenehm. Die
 * Namen sind darum Tokens und keine Konstanten, und der Paritätstest hält
 * beide Listen vollständig.
 */

export const PALETTE = [
  'grau',
  'rot',
  'orange',
  'gelb',
  'gruen',
  'blau',
  'lila',
  'pink',
] as const;

export type PaletteName = (typeof PALETTE)[number];

/** Ein Name aus der Palette, oder ein eigener Hex-Wert. */
export type ChosenColor = PaletteName | `#${string}`;

export const isPaletteName = (value: unknown): value is PaletteName =>
  typeof value === 'string' && (PALETTE as readonly string[]).includes(value);

export const isCustomColor = (value: unknown): value is `#${string}` =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/**
 * Das eine oder das andere, sonst `null`.
 *
 * `null` und nicht ein Fehler: eine Farbe, die eine neuere Fassung kennt und
 * diese nicht, soll die Zeile nicht unbrauchbar machen — sie wird dann eben
 * ohne Farbe gezeichnet.
 */
export function readColor(value: unknown): ChosenColor | null {
  if (isPaletteName(value)) return value;
  if (isCustomColor(value)) return value.toLowerCase() as `#${string}`;
  return null;
}

/**
 * Was in ein Stylesheet gehört.
 *
 * Ein Name wird zum Token und folgt damit weiter der Palette; ein Hex-Wert ist
 * er selbst. `undefined` für alles andere ist die Stelle, die eine ältere
 * Oberfläche überleben lässt: sie zeichnet dann ihre eigene Vorgabe statt an
 * einem Wert zu zerbrechen, den sie nicht kennt.
 */
export function colorValue(value: unknown): string | undefined {
  if (isPaletteName(value)) return `var(--sote-palette-${value})`;
  if (isCustomColor(value)) return value;
  return undefined;
}

/**
 * Das Zeichen eines Projekts.
 *
 * Dieselbe Form wie SONEs `pages.icon` — `{icon, iconColor}` — damit wer beide
 * Systeme liest, nicht zwei Formen für eine Sache lernen muss. SONE hat dort
 * noch `titleColor`; das fehlt hier, weil eine Zeile in der Seitenleiste keinen
 * eigenen Titel hat, der sich färben ließe. Kommt es, kommt es unter diesem
 * Namen.
 *
 * Der Name des Zeichens wird **nicht** geprüft: welche Zeichen es gibt, weiß
 * die Oberfläche, und eine Liste davon im Kern wäre eine zweite Wahrheit, die
 * bei jedem neuen Zeichen nachgezogen werden müsste. Was die Oberfläche nicht
 * kennt, zeichnet sie als Anfangsbuchstaben — wie SONE.
 */
export interface ProjectIcon {
  readonly icon?: string;
  readonly iconColor?: ChosenColor;
}

/** Liest, was in der Datenbank steht — und wirft weg, was keine Form hat. */
export function readIcon(value: unknown): ProjectIcon | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw['icon'] === 'string' ? raw['icon'].trim() : '';
  const color = readColor(raw['iconColor']);
  if (name === '' && color === null) return null;
  return {
    ...(name === '' ? {} : { icon: name.slice(0, 64) }),
    ...(color === null ? {} : { iconColor: color }),
  };
}
