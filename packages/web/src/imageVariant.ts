/**
 * SOTE web — eine kleinere Kopie eines Bildes, bevor es hochgeht.
 *
 * Abgeschaut bei SONE (`lib/imageVariant.ts`, ADR-0029), samt der Begründung,
 * die dort steht:
 *
 * > Done here rather than on the server: server-side means a native image
 * > library in the container, with its own security releases and a build that
 * > differs by architecture, for work the uploading machine can do behind a
 * > progress bar somebody was going to watch anyway. It also means the network
 * > carries the large file once instead of twice.
 *
 * **Der Unterschied zu SONE:** dort wird das Original behalten und zum
 * Herunterladen angeboten. Für ein Profilbild nicht — es wird 22 Pixel breit
 * gezeichnet, und ein Handyfoto mit viertausend Pixeln aufzubewahren ist
 * Speicher für einen Fall, der nicht vorkommt.
 *
 * Die **Rechnung** steht im Kern (`variantSize`), nicht hier: sie lässt sich
 * ohne Leinwand prüfen, und die Verkleinerung selbst nicht.
 */

import { AVATAR_BOUND, isAvatarType, variantSize } from '@sote/core';

/**
 * Eine kleinere Kopie zeichnen.
 *
 * `undefined`, wenn irgendetwas schiefgeht: eine beschädigte Datei, ein Format,
 * das der Browser nicht dekodiert, eine Leinwand, die er verweigert, weil das
 * Bild riesig ist.
 *
 * Bei SONE lädt der Aufrufer dann das Original hoch. **Hier nicht:** ein
 * Profilbild ohne Verkleinerung wäre das Handyfoto in der Datenbank, und der
 * Deckel in Migration 0021 lehnt es ohnehin ab. `undefined` heißt also „sag es
 * der Person", und der Aufrufer tut genau das.
 */
export async function avatarVariant(file: File): Promise<File | undefined> {
  if (!isAvatarType(file.type)) return undefined;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }

  try {
    /*
     * Ein Bild, das schon klein genug ist, wird **trotzdem neu gezeichnet**.
     *
     * Abweichung von SONE, und mit Grund: ein PNG mit 300 Pixeln kann ein
     * Megabyte haben (große Fläche, viele Farben), und der Deckel in der
     * Datenbank gilt für **Bytes**, nicht für Pixel. Ohne diesen Schritt wäre
     * „klein genug" eine Aussage über die Kantenlänge, die der Deckel nicht
     * teilt.
     */
    const ziel = variantSize(bitmap, AVATAR_BOUND) ?? {
      width: bitmap.width,
      height: bitmap.height,
    };

    const leinwand = document.createElement('canvas');
    leinwand.width = ziel.width;
    leinwand.height = ziel.height;

    const stift = leinwand.getContext('2d');
    if (stift === null) return undefined;
    // Besser als die Vorgabe bei einer starken Verkleinerung, und der
    // Unterschied ist genau an den Fotos zu sehen, für die das hier existiert.
    stift.imageSmoothingQuality = 'high';
    stift.drawImage(bitmap, 0, 0, ziel.width, ziel.height);

    const blob = await new Promise<Blob | null>((fertig) => {
      /*
       * **JPEG, außer bei einem kleinen PNG.**
       *
       * Zweite Abweichung von SONE. Dort bleibt ein PNG ein PNG, weil eine
       * Bildschirmaufnahme oder ein Diagramm als JPEG Höfe um den Text
       * bekommt. Ein Profilbild ist keines von beiden — und JPEG spart dort ein
       * Vielfaches.
       *
       * Die Ausnahme ist die Durchsichtigkeit: ein PNG mit Alpha wird als JPEG
       * grau hinterlegt, und dann hat jemand plötzlich einen Kasten um sein
       * Zeichen. Ein kleines PNG bleibt darum PNG — es passt ohnehin unter den
       * Deckel, und was passt, muss nicht umgerechnet werden.
       */
      const typ = file.type === 'image/png' && file.size < 120_000 ? 'image/png' : 'image/jpeg';
      leinwand.toBlob(fertig, typ, 0.85);
    });
    if (blob === null) return undefined;

    return new File([blob], file.name, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
