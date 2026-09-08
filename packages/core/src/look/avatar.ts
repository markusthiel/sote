/**
 * SOTE — die Rechnung hinter einem Profilbild.
 *
 * Im Kern und nicht im Browser, damit sie **geprüft** werden kann: die
 * Verkleinerung selbst braucht eine Leinwand, die Rechnung nicht. Und die
 * Rechnung ist die Stelle, an der ein Fehler um eins ein Bild bei jeder
 * Berührung ein Pixel schmaler macht.
 */

/** Die lange Kante eines Profilbildes. Es wird 22 Pixel breit gezeichnet. */
export const AVATAR_BOUND = 512;

/** Der Deckel in Bytes — dieselbe Zahl wie der CHECK in Migration 0021. */
export const AVATAR_MAX_BYTES = 262_144;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Welche Größe die Kopie haben soll — oder `undefined`, wenn keine nötig ist.
 *
 * `undefined` für alles innerhalb der Grenze. Eine „Kopie" in derselben Größe
 * wären zwei Dateien, wo eine genügt.
 */
export function variantSize(size: Size, bound = AVATAR_BOUND): Size | undefined {
  const längste = Math.max(size.width, size.height);
  if (längste <= bound || längste === 0) return undefined;

  const faktor = bound / längste;
  return {
    // Nie auf null gerundet: ein Panorama mit 8000 auf 3 Pixeln ist absurd und
    // trotzdem jemandes Datei, und eine Höhe von 0 ist eine Leinwand, die wirft.
    width: Math.max(1, Math.round(size.width * faktor)),
    height: Math.max(1, Math.round(size.height * faktor)),
  };
}

/** Was sich überhaupt verkleinern lässt — und was der Server annimmt. */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const isAvatarType = (type: string): boolean =>
  (AVATAR_TYPES as readonly string[]).includes(type);
