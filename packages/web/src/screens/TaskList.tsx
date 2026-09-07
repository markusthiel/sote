/**
 * SOTE — eine Liste von Aufgaben, für jede Ansicht dieselbe.
 *
 * Vorher gab es einen Bildschirm namens `Today`, und die nächste Ansicht hätte
 * eine Kopie davon bekommen. Ein Bildschirm, vier Ansichten: was sich
 * unterscheidet, sind Überschrift, Abschnitte und der Umstand, ob man hier
 * ziehen darf.
 *
 * Gezogen wird nur, wo eine Reihenfolge etwas bedeutet — in einem **Projekt**.
 * In „Heute" ist die Reihenfolge nach Priorität und Zeit sortiert; eine Zeile
 * dort zu ziehen, würde einen Schlüssel setzen, den niemand sieht.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, type Project, type Task, type TaskPatch } from '../api.js';
import { HandleMenu } from '../components/HandleMenu.js';
import { QuickAdd } from '../components/QuickAdd.js';
import { TaskRow } from '../components/TaskRow.js';
import { longDate } from '../dates.js';
import { neighboursFor, neighboursForStep, reordered } from '../reorder.js';
import { viewOf, type Route } from '../route.js';

interface Pending {
  readonly id: string;
  readonly error?: string;
}

const TITLES: Record<string, string> = {
  today: 'Heute',
  upcoming: 'Demnächst',
  someday: 'Irgendwann',
};

export function TaskList({
  route,
  workspace,
  projects,
  now,
  onChanged,
}: {
  route: Route;
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onChanged: () => void;
}) {
  const view = viewOf(route);
  const projectId = route.kind === 'project' ? route.projectId : undefined;
  const project = projects.find((p) => p.id === projectId);

  const [overdue, setOverdue] = useState<Task[]>([]);
  const [rows, setRows] = useState<Task[]>([]);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [unknownProject, setUnknownProject] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.tasks(view, {
      ...(workspace === undefined ? {} : { workspace }),
      ...(projectId === undefined ? {} : { project: projectId }),
    });
    setOverdue(data.overdue);
    setRows(data.tasks);
    setLoaded(true);
  }, [view, workspace, projectId]);

  useEffect(() => {
    setLoaded(false);
    setNotice(undefined);
    void load().catch((e: unknown) => {
      setLoaded(true);
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    });
  }, [load]);

  const nameOf = (id: string | null) =>
    id === null ? undefined : projects.find((p) => p.id === id)?.name;

  const errorOf = (id: string) => pending.find((p) => p.id === id)?.error;
  const isPending = (id: string) => pending.some((p) => p.id === id);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const canDrag = view === 'project';

  async function add(line: string) {
    setBusy(true);
    setNotice(undefined);
    setUnknownProject(null);
    try {
      const out = await api.createTask(line, workspace);
      if (out.unknownProject !== null) {
        setUnknownProject(out.unknownProject);
        setNotice(
          `Das Projekt „${out.unknownProject}“ gibt es hier nicht — die Aufgabe liegt ohne Projekt.`,
        );
      } else if (out.unknownAssignees.length > 0) {
        setNotice(
          `Unbekannt hier: ${out.unknownAssignees.join(', ')}. Die Aufgabe ist niemandem zugewiesen.`,
        );
      }
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Anlegen ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  /** Abhaken: optimistisch, mit sichtbarem Rücksprung bei Fehlschlag. */
  async function toggle(task: Task) {
    setPending((p) => [...p, { id: task.id }]);
    setOverdue((r) => r.filter((x) => x.id !== task.id));
    setRows((r) => r.filter((x) => x.id !== task.id));
    try {
      const out = await api.complete(task.id, workspace);
      if (out.next !== null) setNotice(`„${out.next.title}“ kommt wieder.`);
      await load();
      onChanged();
      setPending((p) => p.filter((x) => x.id !== task.id));
    } catch (e) {
      setPending((p) =>
        p.map((x) =>
          x.id === task.id
            ? { id: x.id, error: e instanceof ApiError ? e.message : 'Abhaken ging nicht.' }
            : x,
        ),
      );
      setRows((r) => [task, ...r]);
    }
  }

  /** Felder ändern: nicht optimistisch. */
  async function change(task: Task, fields: TaskPatch) {
    setBusy(true);
    try {
      await api.patch(task.id, fields, workspace);
      setOpenMenu(null);
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Ändern ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Verschieben: die Reihe geht sofort, der Server bekommt die Nachbarn.
   *
   * Bei Fehlschlag wird nicht zurückgerechnet, sondern neu geladen — eine
   * selbst gerechnete Rücknahme wäre eine zweite Antwort auf „wie stehen die
   * Zeilen", und die ist beim Umsortieren besonders leicht falsch.
   */
  async function moveTo(from: number, to: number) {
    const between = neighboursFor(ids, from, to);
    if (between === null) return;
    const id = ids[from]!;
    const preview = reordered(ids, from, to);
    setRows((r) => preview.map((x) => r.find((y) => y.id === x)!).filter(Boolean));
    try {
      await api.move(id, between, workspace);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Verschieben ging nicht.');
      await load();
    }
  }

  async function step(id: string, direction: -1 | 1) {
    const between = neighboursForStep(ids, id, direction);
    if (between === null) return;
    const from = ids.indexOf(id);
    await moveTo(from, direction === -1 ? from - 1 : from + 2);
  }

  const title =
    route.kind === 'project' ? (project?.name ?? 'Projekt') : (TITLES[view] ?? 'Aufgaben');
  const count = overdue.length + rows.filter((r) => r.completed === null).length;

  const subtitle =
    route.kind === 'project'
      ? `${count === 0 ? 'nichts offen' : `${count} offen`}${canDrag ? ' — Zeilen lassen sich ziehen' : ''}`
      : view === 'today'
        ? `${longDate(now)}${loaded ? ` — ${count === 0 ? 'nichts offen' : `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`}${overdue.length > 0 ? `, ${overdue.length} überfällig` : ''}` : ''}`
        : view === 'upcoming'
          ? 'Was einen Zeitpunkt hat, aber später'
          : 'Ohne Zeitpunkt — nicht unwichtig, nur ungeplant';

  function renderRow(task: Task, index: number) {
    return (
      <div
        key={task.id}
        className="task-wrap"
        data-dragging={dragging === task.id}
        draggable={canDrag && task.completed === null}
        onDragStart={() => setDragging(task.id)}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => {
          if (canDrag && dragging !== null) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging === null) return;
          const from = ids.indexOf(dragging);
          setDragging(null);
          void moveTo(from, index);
        }}
        onKeyDown={(e) => {
          // Ziehen allein wäre eine Reihenfolge, die man mit der Tastatur
          // nicht ändern kann.
          if (!canDrag || !e.altKey) return;
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            void step(task.id, -1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            void step(task.id, 1);
          }
        }}
      >
        <TaskRow
          task={task}
          now={now}
          pending={isPending(task.id)}
          error={errorOf(task.id)}
          projectName={route.kind === 'project' ? undefined : nameOf(task.projectId)}
          grip={canDrag && task.completed === null}
          onComplete={(t) => void toggle(t)}
          onOpenMenu={() => setOpenMenu(openMenu === task.id ? null : task.id)}
          menu={
            openMenu === task.id ? (
              <HandleMenu
                task={task}
                now={now}
                busy={busy}
                onPatch={(fields) => void change(task, fields)}
                onClose={() => setOpenMenu(null)}
              />
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="main-head">
        <h1>{title}</h1>
        <div className="sub">{subtitle}</div>
      </div>

      <div className="body">
        <QuickAdd
          now={now}
          onSubmit={(line) => void add(line)}
          busy={busy}
          unknownProject={unknownProject}
        />
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}

        {overdue.length > 0 ? (
          <>
            <div className="section-label late">
              Überfällig
              <span className="rule" />
            </div>
            {overdue.map((task, i) => renderRow(task, i))}
            <div className="section-label">
              Heute
              <span className="rule" />
            </div>
          </>
        ) : null}

        {rows.map((task, i) => renderRow(task, i))}

        {/* Eine Ablegestelle hinter der letzten Zeile, sonst gibt es kein
            „nach ganz unten". */}
        {canDrag && dragging !== null ? (
          <div
            className="drop-tail"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = ids.indexOf(dragging);
              setDragging(null);
              void moveTo(from, ids.length);
            }}
          >
            hierhin, ans Ende
          </div>
        ) : null}

        {loaded && overdue.length === 0 && rows.length === 0 ? (
          <div className="empty">
            <strong>
              {view === 'today'
                ? 'Für heute ist nichts geplant.'
                : view === 'upcoming'
                  ? 'Nichts steht an.'
                  : route.kind === 'project'
                    ? 'Dieses Projekt ist leer.'
                    : 'Nichts Ungeplantes.'}
            </strong>
            Tippe oben eine Zeile — Datum, Projekt und Priorität liest sie mit.
          </div>
        ) : null}
      </div>
    </>
  );
}
