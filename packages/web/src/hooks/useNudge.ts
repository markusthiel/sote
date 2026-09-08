/**
 * SOTE — auf die Türklingel hören.
 *
 * Übernommen aus SONE (`claude/live-aktualisierung.md`), samt der drei Punkte,
 * die dort teuer erarbeitet sind:
 *
 * ## Zusammenfassen mit einem nachlaufenden Fenster
 *
 * Eine Handlung kommt als **mehrere** Statements an: eine Aufgabe abhaken
 * schreibt die Zeile und legt vielleicht einen Nachfolger. Ohne Fenster wären
 * das zwei volle Listen-Abrufe für eine Handlung.
 *
 * ## Der Handler liegt in einem Ref, nicht in der Abhängigkeitsliste
 *
 * Jeder Aufrufer übergibt eine Closure über eigenen Zustand. Ihn zu listen
 * würde das Abonnement bei fast jedem Zeichnen neu bauen — **samt dem offenen
 * Fenster**, sodass ein Anstoß gefolgt von einem Zeichnen ein verschwundener
 * Anstoß wäre.
 *
 * ## Der Test, auf den es ankommt, ist nicht der Schwall
 *
 * Sondern **dass das Fenster wieder aufgeht**: eine Klinke, die klemmt, sieht
 * genau wie ein funktionierender Push aus — bis zur zweiten Änderung.
 *
 * ## Und der Fokus bleibt
 *
 * Ein Push sagt, was passierte, *während man zuhörte*. Was passierte, während
 * man es nicht tat — schlafender Laptop, verworfener Tab, ein Neustart —, sagt
 * nur die Auffrischung beim Fokus.
 */

import { useEffect, useRef } from 'react';

/** Wie lange gewartet wird, bevor gelesen wird. */
const WINDOW_MS = 250;

export function useNudge(url: string, scope: string, onNudge: () => void): void {
  const handler = useRef(onNudge);
  handler.current = onNudge;

  useEffect(() => {
    // `EventSource` bringt den Wiederaufbau nach einem Abbruch mitgeliefert —
    // genau das, was man hier braucht und sonst selbst schreibt.
    const quelle = new EventSource(url);
    let timer: number | undefined;

    quelle.onmessage = (ev) => {
      if (ev.data !== scope) return;
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        handler.current();
      }, WINDOW_MS);
    };
    /*
     * Kein `onerror`-Handler, der schließt.
     *
     * `EventSource` verbindet nach einem Abbruch von selbst neu; ein
     * `close()` im Fehlerfall wäre genau die Klinke, die klemmt — ein Strom,
     * der nach dem ersten Netzhüpfer für immer still ist und dabei aussieht
     * wie einer, in dem nichts passiert.
     */

    const beiFokus = (): void => handler.current();
    window.addEventListener('focus', beiFokus);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', beiFokus);
      quelle.close();
    };
  }, [url, scope]);
}
