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

import {
  formatDuration,
  LIST_VIEWS,
  LIST_VIEW_SAYS,
  resolveListView,
  type ListView,
} from '@sote/core';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useRowDrag } from '../hooks/useRowDrag.js';
import { useNudge } from '../hooks/useNudge.js';
import { api, ApiError, type Project, type Task, type TaskPatch } from '../api.js';
import { HandleMenu } from '../components/HandleMenu.js';
import { QuickAdd } from '../components/QuickAdd.js';
import { CheckSquareIcon, ColumnsIcon, ListIcon } from '../components/icons.js';
import { TaskRow } from '../components/TaskRow.js';
import { DoneHiddenIcon, ViewCardsIcon, ViewFullIcon } from '../components/viewIcons.js';
import { Board } from './Board.js';
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

/**
 * Welches Zeichen für welche Form.
 *
 * Als Karte und nicht als Verzweigung im Knopf: der Wortschatz steht im Kern,
 * und wer ihm ein Wort hinzufügt, soll hier eine fehlende Zeile finden und
 * nicht ein Zeichen, das stillschweigend fehlt.
 */
const VIEW_ICONS: Record<ListView, ReactNode> = {
  full: <ViewFullIcon />,
  plain: <ListIcon size={16} />,
  cards: <ViewCardsIcon />,
  board: <ColumnsIcon size={16} />,
};

