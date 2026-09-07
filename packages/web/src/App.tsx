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
import { SignIn } from './screens/SignIn.js';
import { Today } from './screens/Today.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((p) => p !== '')
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mode, setMode] = useState<ModeId>('tasks');
  const [projects, setProjects] = useState<Project[]>([]);
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

  const loadProjects = useCallback(async () => {
    if (workspace === undefined) return;
    try {
      const data = await api.projects(workspace);
      setProjects(data.projects);
    } catch {
      setProjects([]);
    }
  }, [workspace]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  if (me === undefined) return <div className="signin" aria-busy="true" />;
  if (me === null) return <SignIn onDone={() => void loadMe()} />;

  const initials = initialsOf(me.displayName);
  const wsName = me.workspaces.find((w) => w.id === workspace)?.name ?? 'Kein Workspace';

  return (
    <div className="app">
      <IconRail
        active={mode}
        onPick={setMode}
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
            onFocus={() => setMode('search')}
          />
        </div>

        <div className="panel-list">
          <button className="p-item" aria-current="true">
            Heute
          </button>
          <button className="p-item">Demnächst</button>
          <button className="p-item">Irgendwann</button>

          <div className="group-label">Projekte</div>
          {projects.length === 0 ? (
            <div className="p-item" style={{ color: 'var(--text-faint)' }}>
              noch keine
            </div>
          ) : (
            projects.map((p) => (
              <button key={p.id} className="p-item">
                <span
                  className="p-sq"
                  aria-hidden="true"
                  {...(p.color === null ? {} : { style: { background: p.color } })}
                />
                {p.name}
                {/* Keine Null: eine Zahl über nichts ist Rauschen. */}
                {p.open === null ? null : <span className="n">{p.open}</span>}
              </button>
            ))
          )}
        </div>
      </div>

      <main className="main">
        {mode === 'tasks' ? (
          <Today
            workspace={workspace}
            projects={projects}
            now={now}
            onProjectsChanged={() => void loadProjects()}
          />
        ) : (
          <>
            <div className="main-head">
              <h1>{modeOf(mode).label}</h1>
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
        active={mode}
        onPick={(id) => {
          setMode(id);
          setDrawer(false);
        }}
        inboxCount={0}
        initials={initials}
        onAccount={() => void 0}
      />
    </div>
  );
}
