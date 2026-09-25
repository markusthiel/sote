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
 * (ADR-0023). Vier Zeilen in **jeder** Größe, in der Oberfläche wie in den
 * Dateien.
 *
 * Das Favicon und die installierten Icons sind dasselbe Signet, vier Zeilen,
 * auf papierfarbenem Grund — erzeugt von `tools/icons.py`, das die Zahlen unten
 * aus dieser Datei liest. Es war einmal dreizeilig mit eigenem Raster, für die
 * Lesbarkeit bei 16 px, und genau dort war das am teuersten: im Tab und auf dem
 * Startbildschirm sieht man nur das kleine Bild, und das war dann nicht die
 * Marke. Wenn sich die Zahlen unten ändern, wird neu erzeugt, nicht
 * nachgezeichnet.
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

/**
 * Signet und Wortmarke nebeneinander — das waagerechte Lockup.
 *
 * Gesetzt in der Hausschrift mit der Laufweite des Markenpakets, nicht als
 * Pfade gezeichnet: in der Anwendung ist die Schrift eine der beiden, die
 * ausgeliefert werden, also ist Setzen dieselbe Wortmarke und keine zweite
 * Zeichnung. Dieselbe Bauform wie SONEs `SoneLockup` (ADR-0202) — die beiden
 * Anmeldeseiten sollen aussehen, als kaemen sie aus einem Haus.
 */
export function SoteLockup({ size = 32 }: { size?: number }) {
  return (
    <span className="sote-lockup">
      <SoteMark size={size} />
      <span className="sote-wortmarke" style={{ fontSize: `${Math.round(size * 0.72)}px` }}>
        SOTE
      </span>
    </span>
  );
}
