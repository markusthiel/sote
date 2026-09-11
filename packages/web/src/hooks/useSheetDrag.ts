/**
 * SOTE — die Fläche am Griff nach unten ziehen und damit schließen.
 *
 * GEWÜNSCHT: „Wenn wir jetzt schon den Anfasser in der Mitte oben haben, dann
 * sollte er auch dragbar sein und damit die Leiste schließen."
 *
 * Richtig: ein Streifen, der aussieht wie ein Griff und keiner ist, ist ein
 * Versprechen, das die Fläche nicht hält. Wer ihn anfasst und nichts passiert,
 * glaubt beim nächsten Mal auch den anderen Griffen nicht.
 *
 * ## Warum das hier nicht mit dem Rollen kollidiert
 *
 * Die Geste hängt AM STREIFEN und nicht an der Fläche. Der Streifen rollt
 * nichts — er ist eine Zeile ohne Inhalt am oberen Rand. Eine Wischgeste auf
 * der ganzen Fläche wäre die schwierige Variante: dieselbe Bewegung rollt
 * dort den Inhalt, und die Unterscheidung („nur wenn schon ganz oben") ist die
 * Sorte Regel, die man falsch baut, wenn man sie nebenbei macht.
 *
 * `touch-action: none` steht am Streifen (im Stylesheet): ohne das nimmt der
 * Browser die senkrechte Bewegung für sich und rollt die Seite, während man
 * zieht.
 *
 * ## Zeigerereignisse, wie überall hier
 *
 * Dieselbe Bauart wie beim Umsortieren (`usePointerDrag`): ein Zeiger deckt
 * Maus, Finger und Stift ab, und `setPointerCapture` sorgt dafür, dass die
 * Bewegung auch dann ankommt, wenn der Finger den Streifen verlässt — was er
 * beim Ziehen nach unten sofort tut.
 */

import { useCallback, useRef, useState } from 'react';

/**
 * Ab wann losgelassen wird als „zu" gilt.
 *
 * Ein Viertel der Fläche, mindestens 80 Pixel. Als ANTEIL und nicht als feste
 * Zahl: auf einem kleinen Telefon sind 150 px fast die halbe Fläche, auf einem
 * grossen ein Achtel — dieselbe Zahl wäre dort zwei verschiedene Gesten.
 */
const ANTEIL = 0.25;
const MINDESTENS = 80;

export function useSheetDrag(onClose: () => void) {
  const sheet = useRef<HTMLElement | null>(null);
  const von = useRef<number | null>(null);
  const [dy, setDy] = useState(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Nur die linke Maustaste; Finger und Stift haben keine.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    /*
     * NICHT, wenn es auf einem Knopf beginnt.
     *
     * GEMELDET: „Der Schliessen-Button geht jetzt nicht mehr, das Zuziehen
     * geht. Aber das X nicht, keine Reaktion."
     *
     * Genau das war die Ursache, und sie steckt in dem Wort, das die Geste
     * überhaupt erst zuverlässig macht: `setPointerCapture` leitet ALLE
     * weiteren Ereignisse dieses Zeigers an den Streifen um — auch das
     * `pointerup`, aus dem der Browser den Klick auf das Kreuz baut. Das Kreuz
     * bekam nie eines.
     *
     * Am Ziel entschieden und nicht am Ort: der Streifen enthält den Knopf,
     * also kann die Fläche nicht wissen, was gemeint war — das Ereignis weiss
     * es. Ein `stopPropagation` am Knopf täte dasselbe, aber verteilt: die
     * Regel stünde dann dort, wo man sie nicht sucht, wenn der zweite Knopf
     * dazukommt.
     */
    if ((e.target as HTMLElement).closest('button') !== null) return;
    von.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (von.current === null) return;
    /*
     * Nur nach UNTEN. Nach oben zu ziehen hiesse, die Fläche grösser zu
     * machen, und das ist eine andere Sache — eine, die es hier (noch) nicht
     * gibt. Ein Griff, der sich in beide Richtungen bewegt, aber nur in einer
     * etwas tut, wäre wieder ein halbes Versprechen.
     */
    setDy(Math.max(0, e.clientY - von.current));
  }, []);

  const schliessen = useCallback(() => {
    if (von.current === null) return;
    von.current = null;
    const hoehe = sheet.current?.getBoundingClientRect().height ?? 0;
    const weit = dy;
    setDy(0);
    if (weit > Math.max(MINDESTENS, hoehe * ANTEIL)) onClose();
  }, [dy, onClose]);

  return {
    /** An die Fläche: sie folgt dem Finger. */
    sheet,
    /**
     * Der Stil der Fläche während des Ziehens.
     *
     * Ohne Übergang, solange gezogen wird: eine Animation, die dem Finger
     * hinterherläuft, fühlt sich nach Verzögerung an. Beim Loslassen springt
     * sie zurück — dafür sorgt die Regel im Stylesheet, die nur greift, wenn
     * hier nichts steht.
     */
    style:
      dy > 0
        ? ({ transform: `translateY(${dy}px)`, transition: 'none' } as React.CSSProperties)
        : undefined,
    /** An den Streifen. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: schliessen,
      onPointerCancel: schliessen,
    },
  };
}
