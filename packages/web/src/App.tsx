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

import { useCallback, useEffect, useRef, useState } from 'react';

import { colorValue, SIGIL_OF, type Board, type CalendarDefault, type Landing, type ListView, type Look } from '@sote/core';

import { streamUrl, api, ApiError, type Me, type Project } from './api.js';
import { useBoard, useLook, useScheme } from './appearance.js';
import { useSidebar } from './hooks/useSidebar.js';
import { useSidebarWidth } from './hooks/useSidebarWidth.js';
import { FootBar } from './components/FootBar.js';
import { IconRail } from './components/IconRail.js';
import { ProjectTree } from './components/ProjectTree.js';
import { TopBar } from './components/TopBar.js';
import { WorkspaceMenu } from './components/WorkspaceMenu.js';
import { modeOf, type ModeId } from './modes.js';
import { isoDate } from './calendar.js';
import { preferredCalendarSpan, rememberCalendarSpan } from './calendarPreference.js';
import { modeOfRoute, parseRoute, pathOf, placeOf, viewOf, type Route } from './route.js';
import { Setup } from './screens/Setup.js';
import { SignIn } from './screens/SignIn.js';
import { TaskList } from './screens/TaskList.js';
import { Calendar } from './screens/Calendar.js';
import { CalendarSources } from './screens/CalendarSources.js';
import { useCalendarSources } from './hooks/useCalendarSources.js';
import { Detail } from './screens/Detail.js';
import { Search } from './screens/Search.js';
import { landingRoute, markRoute, rememberRoute } from './landing.js';
import { AcceptInvite } from './screens/AcceptInvite.js';
import { Accounts } from './screens/Accounts.js';
import { useNudge } from './hooks/useNudge.js';
import { Invitations } from './screens/Invitations.js';
import { SearchPanel } from './screens/SearchPanel.js';
import { SharesPanel, type ShareRow, type SharesView } from './screens/SharesPanel.js';
import {
  Notifications,
  NotificationsPanel,
  useNotifications,
  type NoteView,
} from './screens/Notifications.js';
import { Maintenance } from './screens/Maintenance.js';
import { People } from './screens/People.js';
import { Groups } from './screens/Groups.js';
import { CalendarFeed } from './screens/CalendarFeed.js';
import { SoneConnections } from './screens/SoneConnections.js';
import { Labels } from './screens/Labels.js';
import { Roles } from './screens/Roles.js';
import { WorkspaceExit } from './screens/WorkspaceExit.js';
import { ShareScreen } from './screens/ShareScreen.js';
import { Shares } from './screens/Shares.js';
import { WorkspaceMark } from './screens/WorkspaceMark.js';
import { WorkspaceOverview } from './screens/WorkspaceOverview.js';
import {
  ADMIN_SECTIONS,
  Settings,
  SETTING_SECTIONS,
  WORKSPACE_SECTIONS,
} from './screens/Settings.js';
import { Trash } from './screens/Trash.js';

/**
 * Wo man zuletzt war, je Browser — SONEs `sone.lastWorkspace`.
 *
 * Ein gemerkter Arbeitsbereich ist keine Einstellung, sondern der Stand DIESES
 * Browsers: an zwei Geräten arbeitet man an zwei Stellen. Darum lokal und
 * nicht am Konto.
 */
