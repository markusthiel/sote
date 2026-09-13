/**
 * SOTE — der Weg zum Server.
 *
 * Eine Stelle, die `fetch` aufruft, damit „nicht angemeldet" und „Server weg"
 * genau einmal unterschieden werden. Jeder Fehler des Servers trägt einen
 * maschinenlesbaren Grund; der wird durchgereicht und nicht in „ging nicht"
 * übersetzt.
 */

export interface CalendarSource {
  id: string;
  name: string;
  color: string | null;
  showsIn: string[] | null;
  fetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  writing?: CalendarWriter | null;
  kind?: 'ics' | 'caldav' | 'google' | 'microsoft';
  writable?: boolean | null;
  provider?: 'icloud' | 'google' | 'microsoft' | 'caldav' | 'ics';
}

export interface CalendarWriter {
  enabled: boolean;
  workspaces: string[];
  mode: 'planned' | 'due' | 'both';
  timezone: string;
  syncedAt: string | null;
  lastError: string | null;
  count: number;
  conflict: boolean;
}
export interface CalendarWriterInput {
  url?: string; username?: string; password?: string;
  workspaces: string[]; mode: CalendarWriter['mode']; timezone: string; enabled: boolean;
}

export interface SpanEvent {
  feedId: string;
  uid: string;
  recurrenceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}

export type CalendarSourceFields = { name?: string; color?: string | null; showsIn?: string[] | null };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Die Zeitzone dieses Browsers.
 *
 * An **einer** Stelle gelesen und an **jede** Anfrage gehängt, statt sie
 * dreizehn Aufrufen einzeln mitzugeben. Der Grund ist derselbe wie bei der
 * Suchabfrage in der URL: zwei Antworten auf „welche Zone" laufen beim ersten
 * Gebrauch auseinander.
 *
 * Der Server rechnet ohne sie in UTC, und genau das war der gemeldete Fehler:
 * „morgen 9 Uhr" eingetippt, „morgen, 11:00" angezeigt. Eine Wanduhrzeit ohne
 * Zone ist keine Angabe.
 *
 * Später eine Einstellung: wer verreist, will vielleicht die Zone zu Hause
 * behalten. Bis dahin ist der Browser die beste Auskunft, die es gibt — und
 * eine falsch geratene Zone ist besser als keine.
 */
function zoneOfBrowser(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const TZ = zoneOfBrowser();

/**
 * Dieselbe Zone, auch für die Vorschau.
 *
 * Sie hing bisher nur an den Anfragen — und darum stimmte, was der Server
 * speicherte, während die Vorschau daneben etwas anderes behauptete. Eine
 * zweite Auskunft über die Zone wäre der Fehler, der hier schon einmal
 * passiert ist; also dieselbe.
 */
export const browserZone = (): string => TZ;

/**
 * Die Adresse des Ereignisstroms für DIESEN Arbeitsbereich.
 *
 * GEMELDET: „Wenn ich bei einer vorhandenen Aufgabe den Titel ändere, ändert
 * sich der Text nicht in der Aufgabenliste … Eigentlich alles muss live
 * passieren."
 *
 * Der Strom wurde ohne `?workspace=` geöffnet, und der Server filtert ihn auf
 * einen Bereich: ohne Angabe nimmt er den ERSTEN, in dem jemand Mitglied ist.
 * Bei mehreren Bereichen hörte die Seite also einem anderen zu als dem, den
 * sie zeigt.
 *
 * Hier und nicht an drei Aufrufstellen: dieselbe Adresse dreimal zu bauen ist
 * dreimal die Gelegenheit, den Bereich zu vergessen — genau so ist es
 * passiert.
 */
export const streamUrl = (workspace: string | undefined): string =>
  workspace === undefined ? '/api/stream' : `/api/stream?workspace=${workspace}`;

/**
 * Hängt `tz` an, ohne über ein vorhandenes `?` zu stolpern.
 *
 * Die Aufrufe unten bauen ihre Pfade teils mit und teils ohne Abfrageteil, und
 * ein `?tz=` hinter einem `?workspace=` ist eine zweite Abfrage und keine
 * zweite Angabe.
 */
function withZone(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}tz=${encodeURIComponent(TZ)}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withZone(path), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    // Kein Grund vom Server, weil es keinen Server gab.
    throw new ApiError(0, 'offline', 'Der Server ist nicht erreichbar.');
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Fehler ${res.status}`,
    );
  }
  return body as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  /** Verwaltet diese Person die Instanz (Migration 0012)? */
  isAdmin: boolean;
  /**
   * Ungelesene Benachrichtigungen — die Zahl an der Glocke.
   *
   * Hier und nicht in einer eigenen Route: `/api/me` wird beim Laden ohnehin
   * geholt, und eine zweite Anfrage für eine Zahl wäre ein Umlauf für etwas,
   * das zur ersten Antwort gehört.
   */
  unread: number;
  workspaces: {
    id: string;
    name: string;
    /** Dieselbe Form wie beim Projekt, plus `titleColor` für den Namen. */
    icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
    owner: boolean;
    /**
     * Die wirksame Listenstufe hier — `null` heisst: keine Listen, nur
     * Freigegebenes. Der Server setzt sie seit dem Audit vom 12.09.2026 (F01)
     * an jeder Route durch; die Oberfläche soll daraus lernen, was sie
     * anbieten darf (SONE ADR-0095), statt Knöpfe zu zeigen, die 403 sagen.
     */
    listLevel: 'viewer' | 'editor' | 'admin' | null;
  }[];
}

export interface Task {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  note: string;
  planned: string | null;
  plannedAllDay: boolean;
  due: string | null;
  dueAllDay: boolean;
  priority: number;
  completed: string | null;
  recurrence: { kind: 'calendar' | 'afterCompletion'; says: string } | null;
  /** Geschätzte Dauer in Minuten, `null` heißt keine Angabe. */
  duration: number | null;
  /** Wo die Karte auf der Tafel liegt. `null` heißt Auffangbecken. */
  columnId: string | null;
  /**
   * Das Titelbild der Karte — fehlt, wenn es keines gibt.
   *
   * `image` ist immer ein eigener Anhangsweg; eine fremde Adresse nimmt der
   * Server nicht an, weil ein Titelbild bei jedem Zeichnen geladen wird.
   */
  cover?: { image?: string; color?: string };
  /**
   * Das Aussehen DIESER Aufgabe — die genaueste der drei Ebenen.
   *
   * Was gilt, rechnet `resolveTaskLook` aus Projekt, Schlagwort und dieser
   * Angabe. Hier steht nur, was jemand an der Aufgabe selbst gesetzt hat.
   */
  look?: { icon?: string; color?: string };
  /** Die Schlagwörter, nach Namen sortiert. `[]` wenn keine. */
  labels: readonly string[];
  /**
   * Was an der Aufgabe hängt: `note`, `image`, `file`, `comment`, `subtask`,
   * `assignee`, `reminder`. Sortiert, `[]` wenn nichts.
   */
  marks: readonly string[];
  sortKey: string;
}

/** Was gilt, und wer was gesagt hat — beides in einer Antwort. */
import type { Board, Landing, ListView, Look, Right } from '@sote/core';

interface Level {
  calendarDefault?: import('@sote/core').CalendarDefault;
  scheme?: 'system' | 'light' | 'dark';
  zone?: string;
  look?: Look;
  landing?: Landing;
  /** Wann eine Erinnerung kommt — nur auf der Personen-Ebene sinnvoll. */
  reminders?: { at: string };
  /**
   * Die Vorgabe für die Anzeigeform — auf Arbeitsbereichs- und Instanzebene.
   *
   * Was eine Person je Liste wählt, steht nicht hier: das hängt an Person UND
   * Ort und hätte auf einer Ebene keinen Platz (Migration 0028).
   */
  listView?: ListView;
  /** Wie die Tafel aussieht. Nur auf Arbeitsbereichs- und Instanzebene. */
  board?: Board;
}

export interface SettingsAnswer {
  /** `zone` ist auch hier optional: „nirgends gesagt" ist eine Antwort. */
  effective: {
    scheme: 'system' | 'light' | 'dark';
    zone?: string | undefined;
    /**
     * Flächen, Ecken, Akzent — aus Arbeitsbereich über Instanz.
     *
     * Anders aufgelöst als das Schema, und mit Absicht (ADR-0028): das
     * Aussehen des Arbeitsbereichs gestaltet, was **alle** sehen. Die Person
     * kommt darin nicht vor; ihr gehört hell oder dunkel.
     */
    look?: Look;
    /** Wo eine Sitzung aufgeht — Person schlägt Arbeitsbereich (ADR-0032). */
    landing: Landing;
    /**
     * Die Vorgabe für die Anzeigeform, Arbeitsbereich über Instanz.
     *
     * Was eine Person je Liste gewählt hat, steht woanders (`listViews`) und
     * schlägt diese hier — aufgelöst wird in der Liste, wo beides vorliegt.
     */
    listView?: ListView | undefined;
    /** Wie die Tafel aussieht — Arbeitsbereich über Instanz, Feld für Feld. */
    board?: Board | undefined;
  };
  levels: {
    instance: Level;
    workspace: Level;
    user: Level;
  };
}

export interface Project {
  id: string;
  parentId: string | null;
  name: string;
  /** Ein Palettenname oder ein `#rrggbb` — nie roh in ein `style`. */
  color: string | null;
  /**
   * Dieselbe Form wie SONEs `pages.icon`. `null`, wenn nichts gewählt ist.
   * `titleColor` färbt den NAMEN in der Leiste, getrennt vom Zeichen.
   */
  icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
  /** Ordner ordnen, Projekte halten (Konzept 10d). */
  kind: 'folder' | 'list';
  /** Tiefe im Baum, vom Server gerechnet. */
  depth?: number;
  /**
   * Der Sortierschlüssel — damit die Leiste „einen Platz weiter" rechnen kann.
   *
   * Sie braucht die Schlüssel der Nachbarn, um einen dazwischen zu bauen. Ohne
   * sie müsste der Server die Reihenfolge nachbilden, in der die Leiste
   * zeichnet, und zwei Wahrheiten über dieselbe Liste laufen auseinander.
   */
  sortKey: string;
  /** `null` und nicht 0 — eine Zahl über nichts ist Rauschen. */
  open: number | null;
}

