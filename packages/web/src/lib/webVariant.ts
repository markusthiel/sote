/**
 * SOTE — ein Bild im Browser verkleinern.
 *
 * GEMELDET: „Ist es entsprechend verkleinert, damit keine mehrere MB große
 * Datei geladen wird? … Thumbnails sollten ebenfalls verkleinert dargestellt
 * werden und nicht das volle Bild laden."
 *
 * Die Regeln — wie groß, ab wann, welche Arten — stehen im Kern (`shrink.ts`),
 * weil sie Entscheidungen sind. Hier steht nur das Handwerk: Bild lesen,
 * zeichnen, als JPEG herausgeben.
 *
 * ## `createImageBitmap` und nicht `<img>`
 *
 * Ein `<img>` mit einer Blob-Adresse tut es auch und bringt zwei Ärgernisse
 * mit: es muss am Dokument hängen, um zuverlässig zu laden, und die Adresse
 * muss wieder freigegeben werden, sonst bleibt der Speicher belegt.
 * `createImageBitmap` nimmt die Datei direkt und gibt etwas zurück, das man
 * schließen kann.
 *
 * ## Fehlschlag ist kein Fehler
 *
 * Jeder Weg hier endet im Zweifel mit `undefined`, und der Aufrufer lädt dann
 * eben nur das Original hoch. Ein Anhang, der nicht ankommt, weil sein
 * Vorschaubild nicht zu rechnen war, wäre die schlechteste Art, eine
 * Verbesserung einzubauen.
 */

import { canShrink, fitTo, WEB_MIN_BYTES } from '@sote/core';

/**
 * Die kleine Fassung einer Datei — oder `undefined`, wenn keine nötig ist.
 *
 * `undefined` heißt an jeder Stelle dasselbe: **nimm das Original.** Kein
 * Bild, zu klein, eine Art, die man nicht neu zeichnet, ein Browser, der es
 * nicht kann, ein Bild, das sich nicht öffnen lässt — fünf Gründe, eine
 * Antwort.
 */
export async function webVariant(file: File): Promise<Blob | undefined> {
  if (!canShrink(file.type)) return undefined;
  if (file.size < WEB_MIN_BYTES) return undefined;
  if (typeof createImageBitmap !== 'function') return undefined;

  let bild: ImageBitmap | undefined;
  try {
    bild = await createImageBitmap(file);
    const ziel = fitTo(bild.width, bild.height);
    // Schon klein genug: eine zweite Datei in derselben Größe wäre Verwaltung
    // ohne Ersparnis.
    if (ziel === null) return undefined;

    const leinwand = document.createElement('canvas');
    leinwand.width = ziel.width;
    leinwand.height = ziel.height;
    const ctx = leinwand.getContext('2d');
    if (ctx === null) return undefined;
    /*
     * `high` beim Herunterrechnen: die Vorgabe mancher Browser ist „low", und
     * das sieht man — feine Muster franst aus, Text in einem Beleg wird
     * unleserlich. Es ist ein Bild, das jemand ANSEHEN soll.
     */
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bild, 0, 0, ziel.width, ziel.height);

    const blob = await new Promise<Blob | null>((fertig) => {
      leinwand.toBlob(fertig, 'image/jpeg', 0.82);
    });
    if (blob === null) return undefined;

    /*
     * Und die letzte Prüfung: ist sie überhaupt kleiner?
     *
     * Ein knapp gespeichertes JPEG neu zu kodieren kostet oft mehr, als es
     * bringt — dann ist die „kleine" Fassung größer als das Original, und
     * jeder Abruf wäre mit ihr langsamer. Die Regel heißt „schneller laden",
     * nicht „eine zweite Datei haben".
     */
    if (blob.size >= file.size) return undefined;
    return blob;
  } catch {
    return undefined;
  } finally {
    bild?.close();
  }
}
