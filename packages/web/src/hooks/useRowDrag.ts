/**
 * SOTE — Zeilen ziehen, mit einem Innen.
 *
 * Der dritte Griff auf `usePointerDrag`, und der erste, den SONE nicht hat.
 * Der Grund ist eine Kreuzung zweier Fälle, die es dort getrennt gibt:
 *
 * - `useListDrag` ist auf einen BEHÄLTER beschränkt (SONEs Wechsler schwebt
 *   über der Seitenleiste, und ohne Beschränkung würden die Zeilen des Baums
 *   darunter zu Zielen). Es kennt aber nur Lücken — eine flache Liste hat kein
 *   Innen.
 * - `useTreeDrag` kennt das Innen, sucht seine Zeilen aber DOKUMENTWEIT. Hier
 *   angewandt würden die Projektzeilen in der Seitenleiste zu Zielen für eine
 *   Aufgabe: man zöge eine Aufgabe in einen Ordner, und der Server fragte sich,
 *   was das bedeuten soll.
 *
 * Die Aufgabenliste braucht beides: beschränkt wie das eine, mit Mittelband wie
 * das andere. Die GESTE selbst — Halten gegen Rollen, wann das Capture
 * genommen wird, den abschließenden Klick schlucken — kommt aus
 * `usePointerDrag` und wird auch hier nicht nachgebaut. Dort steckt jeder
 * Fehler, den SONE beim Ziehen je gemacht hat.
 *
 * ## Was eine Zeile mitbringen muss
 *
 * - `data-row="<id>"` — was gezogen wird.
 * - `data-row-parent="<id>|root"` — nötig, um eine Lücke zwischen
 *   Geschwistern von einer an einer Grenze zu unterscheiden.
 * - `data-row-nest` — was mit dieser Zeile geht:
 *   - `yes` — sie kann etwas aufnehmen UND hat Nachbarlücken. Eine
 *     Hauptaufgabe in der Liste.
 *   - `no` (oder fehlend) — nur Lücken. Eine Unteraufgabe.
 *   - `only` — NUR aufnehmen, keine Lücken. Eine Spalte auf der Tafel.
 */

import type { RefObject } from 'react';

import { usePointerDrag } from './usePointerDrag.js';

export type RowIntent = 'before' | 'into' | 'after';

export interface RowDropPosition {
  readonly rowId: string;
  readonly intent: RowIntent;
}

export interface RowDragOptions {
  /** Die Fläche, in der die Zeilen liegen; nichts ausserhalb ist ein Ziel. */
  readonly container: RefObject<HTMLElement | null>;
  readonly canDrop: (draggedId: string, position: RowDropPosition) => boolean;
  readonly onDrop: (draggedId: string, position: RowDropPosition) => void;
}

function rowsIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>('[data-row]')];
}

/**
 * Welche Zeile unter einem Punkt liegt, und wo darin.
 *
 * Gelesen mit `elementFromPoint` und nicht aus dem Ereignis: während einer
 * Geste mit Capture wird alles an das Element geliefert, auf dem sie begann.
 */
function positionAt(
  container: HTMLElement | null,
  x: number,
  y: number,
): RowDropPosition | null {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest<HTMLElement>('[data-row]');
  if (!row || !container?.contains(row)) return null;

  const rowId = row.dataset['row'];
  if (rowId === undefined) return null;

  const box = row.getBoundingClientRect();
  const offset = (y - box.top) / box.height;

  /*
   * Ein Rand von 0.3 gegen 0.5 — dieselbe Zahl wie in SONEs Baum.
   *
   * Eine Zeile, die etwas aufnehmen kann, bekommt ein Mittelband: oberes und
   * unteres Drittel heissen „daneben", die Mitte heisst „hinein". Eine, die
   * nichts aufnehmen kann, teilt sich in zwei Hälften — jedes Ablegen daneben
   * sortiert dann nur um.
   *
   * UND EINE DRITTE MÖGLICHKEIT, die es beim Bauen der Tafel gebraucht hat:
   * ein Behälter, der KEINE Nachbarlücken hat. Eine Spalte ist ein hohes
   * Element; ihr unteres Drittel sind bei 400 Pixeln Höhe 130 Pixel, in denen
   * gewöhnlich Karten liegen — und dort las die Geste „hinter dieser Spalte",
   * was die Tafel gar nicht kennt. Im Browser gefunden: die Karte ließ sich
   * überall ablegen, nur nicht dort, wo sie hinsollte.
   *
   * `only` heißt darum: jeder Punkt in diesem Element bedeutet „hinein".
   */
  const nest = row.dataset['rowNest'];
  if (nest === 'only') return { rowId, intent: 'into' };
  const edge = nest === 'yes' ? 0.3 : 0.5;
  const intent: RowIntent = offset < edge ? 'before' : offset > 1 - edge ? 'after' : 'into';

  if (intent !== 'before') return { rowId, intent };

  /*
   * „Vor dieser" und „hinter der darüber" sind DIESELBE Lücke, solange die
   * beiden Geschwister sind. Ohne das Zusammenlegen zeichnen zwei Bänder zwei
   * Linien wenige Pixel auseinander, und es sieht aus wie zwei Stellen — SONEs
   * Erfahrung, wörtlich übernommen.
   *
   * NUR unter Geschwistern: an einer Grenze (letzte Unteraufgabe, darunter
   * die nächste Hauptaufgabe) hat die Lücke wirklich zwei Bedeutungen, und
   * das sind zwei verschiedene Ziele und nicht eines, doppelt gezeichnet.
   */
  const rows = rowsIn(container);
  const at = rows.indexOf(row);
  const previous = at > 0 ? rows[at - 1] : undefined;
  if (
    previous !== undefined &&
    previous.dataset['rowParent'] === row.dataset['rowParent'] &&
    previous.dataset['row'] !== undefined
  ) {
    return { rowId: previous.dataset['row'], intent: 'after' };
  }
  return { rowId, intent };
}

/**
 * Würde dieses Ablegen die Zeile lassen, wo sie schon ist?
 *
 * Die Lücken direkt über und unter einer Zeile sind ihre eigene Stelle. Sie
 * anzubieten verspricht eine Bewegung, die dann nicht stattfindet — und das
 * liest sich, als wäre das Ablegen verlorengegangen, nicht als wäre es
 * abgelehnt worden.
 */
function isNoop(container: HTMLElement | null, draggedId: string, where: RowDropPosition): boolean {
  if (where.rowId === draggedId) return true;

  const rows = rowsIn(container);
  const dragged = rows.findIndex((row) => row.dataset['row'] === draggedId);
  const target = rows.findIndex((row) => row.dataset['row'] === where.rowId);
  if (dragged === -1 || target === -1) return false;
  if (where.intent === 'into') return false;

  const gleicherVater =
    rows[dragged]!.dataset['rowParent'] === rows[target]!.dataset['rowParent'];
  if (!gleicherVater) return false;

  if (where.intent === 'after' && target === dragged - 1) return true;
  if (where.intent === 'before' && target === dragged + 1) return true;
  return false;
}

export function useRowDrag(options: RowDragOptions) {
  const { container, canDrop, onDrop } = options;
  return usePointerDrag<RowDropPosition>({
    idFrom: (element) => element.dataset['row'] ?? null,
    targetAt: (x, y, draggedId) => {
      const where = positionAt(container.current, x, y);
      if (where === null || isNoop(container.current, draggedId, where)) return null;
      return where;
    },
    canDrop,
    onDrop,
  });
}
