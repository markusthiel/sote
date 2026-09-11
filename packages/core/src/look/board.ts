/**
 * SOTE — wie die Tafel aussieht.
 *
 * Gewünscht: „Das könnte man konfigurierbar machen in den
 * Workspace-Einstellungen, welche Tönung und Akzentfarbe speziell für diese
 * Spalte. Da folgen sicher noch mehr Einstellungen."
 *
 * Der letzte Satz ist der Grund, warum das hier eine GRUPPE ist und keine
 * einzelne Farbe: eine Einstellung allein bekäme einen eigenen Abschnitt, der
 * für eine Sache zu groß und für die nächste zu klein wäre. Drei zusammen
 * ergeben einen Ort, an dem man nachsieht, wenn die Tafel anders aussehen soll.
 *
 * ## Wörter, keine Zahlen
 *
 * `soft` und `strong` statt „7 %" und „16 %". Dieselbe Überlegung wie bei den
 * Flächenbehandlungen (ADR-0131): gewählt wird eine BEZIEHUNG, und was sie in
 * Zahlen bedeutet, entscheidet das Stylesheet — hell anders als dunkel, und
 * morgen vielleicht anders als heute. Ein gespeichertes „7" wäre ein Wert, der
 * seine Bedeutung verliert, sobald jemand die Flächen anfasst.
 *
 * Die Farbe ist die Ausnahme und geht als Wert hinaus, genau wie der Akzent des
 * Arbeitsbereichs: eine gewählte Farbe hat kein Gegenstück im Entwurf, das man
 * benennen könnte.
 *
 * ## Gehört dem ARBEITSBEREICH
 *
 * Anders als die Anzeigeform, die jeder für sich wählt (Migration 0028). Die
 * Tafel eines Vorhabens sieht für alle gleich aus — sie ist der Gegenstand und
 * nicht die Brille. Dieselbe Grenze, die ADR-0028 zwischen dem Thema des
 * Inhalts und dem der Oberfläche zieht.
 */

/**
 * Wie deutlich sich die Fertig-Spalte abhebt.
 *
 * `none` ist eine WAHL und kein fehlender Wert: wer zehn Spalten hat und alle
 * gleich sehen will, sagt das hier.
 */
export const BOARD_TINTS = ['none', 'soft', 'strong'] as const;
export type BoardTint = (typeof BOARD_TINTS)[number];

export const isBoardTint = (value: unknown): value is BoardTint =>
  typeof value === 'string' && (BOARD_TINTS as readonly string[]).includes(value);

/** Wie breit eine Spalte ist — und damit, wie viele nebeneinander passen. */
export const BOARD_WIDTHS = ['narrow', 'normal', 'wide'] as const;
export type BoardWidth = (typeof BOARD_WIDTHS)[number];

export const isBoardWidth = (value: unknown): value is BoardWidth =>
  typeof value === 'string' && (BOARD_WIDTHS as readonly string[]).includes(value);

export interface Board {
  /** Wie deutlich sich die Fertig-Spalte abhebt. */
  readonly doneTint?: BoardTint;
  /**
   * Die Farbe dafür — sonst die des Arbeitsbereichs.
   *
   * Ein Palettenname oder ein Hexwert, wie beim Akzent. Fehlt sie, wird nichts
   * gesetzt und die Tönung mischt aus `--accent`: „wie der Arbeitsbereich" ist
   * eine eigene Antwort und nicht dasselbe wie „dieselbe Farbe, nochmal
   * hingeschrieben" — bei der zweiten bliebe sie stehen, wenn der Akzent
   * wechselt.
   */
  readonly doneAccent?: string;
  readonly columnWidth?: BoardWidth;
}

/** Liest, was in der Datenbank steht — und lässt weg, was keinen Sinn ergibt. */
export function readBoard(value: unknown): Board | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const doneTint = isBoardTint(raw['doneTint']) ? raw['doneTint'] : undefined;
  const columnWidth = isBoardWidth(raw['columnWidth']) ? raw['columnWidth'] : undefined;
  /*
   * Dieselbe Prüfung wie beim Akzent: ein Hexwert oder ein Palettenname aus
   * Buchstaben. Alles andere wäre ein Weg, beliebiges CSS in ein Stylesheet zu
   * schreiben — und das steht in einer Einstellung, die jeder mit
   * `workspace.settings` ändern darf.
   */
  const accent = raw['doneAccent'];
  const doneAccent =
    typeof accent === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-z]{3,20})$/.test(accent)
      ? accent
      : undefined;
  const out: Board = {
    ...(doneTint === undefined ? {} : { doneTint }),
    ...(doneAccent === undefined ? {} : { doneAccent }),
    ...(columnWidth === undefined ? {} : { columnWidth }),
  };
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Was davon als CSS an die Hülle geht.
 *
 * Die ZAHLEN stehen hier und nicht im Stylesheet — anders als bei den
 * Flächenbehandlungen, und das hat einen Grund: dort wählt man aus einem festen
 * Satz von Behandlungen, hier aus einem Satz von Stufen derselben Sache. Eine
 * Stufe ist ein Anteil, und ein Anteil ist eine Zahl.
 *
 * Die Farbe wird NUR gesetzt, wenn eine gewählt ist. Sonst bleibt
 * `--board-done-accent` ungesetzt, und das Stylesheet fällt auf `--accent`
 * zurück — der Rückfall steht dort, wo die Mischung steht.
 */
export function boardProperties(board: Board | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (board === undefined) return out;

  if (board.doneTint !== undefined) {
    out['--board-done-tint'] = { none: '0%', soft: '7%', strong: '16%' }[board.doneTint];
  }
  if (board.doneAccent !== undefined) {
    out['--board-done-accent'] = board.doneAccent.startsWith('#')
      ? board.doneAccent
      : `var(--sote-palette-${board.doneAccent})`;
  }
  if (board.columnWidth !== undefined) {
    out['--board-column'] = { narrow: '240px', normal: '280px', wide: '340px' }[
      board.columnWidth
    ];
  }
  return out;
}

/** Was neben jeder Wahl steht. */
export const BOARD_TINT_SAYS: Record<BoardTint, string> = {
  none: 'Wie jede andere',
  soft: 'Leicht getönt',
  strong: 'Deutlich getönt',
};

export const BOARD_WIDTH_SAYS: Record<BoardWidth, string> = {
  narrow: 'Schmal — mehr Spalten nebeneinander',
  normal: 'Normal',
  wide: 'Breit — längere Titel ohne Umbruch',
};
