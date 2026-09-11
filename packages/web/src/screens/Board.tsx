/**
 * SOTE — die Tafel.
 *
 * Die vierte Anzeigeform einer Liste (Migration 0030). Spalten nebeneinander,
 * Aufgaben als Karten darin.
 *
 * ## Was hier NICHT steht
 *
 * Das Auffangbecken. Es ist keine Spalte, sondern die erste — Aufgaben ohne
 * Zuordnung (`columnId === null`) werden dorthin gezeichnet. Wer sie umbenennt,
 * verschiebt keine Aufgabe; wer sie wegräumt, macht die zweite zur ersten. Eine
 * gespeicherte Markierung müsste bei jedem Umsortieren nachgezogen werden und
 * hinge irgendwann an der falschen Spalte.
 *
 * Und die Regeln um „fertig": die stehen im Server (`board.ts`), weil sie in
 * DEMSELBEN Schreibvorgang gelten müssen wie das Häkchen. Die Oberfläche zieht
 * die Karte und lädt neu — sie rechnet nicht nach, was der Server entscheidet.
 *
 * ## Spalten werden nicht gezogen
 *
 * Nur die Karten. `useRowDrag` misst obere und untere Hälfte einer Zeile — auf
 * eine Reihe nebeneinander angewandt hieße das, links und rechts an der
 * senkrechten Achse zu messen, und das ist schlicht die falsche Rechnung. Die
 * Spalten wandern über „← nach links" und „nach rechts →" im Menü, wie die
 * Zweige im Projektbaum vor dem Ziehen auch.
 */

import { generateKeyBetween } from '@sote/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, type Task } from '../api.js';
import { TaskRow } from '../components/TaskRow.js';
import { useColumnDrag } from '../hooks/useColumnDrag.js';
import { useRowDrag } from '../hooks/useRowDrag.js';

export interface BoardColumn {
  id: string;
  name: string;
  sort_key: string;
  is_done: boolean;
}

