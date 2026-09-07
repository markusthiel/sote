/**
 * SOTE — welche Nachbarn eine verschobene Zeile bekommt.
 *
 * Der Server will `afterId` und `beforeId` und rechnet daraus den Schlüssel.
 * Welche das sind, ist die Sache der Oberfläche — und es ist die Stelle, an der
 * ein Fehler unsichtbar bleibt, weil die Reihe hinterher *irgendeine*
 * Reihenfolge hat. Also rein und getestet, nicht in einem Ereignis-Handler.
 *
 * Die Falle ist der Fall „nach unten geschoben": die eigene Zeile steht noch in
 * der Liste, also verschiebt sie alle Indizes hinter sich um eins. Wer das
 * übersieht, landet konsequent eine Stelle zu hoch.
 */

export interface Neighbours {
  readonly afterId: string | null;
  readonly beforeId: string | null;
}

/**
 * `from` ist die Stelle, an der die Zeile jetzt steht, `to` die Stelle in der
 * **unveränderten** Liste, vor der sie landen soll.
 */
export function neighboursFor(
  ids: readonly string[],
  from: number,
  to: number,
): Neighbours | null {
  if (from < 0 || from >= ids.length) return null;
  if (to < 0 || to > ids.length) return null;

  // Die eigene Zeile herausnehmen, dann die Ziel-Stelle nachziehen: alles
  // hinter `from` rutscht um eins nach vorn.
  const without = [...ids.slice(0, from), ...ids.slice(from + 1)];
  const at = to > from ? to - 1 : to;

  if (at === from) return null; // nichts zu tun

  return {
    afterId: at === 0 ? null : (without[at - 1] ?? null),
    beforeId: without[at] ?? null,
  };
}

/** Eine Zeile um eine Stelle nach oben oder unten — für die Tastatur. */
export function neighboursForStep(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): Neighbours | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  // Nach unten heißt: **hinter** die nächste Zeile, also zwei Stellen weiter in
  // der unveränderten Liste. Um eine wäre die eigene Stelle.
  const to = direction === -1 ? from - 1 : from + 2;
  if (to < 0 || to > ids.length) return null;
  return neighboursFor(ids, from, to);
}

/** Die Liste, wie sie nach dem Verschieben aussieht — für die Vorschau. */
export function reordered(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const moved = ids[from];
  if (moved === undefined) return [...ids];
  const without = [...ids.slice(0, from), ...ids.slice(from + 1)];
  const at = to > from ? to - 1 : to;
  return [...without.slice(0, at), moved, ...without.slice(at)];
}
