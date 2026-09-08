/**
 * SOTE — eine lange Liste stückweise zeichnen.
 *
 * ## Der Anlass
 *
 * Der Zeichenwähler zeigt den **ganzen** Satz: 2080 Knöpfe. Gemessen im
 * Browser: 877 ms, bis das Gitter steht, und **1690 ms auf einem vierfach
 * gedrosselten Gerät** — so lange sieht man ein halb leeres Menü.
 *
 * Ich hatte das vorher mit einer Vorauswahl von dreißig Zeichen gelöst.
 * Markus hat sie zurückgenommen („das war schon ok so"), und das ist richtig:
 * eine Vorauswahl ist eine Behauptung darüber, was jemand braucht. Also muss
 * die Antwort auf die Langsamkeit eine sein, die **nichts weglässt**.
 *
 * ## Was es tut
 *
 * Es gibt zuerst einen Anfang zurück und wächst dann in Schritten, bis alles
 * da ist. Nach zwei bis drei Bildern ist die ganze Liste gezeichnet, und das
 * erste Bild kommt sofort.
 *
 * `requestAnimationFrame` und nicht `requestIdleCallback`: Leerlauf kann bei
 * einem beschäftigten Gerät sehr lange ausbleiben, und dann wächst die Liste
 * genau dort nicht, wo es darauf ankommt. Ein Bild kommt immer.
 *
 * ## Warum kein Fensterln (Virtualisierung)
 *
 * Weil es hier nicht nötig ist: 2080 fertig gezeichnete Knöpfe kosten
 * Speicher, aber keine Zeit mehr. Fensterln würde die Höhe des Gitters von
 * seinem Inhalt lösen, und dann muss jemand die Zeilenhöhe pflegen — eine
 * Zahl, die stimmt, bis sich der Stil ändert.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/** Wie viele beim ersten Bild — genug, um den sichtbaren Teil zu füllen. */
const FIRST = 120;
/** Und wie viele je Bild danach. */
const STEP = 400;

export function useProgressive<T>(all: readonly T[]): readonly T[] {
  const [n, setN] = useState(FIRST);
  // Die Kennung der Liste: ändert sich der Suchbegriff, fängt das Wachsen von
  // vorn an — sonst zeigt eine neue Suche sofort alles und ruckelt.
  const key = all.length;
  const vorher = useRef(key);
  if (vorher.current !== key) {
    vorher.current = key;
    // Beim Zeichnen zurücksetzen und nicht im Effekt: ein Effekt liefe erst
    // NACH einem Bild mit der alten Anzahl, und das ist genau das Bild, das
    // ruckelt.
    setN(FIRST);
  }

  useEffect(() => {
    if (n >= all.length) return undefined;
    const id = requestAnimationFrame(() => setN((v) => v + STEP));
    return () => cancelAnimationFrame(id);
  }, [n, all.length]);

  return useMemo(() => (n >= all.length ? all : all.slice(0, n)), [all, n]);
}
