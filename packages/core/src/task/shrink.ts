/**
 * SOTE — die kleine Fassung eines Bildes.
 *
 * GEMELDET: „Ist es entsprechend verkleinert, damit keine mehrere MB große
 * Datei geladen wird?" Nein, war es nicht: eine 7,7-MB-Aufnahme wurde als
 * Titelbild einer Karte und als Vorschaubild in voller Größe geladen — beides
 * Stellen, an denen sie ein paar hundert Pixel breit erscheint.
 *
 * Nachgebaut aus SONEs ADR-0029 („Bilder verkleinern"), und die eine
 * Entscheidung darin ist die wichtige:
 *
 * ## Das Original bleibt
 *
 * Ein Anhang ist etwas, das jemand AUFBEWAHREN will. Ihn beim Hochladen
 * kleinzurechnen und das Große wegzuwerfen wäre eine stille Enteignung: der
 * Beweis in einer Rechnung, die Auflösung in einem Scan, die Kante in einem
 * Foto — alles weg, weil eine Vorschau schneller laden sollte.
 *
 * Also ZWEI Dateien: das Original, wie es kam, und daneben eine Web-Fassung.
 * Das Profilbild ist der Gegenfall und mit Absicht anders — dort gibt es kein
 * Original zu bewahren, es IST die Vorschau.
 *
 * ## Verkleinert wird im BROWSER
 *
 * Nicht am Server, und das hat zwei Gründe. Der eine ist Rechenzeit, die
 * niemand bezahlen will; der andere wiegt schwerer: eine Leitung, die eine
 * 8-MB-Aufnahme hochträgt, trägt sie langsam. Wer im Browser rechnet,
 * überträgt zweimal wenig statt einmal viel — und das Original geht trotzdem
 * mit, weil es der Punkt der Sache ist.
 *
 * (Nein, das ist kein Widerspruch: das Original geht unverändert hinaus, die
 * Web-Fassung kommt als zweite, kleine Übertragung dazu. Gespart wird beim
 * ABRUF, und zwar bei jedem einzelnen.)
 */

/** Wie groß die Web-Fassung höchstens wird — die längere Seite in Pixeln. */
export const WEB_MAX = 1600;

/**
 * Ab wann sich eine zweite Fassung überhaupt lohnt.
 *
 * Unter 300 KB ist das Original schon klein genug; eine zweite Datei daneben
 * wäre dann mehr Verwaltung als Ersparnis — und ein Bild, das durch das
 * Neuzeichnen GRÖSSER wird, ist keine Seltenheit (ein knapp gespeichertes JPEG
 * neu zu kodieren kostet oft mehr, als es bringt).
 */
export const WEB_MIN_BYTES = 300 * 1024;

/**
 * Welche Bilder neu gezeichnet werden dürfen.
 *
 * SVG NICHT: es ist bereits klein und in jeder Größe scharf — es zu rastern
 * hiesse, seine einzige Eigenschaft wegzuwerfen. GIF nicht: ein Einzelbild
 * daraus zu zeichnen nähme ihm die Bewegung.
 */
export function canShrink(mimeType: string): boolean {
  const t = mimeType.toLowerCase();
  return t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/avif';
}

/**
 * Die Zielgröße für ein Bild — oder `null`, wenn es schon passt.
 *
 * Das SEITENVERHÄLTNIS bleibt: eine Vorschau, die ein Hochformat in ein
 * Quadrat presst, ist keine Vorschau, sondern eine Behauptung über das Bild.
 * Und es wird nur VERKLEINERT, nie vergrößert — ein 400 px breites Bild auf
 * 1600 zu ziehen macht es größer und nicht besser.
 */
export function fitTo(
  width: number,
  height: number,
  max = WEB_MAX,
): { width: number; height: number } | null {
  const laengste = Math.max(width, height);
  if (laengste <= max) return null;
  const faktor = max / laengste;
  return {
    // Gerundet und mindestens 1: ein Bild von 0 Pixeln Breite ist keins, und
    // ein Panorama von 20000 × 300 käme sonst auf 1600 × 24 … was stimmt.
    width: Math.max(1, Math.round(width * faktor)),
    height: Math.max(1, Math.round(height * faktor)),
  };
}

/**
 * Wie die kleine Fassung heißt.
 *
 * Derselbe Name mit einem Zusatz, damit sie im Papierkorb eines Servers oder
 * in einer Fehlermeldung als das erkennbar ist, was sie ist — und nicht als
 * zweiter Anhang, den jemand versehentlich hochgeladen hat.
 */
export function webName(filename: string): string {
  const punkt = filename.lastIndexOf('.');
  const stamm = punkt > 0 ? filename.slice(0, punkt) : filename;
  return `${stamm}.web.jpg`;
}