export interface TrashEntry {
  kind: 'task' | 'project';
  id: string;
  title: string;
  trashedAt: string;
  trashedBy: string | null;
  projectId: string | null;
  projectName: string | null;
  projectTrashed: boolean;
  carries: number | null;
  peek: string | null;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorGuest: string | null;
  /** Worauf geantwortet wird — `null` ist ein eigener Beitrag. */
  parentId: string | null;
}

export interface Detail {
  task: Task;
  projectName: string | null;
  children: Task[];
  comments: Comment[];
  assignees: { userId: string | null; name: string | null; guestKey: string | null }[];
  /** Die Schlagwörter, die es in diesem Arbeitsbereich schon gibt. */
  known: readonly string[];
  /**
   * Die Erinnerungen an dieser Aufgabe — alle, nicht nur die eigenen.
   *
   * Wer eine Aufgabe sieht, sieht auch, dass jemand anders erinnert wird: sonst
   * setzt man eine zweite, weil man die erste nicht kennt. Beim Gast ist die
   * Liste leer — er hat kein Konto und damit keine Erinnerung.
   */
  reminders: {
    id: string;
    userId: string;
    says: string;
    sentAt: string | null;
    dueAt: string | null;
  }[];
  /** Die Anhänge. Beim Gast leer — Dateien hängen an einem Konto. */
  files: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  /** Fehlt, wenn es keine Herkunft gibt — kein „Herkunft: keine". */
  origin?: { url: string; pageTitle: string; seenAt: string };
}

export interface TaskPatch {
  title?: string;
  note?: string;
  planned?: string | null;
  plannedAllDay?: boolean;
  due?: string | null;
  dueAllDay?: boolean;
  priority?: 1 | 2 | 3 | 4;
  /** Titelbild setzen oder mit `null` wegnehmen. */
  cover?: { image?: string; color?: string } | null;
  /** Aussehen setzen oder mit `null` wegnehmen. */
  look?: { icon?: string; color?: string } | null;
  projectId?: string | null;
  /**
   * Die Wiederholung — `null` nimmt sie weg.
   *
   * Zwei Formen: eine Kalenderregel (`rrule`, mit `dtstart` als Anker) oder
   * gezählt ab dem Abhaken (`n` und `unit`). Der Server erkennt sie am Feld
   * und braucht kein `kind` dazu.
   */
  recurrence?: { rrule: string; dtstart?: string } | { n: number; unit: string } | null;
  /** Geschätzte Dauer in Minuten — `null` nimmt sie weg. */
  duration?: number | null;
  /**
   * Die Schlagwörter, vollständig — `[]` nimmt alle weg.
   *
   * Namen und nicht Ids: ein Schlagwort entsteht beim Vergeben. Wer erst
   * eines anlegen müsste, um es zu benutzen, legt keines an.
   */
  labels?: readonly string[];
  /** Wer zuständig ist, vollständig. `[]` nimmt alle weg. */
  assignees?: readonly string[];
}

