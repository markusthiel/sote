/**
 * SOTE — Block-Eigenschaften in eine stabile Zeichenkette.
 *
 * Übernommen aus SONE (`doc/blockTree.ts`). Die Schlüssel werden sortiert,
 * damit zwei gleiche Eigenschaftssätze dieselbe Zeichenkette ergeben — sonst
 * meldet ein Vergleich eine Änderung, wo keine ist.
 */
export function serialiseProps(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return null;
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = props[key];
  return JSON.stringify(ordered);
}
