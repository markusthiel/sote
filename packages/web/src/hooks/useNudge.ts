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
 *
 * ## EINE Verbindung je Adresse, nicht eine je Aufrufer
 *
 * Jeder `useNudge` öffnete seine eigene `EventSource`. Mit Leiste, Liste,
 * Detailspalte und Glocke waren das sechs offene Verbindungen zu demselben
 * Server — und sechs ist die Grenze, die ein Browser über HTTP/1.1 je Host
 * hält. Die siebte Anfrage (irgendein `fetch`) wartet dann, bis eine
 * Verbindung frei wird, und eine `EventSource` wird nie frei. Das sieht aus
 * wie eine Anwendung, die stehen bleibt.
 *
 * Jetzt teilen sich alle Aufrufer derselben Adresse einen Strom; jeder
 * hört auf seinen Scope mit seinem eigenen Fenster. Der Strom schließt, wenn
 * der letzte Hörer geht.
 */

import { useEffect, useRef } from 'react';

/** Wie lange gewartet wird, bevor gelesen wird. */
const WINDOW_MS = 250;

type Hörer = (scope: string) => void;

interface Strom {
  quelle: EventSource;
  hörer: Set<Hörer>;
}

const ströme = new Map<string, Strom>();

/** Einen Hörer an die Adresse hängen; gibt zurück, wie man ihn wieder abhängt. */
function anhören(url: string, hörer: Hörer): () => void {
  let strom = ströme.get(url);
  if (strom === undefined) {
    // `EventSource` bringt den Wiederaufbau nach einem Abbruch mitgeliefert —
    // genau das, was man hier braucht und sonst selbst schreibt.
    const quelle = new EventSource(url);
    const neu: Strom = { quelle, hörer: new Set() };
    quelle.onmessage = (ev) => {
      for (const h of neu.hörer) h(String(ev.data));
    };
    /*
     * Kein `onerror`-Handler, der schließt.
     *
     * `EventSource` verbindet nach einem Abbruch von selbst neu; ein
     * `close()` im Fehlerfall wäre genau die Klinke, die klemmt — ein Strom,
     * der nach dem ersten Netzhüpfer für immer still ist und dabei aussieht
     * wie einer, in dem nichts passiert.
     */
    ströme.set(url, neu);
    strom = neu;
  }
  strom.hörer.add(hörer);
  return () => {
    strom!.hörer.delete(hörer);
    if (strom!.hörer.size === 0) {
      strom!.quelle.close();
      ströme.delete(url);
    }
  };
}

export function useNudge(url: string, scope: string, onNudge: () => void): void {
  const handler = useRef(onNudge);
  handler.current = onNudge;

  useEffect(() => {
    let timer: number | undefined;

    const abhängen = anhören(url, (kam) => {
      if (kam !== scope) return;
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        handler.current();
      }, WINDOW_MS);
    });

    const beiFokus = (): void => handler.current();
    window.addEventListener('focus', beiFokus);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', beiFokus);
      abhängen();
    };
  }, [url, scope]);
}
