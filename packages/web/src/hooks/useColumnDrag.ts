/**
 * SOTE — Spalten ziehen, waagerecht.
 *
 * Der vierte Griff auf `usePointerDrag`, und der Grund ist eine ACHSE.
 *
 * `useRowDrag` teilt ein Element in oberes und unteres Drittel: das ist die
 * Rechnung für Zeilen, die untereinander stehen. Auf eine Reihe nebeneinander
 * angewandt hieße sie, links und rechts an der senkrechten Achse zu messen —
 * und das ist nicht ungenau, sondern schlicht falsch. Eine Einstellung `axis`
 * am vorhandenen Griff wäre möglich gewesen; sie hätte jede Zeile darin zu
 * einer Verzweigung gemacht, in einer Datei, die genau deshalb klein bleiben
 * soll, weil in ihr die Fehler stecken.
 *
 * Was er NICHT kann und nicht können soll: ein Innen. Eine Spalte in eine
 * andere zu ziehen bedeutet nichts — Spalten stehen nebeneinander, sie
 * verschachteln sich nicht. Darum nur zwei Hälften und keine Mitte.
 *
 * Die Geste selbst kommt wieder aus `usePointerDrag`: Halten gegen Rollen,
 * Zeiger-Capture, den abschließenden Klick schlucken. Dort steckt jeder
 * Fehler, den SONE beim Ziehen je gemacht hat, und er wird auch hier nicht
 * nachgebaut.
 *
 * ## Was ein Kopf mitbringen muss
 *
 * - `data-col="<id>"` — eigener Name und nicht `data-row`, weil in derselben
 *   Fläche schon die Karten gezogen werden. Zwei Gesten auf demselben
 *   Merkmal wären zwei Zuständigkeiten für einen Druck, und welche gewinnt,
 *   entschiede die Reihenfolge der Ereignisbehandlung.
 */

import type { RefObject } from 'react';

import { usePointerDrag } from './usePointerDrag.js';

export interface ColumnDropPosition {
  readonly columnId: string;
  /** Links davor oder rechts dahinter. Es gibt kein Hinein. */
  readonly side: 'before' | 'after';
}

export interface ColumnDragOptions {
  readonly container: RefObject<HTMLElement | null>;
  readonly onDrop: (draggedId: string, position: ColumnDropPosition) => void;
}

function colsIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>('[data-col]')];
}

export function useColumnDrag(options: ColumnDragOptions) {
  const { container, onDrop } = options;

  return usePointerDrag<ColumnDropPosition>({
    idFrom: (element) => element.dataset['col'] ?? null,

    targetAt: (x, y, draggedId) => {
      const root = container.current;
      const element = document.elementFromPoint(x, y);
      const col = element?.closest<HTMLElement>('[data-col]');
      if (!col || !root?.contains(col)) return null;

      const columnId = col.dataset['col'];
      if (columnId === undefined || columnId === draggedId) return null;

      const box = col.getBoundingClientRect();
      // Die WAAGERECHTE Mitte — der ganze Unterschied zu `useRowDrag`.
      const side: 'before' | 'after' = x - box.left < box.width / 2 ? 'before' : 'after';

      /*
       * Die eigenen Nachbarlücken ändern nichts.
       *
       * „Links von der rechten Nachbarin" und „rechts von der linken" sind die
       * Stellen, an denen die Spalte schon steht — sie anzubieten verspricht
       * eine Bewegung, die dann nicht stattfindet.
       */
      const cols = colsIn(root);
      const at = cols.findIndex((c) => c.dataset['col'] === columnId);
      const dragged = cols.findIndex((c) => c.dataset['col'] === draggedId);
      if (at === -1 || dragged === -1) return null;
      if (side === 'after' && at === dragged - 1) return null;
      if (side === 'before' && at === dragged + 1) return null;

      return { columnId, side };
    },

    canDrop: () => true,
    onDrop,
  });
}
