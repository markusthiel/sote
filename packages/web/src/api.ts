/**
 * SOTE — der Weg zum Server.
 *
 * Eine Stelle, die `fetch` aufruft, damit „nicht angemeldet" und „Server weg"
 * genau einmal unterschieden werden. Jeder Fehler des Servers trägt einen
 * maschinenlesbaren Grund; der wird durchgereicht und nicht in „ging nicht"
 * übersetzt.
 */

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
  workspaces: {
    id: string;
    name: string;
    /** Dieselbe Form wie beim Projekt, plus `titleColor` für den Namen. */
    icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
    owner: boolean;
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
  sortKey: string;
}

/** Was gilt, und wer was gesagt hat — beides in einer Antwort. */
import type { Landing, Look, Right } from '@sote/core';

interface Level {
  scheme?: 'system' | 'light' | 'dark';
  zone?: string;
  look?: Look;
  landing?: Landing;
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
  /** Dieselbe Form wie SONEs `pages.icon`. `null`, wenn nichts gewählt ist. */
  icon: { icon?: string; iconColor?: string } | null;
  /** Ordner ordnen, Projekte halten (Konzept 10d). */
  kind: 'folder' | 'list';
  /** Tiefe im Baum, vom Server gerechnet. */
  depth?: number;
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
}

export interface Detail {
  task: Task;
  projectName: string | null;
  children: Task[];
  comments: Comment[];
  assignees: { userId: string | null; name: string | null; guestKey: string | null }[];
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
  projectId?: string | null;
}

export const api = {
  /** Braucht diese Instanz noch ein erstes Konto? */
  setupNeeded: () => call<{ needed: boolean }>('/api/setup'),
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
    return call<{ view: string; overdue: Task[]; tasks: Task[] }>(`/api/tasks?${q}`);
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
    between: { afterId: string | null; beforeId: string | null },
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
  /* ── Gruppen ───────────────────────────────────────────────────────────── */
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
      shares: {
        id: string;
        projectId: string;
        projectName: string;
        right: 'read' | 'edit';
        /** `null` heißt: mit diesem Schlüssel nicht anzeigbar. */
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
  shareTasks: (token: string, done: boolean) =>
    call<{
      tasks: {
        id: string;
        title: string;
        completed: string | null;
        plannedAt: string | null;
        dueAt: string | null;
        priority: number;
      }[];
    }>(`/api/share/${token}/tasks${done ? '?done=1' : ''}`),
  shareAdd: (token: string, line: string) =>
    call<{ id: string; title: string }>(`/api/share/${token}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ line }),
    }),
  shareComplete: (token: string, id: string) =>
    call<{ ok: true }>(`/api/share/${token}/tasks/${id}/complete`, { method: 'POST' }),
  shareReopen: (token: string, id: string) =>
    call<{ ok: true }>(`/api/share/${token}/tasks/${id}/complete`, { method: 'DELETE' }),

  settings: () => call<SettingsAnswer>('/api/settings'),
  /** `null` bei einem Feld heißt „nichts gesagt" — die Ebene darüber gilt. */
  patchSettings: (
    scope: 'instance' | 'workspace' | 'user',
    body: Record<string, unknown>,
  ) => call<{ settings: SettingsAnswer['levels']['user'] }>(`/api/settings/${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
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
      icon?: { icon?: string; iconColor?: string } | null;
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
   * Zeile: wer in einem Projekt tippt, meint dieses Projekt. Ein `#projekt` in
   * der Zeile gewinnt trotzdem — das ist eine Ansage, das hier nur ein Ort.
   */
  createTask: (line: string, workspace?: string, projectId?: string) =>
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
  detail: (id: string, workspace?: string) =>
    call<Detail>(
      `/api/tasks/${id}${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  addChild: (id: string, title: string, workspace?: string) =>
    call<{ task: Task }>(
      `/api/tasks/${id}/children${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify({ title }) },
    ),
  addComment: (id: string, body: string, workspace?: string) =>
    call<{ comment: Comment }>(
      `/api/tasks/${id}/comments${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST', body: JSON.stringify({ body }) },
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
