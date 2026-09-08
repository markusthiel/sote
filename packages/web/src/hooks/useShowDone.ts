/**
 * SOTE — ob Erledigtes eingeblendet ist.
 *
 * Gemeldet: „es sollte überall die möglichkeit geben abgehakte einzublenden.
 * vielleicht schieben die sich in eine gesonderte liste unten und sind dann
 * ausgegraut. man kann sie aber wieder abhaken und sie rutschen wieder in die
 * liste oben?"
 *
 * ## Je Ansicht, nicht einmal für alles
 *
 * „In diesem Projekt will ich sehen, was ich geschafft habe" und „in Heute will
 * ich nur, was ansteht" sind zwei verschiedene Antworten. Ein Schalter für
 * alles würde eine davon jedes Mal überschreiben, wenn man die andere setzt.
 *
 * ## Abwesend heißt „wie die Ansicht es ohnehin sagt"
 *
 * Dieselbe Regel wie bei den Flächen und der Schrift. Die Vorgabe ist nicht
 * überall dieselbe, und dafür gibt es einen Grund: **ein Projekt beantwortet
 * die Frage „was habe ich hier geschafft", eine Zeit-Ansicht nicht.** Wer noch
 * nichts gewählt hat, bekommt darum im Projekt Erledigtes und in Heute nicht —
 * und sobald er wählt, gilt seine Wahl.
 *
 * ## Im Browser gemerkt, nicht am Konto
 *
 * Dieselbe Begründung wie bei der Breite der Leiste (SONEs ADR-0124): das ist
 * eine Eigenschaft dieses Fensters und dieser Sitzung, keine Aussage über die
 * Person. Wer am großen Monitor alles sehen will und am Telefon nur das
 * Nötige, will zwei Antworten.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sote.showDone';

/** Was für welche Ansicht gilt, wenn niemand etwas gewählt hat. */
function defaultFor(view: string): boolean {
  // Nur das Projekt. Es ist die einzige Ansicht, deren Frage die
  // Vergangenheit einschließt.
  return view === 'project';
}

function stored(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    // Kaputter Speicher ist keine Meinung: dann gilt die Vorgabe. Ein
    // Ausnahmefehler hier würde die ganze Liste am Zeichnen hindern, und zwar
    // wegen einer Einstellung, die niemand sehen will.
    return {};
  }
}

export function useShowDone(view: string): {
  readonly showDone: boolean;
  readonly toggle: () => void;
} {
  const [map, setMap] = useState<Record<string, boolean>>({});

  // Erst nach dem ersten Zeichnen lesen: `localStorage` gibt es beim Bauen
  // nicht, und ein Zugriff im Anfangswert würde den Server-Lauf brechen.
  useEffect(() => setMap(stored()), []);

  const showDone = map[view] ?? defaultFor(view);

  const toggle = useCallback(() => {
    setMap((current) => {
      const next = { ...current, [view]: !(current[view] ?? defaultFor(view)) };
      // Was der Vorgabe entspricht, wird wieder vergessen — abwesend und „wie
      // die Ansicht es sagt" sind derselbe Zustand, und zwei Schreibweisen für
      // einen Zustand laufen auseinander.
      if (next[view] === defaultFor(view)) delete next[view];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Kein Speicher (privates Fenster, volle Platte): die Wahl gilt für
        // diese Sitzung. Sie zu verweigern, weil man sie nicht merken kann,
        // wäre die schlechtere Antwort.
      }
      return next;
    });
  }, [view]);

  return { showDone, toggle };
}