export function TaskList({
  route,
  workspace,
  projects,
  now,
  onChanged,
  openTask,
  onOpenTask,
  onLabel,
  listView,
  workspaceListView,
  onListView,
}: {
  route: Route;
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onChanged: () => void;
  openTask: string | null;
  onOpenTask: (id: string | null) => void;
  /** Ein Klick auf ein Schlagwort — führt in die Suche. */
  onLabel: (name: string) => void;
  /**
   * Was diese Person hier gewählt hat, und was der Arbeitsbereich vorgibt.
   *
   * Beides kommt von oben und wird nicht hier geholt: die Wahl gilt auch in
   * der Suche und später auf der Tafel, und drei Stellen, die dieselbe
   * Einstellung laden, sind drei Ladezeiten und drei Gelegenheiten,
   * verschiedene Antworten zu zeigen.
   */
  listView: ListView | undefined;
  workspaceListView: ListView | undefined;
  onListView: (display: ListView | null) => void;
}) {
  const view = viewOf(route);
  const projectId = route.kind === 'project' ? route.projectId : undefined;
  const project = projects.find((p) => p.id === projectId);

  const [overdue, setOverdue] = useState<Task[]>([]);
  const [rows, setRows] = useState<Task[]>([]);
  /** Die Unteraufgaben, nach Elternteil — kommt mit der Liste. */
  const [children, setChildren] = useState<Record<string, Task[]>>({});
  /**
   * Welche Aufgaben AUFGEKLAPPT sind.
   *
   * Aufgeklappt und nicht zugeklappt gemerkt — anders als beim Projektbaum.
   * Dort ist der Normalzustand „offen", weil ein Baum die Struktur zeigt;
   * hier ist er „zu", weil eine Liste die Arbeit zeigt und fünf aufgeklappte
   * Aufgaben eine Liste von dreißig Zeilen machen, von denen zwanzig
   * Kleinkram sind.
   *
   * Nicht gespeichert: es ist eine Handbewegung und keine Einstellung. Was
   * dauerhaft gilt, ist die Anzeigeform (Migration 0028).
   */
  const [open_, setOpen] = useState<ReadonlySet<string>>(new Set());
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
    setChildren(data.children ?? {});
    setLoaded(true);
  }, [view, workspace, projectId, showDone]);

  /*
   * Die Türklingel für Aufgaben.
   *
   * Hier und nicht in der Hülle: die Liste weiß, welche Ansicht sie zeigt, und
   * `load` ist ihr eigener Weg. In der Hülle bräuchte es eine zweite Stelle,
   * die dasselbe kann — und die eine wäre irgendwann die falsche.
   *
   * Gemeldet war der Fall, der das nötig machte: „wenn ich per Link teile und
   * dort arbeite, wird das beim Hauptuser nicht live aktualisiert."
   */
  useNudge('/api/stream', 'tasks', () => {
    // Ohne `setLoaded(false)`: ein Anstoß soll die Liste austauschen, nicht
    // durch einen leeren Zustand blinken. Sie steht schon da und ist bloß
    // veraltet.
    void load().catch(() => undefined);
  });

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
  /**
   * Alle Zeilen, die gerade sichtbar sein KÖNNTEN — oben und Kinder.
   *
   * Die Geste fragt nach einer Id und bekommt hier die Aufgabe dazu. Auch die
   * Kinder zugeklappter Zeilen stehen drin: dort wird nichts abgelegt, aber
   * `canDrop` muss wissen, ob eine Aufgabe Kinder hat.
   */
  const alle = useMemo(
    () => [...overdue, ...rows, ...Object.values(children).flat()],
    [overdue, rows, children],
  );
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

  /**
   * Ziehen mit dem Zeiger statt mit HTML5-Drag.
   *
   * GEMELDET, zweierlei: „teilweise das Problem, dass man beim Ziehen Teile
   * der Seite markiert" und „man sieht noch nicht gut, wohin man es zieht."
   *
   * Beides sind Eigenschaften des alten Verfahrens und keine Einstellung
   * daran. `draggable` überlässt dem Browser, wann eine Geste eine Geste ist
   * — auf dem Weg dahin markiert er Text, und auf iOS feuert er gar nicht,
   * also ließ sich am Telefon überhaupt nichts umsortieren.
   *
   * `useListDrag` ist SONEs Fassung, kopiert: kurzes Halten am Finger (350 ms)
   * statt sofort, Zeiger-Capture, und der abschließende Klick wird
   * geschluckt. Was es nicht mitbringt, zeichnet die Liste selbst — die Linie
   * in der Lücke und die schwebende Zeile unter dem Zeiger.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useRowDrag({
    container: listRef,
    canDrop: (id, position) => {
      const mich = alle.find((t) => t.id === id);
      const ziel = alle.find((t) => t.id === position.rowId);
      if (mich === undefined || ziel === undefined || mich.id === ziel.id) return false;

      /*
       * Die Ein-Ebenen-Regel, hier noch einmal — und das ist kein
       * Misstrauen gegen den Server, sondern der Unterschied zwischen
       * „abgelehnt" und „gar nicht erst angeboten". Eine Linie, die etwas
       * verspricht, das der Server zurückweist, endet in einem Fehler statt
       * in einer Bewegung.
       */
      const zielVater = position.intent === 'into' ? ziel.id : ziel.parentId;
      if (zielVater === mich.id) return false;
      if (zielVater !== null) {
        // Eine Unteraufgabe kann nichts aufnehmen, und wer selbst Kinder hat,
        // wird kein Kind.
        const vater = alle.find((t) => t.id === zielVater);
        if (vater === undefined || vater.parentId !== null) return false;
        if ((children[mich.id] ?? []).length > 0) return false;
      }
      /*
       * Umsortieren geht nur, wo sortiert wird. UMHÄNGEN geht überall: in
       * „Heute" ist die Reihenfolge die der Zeit, aber eine Aufgabe aus ihrer
       * Elternaufgabe zu lösen ist keine Sortierung.
       */
      if (!canDrag && zielVater === (mich.parentId ?? null)) return false;
      return true;
    },
    onDrop: (id, position) => {
      const mich = alle.find((t) => t.id === id);
      const ziel = alle.find((t) => t.id === position.rowId);
      if (mich === undefined || ziel === undefined) return;

      if (position.intent === 'into') {
        // Ans Ende der Kinder: „hinein" sagt nichts über die Stelle, und unten
        // ist die Stelle, an der Neues in einer Liste erscheint.
        const drin = (children[ziel.id] ?? []).filter((k) => k.id !== id);
        void reorder(id, {
          parentId: ziel.id,
          afterId: drin.at(-1)?.id ?? null,
          beforeId: null,
        });
        return;
      }

      const zielVater = ziel.parentId ?? null;
      /*
       * Die Nachbarn OHNE die gezogene Zeile: zieht man innerhalb derselben
       * Ebene, stünde sie sonst in der Reihe und der neue Schlüssel läge
       * dort, wo sie schon ist.
       */
      const reihe = (zielVater === null
        ? rows.filter((t) => t.parentId === null)
        : (children[zielVater] ?? [])
      ).filter((t) => t.id !== id);
      const at = reihe.findIndex((t) => t.id === ziel.id);
      if (at === -1) return;
      void reorder(id, {
        ...(zielVater === (mich.parentId ?? null) ? {} : { parentId: zielVater }),
        afterId:
          position.intent === 'after' ? reihe[at]!.id : (reihe[at - 1]?.id ?? null),
        beforeId:
          position.intent === 'after' ? (reihe[at + 1]?.id ?? null) : reihe[at]!.id,
      });
    },
  });

  /**
   * Verschieben und/oder umhängen, mit Nachladen.
   *
   * Kein vorgezogenes Bild wie beim reinen Umsortieren: ein Umhängen ändert
   * zwei Listen (die alte und die neue) und die Zeichen an der Elternaufgabe.
   * Das von Hand nachzuziehen wäre eine zweite Fassung der Regeln, die der
   * Server ohnehin anwendet — und die beiden wären genau dann verschieden,
   * wenn er etwas ablehnt.
   */
  async function reorder(
    id: string,
    between: { afterId: string | null; beforeId: string | null; parentId?: string | null },
  ) {
    try {
      await api.move(id, between, workspace);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Verschieben ging nicht.');
    }
    await load();
    onChanged();
  }

  /**
   * Was hier tatsächlich gilt — Person vor Arbeitsbereich, dann `full`.
   *
   * Die TAFEL nur in einer Liste: ihre Spalten gehören einer Liste, „Heute"
   * hat keine. Wer sie anderswo gewählt hat (oder der Arbeitsbereich sie
   * vorgibt), bekommt dort `full` — entschieden hier, weil erst hier bekannt
   * ist, wo gezeichnet wird. Die Wahl BLEIBT gespeichert: wer von Heute in
   * eine Liste wechselt, soll seine Tafel wiederfinden.
   */
  const gewaehlt = resolveListView(listView, workspaceListView);
  const form = gewaehlt === 'board' && route.kind !== 'project' ? 'full' : gewaehlt;

  const title =
    route.kind === 'project' ? (project?.name ?? 'Projekt') : (TITLES[view] ?? 'Aufgaben');
  const count = overdue.length + rows.filter((r) => r.completed === null).length;
  /*
   * Die Summe der Schätzungen — der eigentliche Zweck einer Dauer.
   *
   * Eine Zahl an einer Aufgabe sagt wenig; „3:20 h" über einem Tag sagt, ob er
   * aufgeht. Darum steht sie im Kopf und nicht nur in der Zeile.
   *
   * GERECHNET AUS DERSELBEN LISTE, DIE GEZEICHNET WIRD, und nicht vom Server
   * geholt: eine zweite Abfrage wäre eine zweite Antwort auf „was steht hier",
   * und die beiden wären genau in dem Moment verschieden, in dem jemand etwas
   * abhakt. Nur Offenes zählt, aus demselben Grund — eine Summe, die Erledigtes
   * mitnimmt, wächst beim Abarbeiten.
   *
   * Und sie sagt nichts, wenn nichts geschätzt ist: „0 min geplant" über einer
   * Liste ohne Angaben wäre eine Auskunft über eine Angabe, die es nicht gibt.
   */
  const geschaetzt = [...overdue, ...rows]
    .filter((r) => r.completed === null)
    .reduce((sum, r) => sum + (r.duration ?? 0), 0);
  const summe = geschaetzt === 0 ? '' : `, ${formatDuration(geschaetzt)} geschätzt`;
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
      ? `${count === 0 ? 'nichts offen' : `${count} offen${summe}`}${canDrag ? ' — Zeilen lassen sich ziehen' : ''}`
      : view === 'today'
        ? `${longDate(now)}${loaded ? ` — ${count === 0 ? 'nichts offen' : `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`}${overdue.length > 0 ? `, ${overdue.length} überfällig` : ''}${count === 0 ? '' : summe}` : ''}`
        : view === 'upcoming'
          ? 'Was einen Zeitpunkt hat, aber später'
          : view === 'inbox'
            ? // Der Untertitel sagt, was zu tun ist, und nicht was fehlt: der
              // Posteingang ist eine Frage an den Menschen und keine Ansicht
              // über die Zeit.
              'Noch ohne Projekt — zieh sie an ihren Ort oder tippe #projekt dazu'
            : 'Ohne Zeitpunkt — nicht unwichtig, nur ungeplant';

  function renderRow(task: Task, index: number, parentId: string | null = null) {
    const kinder = children[task.id] ?? [];
    const offen = open_.has(task.id);
    /*
     * Ziehen gilt, wo sortiert wird — und zusätzlich überall dort, wo es
     * Unteraufgaben gibt oder geben könnte.
     *
     * In „Heute" ist die Reihenfolge die der Zeit, dort wird nicht sortiert.
     * Eine Aufgabe aus ihrer Elternaufgabe herauszuziehen, ist aber keine
     * Sortierung, sondern ein Umhängen — und das soll auch dort gehen.
     */
    const ziehbar = (canDrag || parentId !== null || kinder.length > 0) &&
      task.completed === null;

    return (
      <div key={task.id}>
        <div
          className="task-wrap"
          data-dragging={drag.dragging === task.id}
          data-child={parentId === null ? undefined : 'yes'}
          /*
           * Die drei Marken, die die Geste liest. `data-row-nest` sagt, ob
           * diese Zeile etwas AUFNEHMEN kann: bei einer Ebene kann das nur,
           * wer selbst keine Unteraufgabe ist.
           */
          {...(ziehbar
            ? {
                'data-row': task.id,
                'data-row-parent': parentId ?? 'root',
                'data-row-nest': parentId === null ? 'yes' : 'no',
                onPointerDown: drag.onPointerDown,
              }
            : {})}
          data-drop={drag.target?.rowId === task.id ? drag.target.intent : undefined}
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
          {/*
            Der Aufklapper, und nur wo es etwas aufzuklappen gibt.

            Ein eigener Knopf und nicht die Zeile selbst — dieselbe Regel wie
            im Projektbaum: die Zeile öffnet das Detail, und ein Klick, der
            manchmal öffnet und manchmal aufklappt, ist einer, dessen Wirkung
            man erst danach weiß.

            Wo es nichts gibt, steht KEIN Platzhalter. Im Baum gibt es einen,
            damit die Namen nicht springen; hier haben die meisten Zeilen keine
            Unteraufgaben, und eine Liste, die für alle einrückt, damit
            wenige ein Zeichen tragen können, verschenkt Breite an jeder Zeile.
          */}
          {kinder.length > 0 ? (
            <button
              type="button"
              className="task-twisty"
              aria-expanded={offen}
              aria-label={`${task.title} ${offen ? 'zuklappen' : 'aufklappen'}`}
              onClick={() =>
                setOpen((war) => {
                  const next = new Set(war);
                  if (next.has(task.id)) next.delete(task.id);
                  else next.add(task.id);
                  return next;
                })
              }
            >
              <span aria-hidden="true">▸</span>
            </button>
          ) : null}
          <TaskRow
            task={task}
            view={form}
            open={openTask === task.id}
            onLabel={onLabel}
            onOpen={() => onOpenTask(openTask === task.id ? null : task.id)}
            now={now}
            pending={isPending(task.id)}
            error={errorOf(task.id)}
            projectName={route.kind === 'project' ? undefined : nameOf(task.projectId)}
            grip={ziehbar}
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
        {offen && kinder.length > 0 ? (
          <div className="task-kids">
            {kinder.map((kind, i) => renderRow(kind, index * 1000 + i, task.id))}
          </div>
        ) : null}
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
        {/*
          ZEICHEN STATT WÖRTER, und beide Knöpfe in EINER Reihe.

          Gemeldet: „Die Buttons oben rechts sind hässlich." Sie waren es, und
          zwar aus zwei Gründen: fünf Wörter in zwei Reihen über der
          Überschrift, und der eine Knopf trug einen ganzen Satz („Erledigte
          ausblenden"), die anderen ein Wort.

          Die Wörter gehen dabei nicht verloren: jeder Knopf trägt seinen Namen
          als `title` und als `aria-label` — dasselbe Geschäft wie im
          Projektmenü, und SONEs Begründung dort gilt hier genauso.
        */}
        <div className="head-views" role="group" aria-label="Anzeige">
          <button
            type="button"
            className="head-toggle"
            aria-pressed={showDone}
            title={showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
            aria-label={showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
            onClick={toggleShowDone}
          >
            {/* Durchgestrichen, wenn sie fehlen — der Vorschlag kam so und ist
                gut: was durchgestrichen ist, ist nicht da. */}
            {showDone ? <CheckSquareIcon size={16} /> : <DoneHiddenIcon />}
          </button>
        {/*
          Die Anzeigeform, als Reihe und nicht als Klappmenü.

          Drei Wörter passen nebeneinander, und eine Wahl, die man SIEHT,
          beantwortet die Frage „wie steht das gerade" ohne einen Klick. Ein
          Menü verstecken müsste man erst öffnen, um zu wissen, was gilt.

          Die Wahl gehört der Person und diesem Ort (Migration 0028): sie
          ändert nichts, was ein anderer sieht. Darum steht sie hier im Kopf
          der Liste und nicht in den Einstellungen des Arbeitsbereichs — dort
          liegt nur die Vorgabe.
        */}
          {/*
            DIE TAFEL STEHT NUR DA, WO ES EINE GIBT.

            GEMELDET: „Bei Heute gibt's noch kein Kanban." Richtig — die
            Spalten gehören einer Liste, und „Heute" hat keine. Angeboten wurde
            der Knopf trotzdem, und er schaltete auf `full` zurück: ein Knopf,
            der etwas anderes tut, als er sagt.

            Weggelassen und nicht gesperrt: ein gesperrter Knopf ist ein
            Versprechen mit Fußnote, und die Fußnote steht nirgends (ADR-0027).
            Wer in eine Liste wechselt, findet ihn dort — und seine Wahl steht
            noch, denn gespeichert bleibt sie.
          */}
          {LIST_VIEWS.filter((wahl) => wahl !== 'board' || route.kind === 'project').map((wahl) => (
            <button
              key={wahl}
              type="button"
              className="head-toggle"
              aria-pressed={form === wahl}
              title={`${LIST_VIEW_SAYS[wahl].name} — ${LIST_VIEW_SAYS[wahl].says}`}
              aria-label={LIST_VIEW_SAYS[wahl].name}
              onClick={() =>
                /*
                 * Nochmal auf dasselbe drücken nimmt die Wahl ZURÜCK, statt
                 * sie erneut zu setzen. Damit gibt es einen Weg zu „wie der
                 * Arbeitsbereich sagt" — ohne ihn wäre die Vorgabe nach der
                 * ersten Wahl für diese Liste für immer unerreichbar, und das
                 * merkt man erst, wenn der Bereich sie ändert.
                 */
                onListView(listView === wahl ? null : wahl)
              }
            >
              {VIEW_ICONS[wahl]}
            </button>
          ))}
        </div>
      </div>

      {/*
        Was gerade reist, unter dem Zeiger.

        GEMELDET: „man sieht die Aufgabe schwebend" — SONEs `.drag-preview`,
        und die Begründung von dort gilt hier wörtlich: die Linie sagt, WOHIN
        ein Ablegen führt, nicht WAS abgelegt wird. HTML5-Ziehen zeichnete das
        umsonst mit; wer es durch Zeiger-Ereignisse ersetzt, muss es selbst
        zeichnen.

        Ein Geschwister der Liste und kein Kind: die Liste rollt, und ein Kind
        würde an ihrem Rand abgeschnitten.
      */}
      {drag.dragging !== null && drag.pointer !== null ? (
        <div
          className="drag-preview"
          style={{ left: drag.pointer.x, top: drag.pointer.y }}
          aria-hidden="true"
        >
          {rows.find((r) => r.id === drag.dragging)?.title ?? ''}
        </div>
      ) : null}

      {/* Die Tafel bekommt die ganze Breite, die Listen behalten das Lesemaß
          — die Begründung steht am `.body`-Block im Stylesheet. */}
      <div className="body" ref={listRef} data-wide={form === 'board' ? 'yes' : undefined}>
        <QuickAdd
          now={now}
          onSubmit={(line) => void add(line)}
          busy={busy}
          unknownProject={unknownProject}
        />
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}

        {/*
          Die Tafel ersetzt die Liste, sie steht nicht daneben.

          Der Kopf mit Schnellerfassung und Umschalter bleibt: eine Tafel ohne
          Erfassungszeile wäre ein Ort, an dem man nichts anlegen kann, und der
          Umschalter ist der einzige Weg zurück.
        */}
        {form === 'board' && route.kind === 'project' ? (
          <Board
            workspace={workspace}
            projectId={route.projectId}
            tasks={rows}
            now={now}
            openTask={openTask}
            onOpenTask={onOpenTask}
            onChanged={() => {
              void load();
              onChanged();
            }}
          />
        ) : null}

        {form === 'board' && route.kind === 'project' ? null : (
          <>
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
          </>
        )}

        {/*
          Die Ablegestelle „ans Ende" ist weggefallen, und zwar ersatzlos.

          Sie war nötig, solange eine Zeile nur als Ganzes ein Ziel war: dann
          gab es keinen Platz hinter der letzten. `useListDrag` teilt jede
          Zeile in zwei Hälften, und die untere Hälfte der letzten IST das
          Ende. Ein Kasten, der dasselbe noch einmal anbietet, wäre ein
          zweiter Weg an denselben Ort — und einer, der beim Ziehen erscheint
          und die Liste länger macht, während man zielt.
        */}

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
