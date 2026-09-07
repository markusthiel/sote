/**
 * SOTE — das Signet.
 *
 * Dieselbe Geometrie wie SONE (ADR-0068) — Tuschekasten 12–88 waagerecht,
 * 16–88 senkrecht, rechte Kante 88 —, aber jede Zeile beginnt mit einem Punkt,
 * dann ein Abstand, dann die Linie. **Punkt 9, Abstand 7**, also Punkt plus
 * Abstand gleich dem Einrückungsschritt 16: jeder Punkt steht in der Spalte, in
 * der die Zeile darüber ihre Linie beginnt. Linien 60 / 44 / 28 / 44 — SONEs
 * Rampe um einen Schritt versetzt, als Folge des Abstands und nicht als eigene
 * Wahl.
 *
 * Die dritte Zeile tintet mit `--accent` und damit mit dem Workspace-Ton
 * (ADR-0023). Vier Zeilen in **jeder** Größe der Oberfläche.
 *
 * Bei 16 px trägt der Abstand im Vierzeiler nicht mehr, also ist das Favicon
 * dreibalkig mit eigenem Raster — Punkt 13, Abstand 11, Linien 56 / 40 / 24.
 * Das steht in `public/favicon.svg`: eine Datei, die der Browser holt, ist
 * keine Komponente.
 */

export const MARK_ROWS: readonly (readonly [x: number, y: number])[] = [
  [12, 16],
  [28, 37],
  [44, 58],
  [28, 79],
];

export const MARK_DOT = 9;
export const MARK_GAP = 7;
export const MARK_RIGHT = 88;
export const MARK_ACCENT_ROW = 2;

export function SoteMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="SOTE"
      focusable="false"
    >
      {MARK_ROWS.map(([x, y], i) => {
        const fill = i === MARK_ACCENT_ROW ? 'var(--accent)' : 'currentColor';
        const lineX = x + MARK_DOT + MARK_GAP;
        return (
          <g key={y}>
            <rect x={x} y={y} width={MARK_DOT} height={9} fill={fill} />
            <rect x={lineX} y={y} width={MARK_RIGHT - lineX} height={9} fill={fill} />
          </g>
        );
      })}
    </svg>
  );
}
