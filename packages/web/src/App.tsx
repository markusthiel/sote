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

import type { Look } from '@sote/core';

import { api, ApiError, type Me, type Project } from './api.js';
import { useLook, useScheme } from './appearance.js';
import { useSidebar } from './hooks/useSidebar.js';
import { useSidebarWidth } from './hooks/useSidebarWidth.js';
import { FootBar } from './components/FootBar.js';
import { IconRail } from './components/IconRail.js';
import { ProjectTree } from './components/ProjectTree.js';
import { TopBar } from './components/TopBar.js';
import { WorkspaceMenu } from './components/WorkspaceMenu.js';
import { modeOf, type ModeId } from './modes.js';
import { modeOfRoute, parseRoute, pathOf, type Route } from './route.js';
import { Setup } from './screens/Setup.js';
import { SignIn } from './screens/SignIn.js';
import { TaskList } from './screens/TaskList.js';
import { Detail } from './screens/Detail.js';
import { Search } from './screens/Search.js';
import { WorkspaceOverview } from './screens/WorkspaceOverview.js';
import {
  ADMIN_SECTIONS,
  Settings,
  SETTING_SECTIONS,
  WORKSPACE_SECTIONS,
} from './screens/Settings.js';
import { Trash } from './screens/Trash.js';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<{
    today: number;
    upcoming: number;
    someday: number;
    overdue: number;
  }>({ today: 0, upcoming: 0, someday: 0, overdue: 0 });
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);
  /*
   * Die Leiste: **ein** Zustand, nicht zwei.
   *
   * Hier stand `const [drawer, setDrawer] = useState(false)` — ein Flag, das
   * nur unter 800 px etwas bedeutete, und das **nirgends auf `true` gesetzt
   * wurde**. Die Schublade ließ sich also gar nicht öffnen; auf dem Telefon war
   * die Projektliste unerreichbar.
   *
   * `useSidebar` ist aus SONE kopiert und löst beides: ein Zustand für beide
   * Layouts, mit dem Unterschied in der **Vorgabe** statt im Zustand — als
   * Spalte ist Zeigen die Vorgabe und Verbergen eine gemerkte Vorliebe, als
   * Schublade ist Verborgen die einzig sinnvolle Vorgabe, und sie schließt beim
   * Navigieren wieder.
   */
  const sidebar = useSidebar(route);
  const panelWidth = useSidebarWidth();
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [now] = useState(() => new Date());

  const loadMe = useCallback(async () => {
    try {
      const data = await api.me();
      setMe(data);
      setWorkspace(data.workspaces[0]?.id);
    } catch {
      setMe(null);
      // Erst wenn keine Sitzung da ist, wird gefragt, ob überhaupt ein Konto
      // existiert. Vorher wäre es eine Anfrage, deren Antwort niemand braucht.
      try {
        setNeedsSetup((await api.setupNeeded()).needed);
      } catch {
        setNeedsSetup(false);
      }
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
    // Das Schließen beim Navigieren macht `useSidebar` selbst — und nur für
    // die Schublade. Eine Spalte zu schließen, weil jemand geklickt hat, wäre
    // zum Wahnsinnigwerden.
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

  /*
   * Was gerade gilt, an <html>.
   *
   * Geladen, sobald es eine Sitzung gibt — vorher steht die gemerkte Antwort
   * dort (`main.tsx`). Fehlt die Anfrage, bleibt die gemerkte stehen: eine
   * Oberfläche, die bei einem Netzfehler die Farbe wechselt, ist schlimmer als
   * eine, die die letzte behält.
   *
   * **Vor den frühen Rückgaben**, und das war ein echter Fehler: zuerst stand
   * das hier hinter `if (me === undefined) return …`, also lief es beim
   * Anmeldebildschirm nicht und beim angemeldeten schon — React zählt dann
   * unterschiedlich viele Hooks und wirft #310. Der Bildschirm blieb leer, und
   * kein Test hat es gemerkt, weil keiner die Anwendung rendert. Gefunden im
   * Browser.
   */
  const [scheme, setScheme] = useState<'system' | 'light' | 'dark' | undefined>(undefined);
  const [look, setLook] = useState<Look | undefined>(undefined);
  /*
   * Die Hülle als Element, damit `useLook` Attribute daran setzen kann.
   *
   * Über einen Ref und nicht über React-Props: die Flächen werden im
   * Stylesheet über `[data-surface-*]` zugeordnet, und das ist die Stelle, an
   * der beide Themen ohnehin stehen. Als Props müsste jedes Bauteil seine
   * eigene Farbe kennen.
   */
  const [shell, setShell] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Erst mit Sitzung fragen. Vorher antwortet die Route 401, und ein
    // erwarteter Fehlschlag im Protokoll ist einer, den man beim Suchen nach
    // einem echten überliest.
    if (me === undefined || me === null) return;
    void api
      .settings()
      .then((s) => {
        setScheme(s.effective.scheme);
        setLook(s.effective.look);
      })
      .catch(() => undefined);
  }, [me, workspace]);
  useScheme(scheme);
  useLook(look, shell);

  if (me === undefined) return <div className="signin" aria-busy="true" />;
  if (me === null) {
    return needsSetup ? (
      <Setup onDone={() => void loadMe()} />
    ) : (
      <SignIn onDone={() => void loadMe()} />
    );
  }

  /*
   * Abmelden.
   *
   * Bis hierher hing der Konto-Knopf an `() => void 0` — er sah aus wie ein
   * Bedienelement und war keines, und `api.signOut` stand in der Datei und
   * wurde von nirgendwo gerufen. Eine Anmeldung ohne Abmeldung ist kein halbes
   * Merkmal, sondern ein geöffneter Rechner in einem Büro.
   *
   * Ob der Server die Sitzung wirklich verworfen hat, spielt für den nächsten
   * Schritt keine Rolle: `loadMe()` fragt danach, und ohne Sitzung ist die
   * Antwort 401 und der Anmeldebildschirm da. Ein Fehler beim Verwerfen darf
   * nicht dazu führen, dass man angemeldet bleibt, obwohl man es nicht will.
   */

  const signOut = () => {
    void api
      .signOut()
      .catch(() => undefined)
      .then(() => loadMe());
  };
  const wsName = me.workspaces.find((w) => w.id === workspace)?.name ?? 'Kein Workspace';

  /**
   * Was die Seitenleiste zeigt, wenn man in einem Einstellungsbereich ist.
   *
   * `null` heisst: der gewoehnliche Baum. Eine Struktur statt dreier
   * Verzweigungen im Markup, weil die drei Bereiche sich nur in Titel, Liste
   * und Ziel unterscheiden — und drei fast gleiche Bloecke laufen auseinander.
   */
  const SECTION_NAV =
    route.kind === 'settings'
      ? {
          title: 'Einstellungen',
          note: 'Nur für dich',
          entries: SETTING_SECTIONS,
          active: route.section,
          go: (id: string) => go({ kind: 'settings', section: id }),
        }
      : route.kind === 'workspaces'
        ? {
            title: 'Workspaces',
            note: wsName,
            entries: WORKSPACE_SECTIONS,
            active: route.section,
            go: (id: string) => go({ kind: 'workspaces', section: id }),
          }
        : route.kind === 'admin'
          ? {
              title: 'Verwaltung',
              note: 'Für alle auf diesem Server',
              entries: ADMIN_SECTIONS,
              active: route.section,
              go: (id: string) => go({ kind: 'admin', section: id }),
            }
          : null;

  return (
    <div
      className="app"
      ref={setShell}
      data-detail={openTask !== null}
      data-sidebar={sidebar.visible}
    >
      <IconRail
        active={modeOfRoute(route) as ModeId}
        onPick={(id) =>
          go(
            id === 'tasks'
              ? { kind: 'today' }
              : id === 'workspaces'
                ? // Der Bereich hat jetzt einen Inhalt und ist darum eine
                  // eigene Route statt der Platzhalterseite.
                  { kind: 'workspaces', section: 'alle' }
                : { kind: 'mode', mode: id },
          )
        }
        inboxCount={0}
        displayName={me.displayName}
        email={me.email}
        onSettings={() => go({ kind: 'settings', section: 'profil' })}
        onAdmin={() => go({ kind: 'admin', section: 'instanz' })}
        onSignOut={signOut}
      />

      {sidebar.visible && !sidebar.isColumn ? (
        <div className="scrim" onClick={sidebar.close} />
      ) : null}

      <div className="panel" data-open={sidebar.visible}>
        {/*
          Der Griff an der rechten Kante.
          Nur als Spalte: eine Schublade hat keine Kante, an der man ziehen
          könnte, ohne die Seite darunter zu treffen. Doppelklick setzt zurück,
          weil das jemand versuchen wird.
        */}
        {sidebar.isColumn ? (
          <div
            className="panel-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="Breite der Leiste"
            onMouseDown={panelWidth.startResize}
            onDoubleClick={panelWidth.reset}
          />
        ) : null}
        <div className="panel-head">
          <WorkspaceMenu
            workspaces={me.workspaces}
            current={workspace}
            onPick={(id) => {
              setWorkspace(id);
              // Zurück nach Heute: die alte Adresse konnte ein Projekt sein,
              // und das gibt es im neuen Arbeitsbereich nicht. Ein Wechsel,
              // der auf „Projekt gibt es nicht" landet, ist ein Wechsel, den
              // man rückgängig machen will.
              go({ kind: 'today' });
            }}
          />
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
          {/*
            Die Einstellungen füllen die SEITENLEISTE, nicht den Inhalt.
            Gemeldet: „Einstellungsseiten haben ihre eigene Seitenleiste, sind
            also komplett eigenständig und nicht einfach eine Seite im
            Content-Bereich." SONE hat dafür seine eigene Hülle wieder
            abgeschafft — sobald die Schiene immer da ist, braucht es keinen
            zweiten Rahmen: der Weg zurück ist das Signet, das Konto steht
            unten, und die Bereiche sind Gruppen in einer Liste.
          */}
          {/*
            Drei Bereiche, eine Zeichnung.
            Die Leiste zeigt die Abschnitte dessen, wo man ist — und die
            Ueberschrift sagt, wessen Einstellungen es sind. Vorher lagen alle
            drei auf einem Bildschirm, und jeder Kasten musste selbst sagen,
            wen er angeht: eine Notloesung dafuer, dass der Ort es nicht sagte.
          */}
          {SECTION_NAV !== null ? (
            <>
              <div className="group-label">{SECTION_NAV.title}</div>
              <p className="nav-note">{SECTION_NAV.note}</p>
              {SECTION_NAV.entries.map((entry) => (
                <button
                  key={entry.id}
                  className="p-item set-nav"
                  aria-current={SECTION_NAV.active === entry.id}
                  aria-label={`${entry.label} — ${entry.hint}`}
                  onClick={() => SECTION_NAV.go(entry.id)}
                >
                  <span className="p-name">{entry.label}</span>
                  <span className="set-nav-hint">{entry.hint}</span>
                </button>
              ))}
            </>
          ) : null}

          {SECTION_NAV !== null ? null : (
          <>
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
              /*
               * Die Beschriftung nennt Name und Zahl getrennt.
               *
               * Ohne sie war der zugängliche Name „Demnächst 6" — die Zahl
               * klebte am Namen der Ansicht. Im Bild sieht man das nie; einer
               * Vorleseansage fällt es sofort auf. Gefunden beim Nachsehen,
               * warum die Projektzeile keine Beschriftung zu haben schien: sie
               * hatte eine, diese drei nicht.
               */
              aria-label={n === 0 ? label : `${label}, ${n} offen`}
              aria-current={route.kind === kind}
              onClick={() => go({ kind })}
            >
              {label}
              {n === 0 ? null : (
                <span className="n" aria-hidden="true">
                  {n}
                </span>
              )}
            </button>
          ))}

          <ProjectTree
            projects={projects}
            activeId={route.kind === 'project' ? route.projectId : null}
            busy={panelBusy}
            onOpen={(id) => go({ kind: 'project', projectId: id })}
            onCreate={(name, parentId, kind) =>
              void panelWrite(() => api.createProject({ name, parentId, kind }, workspace))
            }
            onRename={(id, name) =>
              void panelWrite(() => api.patchProject(id, { name }, workspace))
            }
            onColor={(id, color) =>
              void panelWrite(() => api.patchProject(id, { color }, workspace))
            }
            onIcon={(id, icon) =>
              void panelWrite(() => api.patchProject(id, { icon }, workspace))
            }
            onTrash={(id) => void panelWrite(() => api.trash('projects', id, workspace))}
          />
          {panelError !== undefined ? (
            <p className="panel-error">{panelError}</p>
          ) : null}
          </>
          )}
        </div>
      </div>

      <main className="main">
        {/* Die Umschalter sitzen INNERHALB der Seite und nicht in der Leiste,
            die sie ausblenden — sonst verschwindet der Knopf mit ihr. */}
        <TopBar
          sidebarVisible={sidebar.visible}
          onToggleSidebar={sidebar.toggle}
          detailOpen={openTask !== null}
          onToggleDetail={openTask === null ? undefined : () => setOpenTask(null)}
        />
        {route.kind === 'workspaces' && route.section === 'alle' ? (
          <WorkspaceOverview workspaces={me.workspaces} current={workspace} />
        ) : SECTION_NAV !== null ? (
          <Settings
            section={
              // Den Abschnitt „Aussehen" gibt es zweimal — einmal fuer dich,
              // einmal fuer den Arbeitsbereich. Der Bereich entscheidet,
              // welcher gemeint ist, statt zwei gleich benannte Abschnitte in
              // einen Namensraum zu zwingen.
              route.kind === 'workspaces' ? `ws-${SECTION_NAV.active}` : SECTION_NAV.active
            }
            workspaceName={wsName}
            displayName={me.displayName}
            email={me.email}
            onEffective={(out) => {
              setScheme(out.scheme);
              setLook(out.look);
            }}
          />
        ) : route.kind !== 'mode' && route.kind !== 'search' ? (
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
        onPick={(id) =>
          go(
            id === 'tasks'
              ? { kind: 'today' }
              : id === 'workspaces'
                ? // Der Bereich hat jetzt einen Inhalt und ist darum eine
                  // eigene Route statt der Platzhalterseite.
                  { kind: 'workspaces', section: 'alle' }
                : { kind: 'mode', mode: id },
          )
        }
        inboxCount={0}
        displayName={me.displayName}
        email={me.email}
        onSettings={() => go({ kind: 'settings', section: 'profil' })}
        onAdmin={() => go({ kind: 'admin', section: 'instanz' })}
        onSignOut={signOut}
      />
    </div>
  );
}