export const api = {
  /** Braucht diese Instanz noch ein erstes Konto? */
  setupNeeded: () =>
    call<{ needed: boolean; sso: { label: string } | null }>('/api/setup'),
  setup: (body: {
    key: string;
    email: string;
    displayName: string;
    password: string;
    workspaceName?: string;
  }) =>
    call<{ userId: string }>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  signIn: (email: string, password: string) =>
    call<{ ok: true }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signOut: () => call<{ ok: true }>('/api/session', { method: 'DELETE' }),
  me: () => call<Me>('/api/me'),
  /** Eine Ansicht. `overdue` ist nur bei `today` gefüllt. */
  tasks: (
    view: 'today' | 'upcoming' | 'someday' | 'inbox' | 'project',
    opts: { workspace?: string; project?: string; done?: boolean } = {},
  ) => {
    const q = new URLSearchParams({ view });
    if (opts.workspace !== undefined) q.set('workspace', opts.workspace);
    if (opts.project !== undefined) q.set('project', opts.project);
    // Nur wenn eingeblendet: ein `done=0` in jeder Adresse wäre eine Angabe
    // über die Vorgabe, und die soll die Abwesenheit sein.
    if (opts.done === true) q.set('done', '1');
    return call<{
      view: string;
      overdue: Task[];
      tasks: Task[];
      /**
       * Die Unteraufgaben, nach Elternteil geordnet.
       *
       * Mit der Liste und nicht beim Aufklappen: das Ziehen braucht sie schon
       * vorher — wer eine Aufgabe auf eine zugeklappte zieht, soll sie ans
       * Ende der Kinder setzen, und der Sortierschlüssel dafür wird hier
       * gerechnet.
       */
      children: Record<string, Task[]>;
    }>(`/api/tasks?${q}`);
  },
  search: (q: string, workspace?: string) => {
    const p = new URLSearchParams({ q });
    if (workspace !== undefined) p.set('workspace', workspace);
    return call<{
      q: string;
      read: { facet: string; value: string }[];
      status: 'open' | 'done' | 'all';
      tasks: Task[];
      more: boolean;
    }>(`/api/search?${p}`);
  },
  counts: (workspace?: string) =>
    call<{
      today: number;
      upcoming: number;
      someday: number;
      inbox: number;
      overdue: number;
    }>(
      `/api/counts${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  move: (
    id: string,
    /**
     * Wohin und wohin darin.
     *
     * `parentId` FEHLEN zu lassen heißt „nicht umhängen"; `null` heißt „nach
     * ganz oben". Zwei verschiedene Dinge — ohne die Unterscheidung würde
     * jedes Umsortieren innerhalb einer Aufgabe die Unteraufgabe
     * herauswerfen.
     */
    between: {
      afterId: string | null;
      beforeId: string | null;
      parentId?: string | null;
    },
    workspace?: string,
  ) =>
    call<{ task: Task }>(
      `/api/tasks/${id}/move${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(between) },
    ),
  /**
   * Nur die genannten Felder. Ein fehlender Schlüssel heißt „nicht angefasst",
   * `null` heißt „leeren" — dieselbe Regel wie im Server, und sie muss hier
   * stehen, damit `JSON.stringify` kein `undefined` verschluckt und daraus
   * versehentlich „nicht angefasst" macht, wo „leeren" gemeint war.
   */
  patch: (id: string, fields: TaskPatch, workspace?: string) =>
    call<{ task: Task }>(
      `/api/tasks/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(fields) },
    ),
  /** Name und Zeichen des Arbeitsbereichs, in dem man steht. */
  patchWorkspace: (
    body: {
      name?: string;
      icon?: { icon?: string; iconColor?: string; titleColor?: string } | null;
    },
    workspace?: string,
  ) =>
    call<{ workspace: { id: string; name: string; icon: unknown } }>(
      `/api/workspace${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  /* ── Profilbild ────────────────────────────────────────────────────────── */
  /**
   * Das eigene Bild setzen.
   *
   * Die Datei als **Körper** und nicht in einem `FormData`: es ist ein Bild und
   * kein Formular, und ein `multipart`-Rahmen wäre ein Umschlag um genau eine
   * Sache. Der Typ steht in der Kopfzeile, wo der Server ihn ohnehin liest.
   */
  setPicture: (file: File) =>
    call<{ ok: true }>('/api/me/picture', {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    }),
  deletePicture: () => call<{ ok: true }>('/api/me/picture', { method: 'DELETE' }),

  /* ── Benachrichtigungen ────────────────────────────────────────────────── */
  /**
   * Alles auf einmal.
   *
   * Die Oberfläche zählt ihre Ansichten daraus — eine Abfrage je Zahl wäre eine
   * je Ansicht, und die Zahlen kämen aus verschiedenen Augenblicken (SONEs
   * `InboxPanel`: *„a menu that says Mentions without saying how many is a menu
   * you have to click to learn anything from"*).
   */
  notifications: () =>
    call<{
      notifications: {
        id: string;
        kind: 'assigned' | 'commented';
        taskId: string;
        taskTitle: string;
        workspaceId: string;
        workspaceName: string;
        actorName: string | null;
        createdAt: string;
        readAt: string | null;
      }[];
    }>('/api/notifications'),
  /** Ohne Id: alles gelesen. Mit Id: diese eine. */
  markRead: (id?: string) =>
    call<{ ok: true }>(`/api/notifications${id === undefined ? '' : `/${id}`}/read`, {
      method: 'POST',
    }),

  /* ── Arbeitsbereiche ───────────────────────────────────────────────────── */
  /**
   * Einen anlegen.
   *
   * Jedes Konto darf das: ein Arbeitsbereich ist der Ort, an dem jemand seine
   * eigene Arbeit führt, und ihn beantragen zu müssen macht aus einer Notiz
   * einen Vorgang.
   */
  createWorkspace: (name: string) =>
    call<{ id: string }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /* ── Gruppen ───────────────────────────────────────────────────────────── */
  /**
   * Der Kalender-Link dieser Person in diesem Arbeitsbereich.
   *
   * `possible` sagt, ob die Instanz überhaupt Links ausgeben kann (sie braucht
   * `SOTE_SHARE_KEY`) — sonst stünde dort ein Knopf, der nichts tut.
   */
  /**
   * Wo diese Person von der Vorgabe abweicht — je Liste und je fester Ansicht.
   *
   * Nur die Abweichungen: wer nirgends etwas gewählt hat, bekommt zwei leere
   * Karten. Was dann gilt, entscheidet `resolveListView` im Kern.
   */
  /** Die Spalten einer Liste, in ihrer Reihenfolge. */
  board: (project: string, workspace?: string) =>
    call<{ columns: { id: string; name: string; sort_key: string; is_done: boolean }[] }>(
      `/api/board?project=${project}${workspace === undefined ? '' : `&workspace=${workspace}`}`,
    ),
  addColumn: (
    body: { project: string; name: string; sortKey: string; isDone?: boolean },
    workspace?: string,
  ) =>
    call<{ column: { id: string; name: string; sort_key: string; is_done: boolean } }>(
      `/api/board${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateColumn: (
    id: string,
    body: { name?: string; sortKey?: string; isDone?: boolean },
    workspace?: string,
  ) =>
    call<{ column: { id: string; name: string; sort_key: string; is_done: boolean } }>(
      `/api/board/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  removeColumn: (id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/board/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  /**
   * Eine Karte in eine Spalte legen — `columnId: null` ins Auffangbecken.
   *
   * In die Fertig-Spalte zu legen hakt ab, heraus zu legen öffnet wieder: die
   * Spalte heißt so, und eine offene Aufgabe darin wäre ein Widerspruch.
   */
  placeCard: (
    id: string,
    columnId: string | null,
    /**
     * Wo in der Spalte. Fehlt beides, bleibt die Reihenfolge, wie sie war.
     *
     * Die Tafel führt keine eigene Ordnung: sie sortiert nach demselben
     * Schlüssel wie die Liste. Wer auf der Tafel umsortiert, sortiert damit
     * auch die Liste um — eine Ordnung, zwei Ansichten.
     */
    between: { afterId?: string | null; beforeId?: string | null } = {},
    workspace?: string,
  ) =>
    call<{ ok: true }>(
      `/api/tasks/${id}/column${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PUT', body: JSON.stringify({ columnId, ...between }) },
    ),
  listViews: (workspace?: string) =>
    call<{
      projects: Record<string, string>;
      places: Record<string, string>;
    }>(`/api/list-views${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  /** Eine Wahl setzen; `display: null` nimmt sie zurück. */
  setListView: (
    body: { projectId?: string; place?: string; display: string | null },
    workspace?: string,
  ) =>
    call<{ ok: true }>(
      `/api/list-views${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  calendar: (workspace?: string) =>
    call<{
      possible: boolean;
      base: string | null;
      feed: { token: string | null; createdAt: string; lastUsedAt: string | null } | null;
    }>(`/api/calendar${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  /** Einen neuen machen — der alte ist danach tot. */
  newCalendar: (workspace?: string) =>
    call<{ token: string }>(
      `/api/calendar${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST' },
    ),
  revokeCalendar: (workspace?: string) =>
    call<{ ok: true }>(
      `/api/calendar${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  /** Die Schlagwörter dieses Arbeitsbereichs, mit der Zahl der Aufgaben. */
  /** Die Farbe eines Schlagworts setzen; `null` nimmt sie weg. */
  colorLabel: (id: string, color: string | null, workspace?: string) =>
    call<{ ok: true }>(
      `/api/labels/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify({ color }) },
    ),
  /**
   * Heute oder Demnächst über ALLE Arbeitsbereiche.
   *
   * Ohne `?workspace=` — als einzige Route neben der Kontoantwort. Sie fragt
   * nicht „darf ich hier", sondern „wo bin ich Mitglied", und nimmt genau die
   * Bereiche.
   */
  /** Der öffentliche Schlüssel dieser Instanz — für das Abonnement im Browser. */
  pushKey: () => call<{ key: string }>('/api/push/key'),
  pushSubscribe: (abo: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    says?: string;
  }) => call<{ ok: true }>('/api/push', { method: 'POST', body: JSON.stringify(abo) }),
  pushUnsubscribe: (endpoint: string) =>
    call<{ ok: true }>('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  /** Wohin Meldungen gehen — je Art, mit der geltenden Wahl. */
  channels: () =>
    call<{
      channels: { kind: string; email: boolean; push: boolean; eigen: boolean }[];
      mailOn: boolean;
    }>('/api/notification-channels'),
  /** Setzen; `null` nimmt die Wahl zurück auf die Vorgabe. */
  setChannels: (kind: string, channels: { email: boolean; push: boolean } | null) =>
    call<{ ok: true }>('/api/notification-channels', {
      method: 'PUT',
      body: JSON.stringify({ kind, channels }),
    }),
  labels: (workspace?: string) =>
    call<{
      labels: { id: string; name: string; tasks: number; color: string | null }[];
      mayManage: boolean;
    }>(`/api/labels${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  /**
   * Umbenennen — und verschmelzen, wenn der Name schon vergeben ist.
   *
   * `merged` in der Antwort sagt, dass zwei zu einem wurden. Die Oberfläche
   * schreibt es hin: eine Zusammenlegung, die man nicht bemerkt, ist ein
   * Datenverlust.
   */
  renameLabel: (id: string, name: string, workspace?: string) =>
    call<{ name: string; merged: boolean }>(
      `/api/labels/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ),
  removeLabel: (id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/labels/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  groups: (workspace?: string) =>
    call<{
      groups: {
        id: string;
        name: string;
        roleId: string | null;
        roleName: string | null;
        members: { userId: string; displayName: string }[];
      }[];
      mayManage: boolean;
    }>(`/api/groups${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  createGroup: (name: string, workspace?: string) =>
    call<{ id: string }>(`/api/groups${workspace === undefined ? '' : `?workspace=${workspace}`}`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  patchGroup: (id: string, body: { name?: string; roleId?: string }, workspace?: string) =>
    call<{ ok: true }>(
      `/api/groups/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  deleteGroup: (id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/groups/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  addToGroup: (id: string, userId: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/groups/${id}/members${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify({ userId }) },
    ),
  dropFromGroup: (id: string, userId: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/groups/${id}/members/${userId}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),

  /* ── Mitnehmen und wegwerfen ───────────────────────────────────────────── */
  exportWorkspace: (workspace?: string) =>
    call<Record<string, unknown>>(
      `/api/workspace/export${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  deleteWorkspace: (name: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/workspace${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE', body: JSON.stringify({ name }) },
    ),

  /* ── Einladungen ───────────────────────────────────────────────────────── */
  invitations: () =>
    call<{
      mails: boolean;
      base: string | null;
      invitations: {
        id: string;
        email: string;
        token: string | null;
        expiresAt: string;
        createdAt: string;
        acceptedAt: string | null;
      }[];
    }>('/api/invitations'),
  /**
   * Nur die Adresse — **keine URL** (ADR-0126).
   *
   * Es gibt hier absichtlich keinen Parameter, in dem ein Link stehen könnte:
   * eine Route, die eine übergebene URL verschickt, wäre ein kleiner offener
   * Verteiler mit dem Namen dieser Instanz auf dem Umschlag.
   */
  invite: (email: string) =>
    call<{ id: string; token: string; mailed: boolean }>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  revokeInvitation: (id: string) =>
    call<{ ok: true }>(`/api/invitations/${id}`, { method: 'DELETE' }),

  /* ── Eine Einladung einlösen: ohne Konto ───────────────────────────────── */
  invitation: (token: string) => call<{ email: string }>(`/api/invitation/${token}`),
  acceptInvitation: (token: string, body: { displayName: string; password: string }) =>
    call<{ ok: true }>(`/api/invitation/${token}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ── Wartung ───────────────────────────────────────────────────────────── */
  maintenance: () =>
    call<{
      kinds: string[];
      trashDays: number;
      done: { count: number; last: string | null };
      open: {
        kind: string;
        runAt: string;
        attempts: number;
        givenUp: boolean;
        lastError: string | null;
      }[];
    }>('/api/maintenance'),

  /* ── Rollen ────────────────────────────────────────────────────────────── */
  roles: (workspace?: string) =>
    call<{
      roles: {
        id: string;
        name: string;
        listLevel: 'viewer' | 'editor' | 'admin' | null;
        // Aus dem Kern statt abgeschrieben: eine zweite Liste derselben Rechte
        // ist eine Liste, die beim nächsten Recht auseinanderläuft — genau so
        // ist `groups.manage` hier hängen geblieben und der Übersetzer hat es
        // gemeldet.
        rights: Right[];
        system: boolean;
        members: number;
      }[];
      mayManage: boolean;
    }>(`/api/roles${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  createRole: (
    body: { name: string; listLevel: 'viewer' | 'editor' | 'admin' | null; rights: string[] },
    workspace?: string,
  ) =>
    call<{ role: unknown }>(`/api/roles${workspace === undefined ? '' : `?workspace=${workspace}`}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchRole: (
    id: string,
    body: {
      name?: string;
      /** `null` ist eine Angabe („keine Stufe" = Gast), Weglassen ist keine. */
      listLevel?: 'viewer' | 'editor' | 'admin' | null;
      rights?: string[];
    },
    workspace?: string,
  ) =>
    call<{ ok: true }>(
      `/api/roles/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  deleteRole: (id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/roles/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),

  /* ── Konten: die Instanzseite ──────────────────────────────────────────── */
  accounts: () =>
    call<{
      you: string;
      accounts: {
        id: string;
        email: string;
        displayName: string;
        isAdmin: boolean;
        workspaces: number;
        createdAt: string;
      }[];
    }>('/api/accounts'),
  setAdmin: (id: string, isAdmin: boolean) =>
    call<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isAdmin }),
    }),
  deleteAccount: (id: string) => call<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),

  /* ── Leute ─────────────────────────────────────────────────────────────── */
  people: (workspace?: string) =>
    call<{
      people: {
        userId: string;
        displayName: string;
        email: string;
        isOwner: boolean;
        roleId: string | null;
        roleName: string | null;
      }[];
      roles: { id: string; name: string }[];
      mayManage: boolean;
      you: string;
    }>(`/api/people${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  findPeople: (q: string, workspace?: string) => {
    const p = new URLSearchParams({ q });
    if (workspace !== undefined) p.set('workspace', workspace);
    return call<{
      found: { userId: string; displayName: string; email: string; alreadyMember: boolean }[];
    }>(`/api/people?${p}`);
  },
  addPerson: (body: { userId: string; roleId: string }, workspace?: string) =>
    call<{ ok: true }>(`/api/people${workspace === undefined ? '' : `?workspace=${workspace}`}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setRole: (userId: string, roleId: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/people/${userId}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify({ roleId }) },
    ),
  removePerson: (userId: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/people/${userId}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),

  /* ── Freigaben verwalten (mit Konto) ───────────────────────────────────── */
  shares: (workspace?: string) =>
    call<{
      possible: boolean;
      /** Ob ich hier Links anlegen, widerrufen und darum auch ablesen darf. */
      mayManage: boolean;
      shares: {
        id: string;
        projectId: string;
        projectName: string;
        right: 'read' | 'edit';
        /** `null` heißt: mit diesem Schlüssel nicht anzeigbar — oder nicht für mich. */
        token: string | null;
        expiresAt: string | null;
        lastUsedAt: string | null;
        createdAt: string;
      }[];
    }>(`/api/shares${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  createShare: (
    body: { projectId: string; right: 'read' | 'edit'; expiresAt?: string | null },
    workspace?: string,
  ) =>
    call<{ share: { id: string; token: string } }>(
      `/api/shares${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  revokeShare: (id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/shares/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),

  /* ── Was ein Gast ruft: ohne Arbeitsbereich, ohne Konto ─────────────────── */
  shareHead: (token: string) =>
    call<{ project: { name: string; icon: unknown }; right: 'read' | 'edit' }>(
      `/api/share/${token}`,
    ),
  /**
   * Die Aufgaben einer Freigabe — in DERSELBEN Form wie überall sonst.
   *
   * Hier stand eine eigene, kürzere Form mit sechs Feldern, und damit fehlten
   * dem Gast alle Angaben, die seitdem an einer Aufgabe dazugekommen sind. Es
   * ist dieselbe Abfrage im Server, also war die Kürzung nie eine Ersparnis —
   * nur eine zweite Antwort, die niemand nachzog.
   */
  shareTasks: (token: string, done: boolean) =>
    call<{ tasks: Task[]; children: Record<string, Task[]> }>(
      `/api/share/${token}/tasks${done ? '?done=1' : ''}`,
    ),
  /**
   * Eine Aufgabe in einer Freigabe umsortieren oder umhängen.
   *
   * Ein Gast mit Bearbeitungsrecht DARF das: „Er hat Bearbeitungsrechte, das
   * gehört dazu." Eine Freigabe, in der man anlegen und abhaken, aber nicht
   * ordnen darf, wäre eine halbe Erlaubnis.
   *
   * Die Grenze zieht der Server: Ziel und Nachbarn müssen zu DIESER Freigabe
   * gehören, sonst 403.
   */
  shareMove: (
    token: string,
    id: string,
    /* DIESELBEN Namen wie beim Mitglied (`afterId`/`beforeId`): zwei
       Schreibweisen für dieselbe Angabe waren genau der Fehler, der jeden Zug
       nach ganz oben schickte. */
    wohin: { afterId?: string | null; beforeId?: string | null; parentId?: string | null },
  ) =>
    call<{ task: Task }>(`/api/share/${token}/tasks/${id}/move`, {
      method: 'PUT',
      body: JSON.stringify(wohin),
    }),
  /**
   * Eine Datei an eine Aufgabe in einer Freigabe.
   *
   * GEMELDET: „Datei-Uploads gehen nicht, sollte aber, das gehört dazu."
   * Derselbe Weg wie beim Mitglied, nur unter dem Freigabe-Schlüssel — mit
   * Fortschritt und kleiner Fassung, weil beides zur Sache gehört und nicht
   * zum Konto.
   */
  shareAddFile: async (
    token: string,
    taskId: string,
    file: File,
    onProgress?: (anteil: number) => void,
    web?: Blob | undefined,
  ): Promise<{ file: { id: string; filename: string } }> => {
    const out = await new Promise<{ file: { id: string; filename: string } }>(
      (fertig, schiefgegangen) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `/api/share/${token}/tasks/${taskId}/files?name=${encodeURIComponent(file.name)}`,
        );
        xhr.setRequestHeader(
          'content-type',
          file.type === '' ? 'application/octet-stream' : file.type,
        );
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress !== undefined) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              fertig(JSON.parse(xhr.responseText) as { file: { id: string; filename: string } });
            } catch {
              schiefgegangen(new ApiError(xhr.status, 'bad_json', 'Die Antwort war unverständlich.'));
            }
            return;
          }
          let sagt = 'Hochladen ging nicht.';
          try {
            sagt = (JSON.parse(xhr.responseText) as { message?: string }).message ?? sagt;
          } catch {
            // Dann bleibt der Satz oben.
          }
          schiefgegangen(new ApiError(xhr.status, 'upload_failed', sagt));
        };
        xhr.onerror = () => schiefgegangen(new ApiError(0, 'network', 'Die Verbindung brach ab.'));
        xhr.send(file);
      },
    );
    if (web !== undefined) {
      try {
        await fetch(`/api/share/${token}/tasks/${taskId}/files/${out.file.id}/web`, {
          method: 'PUT',
          body: web,
        });
      } catch {
        // Ohne kleine Fassung wird das Original gezeigt — langsamer, richtig.
      }
    }
    return out;
  },
  shareRemoveFile: (token: string, taskId: string, fileId: string) =>
    call<{ ok: boolean }>(`/api/share/${token}/tasks/${taskId}/files/${fileId}`, {
      method: 'DELETE',
    }),
  shareFileHref: (token: string, taskId: string, fileId: string, size?: 'web') =>
    `/api/share/${token}/tasks/${taskId}/files/${fileId}${size === undefined ? '' : '?size=web'}`,
  shareAdd: (token: string, line: string) =>
    /** `unknownAssignees`: ein `@name` weist als Gast niemanden zu — er wird genannt. */
    call<{ id: string; title: string; unknownAssignees: string[] }>(`/api/share/${token}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ line }),
    }),
  shareComplete: (token: string, id: string) =>
    call<{ ok: true }>(`/api/share/${token}/tasks/${id}/complete`, { method: 'POST' }),
  shareReopen: (token: string, id: string) =>
    call<{ ok: true }>(`/api/share/${token}/tasks/${id}/complete`, { method: 'DELETE' }),

  /*
   * Die Detailspalte eines Gasts — vier Wege, dieselben wie beim Mitglied.
   *
   * Ohne Arbeitsbereich: der Token sagt schon, worum es geht. Und was ein Gast
   * ändern darf, entscheidet der Server (eine Auswahlliste in `shareRoutes`) —
   * ein Client, der seine Rechte selbst kennt, ist keine Rechteprüfung.
   */
  shareDetail: (token: string, id: string) =>
    call<Detail>(`/api/share/${token}/tasks/${id}`),
  sharePatch: (token: string, id: string, fields: Record<string, unknown>) =>
    call<{ ok: true }>(`/api/share/${token}/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),
  shareAddChild: (token: string, id: string, title: string) =>
    call<unknown>(`/api/share/${token}/tasks/${id}/children`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  shareAddComment: (token: string, id: string, body: string, parentId?: string | null) =>
    call<unknown>(`/api/share/${token}/tasks/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, parentId: parentId ?? null }),
    }),

  /*
   * MIT dem Arbeitsbereich — beides, Lesen und Schreiben.
   *
   * Gemeldet: „Wenn ich einen neuen Workspace anlege und dort die Akzentfarbe
   * ändere, dann ändert sich auch die Akzentfarbe von allen anderen." Der
   * Server entscheidet die Ebene „Arbeitsbereich" nach `?workspace=`, und
   * ohne den Parameter nimmt er den ERSTEN, in dem man Mitglied ist. Diese
   * beiden Aufrufe schickten ihn nie mit: „Arbeitsbereich" hieß hier in
   * Wahrheit immer derselbe, egal wo man stand. Jede andere Route bekommt ihn;
   * diese zwei hatte ich beim Bauen der Einstellungen vergessen, als es nur
   * einen Arbeitsbereich gab — und dann konnte es niemandem auffallen.
   */
  settings: (workspace?: string) =>
    call<SettingsAnswer>(`/api/settings${workspace === undefined ? '' : `?workspace=${workspace}`}`),
  /** `null` bei einem Feld heißt „nichts gesagt" — die Ebene darüber gilt. */
  patchSettings: (
    scope: 'instance' | 'workspace' | 'user',
    body: Record<string, unknown>,
    workspace?: string,
  ) =>
    call<{ settings: SettingsAnswer['levels']['user'] }>(
      `/api/settings/${scope}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  projects: (workspace?: string) =>
    call<{ projects: Project[] }>(
      `/api/projects${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  createProject: (
    body: {
      name: string;
      parentId?: string | null;
      color?: string | null;
      /**
       * Ordner oder Projekt.
       *
       * Fehlt sie, entscheidet der Server nach dem Ort: ganz oben ein Ordner,
       * darunter ein Projekt. Die Oberfläche gibt sie trotzdem immer mit —
       * „Unterordner anlegen" und „Projekt anlegen" sind zwei Einträge im
       * Menü, und keiner davon soll auf eine Vermutung angewiesen sein.
       */
      kind?: 'folder' | 'list';
    },
    workspace?: string,
  ) =>
    call<{ project: Project }>(
      `/api/projects${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  patchProject: (
    id: string,
    body: {
      name?: string;
      color?: string | null;
      parentId?: string | null;
      /** `null` leert das Zeichen, ein fehlender Schlüssel lässt es stehen. */
      icon?: { icon?: string; iconColor?: string; titleColor?: string } | null;
      /** Fertig gerechnet: nur die Oberfläche kennt die Nachbarn. */
      sortKey?: string;
    },
    workspace?: string,
  ) =>
    call<{ project: Project }>(
      `/api/projects/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  /**
   * Eine Aufgabe aus einer Zeile.
   *
   * `projectId` ist die **Herkunft des Bildschirms**, nicht eine Angabe aus der
   * Zeile: wer in einem Projekt tippt, meint dieses Projekt. Ein `+projekt` in
   * der Zeile gewinnt trotzdem — das ist eine Ansage, das hier nur ein Ort.
   */
  createTask: (
    line: string,
    workspace?: string,
    projectId?: string,
    /** Wer als Pille im Feld stand — Konto-Ids, keine Namen. */
    assigneeIds?: readonly string[],
  ) =>
    call<{
      task: Task;
      unknownProject: string | null;
      ambiguousProject: string | null;
    /** Der Name gehört einem Ordner — der trägt keine Aufgaben. */
    folderProject: string | null;
      unknownAssignees: string[];
      ambiguousAssignees: string[];
    }>(`/api/tasks${workspace === undefined ? '' : `?workspace=${workspace}`}`, {
      method: 'POST',
      body: JSON.stringify({
        line,
        ...(projectId === undefined ? {} : { projectId }),
        ...(assigneeIds === undefined || assigneeIds.length === 0 ? {} : { assigneeIds }),
      }),
    }),
  trash: (kind: 'tasks' | 'projects', id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/${kind}/${id}/trash${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST' },
    ),
  /** `projectId` weglassen heißt „zurück, wohin es gehörte". */
  restore: (
    kind: 'tasks' | 'projects',
    id: string,
    body: { projectId?: string | null },
    workspace?: string,
  ) =>
    call<{ ok: true }>(
      `/api/${kind}/${id}/restore${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  purge: (kind: 'tasks' | 'projects', id: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/${kind}/${id}/purge${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST' },
    ),
  listTrash: (kind: 'task' | 'project', workspace?: string) => {
    const q = new URLSearchParams({ kind });
    if (workspace !== undefined) q.set('workspace', workspace);
    return call<{ kind: string; entries: TrashEntry[] }>(`/api/trash?${q}`);
  },
  /** Eine Erinnerung setzen. Antwortet mit dem ganzen Detail — eine Antwort
      statt zweier Abrufe. */
  addReminder: (
    id: string,
    body: { minutes: number } | { at: string },
    workspace?: string,
  ) =>
    call<Detail>(
      `/api/tasks/${id}/reminders${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** Und wegnehmen — nur die eigene, das prüft der Server. */
  removeReminder: (id: string, reminderId: string, workspace?: string) =>
    call<Detail>(
      `/api/tasks/${id}/reminders/${reminderId}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  /**
   * Einen Anhang hochladen — rohe Bytes, wie beim Profilbild.
   *
   * Der Name reist als Abfrageparameter, weil der Körper die Datei IST. Kein
   * Multipart: das wäre ein Parser für einen Vorteil, den niemand sieht.
   */
  /**
   * Eine Datei anhängen — mit Fortschritt und kleiner Fassung.
   *
   * GEMELDET: „Uploads könnten einen Ladebalken vertragen und andeuten, wenn
   * sie fertig sind."
   *
   * Darum `XMLHttpRequest` statt `fetch`: `fetch` kennt keinen Fortschritt
   * beim SENDEN. Es gibt inzwischen einen Weg über Streams, und er ist in
   * Safari nicht da — für eine Anzeige, die gerade dort am nötigsten ist (dort
   * lädt man vom Telefon hoch).
   *
   * ZWEI AUFRUFE: erst das Original, dann die kleine Fassung. Der Upload trägt
   * rohe Bytes; zwei Dateien in einem Körper brauchten ein Format, das sagt,
   * wo die eine aufhört. Scheitert der zweite, liegt der Anhang trotzdem da —
   * ohne Vorschau, aber vollständig.
   */
  addFile: async (
    id: string,
    file: File,
    workspace?: string,
    onProgress?: (anteil: number) => void,
    web?: Blob | undefined,
  ): Promise<{ file: { id: string; filename: string } }> => {
    const p = new URLSearchParams({ name: file.name });
    if (workspace !== undefined) p.set('workspace', workspace);

    const out = await new Promise<{ file: { id: string; filename: string } }>(
      (fertig, schiefgegangen) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/tasks/${id}/files?${p}`);
        xhr.withCredentials = true;
        xhr.setRequestHeader(
          'content-type',
          file.type === '' ? 'application/octet-stream' : file.type,
        );
        /*
         * `lengthComputable` prüfen: bei einer Übertragung ohne bekannte Länge
         * ist `total` null, und `geladen / 0` wäre `Infinity` — ein Balken, der
         * sofort voll ist und dann stehenbleibt.
         */
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress !== undefined) {
            onProgress(e.loaded / e.total);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              fertig(JSON.parse(xhr.responseText) as { file: { id: string; filename: string } });
            } catch {
              schiefgegangen(new ApiError(xhr.status, 'bad_json', 'Die Antwort war unverständlich.'));
            }
            return;
          }
          let sagt = 'Hochladen ging nicht.';
          let code = 'upload_failed';
          try {
            const j = JSON.parse(xhr.responseText) as { error?: string; message?: string };
            sagt = j.message ?? sagt;
            code = j.error ?? code;
          } catch {
            // Keine Antwort im erwarteten Format: dann bleibt der Satz oben.
          }
          schiefgegangen(new ApiError(xhr.status, code, sagt));
        };
        xhr.onerror = () =>
          schiefgegangen(new ApiError(0, 'network', 'Die Verbindung brach ab.'));
        xhr.send(file);
      },
    );

    if (web !== undefined) {
      try {
        await fetch(
          `/api/tasks/${id}/files/${out.file.id}/web${
            workspace === undefined ? '' : `?workspace=${workspace}`
          }`,
          { method: 'PUT', body: web, credentials: 'same-origin' },
        );
      } catch {
        // Ohne kleine Fassung wird ueberall das Original gezeigt — langsamer,
        // aber richtig. Ein Anhang, der wegen seines Vorschaubilds scheitert,
        // waere die schlechteste Art, eine Verbesserung einzubauen.
      }
    }
    return out;
  },
  removeFile: (id: string, fileId: string, workspace?: string) =>
    call<{ ok: true }>(
      `/api/tasks/${id}/files/${fileId}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  /** Wo ein Anhang liegt. Ein Link und kein Abruf: der Browser lädt ihn. */
  fileHref: (id: string, fileId: string, workspace?: string, size?: 'web') => {
    const q = new URLSearchParams();
    if (workspace !== undefined) q.set('workspace', workspace);
    // `?size=web` ist eine Bitte: gibt es keine kleine Fassung, kommt das
    // Original.
    if (size !== undefined) q.set('size', size);
    const s = q.toString();
    return `/api/tasks/${id}/files/${fileId}${s === '' ? '' : `?${s}`}`;
  },
  /**
   * Alle Aufgaben mit Zeitpunkt in einem Fenster — für den Kalender. Die
   * Grenzen als Augenblicke: der Browser rechnet seine Tage in seiner Zone.
   */
  calendarSources: () => call<{ possible: boolean; max: number; feeds: CalendarSource[] }>('/api/calendar-sources'),
  calendarAccounts: () => call<{providers:Record<'google'|'microsoft',{ready:boolean;callback:string|null}>;accounts:{id:string;provider:'google'|'microsoft';label:string;lastError:string|null}[]}>('/api/calendar-accounts'),
  authorizeCalendarAccount: (provider:'google'|'microsoft') => call<{url:string}>(`/api/calendar-accounts/${provider}/authorize`,{method:'POST',body:'{}'}),
  cloudCalendars: (id:string) => call<{calendars:{id:string;name:string;writable:boolean}[]}>(`/api/calendar-accounts/${id}/calendars`),
  connectCloudCalendar: (id:string,body:{calendarId:string;name:string}) => call<{id:string}>(`/api/calendar-accounts/${id}/calendars`,{method:'POST',body:JSON.stringify(body)}),
  removeCalendarAccount: (id:string) => call<{ok:true}>(`/api/calendar-accounts/${id}`,{method:'DELETE'}),
  saveCalendarWriter: (id: string, body: CalendarWriterInput) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/writer`, { method: 'PUT', body: JSON.stringify(body) }),
  discoverICloudCalendars: (id: string, body: { username: string; password: string }) =>
    call<{ calendars: { url: string; name: string }[] }>(`/api/calendar-sources/${id}/writer/icloud`, { method: 'POST', body: JSON.stringify(body) }),
  syncCalendarWriter: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/writer/sync`, { method: 'POST' }),
  pauseCalendarWriter: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/writer/pause`, { method: 'POST' }),
  resolveCalendarWriter: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/writer/resolve`, { method: 'POST' }),
  disconnectCalendarWriter: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/writer`, { method: 'DELETE' }),
  discoverCalendars: (body: { provider: 'icloud' | 'caldav'; url?: string; username: string; password: string }) =>
    call<{ calendars: { url: string; name: string; writable: boolean | null }[] }>('/api/calendar-sources/discover', { method: 'POST', body: JSON.stringify(body) }),
  addCalendarSource: (body: CalendarSourceFields & { url: string; kind?: 'ics' | 'caldav'; username?: string; password?: string }) =>
    call<CalendarSource>('/api/calendar-sources', { method: 'POST', body: JSON.stringify(body) }),
  patchCalendarSource: (id: string, body: CalendarSourceFields) =>
    call<CalendarSource>(`/api/calendar-sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeCalendarSource: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}`, { method: 'DELETE' }),
  refreshCalendarSource: (id: string) =>
    call<{ ok: true }>(`/api/calendar-sources/${id}/refresh`, { method: 'POST' }),
  span: (from: Date, to: Date, workspace: string | null, done = false) =>
    call<{
      tasks: (Task & { workspaceId: string })[];
      events: SpanEvent[];
      workspaces: { id: string; name: string; icon: { icon?: string; iconColor?: string } | null }[];
    }>(
      `/api/span?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${
        done ? '&done=1' : ''
      }${workspace === null ? '' : `&workspace=${workspace}`}`,
    ),
  detail: (id: string, workspace?: string) =>
    call<Detail>(
      `/api/tasks/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  addChild: (id: string, title: string, workspace?: string) =>
    call<{ task: Task }>(
      `/api/tasks/${id}/children${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify({ title }) },
    ),
  addComment: (id: string, body: string, workspace?: string, parentId?: string | null) =>
    call<{ comment: Comment }>(
      `/api/tasks/${id}/comments${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify({ body, parentId: parentId ?? null }) },
    ),
  /** Den Haken zurücknehmen — DELETE auf denselben Weg, nicht POST auf einen zweiten. */
  reopen: (id: string, workspace?: string) =>
    call<{ task: Task }>(
      `/api/tasks/${id}/complete${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'DELETE' },
    ),
  complete: (id: string, workspace?: string) =>
    call<{ completed: Task; next: Task | null }>(
      `/api/tasks/${id}/complete${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST' },
    ),
};
