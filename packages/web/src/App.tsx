/**
 * SOTE — die Hülle.
 *
 * Spalte 1 wählt den Modus, Spalte 2 navigiert, Spalte 3 zeigt (SONE, ADR-0069).
 * Diese Datei verteilt nur; sie zeichnet keinen Inhalt.
 *
 * Nur `tasks` hat einen Bildschirm. Die anderen Modi stehen in der Liste, weil
 * die Liste die Wahrheit ist — und sagen, dass sie noch nichts sind. Ein Modus
 * aus der Liste zu nehmen, bis er fertig ist, wäre der Weg zu einer Fußleiste,
 * die sich beim nächsten Feature anders zusammensetzt.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Me, type Project } from './api.js';
import { FootBar } from './components/FootBar.js';
import { IconRail } from './components/IconRail.js';
import { ProjectTree } from './components/ProjectTree.js';
import { modeOf, type ModeId } from './modes.js';
import { modeOfRoute, parseRoute, pathOf, type Route } from './route.js';
import { SignIn } from './screens/SignIn.js';
import { TaskList } from './screens/TaskList.js';
import { Detail } from './screens/Detail.js';
import { Search } from './screens/Search.js';
import { Trash } from './screens/Trash.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((p) => p !== '')
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<{
    today: number;
    upcoming: number;
    someday: number;
    overdue: number;
  }>({ today: 0, upcoming: 0, someday: 0, overdue: 0 });
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [now] = useState(() => new Date());

  const loadMe = useCallback(async () => {
    try {
      const data = await api.me();
      setMe(data);
      setWorkspace(data.workspaces[0]?.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setMe(null);
    }
  }, []);

  const loadPanel = useCallback(async () => {
    if (workspace === undefined) return;
    try {
      const [p, c] = await Promise.all([
        api.projects(workspace),
        api.counts(workspace),
      ]);
      setProjects(p.projects);
      setCounts(c);
    } catch {
      setProjects([]);
    }
  }, [workspace]);

  /**
   * Ein Ort wird betreten, nicht ein Zustand gesetzt.
   *
   * `pushState` plus `popstate`: der Zurück-Knopf funktioniert, ein Link ist
   * teilbar, und es gibt **eine** Antwort auf „wo bin ich" — die URL. Eine
   * Kopie im Zustand wäre eine zweite (SONE, `claude/suche-als-ort.md`).
   */
  const go = useCallback((next: Route, replace = false) => {
    const path = pathOf(next);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== path) {
      // Tippen ersetzt, Abschicken schiebt: ein Tastendruck ist kein Ort, zu
      // dem man zurückgeht (SONE, `claude/suche-als-ort.md`).
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    setRoute(next);
    setDrawer(false);
  }, []);

  useEffect(() => {
    const back = () =>
      setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  /**
   * Ein Schreibzugriff aus dem Panel.
   *
   * Nicht optimistisch: ein Projekt, das angelegt aussieht und dessen Name
   * schon belegt war, wäre eine Zeile, die beim nächsten Laden verschwindet.
   * Der Grund kommt vom Server (`name_taken`) und wird gezeigt, nicht in
   * „ging nicht" übersetzt.
   */
  const panelWrite = useCallback(
    async (body: () => Promise<unknown>) => {
      setPanelBusy(true);
      setPanelError(undefined);
      try {
        await body();
        await loadPanel();
      } catch (e) {
        setPanelError(e instanceof ApiError ? e.message : 'Ging nicht.');
      } finally {
        setPanelBusy(false);
      }
    },
    [loadPanel],
  );

  if (me === undefined) return <div className="signin" aria-busy="true" />;
  if (me === null) return <SignIn onDone={() => void loadMe()} />;

  const initials = initialsOf(me.displayName);
  const wsName = me.workspaces.find((w) => w.id === workspace)?.name ?? 'Kein Workspace';

  return (
    <div className="app" data-detail={openTask !== null}>
      <IconRail
        active={modeOfRoute(route) as ModeId}
        onPick={(id) => go(id === 'tasks' ? { kind: 'today' } : { kind: 'mode', mode: id })}
        inboxCount={0}
        initials={initials}
        onAccount={() => void 0}
      />

      {drawer ? <div className="scrim" onClick={() => setDrawer(false)} /> : null}

      <div className="panel" data-open={drawer}>
        <div className="panel-head">
          <button className="ws" aria-label="Workspace wechseln">
            <span className="ws-dot" aria-hidden="true" />
            <span className="ws-name">{wsName}</span>
            <span aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: 10 }}>
              ▾
            </span>
          </button>
        </div>

        <div className="seek">
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M12.8 12.8 17 17" />
          </svg>
          {/* Das Feld ist der Eingang zur Suche, nicht eine Tür vor einer Tür. */}
          <input
            placeholder="Aufgaben durchsuchen"
            aria-label="Aufgaben durchsuchen"
            value={route.kind === 'search' ? route.q : ''}
            /* Das Feld IST der Eingang. Tippen bringt einen in die Suche,
               mitsamt dem Getippten — kein Knopf, der einen Bildschirm mit
               einem Feld öffnet. */
            onChange={(e) => go({ kind: 'search', q: e.target.value }, true)}
          />
        </div>

        <div className="panel-list">
          {/* Die Zahlen kommen aus derselben Abfrage wie die Listen. Keine
              Null: eine Zahl über nichts ist Rauschen in einer ruhigen Zeile. */}
          {(
            [
              ['today', 'Heute', counts.today],
              ['upcoming', 'Demnächst', counts.upcoming],
              ['someday', 'Irgendwann', counts.someday],
            ] as const
          ).map(([kind, label, n]) => (
            <button
              key={kind}
              className="p-item"
              aria-current={route.kind === kind}
              onClick={() => go({ kind })}
            >
              {label}
              {n === 0 ? null : <span className="n">{n}</span>}
            </button>
          ))}

          <ProjectTree
            projects={projects}
            activeId={route.kind === 'project' ? route.projectId : null}
            busy={panelBusy}
            onOpen={(id) => go({ kind: 'project', projectId: id })}
            onCreate={(name, parentId) =>
              void panelWrite(() => api.createProject({ name, parentId }, workspace))
            }
            onRename={(id, name) =>
              void panelWrite(() => api.patchProject(id, { name }, workspace))
            }
            onColor={(id, color) =>
              void panelWrite(() => api.patchProject(id, { color }, workspace))
            }
            onTrash={(id) => void panelWrite(() => api.trash('projects', id, workspace))}
          />
          {panelError !== undefined ? (
            <p className="panel-error">{panelError}</p>
          ) : null}
        </div>
      </div>

      <main className="main">
        {route.kind !== 'mode' && route.kind !== 'search' ? (
          <TaskList
            route={route}
            workspace={workspace}
            projects={projects}
            now={now}
            onChanged={() => void loadPanel()}
            openTask={openTask}
            onOpenTask={setOpenTask}
          />
        ) : route.kind === 'search' ? (
          <Search
            q={route.q}
            workspace={workspace}
            projects={projects}
            now={now}
            onQuery={(next) => go({ kind: 'search', q: next }, true)}
            openTask={openTask}
            onOpenTask={setOpenTask}
          />
        ) : route.mode === 'trash' ? (
          <Trash
            workspace={workspace}
            projects={projects}
            now={now}
            onChanged={() => void loadPanel()}
          />
        ) : (
          <>
            <div className="main-head">
              <h1>{modeOf(route.mode).label}</h1>
              <div className="sub">noch nicht gebaut</div>
            </div>
            <div className="body">
              <div className="empty">
                <strong>Diesen Bereich gibt es noch nicht.</strong>
                Er steht in der Leiste, weil die Leiste eine Liste ist und kein
                Modus aus ihr fallen darf — auch nicht, solange er leer ist.
              </div>
            </div>
          </>
        )}
      </main>

      {openTask !== null ? (
        <Detail
          taskId={openTask}
          workspace={workspace}
          now={now}
          onClose={() => setOpenTask(null)}
          onChanged={() => void loadPanel()}
        />
      ) : null}

      <FootBar
        active={modeOfRoute(route) as ModeId}
        onPick={(id) => go(id === 'tasks' ? { kind: 'today' } : { kind: 'mode', mode: id })}
        inboxCount={0}
        initials={initials}
        onAccount={() => void 0}
      />
    </div>
  );
}