export function Board({
  workspace,
  projectId,
  tasks,
  now,
  openTask,
  onOpenTask,
  onChanged,
}: {
  workspace: string | undefined;
  projectId: string;
  /** Dieselben Zeilen, die die Liste zeigt — die Tafel ordnet sie nur anders. */
  tasks: readonly Task[];
  now: Date;
  openTask: string | null;
  onOpenTask: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [columns, setColumns] = useState<BoardColumn[] | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const out = await api.board(projectId, workspace);
    setColumns(out.columns);
  }, [projectId, workspace]);

  useEffect(() => {
    void load().catch(() => setNotice('Die Spalten ließen sich nicht laden.'));
  }, [load]);

  async function tun(fn: () => Promise<unknown>, wenn: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : wenn);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Welche Karten in welcher Spalte liegen.
   *
   * Die ERSTE Spalte bekommt auch alles ohne Zuordnung. Das ist die ganze
   * Umsetzung des Auffangbeckens — eine Zeile Code statt einer Spalte in der
   * Datenbank.
   */
  const kartenIn = (column: BoardColumn, index: number): Task[] =>
    tasks.filter(
      (t) => t.columnId === column.id || (index === 0 && t.columnId === null),
    );

  const drag = useRowDrag({
    container: boardRef,
    canDrop: (id, position) => {
      if (tasks.find((t) => t.id === id) === undefined) return false;
      // Auf eine SPALTE: ans Ende. Auf eine KARTE: an deren Stelle.
      if (position.intent === 'into') return columns?.some((c) => c.id === position.rowId) === true;
      return tasks.some((t) => t.id === position.rowId);
    },
    onDrop: (id, position) => {
      if (position.intent === 'into') {
        /*
         * Auf die Spalte gelegt: ans Ende, und die Reihenfolge sonst lassen.
         * „Hinein" sagt nichts über die Stelle — und unten ist die Stelle, an
         * der Neues in einer Liste erscheint.
         */
        const at = columns?.findIndex((c) => c.id === position.rowId) ?? -1;
        const ziel = columns?.[at];
        if (ziel === undefined) return;
        const drin = kartenIn(ziel, at).filter((t) => t.id !== id);
        void tun(
          () =>
            api.placeCard(
              id,
              ziel.id,
              { afterId: drin.at(-1)?.id ?? null, beforeId: null },
              workspace,
            ),
          'Verschieben ging nicht.',
        );
        return;
      }

      /*
       * Zwischen zwei Karten: dieselbe Spalte wie die Zielkarte, und die
       * Stelle daneben.
       *
       * Die Tafel führt KEINE eigene Reihenfolge — sie sortiert nach demselben
       * Schlüssel wie die Liste. Wer hier umsortiert, sortiert damit auch die
       * Liste um. Ein zweiter Schlüssel je Spalte wäre eine zweite Ordnung
       * derselben Aufgaben, und dann stünde dieselbe Liste in zwei Ansichten
       * verschieden, ohne dass jemand das entschieden hätte.
       */
      const ziel = tasks.find((t) => t.id === position.rowId);
      if (ziel === undefined || columns === undefined) return;
      const at = columns.findIndex(
        (c) => c.id === ziel.columnId || (ziel.columnId === null && c.id === columns[0]?.id),
      );
      const spalte = columns[at];
      if (spalte === undefined) return;

      // Ohne die gezogene Karte: sonst läge der neue Schlüssel dort, wo sie
      // schon ist.
      const reihe = kartenIn(spalte, at).filter((t) => t.id !== id);
      const i = reihe.findIndex((t) => t.id === ziel.id);
      if (i === -1) return;
      void tun(
        () =>
          api.placeCard(
            id,
            spalte.id,
            {
              afterId: position.intent === 'after' ? reihe[i]!.id : (reihe[i - 1]?.id ?? null),
              beforeId: position.intent === 'after' ? (reihe[i + 1]?.id ?? null) : reihe[i]!.id,
            },
            workspace,
          ),
        'Verschieben ging nicht.',
      );
    },
  });

  /**
   * Spalten ziehen — waagerecht, und darum ein eigener Griff.
   *
   * Der Kopf ist der Anfasser und nicht die ganze Spalte: in der Spalte liegen
   * die Karten, und die haben ihre eigene Geste. Ein gemeinsamer Anfasser wäre
   * ein Druck mit zwei Bedeutungen.
   *
   * Die Pfeile im Menü BLEIBEN. Ziehen allein wäre eine Reihenfolge, die man
   * ohne Zeiger nicht ändern kann — dieselbe Überlegung wie bei ⌥↑/⌥↓ in der
   * Liste.
   */
  const colDrag = useColumnDrag({
    container: boardRef,
    onDrop: (id, position) => {
      const reihe = (columns ?? []).filter((c) => c.id !== id);
      const at = reihe.findIndex((c) => c.id === position.columnId);
      if (at === -1) return;
      const [a, b] =
        position.side === 'after'
          ? [reihe[at]!.sort_key, reihe[at + 1]?.sort_key ?? null]
          : [reihe[at - 1]?.sort_key ?? null, reihe[at]!.sort_key];
      void tun(
        () => api.updateColumn(id, { sortKey: generateKeyBetween(a, b) }, workspace),
        'Verschieben ging nicht.',
      );
    },
  });

  if (columns === undefined) return <div className="board" aria-busy="true" />;

  const neuerSchluessel = (at: number): string =>
    generateKeyBetween(columns[at - 1]?.sort_key ?? null, columns[at]?.sort_key ?? null);

  /** Eine Spalte einen Platz weiter — der Schlüssel liegt zwischen den Nachbarn. */
  const ruecken = (id: string, dir: -1 | 1) => {
    const i = columns.findIndex((c) => c.id === id);
    if (i < 0 || i + dir < 0 || i + dir >= columns.length) return;
    const nachbar = columns[i + dir]!;
    const dahinter = columns[i + 2 * dir];
    const [a, b] =
      dir === -1
        ? [dahinter?.sort_key ?? null, nachbar.sort_key]
        : [nachbar.sort_key, dahinter?.sort_key ?? null];
    setMenu(null);
    void tun(
      () => api.updateColumn(id, { sortKey: generateKeyBetween(a, b) }, workspace),
      'Verschieben ging nicht.',
    );
  };

  return (
    <>
      {drag.dragging !== null && drag.pointer !== null ? (
        <div
          className="drag-preview"
          style={{ left: drag.pointer.x, top: drag.pointer.y }}
          aria-hidden="true"
        >
          {tasks.find((t) => t.id === drag.dragging)?.title ?? ''}
        </div>
      ) : null}

      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      {columns.length === 0 && !adding ? (
        <div className="empty board-empty">
          <strong>Diese Liste hat noch keine Tafel.</strong>
          {/*
            Der Satz sagt, was eine Spalte IST, und nicht nur, dass eine fehlt.
            Wer zum ersten Mal auf eine leere Tafel sieht, weiß sonst nicht, ob
            er Spalten anlegen soll oder ob etwas kaputt ist.
          */}
          Leg eine Spalte an — die erste nimmt alles auf, was noch keiner
          zugeordnet ist.
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            Erste Spalte
          </button>
        </div>
      ) : null}

      <div className="board" ref={boardRef}>
        {columns.map((column, index) => {
          const karten = kartenIn(column, index);
          return (
            <section
              key={column.id}
              className="board-column"
              data-row={column.id}
              data-row-parent="board"
              /*
                `only`: jeder Punkt in der Spalte heißt „hinein". Ohne das
                lasen die oberen und unteren 30 Prozent „davor/dahinter", und
                genau dort liegen die Karten — die Tafel führt aber keine
                Reihenfolge der Spalten durch Ziehen.
              */
              data-row-nest="only"
              data-drop={
                drag.target?.rowId === column.id
                  ? 'into'
                  : colDrag.target?.columnId === column.id
                    ? colDrag.target.side
                    : undefined
              }
              data-dragging={colDrag.dragging === column.id}
            >
              <header
                className="board-head"
                data-col={column.id}
                onPointerDown={colDrag.onPointerDown}
              >
                {renaming === column.id ? (
                  <input
                    className="set-input"
                    defaultValue={column.name}
                    autoFocus
                    aria-label={`${column.name} umbenennen`}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      setRenaming(null);
                      if (name !== '' && name !== column.name) {
                        void tun(
                          () => api.updateColumn(column.id, { name }, workspace),
                          'Umbenennen ging nicht.',
                        );
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') {
                        e.currentTarget.value = column.name;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <>
                    <span className="board-name">{column.name}</span>
                    {/*
                      Die Zahl sagt, wie viel hier liegt — und das ist die
                      Frage, die eine Tafel beantworten soll: wo staut es sich.
                    */}
                    <span className="board-count">{karten.length}</span>
                    {column.is_done ? (
                      <span className="board-done" title="Abgehaktes wandert hierher">
                        fertig
                      </span>
                    ) : null}
                    {index === 0 ? (
                      <span className="board-done" title="Nimmt alles auf, was keiner Spalte zugeordnet ist">
                        Eingang
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="dots"
                      aria-label={`Menü für ${column.name}`}
                      aria-haspopup="menu"
                      onClick={() => setMenu(menu === column.id ? null : column.id)}
                    >
                      ⋮
                    </button>
                  </>
                )}
                {menu === column.id ? (
                  <div className="menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        setMenu(null);
                        setRenaming(column.id);
                      }}
                    >
                      Umbenennen
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      disabled={index === 0}
                      onClick={() => ruecken(column.id, -1)}
                    >
                      ← nach links
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      disabled={index === columns.length - 1}
                      onClick={() => ruecken(column.id, 1)}
                    >
                      nach rechts →
                    </button>
                    {/*
                      Die Fertig-Spalte, umschaltbar. Es kann nur eine geben —
                      das Einschalten nimmt sie darum der bisherigen ab, und
                      der Server tut das in einem Zug, damit es nicht an einem
                      eindeutigen Index scheitert.
                    */}
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      aria-pressed={column.is_done}
                      onClick={() => {
                        setMenu(null);
                        void tun(
                          () =>
                            api.updateColumn(
                              column.id,
                              { isDone: !column.is_done },
                              workspace,
                            ),
                          'Ging nicht.',
                        );
                      }}
                    >
                      {column.is_done
                        ? 'Nicht mehr die Fertig-Spalte'
                        : 'Das ist die Fertig-Spalte'}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item danger"
                      onClick={() => {
                        setMenu(null);
                        void tun(
                          () => api.removeColumn(column.id, workspace),
                          'Wegräumen ging nicht.',
                        );
                      }}
                    >
                      {/*
                        Der Satz sagt, was mit den Karten geschieht. „Spalte
                        löschen" allein lässt offen, ob die Arbeit mitgeht —
                        und das ist die einzige Frage, die dabei zählt.
                      */}
                      Spalte weg, Karten in den Eingang
                    </button>
                  </div>
                ) : null}
              </header>

              <div className="board-cards">
                {karten.map((task) => (
                  <div
                    key={task.id}
                    className="task-wrap board-card"
                    data-row={task.id}
                    data-row-parent={column.id}
                    onPointerDown={drag.onPointerDown}
                    data-dragging={drag.dragging === task.id}
                    data-drop={
                      drag.target?.rowId === task.id ? drag.target.intent : undefined
                    }
                  >
                    <TaskRow
                      task={task}
                      view="cards"
                      open={openTask === task.id}
                      onOpen={() => onOpenTask(openTask === task.id ? null : task.id)}
                      now={now}
                      onComplete={() => {
                        /*
                         * Abhaken geht über die gewöhnliche Route, und die
                         * Tafel lädt danach neu: ob die Karte in die
                         * Fertig-Spalte wandert, entscheidet der Server. Es
                         * hier vorwegzunehmen wäre eine zweite Fassung
                         * derselben Regel.
                         */
                        void tun(() => api.complete(task.id, workspace), 'Ging nicht.');
                      }}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {adding ? (
          <section className="board-column board-new">
            <input
              className="set-input"
              autoFocus
              placeholder="Name der Spalte"
              aria-label="Name der Spalte"
              onBlur={(e) => {
                const name = e.target.value.trim();
                setAdding(false);
                if (name === '') return;
                void tun(
                  () =>
                    api.addColumn(
                      {
                        project: projectId,
                        name,
                        sortKey: neuerSchluessel(columns.length),
                      },
                      workspace,
                    ),
                  'Anlegen ging nicht.',
                );
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = '';
                  e.currentTarget.blur();
                }
              }}
            />
          </section>
        ) : columns.length > 0 ? (
          <button
            type="button"
            className="board-add"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            + Spalte
          </button>
        ) : null}
      </div>
    </>
  );
}
