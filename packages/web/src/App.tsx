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
import { modeOf, type ModeId } from './modes.js';
import { modeOfRoute, parseRoute, pathOf, type Route } from './route.js';
import { SignIn } from './screens/SignIn.js';
import { TaskList } from './screens/TaskList.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((p) => p !== '')
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<{
    today: number;
    upcoming: number;
    someday: number;
    overdue: number;
  }>({ today: 0, upcoming: 0, someday: 0, overdue: 0 });
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState(false);
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
  const go = useCallback((next: Route) => {
    const path = pathOf(next);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setRoute(next);
    setDrawer(false);
  }, []);

  useEffect(() => {
    const back = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  if (me === undefined) return <div className="signin" aria-busy="true" />;
  if (me === null) return <SignIn onDone={() => void loadMe()} />;

  const initials = initialsOf(me.displayName);
  const wsName = me.workspaces.find((w) => w.id === workspace)?.name ?? 'Kein Workspace';

  return (
    <div className="app">
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
            onFocus={() => go({ kind: 'mode', mode: 'search' })}
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

          <div className="group-label">Projekte</div>
          {projects.length === 0 ? (
            <div className="p-item" style={{ color: 'var(--text-faint)' }}>
              noch keine
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                className="p-item"
                aria-current={route.kind === 'project' && route.projectId === p.id}
                onClick={() => go({ kind: 'project', projectId: p.id })}
              >
                <span
                  className="p-sq"
                  aria-hidden="true"
                  {...(p.color === null ? {} : { style: { background: p.color } })}
                />
                {p.name}
                {p.open === null ? null : <span className="n">{p.open}</span>}
              </button>
            ))
          )}
        </div>
      </div>

      <main className="main">
        {route.kind !== 'mode' ? (
          <TaskList
            route={route}
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
