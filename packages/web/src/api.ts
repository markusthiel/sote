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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
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
  workspaces: { id: string; name: string }[];
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

export interface Project {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
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
  signIn: (email: string, password: string) =>
    call<{ ok: true }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signOut: () => call<{ ok: true }>('/api/session', { method: 'DELETE' }),
  me: () => call<Me>('/api/me'),
  /** Eine Ansicht. `overdue` ist nur bei `today` gefüllt. */
  tasks: (
    view: 'today' | 'upcoming' | 'someday' | 'project',
    opts: { workspace?: string; project?: string } = {},
  ) => {
    const q = new URLSearchParams({ view });
    if (opts.workspace !== undefined) q.set('workspace', opts.workspace);
    if (opts.project !== undefined) q.set('project', opts.project);
    return call<{ view: string; overdue: Task[]; tasks: Task[] }>(`/api/tasks?${q}`);
  },
  counts: (workspace?: string) =>
    call<{ today: number; upcoming: number; someday: number; overdue: number }>(
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
  projects: (workspace?: string) =>
    call<{ projects: Project[] }>(
      `/api/projects${workspace === undefined ? '' : `?workspace=${workspace}`}`,
    ),
  createTask: (line: string, workspace?: string) =>
    call<{
      task: Task;
      unknownProject: string | null;
      unknownAssignees: string[];
    }>(`/api/tasks${workspace === undefined ? '' : `?workspace=${workspace}`}`, {
      method: 'POST',
      body: JSON.stringify({ line }),
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
  complete: (id: string, workspace?: string) =>
    call<{ completed: Task; next: Task | null }>(
      `/api/tasks/${id}/complete${workspace === undefined ? '' : `?workspace=${workspace}`}`,
      { method: 'POST' },
    ),
};