const LAST_WORKSPACE = 'sote.lastWorkspace';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  /** Der Anmeldeknopf des Anbieters — oder `null`, wenn es keinen gibt. */
  const [sso, setSso] = useState<{ label: string } | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<{
    today: number;
    upcoming: number;
    someday: number;
    inbox: number;
    overdue: number;
  }>({ today: 0, upcoming: 0, someday: 0, inbox: 0, overdue: 0 });
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
  const [openTaskState, setOpenTaskState] = useState<string | null>(null);
  /*
   * Die letzte Abfrage, damit das Symbol in der Schiene zurückführt.
   *
   * Im Zustand und nicht in der Adresse: es ist kein Ort, sondern ein
   * Gedächtnis. Und nicht im Speicher des Browsers — eine Suche von letzter
   * Woche beim Aufschlagen wieder vorzufinden wäre ein Ort, an dem man nicht
   * stehen geblieben ist.
   */
  const [letzteSuche, setLetzteSuche] = useState('');

  /*
   * Steht die Leiste im AUFGABEN-Bereich?
   *
   * Nur dort gehört das Suchfeld hin, denn es sucht Aufgaben. Vorher hing es an
   * `SECTION_NAV === null`, und das erfasste die Einstellungen und die
   * Verwaltung — aber nicht die Benachrichtigungen, die Freigaben, den
   * Papierkorb und die Suche selbst. Im Bild der Freigaben stand darum
   * „Aufgaben durchsuchen" über einer Liste von Links.
   *
   * Als **Aufzählung dessen, wo es hingehört**, und nicht als Liste dessen, wo
   * nicht: ein neuer Bereich erbt damit kein Feld, das dort nichts findet.
   */
  const imBaum =
    route.kind === 'today' ||
    route.kind === 'upcoming' ||
    route.kind === 'someday' ||
    route.kind === 'inbox' ||
    route.kind === 'project';
  /*
   * Die Benachrichtigungen werden EINMAL geholt, für Menü und Bildschirm.
   *
   * Beide zählen daraus — eine Abfrage je Ansicht wäre eine je Zahl, und die
   * Zahlen kämen aus verschiedenen Augenblicken (SONEs `InboxPanel`).
   */
  const { notes, reload: reloadNotes } = useNotifications();
  /*
   * Die Zahl an der Glocke — aus der Liste, die der Bildschirm ohnehin hält,
   * nicht aus `/api/me`. Eine Zahl und eine Liste aus zwei Abfragen laufen
   * auseinander, sobald eine der beiden neu lädt und die andere nicht; und
   * `/api/me` nachzuladen kostet die Einstellungen gleich mit.
   */
  const ungelesen = notes.filter((n) => n.readAt === null).length;
  const [noteView, setNoteView] = useState<NoteView>({ of: 'unread' });
  /**
   * Der Bereichsfilter des Kalenders — `null` heisst alle. Zustand und nicht
   * Adresse, wie der Filter der Glocke: ein Blickwinkel, kein Ort.
   */
  const [calScope, setCalScope] = useState<string | null>(null);
  const [calendarDefault, setCalendarDefault] = useState<CalendarDefault>('last');
  useEffect(() => {
    if (me?.id && route.kind === 'calendar') rememberCalendarSpan(me.id, route.span);
  }, [me?.id, route]);
  const calendarStart = () => preferredCalendarSpan(me?.id ?? '', calendarDefault);
  const timeCalendar = route.kind === 'calendar' && route.span !== 'month';
  const calendarSources = useCalendarSources(me?.id, route.kind);
  const [hiddenCalendars, setHiddenCalendars] = useState<ReadonlySet<string>>(new Set());
  /*
   * Welche Freigaben gezeigt werden.
   *
   * „Aktiv" als Vorgabe: was gilt, ist die Frage, mit der man diesen Bereich
   * aufsucht — abgelaufene sucht man erst, wenn man aufräumt.
   */
  const [shareView, setShareView] = useState<SharesView>({ of: 'active' });
  /*
   * Die Liste, die der Freigaben-Bildschirm geladen hat.
   *
   * Sie kommt von dort nach oben und wird nicht hier geholt: das Laden gehört
   * zum Bildschirm, der anlegt und widerruft — nur er weiß, wann neu zu holen
   * ist. Und ein zweiter Abruf wären zwei Zahlen aus verschiedenen
   * Augenblicken.
   */
  const [shareList, setShareList] = useState<readonly ShareRow[]>([]);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [now] = useState(() => new Date());

  const loadMe = useCallback(async (keep?: string) => {
    try {
      const data = await api.me();
      setMe(data);
      /*
       * Der erste Arbeitsbereich — **oder der genannte**.
       *
       * `keep` gibt es, weil „einen anlegen" beides tut: die Liste neu laden
       * und hineinwechseln. Ohne das setzte `loadMe` gleich danach wieder auf
       * den ersten, und der neue Bereich war angelegt, in der Liste, und man
       * stand im alten. So gemessen: `POST 201`, Name in `me.workspaces`, und
       * oben stand weiter der alte.
       *
       * `keep` wird geprüft und nicht geglaubt: eine Id, die es nicht (mehr)
       * gibt, wäre ein Arbeitsbereich, in dem jede Anfrage fehlschlägt.
       */
      /*
       * Nach dem Neuladen derselbe Arbeitsbereich.
       *
       * Gemeldet: „Wenn ich einen Reload mache, lande ich auch immer wieder in
       * meinem Workspace anstatt in dem, den ich ausgewählt hatte. Das geht bei
       * SONE korrekt." Zutreffend — SOTE merkte sich nichts, also fiel jeder
       * Neustart auf `workspaces[0]`.
       *
       * SONEs Reihenfolge: erst der mitgegebene (nach dem Anlegen), dann der
       * gemerkte, dann der erste. Und *„prefer the last workspace, but only if
       * the user is still a member — a remembered id from a workspace they were
       * removed from would otherwise leave them staring at an empty sidebar."*
       */
      const gibt = (id: string | undefined) =>
        id !== undefined && data.workspaces.some((w) => w.id === id) ? id : undefined;
      const bleibt =
        gibt(keep) ?? gibt(localStorage.getItem(LAST_WORKSPACE) ?? undefined) ?? data.workspaces[0]?.id;
      setWorkspace(bleibt);
    } catch {
      setMe(null);
      // Erst wenn keine Sitzung da ist, wird gefragt, ob überhaupt ein Konto
      // existiert. Vorher wäre es eine Anfrage, deren Antwort niemand braucht.
      try {
        const setup = await api.setupNeeded();
        setNeedsSetup(setup.needed);
        setSso(setup.sso);
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

  /*
   * Zwei Klingeln für die Leiste, und zwei mit Grund.
   *
   * `projects` läutet, wenn der Baum anders aussieht — ein Umbenennen, ein
   * neues Projekt, eine andere Reihenfolge. `tasks` läutet für die **Zahlen**
   * daneben: sie kommen aus derselben Abfrage wie die Listen, also ändern sie
   * sich, wenn Aufgaben sich ändern.
   *
   * Getrennt, weil ein Umbenennen im Baum nicht die Aufgabenliste neu holen
   * soll und ein Abhaken nicht den Baum — *die Spaltenliste ist das Design.*
   */
  /* Mit dem Arbeitsbereich — sonst hört die Seite dem ersten zu und nicht dem,
     den sie zeigt. Siehe die ausführliche Notiz in `TaskList`. */
  useNudge(streamUrl(workspace), 'projects', () => {
    void loadPanel();
    // Name und Zeichen des Arbeitsbereichs stehen in `/api/me` — seit
    // Migration 0041 klingelt ein Umbenennen auf `projects`. Mit dem
    // aktuellen Bereich, damit die Wahl nicht springt.
    void loadMe(workspace);
  });
  useNudge(streamUrl(workspace), 'tasks', () => void loadPanel());
  /*
   * Und die Glocke: eine Zuweisung ist eine Änderung an einer Aufgabe, ein
   * Kommentar ein Kommentar — beides kann eine Meldung erzeugt haben. Die
   * Liste neu holen; die Zahl an der Glocke zählt aus ihr.
   */
  useNudge(streamUrl(workspace), 'tasks', reloadNotes);
  useNudge(streamUrl(workspace), 'comments', reloadNotes);

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
    // Merken, wo jemand war — für „wo du zuletzt warst" (ADR-0072). Hier und
    // nicht in einem Effekt: das Navigieren ist das Ereignis, und ein Effekt
    // über `route` würde beim ersten Zeichnen auch feuern.
    rememberRoute(path);
    // Das Schließen beim Navigieren macht `useSidebar` selbst — und nur für
    // die Schublade. Eine Spalte zu schließen, weil jemand geklickt hat, wäre
    // zum Wahnsinnigwerden.
  }, []);

  /**
   * Welche Aufgabe offen ist — aus der Adresse, wenn die eine nennt.
   *
   * `/a/<id>` ist die Adresse einer Aufgabe (gebraucht von der
   * Kalender-Ausgabe: ein Eintrag, von dem man nicht hinkommt, ist eine
   * Sackgasse). Auf dieser Adresse ist die ADRESSE die Antwort auf „was ist
   * offen" und nicht der Zustand daneben — zwei Antworten wären eine zu viel.
   *
   * Aus einer Liste heraus bleibt es Zustand, wie bisher. Jedes Öffnen zu
   * einem Ort zu machen, wäre die richtige Fortsetzung, aber eine Änderung an
   * der Bedienung des Zurück-Knopfes — und die gehört nicht in einen Commit
   * über Kalender.
   */
  const openTask = route.kind === 'task' ? route.taskId : openTaskState;
  /*
   * Die Spalte schließt, wenn der Ort keine Aufgaben mehr zeigt.
   *
   * Gemeldet: offen geblieben beim Wechsel zu Benachrichtigungen, Freigaben,
   * Einstellungen — „macht da aber ja keinen Sinn mehr". Als Effekt über die
   * Route und nicht in `go()`: der Zurück-Knopf des Browsers geht nicht durch
   * `go()`, und die Spalte soll auch dann zugehen.
   */
  const letzterOrt = useRef(placeOf(route));
  /**
   * Gesetzt, wenn eine Navigation eine Aufgabe MITBRINGT (aus der Glocke, aus
   * „Überall"): dann gehört die Spalte zum neuen Ort und bleibt.
   */
  const bringtAufgabe = useRef(false);
  useEffect(() => {
    const ort = placeOf(route);
    if (ort !== letzterOrt.current) {
      letzterOrt.current = ort;
      if (!bringtAufgabe.current) setOpenTaskState(null);
    }
    bringtAufgabe.current = false;
  }, [route]);
  const setOpenTask = useCallback(
    (id: string | null) => {
      if (route.kind === 'task') {
        // Auf der Adresse einer Aufgabe ist Zumachen ein Weggehen — sonst
        // bliebe die Adresse stehen und die Spalte wäre zu, also zwei
        // widersprechende Auskünfte.
        setOpenTaskState(id === route.taskId ? null : id);
        go({ kind: 'today' }, true);
        return;
      }
      setOpenTaskState(id);
    },
    [route, go],
  );

  /**
   * Eine Aufgabe von ausserhalb ihrer Liste öffnen — aus der Glocke, aus
   * „Überall": in IHREM Arbeitsbereich, an IHREM Ort, in der Spalte.
   *
   * Gemeldet: „im Baum sollte auch der richtige Projektordner geöffnet werden
   * … momentan lande ich bei Heute." Der Ort einer Aufgabe ist ihr Projekt;
   * ohne Projekt der Posteingang (so definiert `views.ts` ihn: `project_id
   * IS NULL`). „Heute" und „Irgendwann" sind Sichten darüber, keine Orte.
   *
   * Erst die Aufgabe holen, dann gehen: der Ort steht in der Aufgabe. Ist
   * sie nicht mehr da, bleibt es beim Posteingang, und die Spalte sagt, was
   * fehlt.
   */
  const openTaskAt = useCallback(
    async (ws: string, taskId: string) => {
      setWorkspace(ws);
      localStorage.setItem(LAST_WORKSPACE, ws);
      let ziel: Route = { kind: 'inbox' };
      try {
        const d = await api.detail(taskId, ws);
        if (d.task.projectId !== null) ziel = { kind: 'project', projectId: d.task.projectId };
      } catch {
        /* dann der Posteingang */
      }
      bringtAufgabe.current = true;
      setOpenTaskState(taskId);
      go(ziel);
    },
    [go],
  );

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
  /**
   * Die Vorgabe des Arbeitsbereichs für die Anzeigeform, und die Abweichungen
   * dieser Person.
   *
   * BEIDES HIER und nicht in der Liste: die Wahl gilt auch in der Suche und
   * später auf der Tafel. Drei Stellen, die dieselbe Einstellung laden, sind
   * drei Ladezeiten — und in jeder davon zeichnet die Liste einen Moment lang
   * die falsche Form, bevor die Antwort kommt.
   */
  const [workspaceListView, setWorkspaceListView] = useState<ListView | undefined>(undefined);
  /** Wie die Tafel aussieht — gehört dem Arbeitsbereich, nicht der Person. */
  const [board, setBoard] = useState<Board | undefined>(undefined);
  const [listViews, setListViews] = useState<{
    projects: Record<string, string>;
    places: Record<string, string>;
  }>({ projects: {}, places: {} });
  const [landing, setLanding] = useState<Landing>({ kind: 'today' });
  /*
   * Die Hülle als Element, damit `useLook` Attribute daran setzen kann.
   *
   * Über einen Ref und nicht über React-Props: die Flächen werden im
   * Stylesheet über `[data-surface-*]` zugeordnet, und das ist die Stelle, an
   * der beide Themen ohnehin stehen. Als Props müsste jedes Bauteil seine
   * eigene Farbe kennen.
   */
  const [shell, setShell] = useState<HTMLElement | null>(null);
  const angemeldet = me !== undefined && me !== null;
  useEffect(() => {
    // Erst mit Sitzung fragen. Vorher antwortet die Route 401, und ein
    // erwarteter Fehlschlag im Protokoll ist einer, den man beim Suchen nach
    // einem echten überliest.
    if (!angemeldet) return;
    /*
     * MIT dem Arbeitsbereich, und neu bei jedem Wechsel: der wirksame Look
     * hängt vom Bereich ab. Ohne den Parameter kam immer der des ersten
     * Bereichs — darum sah ein zweiter Arbeitsbereich nie anders aus, und
     * eine Änderung dort schien „alle" zu ändern.
     */
    void api
      .settings(workspace)
      .then((s) => {
        setScheme(s.effective.scheme);
        setLook(s.effective.look);
        /*
         * Ankommen heißt: die Landeeinstellung in voller Länge (ADR-0072).
         *
         * Nur wenn keine Adresse gemeint war. Wer einen Link auf ein Projekt
         * öffnet, hat gesagt, wo er hin will — ihn stattdessen auf seine
         * Landeseite zu schicken, macht jeden geteilten Link unbrauchbar.
         */
        setLanding(s.effective.landing);
        setCalendarDefault(s.levels.user.calendarDefault ?? 'last');
        setWorkspaceListView(s.effective.listView);
        setBoard(s.effective.board);
        if (window.location.pathname === '/') go(landingRoute(s.effective.landing, projects));
      })
      .catch(() => undefined);
    /*
     * Abhängig davon, OB jemand angemeldet ist — nicht vom `me`-Objekt.
     * `loadMe()` läuft auch nach einem Umbenennen des Arbeitsbereichs oder
     * einem neuen Konto, und jedes Mal ein neues Objekt; die Einstellungen
     * darauf neu zu holen (und auf `/` an die Landeseite zu springen) wäre
     * ein Effekt, der mehr tut, als sein Anlass verlangt.
     */
  }, [angemeldet, workspace]);
  /* Die Abweichungen dieser Person, einmal je Arbeitsbereich. */
  useEffect(() => {
    if (!angemeldet) return;
    void api
      .listViews(workspace)
      .then(setListViews)
      // Still: ohne Antwort gilt die Vorgabe, und das ist die richtige
      // Rückfallebene. Eine Fehlermeldung über eine Anzeigeform wäre lauter
      // als die Sache ist.
      .catch(() => undefined);
  }, [angemeldet, workspace]);

  useScheme(scheme);
  useLook(look, shell);
  useBoard(board, shell);

  /*
   * Eine Freigabe braucht kein Konto — und wird darum VOR jeder Anmeldeprüfung
   * gezeichnet (Konzept 10e).
   *
   * Eine Anmeldemaske vor einem Link zu zeigen wäre die Aufforderung, sich
   * etwas anzulegen, um etwas zu sehen, das man geschickt bekommen hat. Und es
   * steht hier oben und nicht in der Hülle, weil dieser Bildschirm keinen
   * Rahmen hat: es gibt keine anderen Orte, also auch keine Liste davon.
   */
  if (route.kind === 'share') return <ShareScreen token={route.token} now={now} />;
  /*
   * Auch das vor jeder Anmeldeprüfung: wer eingeladen ist, HAT noch kein Konto.
   * Nach dem Anlegen ist er angemeldet (der Server setzt das Plätzchen), also
   * genügt `loadMe()` und ein Sprung nach Hause.
   */
  if (route.kind === 'invite') {
    return (
      <AcceptInvite
        token={route.token}
        onDone={() => {
          go({ kind: 'today' });
          void loadMe();
        }}
      />
    );
  }

  if (me === undefined) return <div className="signin" aria-busy="true" />;
  if (me === null) {
    return needsSetup ? (
      <Setup onDone={() => void loadMe()} />
    ) : (
      <SignIn sso={sso} onDone={() => void loadMe()} />
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
    /*
     * Der gemerkte Bereich geht mit der Sitzung — SONE räumt ihn beim Abmelden
     * ebenso weg. Sonst landet die nächste Person an diesem Browser im
     * Arbeitsbereich der vorigen (oder in einer Id, die ihr nichts sagt).
     */
    localStorage.removeItem(LAST_WORKSPACE);
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
              ? // Die Marke drücken heißt: irgendwohin, aber nicht hierher
                // (ADR-0072). Vorher führte sie immer nach Heute und tat von
                // Heute aus nichts.
                markRoute(landing, projects, route)
              : id === 'workspaces'
                ? // Die Liste der Bereiche. „Überall" ist in den Kalender aufgegangen.
                  { kind: 'workspaces', section: 'alle' }
                : id === 'calendar'
                  ? { kind: 'calendar', span: calendarStart(), date: isoDate(now) }
                : id === 'search'
                  ? /*
                     * Zur SUCHE, nicht auf eine Platzhalterseite.
                     *
                     * Gemeldet als „Suche: diesen Bereich gibt es noch nicht" —
                     * und das stand da, weil die Schiene auf
                     * `{kind:'mode'}` zeigte, während es die Suche als Ort
                     * längst gab.
                     *
                     * SONE sagt, was das Symbol bedeutet: *„Das Symbol in der
                     * Schiene heißt nicht ‚Suche starten'. Es ist der Weg
                     * ZURÜCK zu einer."* Niemand navigiert hierher, um zu
                     * suchen — man tippt oben ins Feld. Darum die letzte
                     * Abfrage, wenn es eine gibt.
                     */
                    { kind: 'search', q: route.kind === 'search' ? route.q : letzteSuche }
                  : id === 'notifications'
                    ? { kind: 'notifications' }
                    : id === 'shares'
                      ? { kind: 'shares' }
                      : { kind: 'mode', mode: id },
          )
        }
        // Ungelesene Benachrichtigungen, nicht der Posteingang: die Zahl an
        // einer Glocke soll von dem sprechen, was hinter der Glocke liegt.
        inboxCount={ungelesen}
        displayName={me.displayName}
        email={me.email}
        onSettings={() => go({ kind: 'settings', section: 'profil' })}
        // Nur wer verwaltet: ein Eintrag, der auf „das darfst du nicht" führt,
        // bringt Leute dazu, dem Menü zu misstrauen (ADR-0027).
        {...(me.isAdmin ? { onAdmin: () => go({ kind: 'admin', section: 'instanz' }) } : {})}
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
          {/*
            In den Workspace-Einstellungen steht der WÄHLER, nicht nur ein
            Titel — gemeldet: „Workspaces im Menü: hier ist ein Suchfeld, das
            kann raus. Dafür muss oben der Workspace Wähler rein."

            Und das ist auch die richtige Stelle: dieser Bereich handelt VON
            Arbeitsbereichen, also ist Wechseln hier die häufige Handlung. Der
            Titel darüber wäre eine Beschriftung für etwas, das man ohnehin am
            Namen erkennt.
          */}
          {route.kind === 'search' ? (
            <>
              {/*
                SONEs Kopf: `sidebar-head` ist die Zeile mit dem Titel (und
                ggf. Knöpfen), `panel-scope` steht als eigene Zeile DARUNTER —
                nicht in einer Spalte im Titel. Was gefunden wurde, sagt der
                Inhalt; hier steht, wo gesucht wird.
              */}
              <div className="sidebar-head">
                <div className="panel-title">Suche</div>
              </div>
              <div className="panel-scope">
                {route.q.trim() === '' ? 'tippe oben' : wsName}
              </div>
            </>
          ) : route.kind === 'notifications' ? (
            <>
              <div className="sidebar-head">
                <div className="panel-title">Benachrichtigungen</div>
              </div>
              {/*
                Kein Arbeitsbereich im Kopf, und das ist die Aussage: eine
                Glocke gilt über Arbeitsbereiche hinweg, also kann hier keiner
                stehen — es gibt keine einzige Antwort (wie in SONE, ADR-0052).
                „Wo" ist stattdessen eine Achse im Menü darunter.
              */}
              <div className="panel-scope">über alle Arbeitsbereiche</div>
            </>
          ) : route.kind === 'calendar' || route.kind === 'calendar-sources' ? (
            <>
              <div className="sidebar-head">
                <div className="panel-title">Kalender</div>
              </div>
              <div className="panel-scope">
                {route.kind === 'calendar-sources' ? 'für dein Konto' : calScope === null
                  ? 'über alle Arbeitsbereiche'
                  : (me.workspaces.find((w) => w.id === calScope)?.name ?? '')}
              </div>
            </>
          ) : SECTION_NAV !== null && route.kind !== 'workspaces' ? (
            <>
              <div className="sidebar-head">
                <div className="panel-title">{SECTION_NAV.title}</div>
              </div>
              <div className="panel-scope">{SECTION_NAV.note}</div>
            </>
          ) : (
          <WorkspaceMenu
            workspaces={me.workspaces}
            current={workspace}
            onPick={(id) => {
              setWorkspace(id);
              /*
               * Und die Detailspalte zu: sie zeigte eine Aufgabe des ALTEN
               * Bereichs, und die Route darunter fragt sie im neuen ab —
               * „Aufgabe … gibt es nicht", in Rot, in einer Spalte, die
               * niemand mehr gemeint hat. Gemeldet mit Bild.
               */
              setOpenTaskState(null);
              // Gemerkt, damit ein Neuladen hier bleibt.
              localStorage.setItem(LAST_WORKSPACE, id);
              /*
               * Der Ort bleibt, wenn er im neuen Arbeitsbereich existiert.
               *
               * Gemeldet: „Wenn ich einen Workspace bearbeite und dann im
               * Wähler einen anderen wähle, lande ich im Aufgaben-Bereich —
               * aber der Wähler soll ja dafür sorgen, dass ich in den
               * Workspace-Einstellungen durchwechseln kann. Dasselbe für das
               * Teilen-Menü und den Papierkorb."
               *
               * Nur ein Projekt gibt es im nächsten Bereich nicht — darum ging
               * es vorher immer nach Heute. Alles andere (Einstellungen,
               * Verwaltung, Workspaces, Freigaben, Papierkorb, Benachrichtigungen,
               * Suche) ist ein Ort, der in jedem Arbeitsbereich existiert, und
               * dort bleibt man.
               */
              go(route.kind === 'project' ? { kind: 'today' } : route);
            }}
            /*
              Angelegt heißt: Liste neu laden UND hineinwechseln. Beides, weil
              einen Arbeitsbereich anzulegen und ihn dann suchen zu müssen zwei
              Schritte für einen Vorgang wären.
            */
            onCreated={(id) => {
              go({ kind: 'today' });
              // Die Id mitgeben: `loadMe` setzte sonst gleich wieder auf den
              // ersten Arbeitsbereich zurück.
              void loadMe(id);
            }}
          />
          )}
        </div>

        {/*
          Das Suchfeld sucht AUFGABEN — also steht es nur, wo es welche gibt.
          Gemeldet für die Workspaces; es stand in jedem Bereich, auch in der
          Verwaltung und in den Einstellungen, und suchte dort nichts. Ein Feld,
          das an einem Ort nichts findet, ist ein Feld, dem man an allen Orten
          misstraut.
        */}
        {imBaum ? (
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
            /*
              Immer leer, denn dieses Feld steht nur im Aufgaben-Bereich.
              Vorher las es `route.q` für den Fall, dass man in der Suche
              steht — dort gibt es das Feld jetzt nicht mehr, und der
              Übersetzer hat den unmöglichen Vergleich gemeldet. Die Abfrage
              zeigt das Feld IM Suchbildschirm, wo sie hingehört.
            */
            value=""
            /* Und das Getippte reist mit: `defaultValue` wäre ein Feld, das
               nach dem Wechsel den alten Text behält. */
            /* Das Feld IST der Eingang. Tippen bringt einen in die Suche,
               mitsamt dem Getippten — kein Knopf, der einen Bildschirm mit
               einem Feld öffnet. */
            onChange={(e) => {
              setLetzteSuche(e.target.value);
              go({ kind: 'search', q: e.target.value }, true);
            }}
          />
        </div>
        ) : null}

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
              {/*
                KEINE Gruppenüberschrift (SONEs ADR-0072, das ADR-0070
                ändert): „a heading repeating it over the only group in the
                column says nothing." Der Titel steht im Kopf der Leiste, wo
                sonst der Arbeitsbereich steht — und die Zeile darunter nennt
                den Geltungsbereich, „Nur für dich" gegen „Für alle auf diesem
                Server". Die verdient ihren Platz: sie ist die Tatsache, die auf
                dem Bildschirm stehen soll, wenn jemand etwas für alle ändert.
              */}
              {/* SONEs Abschnittsnavigation: eine Gruppe, Zeilen mit Beschriftung
                  und Hinweis daneben — der Hinweis fällt auf dem Telefon weg. */}
              <div className="settings-nav-group">
              {SECTION_NAV.entries.map((entry) => (
                <button
                  key={entry.id}
                  className="settings-nav-item"
                  aria-current={SECTION_NAV.active === entry.id ? 'page' : undefined}
                  /*
                    DER NAME ALLEIN — SONEs `SectionNav`, und die Begründung ist
                    dort geschrieben: *„A line of explanation under each entry
                    made every one three lines tall, and a navigation that has
                    to be read is a page about the navigation."*

                    SOTE zeigte den Hinweis daneben, und bei 272 px Spalte
                    brachen zwei Zeilen um („Name und Zeichen", „Mitnehmen und
                    wegwerfen" — 42 px statt 34, gemessen). Der Hinweis bleibt
                    als `title` und in der Vorleseansage: er ist nicht falsch,
                    er gehört nur nicht in die Zeile.
                  */
                  title={entry.hint}
                  aria-label={`${entry.label} — ${entry.hint}`}
                  onClick={() => SECTION_NAV.go(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
              </div>
            </>
          ) : null}

          {route.kind === 'notifications' ? (
            <NotificationsPanel notes={notes} view={noteView} onPick={setNoteView} />
          ) : null}

          {route.kind === 'calendar' ? (
            /*
             * Der Bereichsfilter des Kalenders — dieselbe Form wie das „Wo"
             * der Glocke. „Alle" zuerst, dann jeder Bereich; bei nur einem
             * Bereich ist die Wahl keine und das Menü entfällt (ADR-0072).
             */
            me.workspaces.length > 1 ? (
              <div className="panel-menu-group">
                <div className="sidebar-label">Wo</div>
                {[{ id: null as string | null, name: 'Alle Arbeitsbereiche' }, ...me.workspaces].map((w) => (
                  <button
                    key={w.id ?? 'alle'}
                    className="panel-menu-item"
                    aria-current={calScope === w.id ? 'page' : undefined}
                    onClick={() => setCalScope(w.id)}
                  >
                    <span className="panel-menu-label">{w.name}</span>
                  </button>
                ))}
              </div>
            ) : null
          ) : null}

          {route.kind === 'calendar' || route.kind === 'calendar-sources' ? (
            <div className="panel-menu-group">
              <button className="panel-menu-item" aria-current={route.kind === 'calendar-sources' ? 'page' : undefined}
                onClick={() => go({ kind: 'calendar-sources' })}>
                <span className="panel-menu-label">Kalender einbinden …</span>
              </button>
              {route.kind === 'calendar-sources' ? <button className="panel-menu-item"
                onClick={() => go({ kind: 'calendar', span: calendarStart(), date: isoDate(now) })}>
                <span className="panel-menu-label">Zur Kalenderansicht</span>
              </button> : <>
                {(calendarSources.data?.feeds.length ?? 0) > 0 ? <div className="sidebar-label">Eingebundene Kalender</div> : null}
                {calendarSources.data?.feeds.filter((f) => calScope === null || f.showsIn === null || f.showsIn.includes(calScope)).map((f) => (
                  <button key={f.id} className="panel-menu-item" aria-pressed={!hiddenCalendars.has(f.id)}
                    title={hiddenCalendars.has(f.id) ? 'Kalender einblenden' : 'Kalender ausblenden'}
                    onClick={() => setHiddenCalendars((current) => {
                      const next = new Set(current);
                      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                      return next;
                    })}>
                    <span className="calendar-source-dot" style={{ background: colorValue(f.color) ?? 'var(--text-muted)', opacity: hiddenCalendars.has(f.id) ? 0.3 : 1 }} />
                    <span className="panel-menu-label">{f.name}</span>
                    {hiddenCalendars.has(f.id) ? <span className="muted small">aus</span> : null}
                  </button>
                ))}
                {calendarSources.error ? <p className="note-error">{calendarSources.error}</p> : null}
              </>}
            </div>
          ) : null}

          {/*
            Die Filter der Suche stehen in der LEISTE: eine Suche einzugrenzen
            ist Navigation innerhalb dieser Suche (SONEs ADR-0069, angewandt und
            nicht gebogen). Gemeldet als „Menü im Baum ebenfalls".
          */}
          {/*
            Das Menü der Freigaben. Gemeldet wie bei SONE: „auch hier fehlt ein
            Menü im Baum." Die Achse ist hier der ZUSTAND und nicht die Art —
            SOTE hat nur eine Art von Freigabe, einen Link.
          */}
          {route.kind === 'shares' ? (
            <SharesPanel
              shares={shareList}
              view={shareView}
              now={now}
              onPick={setShareView}
            />
          ) : null}

          {route.kind === 'search' ? (
            <SearchPanel
              q={route.q}
              projects={projects}
              onQuery={(next) => {
                setLetzteSuche(next);
                go({ kind: 'search', q: next }, true);
              }}
            />
          ) : null}

          {SECTION_NAV !== null ||
        route.kind === 'notifications' ||
        route.kind === 'calendar' ||
        route.kind === 'calendar-sources' ||
        route.kind === 'shares' ||
        route.kind === 'search' ? null : (
          <>
          {/* Die Zahlen kommen aus derselben Abfrage wie die Listen. Keine
              Null: eine Zahl über nichts ist Rauschen in einer ruhigen Zeile.
              Und eine `.panel-menu-group` darum, wie in SONE: der Abstand zum
              Projektbaum kommt aus der Gruppe. */}
          <div className="panel-menu-group">
          {(
            [
              ['today', 'Heute', counts.today],
              ['upcoming', 'Demnächst', counts.upcoming],
              ['someday', 'Irgendwann', counts.someday],
              /*
               * Der Posteingang steht hier, nicht in der Schiene.
               *
               * Er ist eine **Aufgabenansicht** — was noch nicht einsortiert
               * ist —, und Aufgabenansichten stehen beieinander. In der
               * Schiene saß er hinter einer Glocke, und eine Glocke meint
               * Benachrichtigungen: das sind zwei Fragen, und eine Glocke
               * beantwortet nur die zweite.
               */
              ['inbox', 'Posteingang', counts.inbox],
            ] as const
          ).map(([kind, label, n]) => (
            <button
              key={kind}
              className="panel-menu-item"
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
              aria-current={route.kind === kind ? 'page' : undefined}
              onClick={() => go({ kind })}
            >
              <span className="panel-menu-label">{label}</span>
              {n === 0 ? null : (
                <span className="panel-menu-count" aria-hidden="true">
                  {n}
                </span>
              )}
            </button>
          ))}
          </div>

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
            onSort={(id, sortKey) =>
              void panelWrite(() => api.patchProject(id, { sortKey }, workspace))
            }
            /* Ziehen schreibt beides in EINEM Aufruf: Ort und Platz. Zwei
               Aufrufe wären zwei Wege, von denen der zweite scheitern kann —
               und dann steht ein Projekt im neuen Ordner an einer Stelle, die
               dort niemand gewählt hat. */
            onMove={(id, parentId, sortKey) =>
              void panelWrite(() => api.patchProject(id, { parentId, sortKey }, workspace))
            }
            /*
              Teilen führt auf die Freigaben, mit diesem Projekt vorgewählt.
              Nicht sofort einen Link anlegen: Recht und Ablauf sind eine Wahl
              (Konzept 10e), und ein Knopf, der still ein Schreibrecht
              hinausgibt, wäre der eine Klick, den man nicht zurücknehmen kann,
              ohne ihn zu bemerken.
            */
            onShare={(id) => go({ kind: 'shares', projectId: id })}
          />
          {panelError !== undefined ? (
            <p className="panel-error">{panelError}</p>
          ) : null}
          </>
          )}
        </div>
      </div>

      <main className={timeCalendar ? 'main main-calendar' : 'main'}>
        {/* Die Umschalter sitzen INNERHALB der Seite und nicht in der Leiste,
            die sie ausblenden — sonst verschwindet der Knopf mit ihr. */}
        <TopBar
          sidebarVisible={sidebar.visible}
          onToggleSidebar={sidebar.toggle}
          /*
           * Der Schliessen-Knopf steht wieder HIER, in der Kopfleiste.
           *
           * GEMELDET: „Den Schliessen-Button fuer die Seitenleiste haette ich
           * wie gesagt gerne mit demselben Icon wie SONE und vor der Leiste.
           * Schwebend ueber dem Inhalt."
           *
           * Genau dort sass er ursprünglich, und genau dort war er unsichtbar,
           * seit die Spalte ueber dem Inhalt liegt: er lag darunter. Ich habe
           * ihn daraufhin IN die Spalte geholt — die falsche Korrektur an der
           * richtigen Beobachtung.
           *
           * Die richtige ist eine Zeile im Stylesheet: bei offener Spalte
           * rueckt die Kopfleiste um deren Breite nach links. Dann steht der
           * Knopf da, wo er bei SONE steht — unmittelbar vor der Leiste, ueber
           * dem Inhalt schwebend.
           */
          detailOpen={openTask !== null}
          onToggleDetail={openTask === null ? undefined : () => setOpenTask(null)}
        />
        {route.kind === 'admin' && route.section === 'einladungen' ? (
          <Invitations />
        ) : route.kind === 'admin' && route.section === 'wartung' ? (
          <Maintenance />
        ) : route.kind === 'admin' && route.section === 'konten' ? (
          <Accounts />
        ) : route.kind === 'shares' ? (
          <Shares
            workspace={workspace}
            projects={projects}
            // Vorgewählt, wenn man über den Teilen-Knopf im Baum kommt.
            preselect={route.projectId}
            view={shareView}
            onList={setShareList}
          />
        ) : route.kind === 'notifications' ? (
          /*
           * DER BILDSCHIRM. Er war seit d2c9d1f importiert, die Leiste zeigte
           * seine Filter, die Glocke seine Zahl — und hier stand er nie:
           * die Route fiel unten in die Aufgabenliste, also „Heute" neben
           * einem Menü, das auf nichts wirkte. Gemeldet: „im Content tut sich
           * nichts". Ein Durchgang, der nie gelaufen ist (SONE,
           * `durchgang-nie-gelaufen.md`): jeder Teil war da, nur nicht der
           * eine, der sie verbindet.
           */
          <Notifications
            notes={notes}
            view={noteView}
            onChanged={reloadNotes}
            onOpenTask={(taskId, ws) => void openTaskAt(ws, taskId)}
          />
        ) : route.kind === 'settings' && route.section === 'verbindungen' ? (
          <SoneConnections />
        ) : route.kind === 'settings' && route.section === 'kalender' ? (
          <CalendarFeed workspace={workspace} workspaceName={wsName} defaultView={calendarDefault} onDefaultView={setCalendarDefault} />
        ) : route.kind === 'workspaces' && route.section === 'alle' ? (
          <WorkspaceOverview workspaces={me.workspaces} current={workspace} />
        ) : route.kind === 'workspaces' && route.section === 'gruppen' ? (
          <Groups workspace={workspace} />
        ) : route.kind === 'workspaces' && route.section === 'schlagworte' ? (
          <Labels workspace={workspace} />
        ) : route.kind === 'workspaces' && route.section === 'weg' ? (
          <WorkspaceExit
            workspace={workspace}
            name={me.workspaces.find((w) => w.id === workspace)?.name ?? ''}
            onGone={() => void loadMe()}
          />
        ) : route.kind === 'workspaces' && route.section === 'rollen' ? (
          <Roles workspace={workspace} />
        ) : route.kind === 'workspaces' && route.section === 'leute' ? (
          <People workspace={workspace} you={me.id} />
        ) : route.kind === 'workspaces' && route.section === 'name' ? (
          <WorkspaceMark
            name={wsName}
            owner={me.workspaces.find((w) => w.id === workspace)?.owner === true}
            icon={me.workspaces.find((w) => w.id === workspace)?.icon ?? null}
            workspace={workspace}
            // Neu laden, damit Wechsler, Kopf und Übersicht dasselbe zeigen.
            // Drei Stellen, ein Zustand — sonst heißt der Arbeitsbereich an
            // einer davon noch alt.
            onChanged={() => void loadMe()}
          />
        ) : SECTION_NAV !== null ? (
          <Settings
            // Nur Projekte, keine Ordner: ein Ordner ist kein Ort, an dem
            // Aufgaben stehen, also kein Ort zum Landen.
            projects={projects.filter((p) => p.kind === 'list')}
            section={
              // Den Abschnitt „Aussehen" gibt es zweimal — einmal fuer dich,
              // einmal fuer den Arbeitsbereich. Der Bereich entscheidet,
              // welcher gemeint ist, statt zwei gleich benannte Abschnitte in
              // einen Namensraum zu zwingen.
              route.kind === 'workspaces' ? `ws-${SECTION_NAV.active}` : SECTION_NAV.active
            }
            workspaceName={wsName}
            workspaceId={workspace}
            displayName={me.displayName}
            userId={me.id}
            email={me.email}
            onEffective={(out) => {
              setScheme(out.scheme);
              setLook(out.look);
            }}
          />
        ) : route.kind === 'calendar-sources' ? (
          <CalendarSources data={calendarSources.data} error={calendarSources.error}
            workspaces={me.workspaces} reload={calendarSources.reload} />
        ) : route.kind === 'calendar' ? (
          <Calendar
            sources={calendarSources.data?.feeds ?? []}
            hiddenSources={hiddenCalendars}
            span={route.span}
            date={route.date}
            scope={calScope}
            /* Wo eine per Klick erfasste Aufgabe hingeht, wenn „Alle" gewählt ist:
               in den Bereich, in dem man gerade steht. */
            createIn={calScope ?? workspace}
            createInName={me.workspaces.find((w) => w.id === (calScope ?? workspace))?.name ?? ''}
            projects={projects}
            now={now}
            openTask={openTask}
            onOpenTask={(id, ws) => {
              /*
               * Eine Aufgabe aus einem anderen Bereich öffnen: die Hülle
               * wechselt den Bereich (die Detailspalte lädt aus ihm), der
               * Kalender bleibt, wo er ist — sein Fenster hängt nicht am
               * Bereich, wenn „Alle" gewählt ist.
               */
              if (id !== null && ws !== undefined && ws !== workspace) {
                setWorkspace(ws);
                localStorage.setItem(LAST_WORKSPACE, ws);
              }
              setOpenTask(id);
            }}
            onGo={(span, tag) => go({ kind: 'calendar', span, date: isoDate(tag) })}
            onChanged={() => void loadPanel()}
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
            onLabel={(name) => go({ kind: 'search', q: `${SIGIL_OF.schlagwort}${name}` })}
            onOpenProject={(id) => go({ kind: 'project', projectId: id })}
            listView={
              /*
               * Welcher Ort gerade gemeint ist: eine Liste hat eine Id, Heute
               * ein Wort. Dieselbe Zweiteilung wie in der Tabelle — und sie
               * steht hier, weil nur hier bekannt ist, welche Route offen ist.
               */
              (route.kind === 'project'
                ? listViews.projects[route.projectId]
                : listViews.places[viewOf(route)]) as ListView | undefined
            }
            workspaceListView={workspaceListView}
            onListView={(display) => {
              const wo =
                route.kind === 'project'
                  ? { projectId: route.projectId }
                  : { place: viewOf(route) };
              /*
               * Sofort im Bild und dann erst geschrieben.
               *
               * Eine Anzeigeform, die erst nach der Antwort des Servers
               * umschaltet, fühlt sich kaputt an — sie ist die einzige
               * Einstellung, deren Wirkung man unmittelbar sieht. Scheitert
               * das Schreiben, holt der nächste Ladevorgang den alten Stand
               * zurück; verloren ist dann eine Wahl, die einen Klick kostet.
               */
              setListViews((was) => {
                const raus = (karte: Record<string, string>, schluessel: string) => {
                  const naechste = { ...karte };
                  if (display === null) delete naechste[schluessel];
                  else naechste[schluessel] = display;
                  return naechste;
                };
                return route.kind === 'project'
                  ? { ...was, projects: raus(was.projects, route.projectId) }
                  : { ...was, places: raus(was.places, viewOf(route)) };
              });
              void api.setListView({ ...wo, display }, workspace).catch(() => undefined);
            }}
          />
        ) : route.kind === 'search' ? (
          <Search
            q={route.q}
            workspace={workspace}
            projects={projects}
            now={now}
            onQuery={(next) => {
              // Gemerkt, damit das Symbol in der Schiene zurückführt.
              setLetzteSuche(next);
              go({ kind: 'search', q: next }, true);
            }}
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
          /* Für „nur meine Erinnerung wegnehmen": der Server prüft es, und die
             Oberfläche zeigt den Handgriff nur da, wo er auch geht. */
          me={me.id}
          onClose={() => setOpenTask(null)}
          workspace={workspace}
          now={now}
          onChanged={() => void loadPanel()}
        />
      ) : null}

      <FootBar
        active={modeOfRoute(route) as ModeId}
        onPick={(id) =>
          go(
            id === 'tasks'
              ? // Die Marke drücken heißt: irgendwohin, aber nicht hierher
                // (ADR-0072). Vorher führte sie immer nach Heute und tat von
                // Heute aus nichts.
                markRoute(landing, projects, route)
              : id === 'workspaces'
                ? // Die Liste der Bereiche. „Überall" ist in den Kalender aufgegangen.
                  { kind: 'workspaces', section: 'alle' }
                : id === 'calendar'
                  ? { kind: 'calendar', span: calendarStart(), date: isoDate(now) }
                : id === 'search'
                  ? /*
                     * Zur SUCHE, nicht auf eine Platzhalterseite.
                     *
                     * Gemeldet als „Suche: diesen Bereich gibt es noch nicht" —
                     * und das stand da, weil die Schiene auf
                     * `{kind:'mode'}` zeigte, während es die Suche als Ort
                     * längst gab.
                     *
                     * SONE sagt, was das Symbol bedeutet: *„Das Symbol in der
                     * Schiene heißt nicht ‚Suche starten'. Es ist der Weg
                     * ZURÜCK zu einer."* Niemand navigiert hierher, um zu
                     * suchen — man tippt oben ins Feld. Darum die letzte
                     * Abfrage, wenn es eine gibt.
                     */
                    { kind: 'search', q: route.kind === 'search' ? route.q : letzteSuche }
                  : id === 'notifications'
                    ? { kind: 'notifications' }
                    : id === 'shares'
                      ? { kind: 'shares' }
                      : { kind: 'mode', mode: id },
          )
        }
        // Ungelesene Benachrichtigungen, nicht der Posteingang: die Zahl an
        // einer Glocke soll von dem sprechen, was hinter der Glocke liegt.
        inboxCount={ungelesen}
        displayName={me.displayName}
        email={me.email}
        onSettings={() => go({ kind: 'settings', section: 'profil' })}
        // Nur wer verwaltet: ein Eintrag, der auf „das darfst du nicht" führt,
        // bringt Leute dazu, dem Menü zu misstrauen (ADR-0027).
        {...(me.isAdmin ? { onAdmin: () => go({ kind: 'admin', section: 'instanz' }) } : {})}
        onSignOut={signOut}
      />
    </div>
  );
}
