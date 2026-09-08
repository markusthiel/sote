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
import { useShowDone } from '../hooks/useShowDone.js';
import { toggleDone } from '../tasks/toggleDone.js';
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
  inbox: 'Posteingang',
};

export function TaskList({
  route,
  workspace,
  projects,
  now,
  onChanged,
  openTask,
  onOpenTask,
}: {
  route: Route;
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onChanged: () => void;
  openTask: string | null;
  onOpenTask: (id: string | null) => void;
}) {
  const view = viewOf(route);
  const projectId = route.kind === 'project' ? route.projectId : undefined;
  const project = projects.find((p) => p.id === projectId);

  const [overdue, setOverdue] = useState<Task[]>([]);
  const [rows, setRows] = useState<Task[]>([]);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [unknownProject, setUnknownProject] = useState<string | null>(null);
  /*
   * Ob Erledigtes mitkommt — je Ansicht, im Browser gemerkt.
   *
   * Gemeldet: „es sollte überall die möglichkeit geben abgehakte
   * einzublenden." Vorher konnte das nur das Projekt, und es konnte es immer.
   */
  const { showDone, toggle: toggleShowDone } = useShowDone(view);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.tasks(view, {
      ...(workspace === undefined ? {} : { workspace }),
      ...(projectId === undefined ? {} : { project: projectId }),
      ...(showDone ? { done: true } : {}),
    });
    setOverdue(data.overdue);
    setRows(data.tasks);
    setLoaded(true);
  }, [view, workspace, projectId, showDone]);

  useEffect(() => {
    setLoaded(false);
    setNotice(undefined);
    void load().catch((e: unknown) => {
      setLoaded(true);
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    });
  }, [load]);

  /**
   * Der Pfad zum Projekt, nicht nur sein Name.
   *
   * „Kabel" allein reicht nicht: seit Ordner und Projekte getrennt sind, kann
   * dasselbe Wort in zwei Ordnern stehen — die Migration erzeugt sogar
   * regelmäßig „Haus ▸ Haus". Eine Zeile in Heute, die nur „Haus" zeigt, sagt
   * dann nicht, welches gemeint ist.
   *
   * Aus dem Baum gerechnet und nicht vom Server geholt: die Liste ist ohnehin
   * da, und eine zweite Quelle für denselben Pfad wären zwei Antworten auf
   * eine Frage. Der oberste Ordner bleibt weg — der ist bei allen gleich,
   * solange man in einem Arbeitsbereich steht, und trägt darum nichts bei.
   */
  const nameOf = (id: string | null): string | undefined => {
    if (id === null) return undefined;
    const teile: string[] = [];
    let at = projects.find((p) => p.id === id);
    // Gedeckelt, damit ein Kreis in den Daten die Oberfläche nicht anhält.
    for (let i = 0; at !== undefined && i < 12; i += 1) {
      teile.unshift(at.name);
      const parentId: string | null = at.parentId;
      at = parentId === null ? undefined : projects.find((p) => p.id === parentId);
    }
    if (teile.length === 0) return undefined;
    // Zwei Ebenen reichen: „Ordner ▸ Projekt". Der ganze Pfad in einer Zeile,
    // die vor allem die Aufgabe zeigen soll, wäre mehr Weg als Ziel.
    return teile.slice(-2).join(' ▸ ');
  };

  const errorOf = (id: string) => pending.find((p) => p.id === id)?.error;
  const isPending = (id: string) => pending.some((p) => p.id === id);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const canDrag = view === 'project';

  async function add(line: string) {
    setBusy(true);
    setNotice(undefined);
    setUnknownProject(null);
    try {
      // Der Bildschirm gibt seine Herkunft mit: wer in einem Projekt tippt,
      // meint dieses Projekt. Vorher ging die Zeile ohne Projekt hinaus und
      // die Aufgabe landete in Heute oder Irgendwann — angelegt, aber nicht
      // dort, wo man stand.
      const out = await api.createTask(line, workspace, projectId);
      // Vier verschiedene Nachrichten, und keine davon ist „ging nicht":
      // unbekannt und mehrdeutig sind zwei Fälle, und für Projekt und Person
      // je einer.
      if (out.unknownProject !== null) {
        setUnknownProject(out.unknownProject);
        setNotice(
          `Das Projekt „${out.unknownProject}“ gibt es hier nicht — die Aufgabe liegt ohne Projekt.`,
        );
      } else if (out.folderProject !== null) {
        /*
         * Die fünfte Meldung (Konzept 10d).
         *
         * Der Unterschied zu „gibt es nicht" zählt für den Menschen:
         * unbekannt heißt vertippt, dies heißt falsche Ebene gemeint. Ohne
         * eigene Meldung schickt „gibt es nicht" jemanden auf die Suche nach
         * einem Tippfehler in einem Namen, den es gibt.
         */
        setUnknownProject(null);
        setNotice(
          `„${out.folderProject}“ ist ein Ordner — Aufgaben liegen in Projekten. Die Aufgabe liegt ohne Projekt.`,
        );
      } else if (out.ambiguousProject !== null) {
        setUnknownProject(out.ambiguousProject);
        setNotice(
          `„${out.ambiguousProject}“ gibt es mehr als einmal — die Aufgabe liegt ohne Projekt. Zieh sie ins richtige.`,
        );
      } else if (out.ambiguousAssignees.length > 0) {
        setNotice(
          `${out.ambiguousAssignees.join(', ')} passt auf mehrere Leute — die Aufgabe ist niemandem zugewiesen.`,
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
  /**
   * Abhaken **und** zurücknehmen.
   *
   * Gemeldet: „Ich kann übrigens abgehakte Aufgaben nicht wieder eröffnen."
   * Hier stand vorher immer `api.complete` — auch bei einer Zeile, deren
   * Kästchen `„… wieder öffnen"` heißt. Der Server kehrt bei einer erledigten
   * Aufgabe früh zurück, also passierte nichts: ein Umschalter, der nur in
   * eine Richtung schaltet.
   */
  async function toggle(task: Task) {
    const wieder = task.completed !== null;
    setPending((p) => [...p, { id: task.id }]);
    // Die Zeile verschwindet nur beim ABHAKEN sofort. Beim Zurücknehmen soll
    // sie stehen bleiben und ihren Haken verlieren — sie geht ja nirgendwohin,
    // sondern wird wieder eine offene Zeile an derselben Stelle.
    if (!wieder) {
      setOverdue((r) => r.filter((x) => x.id !== task.id));
      setRows((r) => r.filter((x) => x.id !== task.id));
    }
    try {
      // Die Richtung entscheidet `toggleDone` und nicht dieser Bildschirm:
      // dieselbe Entscheidung stand an drei Stellen, und an zwei davon war sie
      // falsch.
      const out = await toggleDone(task, workspace);
      if (out.nextTitle !== undefined) setNotice(`„${out.nextTitle}“ kommt wieder.`);
      await load();
      onChanged();
      setPending((p) => p.filter((x) => x.id !== task.id));
    } catch (e) {
      setPending((p) =>
        p.map((x) =>
          x.id === task.id
            ? {
                id: x.id,
                error:
                  e instanceof ApiError
                    ? e.message
                    : wieder
                      ? 'Wieder öffnen ging nicht.'
                      : 'Abhaken ging nicht.',
              }
            : x,
        ),
      );
      if (!wieder) setRows((r) => [task, ...r]);
    }
  }

  /** Wegwerfen: optimistisch wie das Abhaken — die Zeile soll sofort weg. */
  async function throwAway(task: Task) {
    setOpenMenu(null);
    setOverdue((r) => r.filter((x) => x.id !== task.id));
    setRows((r) => r.filter((x) => x.id !== task.id));
    try {
      await api.trash('tasks', task.id, workspace);
      setNotice(`„${task.title}“ liegt im Papierkorb.`);
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Wegwerfen ging nicht.');
      await load();
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
  /*
   * Offen und erledigt, aus derselben Liste.
   *
   * Die Grenze zieht der Server über die Sortierung (`completed_at IS NOT
   * NULL` zuerst), hier wird nur getrennt. Ein `filter` und nicht ein Suchen
   * der Grenze: eine Aufgabe, die zwischen Laden und Zeichnen abgehakt wird,
   * soll im richtigen Bündel landen und nicht an einer gemerkten Stelle.
   */
  const offen = rows.filter((r) => r.completed === null);
  const erledigt = rows.filter((r) => r.completed !== null);

  const subtitle =
    route.kind === 'project'
      ? `${count === 0 ? 'nichts offen' : `${count} offen`}${canDrag ? ' — Zeilen lassen sich ziehen' : ''}`
      : view === 'today'
        ? `${longDate(now)}${loaded ? ` — ${count === 0 ? 'nichts offen' : `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`}${overdue.length > 0 ? `, ${overdue.length} überfällig` : ''}` : ''}`
        : view === 'upcoming'
          ? 'Was einen Zeitpunkt hat, aber später'
          : view === 'inbox'
            ? // Der Untertitel sagt, was zu tun ist, und nicht was fehlt: der
              // Posteingang ist eine Frage an den Menschen und keine Ansicht
              // über die Zeit.
              'Noch ohne Projekt — zieh sie an ihren Ort oder tippe #projekt dazu'
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
          open={openTask === task.id}
          onOpen={() => onOpenTask(openTask === task.id ? null : task.id)}
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
                onTrash={() => void throwAway(task)}
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
        {/*
          Der Umschalter steht im Kopf, bei der Frage, die er beantwortet.
          Nicht unten bei der Liste, die er erzeugt: dort wäre er beim ersten
          Mal unsichtbar, weil es die Liste noch nicht gibt.
        */}
        <button
          type="button"
          className="head-toggle"
          aria-pressed={showDone}
          onClick={toggleShowDone}
        >
          {showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
        </button>
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

        {/*
          Zwei Bündel aus einer Liste.
          Der Server liefert sie in einer Abfrage, Erledigtes am Ende — eine
          zweite Abfrage hätte eine eigene Sortierung und einen eigenen
          Zeitpunkt, und zwei Listen, die zusammen eine sein sollen, laufen
          genau daran auseinander. Getrennt wird darum HIER, an der Grenze, die
          die Sortierung schon gezogen hat.
        */}
        {offen.map((task, i) => renderRow(task, i))}

        {erledigt.length > 0 ? (
          <>
            <div className="section-label done">
              Erledigt
              <span className="rule" />
            </div>
            {/*
              Der Index läuft weiter: `renderRow` benutzt ihn fürs Ziehen, und
              zwei Bündel mit je eigener Zählung würden zwei Zeilen denselben
              Platz geben.
            */}
            {erledigt.map((task, i) => renderRow(task, offen.length + i))}
          </>
        ) : null}

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
                  : view === 'inbox'
                    ? // Ein leerer Posteingang ist ein GUTER Zustand, und der
                      // Satz sagt das. „Nichts hier" liest sich wie ein Mangel.
                      'Alles einsortiert.'
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
