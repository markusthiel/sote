/**
 * SOTE — welche Aufgaben aufgeklappt sind.
 *
 * GEMELDET: „Der Offen- und Geschlossen-Status einer Aufgabe mit
 * Unteraufgaben sollte gespeichert bleiben bei Reload."
 *
 * Ich hatte beim Bauen das Gegenteil begründet — „es ist eine Handbewegung und
 * keine Einstellung" — und dabei zwei Sachen verwechselt. Eine Handbewegung ist
 * das ÖFFNEN; der Zustand danach ist eine Auskunft darüber, woran man gerade
 * arbeitet. Wer eine Aufgabe aufklappt, um ihre Teile abzuarbeiten, will sie
 * nach einem Neuladen nicht wieder zugeklappt vorfinden — sonst klappt er sie
 * jedes Mal neu auf, und die Bewegung, die ich für beiläufig hielt, wird zur
 * Pflicht.
 *
 * ## Im Browser gemerkt, nicht am Konto
 *
 * Dieselbe Begründung wie bei `useShowDone` und der Breite der Leiste (SONEs
 * ADR-0124): das ist eine Eigenschaft dieses Fensters, keine Aussage über die
 * Person. Wer am großen Monitor drei Aufgaben offen hat und am Telefon keine,
 * will zwei Antworten — und die eine soll die andere nicht überschreiben.
 *
 * ## Nur die OFFENEN werden gemerkt
 *
 * Zugeklappt ist der Normalzustand, also ist „nichts gespeichert" dasselbe wie
 * „alles zu". Die Umkehrung — alle zugeklappten merken — wäre eine Liste, die
 * mit jeder Aufgabe wächst, auch mit denen, die niemand je angefasst hat.
 *
 * ## Was verschwindet, verschwindet
 *
 * Eine Aufgabe, die gelöscht wird oder ihre Unteraufgaben verliert, lässt ihre
 * Id hier stehen. Das ist harmlos — sie wird nie wieder gelesen, weil die
 * Zeile nicht mehr gezeichnet wird — und wird beim nächsten Umschalten
 * mitgeräumt. Eine Aufräumroutine dafür wäre mehr Code als die paar Bytes
 * wert sind, die sie spart.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sote.openTasks';

function stored(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string');
  } catch {
    /*
     * Kaputter Speicher ist keine Meinung: dann ist eben alles zu. Ein
     * Ausnahmefehler hier würde die ganze Liste am Zeichnen hindern, und zwar
     * wegen einer Angabe, die niemand vermisst.
     */
    return [];
  }
}

export function useOpenTasks(): {
  readonly open: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
} {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  // Erst nach dem ersten Zeichnen lesen: `localStorage` gibt es beim Bauen
  // nicht, und ein Zugriff im Anfangswert würde den Server-Lauf brechen.
  useEffect(() => setIds(new Set(stored())), []);

  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Kein Speicher (privates Fenster, volle Platte): die Wahl gilt für
        // diese Sitzung. Sie zu verweigern, weil man sie nicht merken kann,
        // wäre die schlechtere Antwort.
      }
      return next;
    });
  }, []);

  return { open: ids, toggle };
}
