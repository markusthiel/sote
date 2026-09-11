/**
 * SOTE — welcher Reiter in der Detailspalte offen ist.
 *
 * GEWÜNSCHT: „Die Seitenspalte einer Aufgabe wird langsam voll. … Dann sollten
 * wir in die Spalte ein Menü bringen, ebenfalls wie SONE."
 *
 * Gemerkt wie in SONE, und aus demselben Grund, den der Kommentar dort nennt:
 * *„Reopening a panel on every navigation is the kind of small friction that
 * makes an app feel like it is not paying attention."* Wer gerade Kommentare
 * liest und die nächste Aufgabe öffnet, liest weiter Kommentare.
 *
 * Im Browser und nicht am Konto — dieselbe Begründung wie bei `useShowDone`
 * und `useOpenTasks`: das ist eine Eigenschaft dieses Fensters.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sote.detailTab';

export function useDetailTab<T extends string>(
  erlaubt: readonly T[],
  vorgabe: T,
): readonly [T, (next: T) => void] {
  const [tab, setTab] = useState<T>(vorgabe);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // Was nicht (mehr) in der Liste steht, zählt als nichts gesagt: ein Name
      // aus einer früheren Fassung soll den gewöhnlichen Reiter bekommen und
      // keine leere Spalte.
      if (raw !== null && (erlaubt as readonly string[]).includes(raw)) setTab(raw as T);
    } catch {
      // Kaputter Speicher ist keine Meinung.
    }
    // Einmal beim Aufbau: die Liste ist eine Konstante des Moduls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waehle = useCallback((next: T) => {
    setTab(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Kein Speicher: die Wahl gilt für diese Sitzung.
    }
  }, []);

  return [tab, waehle] as const;
}
