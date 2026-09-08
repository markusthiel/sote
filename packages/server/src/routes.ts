/**
 * SOTE — die Routen.
 *
 * Eine Route übersetzt HTTP und entscheidet nichts. Was Abhaken bedeutet, steht
 * in `tasks.ts`; was eine Zeile bedeutet, in `@sote/core`. Diese Datei prüft
 * Zugriff, liest Parameter und gibt Gründe zurück.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { describe as describeRecurrence, isZone, readIcon } from '@sote/core';
import type { Pool } from 'pg';

import { signIn, signOut, userOfToken } from './auth.js';
import {
  BadSetupKey,
  SetupClosed,
  setupFirstAccount,
  userCount,
  type SetupKey,
} from './bootstrap.js';
import { addChild, addComment, detail } from './detail.js';
import { effectiveFor, mayChange, patchSettings, type Scope } from './settings.js';
import { queryOne, queryRows } from './db.js';
import { create as createProject, NameTaken, update as updateProject } from './projects.js';
import type { Config } from './env.js';
import { cookie, fail, json, readJson } from './http/respond.js';
import { makeStatic } from './http/static.js';
import {
  complete,
  reopen,
  createFromLine,
  listTrash,
  move,
  NeedsTarget,
  NotFound,
  OutOfOrder,
  patch,
  purge,
  recurrenceOf,
  restore,
  trash,
  type TaskRow,
  type TrashKind,
} from './tasks.js';
import { search } from './search.js';
import { counts, list, splitOverdue, type ViewId } from './views.js';

const COOKIE = 'sote_session';
const VIEWS: readonly ViewId[] = ['today', 'upcoming', 'someday', 'inbox', 'project'];

/**
 * Aus dem Körper einer PATCH-Anfrage die genannten Felder — und nur die.
 *
 * `undefined` heißt „nicht angefasst", `null` heißt „leeren". Ein Körper, der
 * ein Feld nicht nennt, darf es nicht auf null setzen; genau deshalb wird hier
 * auf Anwesenheit des Schlüssels geprüft und nicht auf Wahrheit des Werts.
 */
function readPatch(body: Record<string, unknown>): import('./tasks.js').Patch {
  const out: Record<string, unknown> = {};
  const date = (v: unknown) => (v === null ? null : new Date(String(v)));
  if ('title' in body) out['title'] = String(body['title']);
  if ('note' in body) out['note'] = String(body['note']);
  if ('planned' in body) out['plannedAt'] = date(body['planned']);
  if ('plannedAllDay' in body) out['plannedAllDay'] = body['plannedAllDay'] === true;
  if ('due' in body) out['dueAt'] = date(body['due']);
  if ('dueAllDay' in body) out['dueAllDay'] = body['dueAllDay'] === true;
  if ('priority' in body) out['priority'] = Number(body['priority']);
  if ('projectId' in body) {
    out['projectId'] = body['projectId'] === null ? null : String(body['projectId']);
  }
  return out as import('./tasks.js').Patch;
}

/** Was die Oberfläche von einer Aufgabe braucht. Nicht die Zeile. */
function taskView(row: TaskRow) {
  const rec = recurrenceOf(row);
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    note: row.note,
    planned: row.planned_at?.toISOString() ?? null,
    plannedAllDay: row.planned_all_day,
    due: row.due_at?.toISOString() ?? null,
    dueAllDay: row.due_all_day,
    priority: row.priority,
    completed: row.completed_at?.toISOString() ?? null,
    // Der Satz kommt aus `core`, damit die Oberfläche ihn nicht nachbaut und
    // irgendwann etwas anderes behauptet als die Regel tut (Blatt 08).
    recurrence: rec === undefined ? null : { kind: rec.kind, says: describeRecurrence(rec) },
    sortKey: row.sort_key,
  };
}

interface Ctx {
  readonly pool: Pool;
  readonly config: Config;
  readonly now: () => Date;
  /** Wurzel der gebauten Oberfläche. Fehlt sie, ist es nur eine API. */
  readonly webRoot?: string | undefined;
  /** Fehlt in Tests, die die Einrichtung nicht betreffen. */
  readonly setup?: SetupKey | undefined;
}

/** Der Arbeitsbereich, in dem diese Person Mitglied ist. */
async function memberWorkspace(
  ctx: Ctx,
  userId: string,
  wanted: string | null,
): Promise<string | null> {
  if (wanted !== null) {
    const row = await queryOne<{ workspace_id: string }>(
      ctx.pool,
      `SELECT m.workspace_id FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
        WHERE m.user_id = $1 AND m.workspace_id = $2`,
      [userId, wanted],
    );
    return row?.workspace_id ?? null;
  }
  const first = await queryOne<{ workspace_id: string }>(
    ctx.pool,
    `SELECT m.workspace_id FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE m.user_id = $1 ORDER BY w.created_at LIMIT 1`,
    [userId],
  );
  return first?.workspace_id ?? null;
}

/** Der Auslieferer wird pro Wurzel einmal gebaut, nicht pro Anfrage. */
const servers = new Map<string, ReturnType<typeof makeStatic>>();
function serveFrom(root: string) {
  const found = servers.get(root);
  if (found !== undefined) return found;
  const made = makeStatic(root);
  servers.set(root, made);
  return made;
}

export function makeServer(ctx: Ctx): Server {
  return createServer((req, res) => {
    handle(ctx, req, res).catch((e: unknown) => {
      if (e instanceof NotFound) {
        fail(res, 404, 'not_found', e.message);
        return;
      }
      if (e instanceof SetupClosed) {
        // 410 und nicht 404: die Einrichtung gab es, sie ist vorbei. Ein 404
        // ließe offen, ob der Weg je existiert hat.
        fail(res, 410, 'setup_done', e.message);
        return;
      }
      if (e instanceof BadSetupKey) {
        fail(res, 401, 'bad_setup_key', e.message);
        return;
      }
      if (e instanceof NeedsTarget) {
        // Eine eigene Sorte Ablehnung: die Oberfläche soll nach einem Ziel
        // fragen und nicht „ging nicht" anzeigen.
        fail(res, 409, 'needs_target', e.message);
        return;
      }
      if (e instanceof NameTaken) {
        fail(res, 409, 'name_taken', e.message);
        return;
      }
      if (e instanceof OutOfOrder) {
        // Eine Ablehnung mit Grund, kein 500: der Aufrufer hat etwas
        // Widersprüchliches geschickt, nicht der Server etwas falsch gemacht.
        fail(res, 409, 'conflict', e.message);
        return;
      }
      console.error('unbehandelt:', e);
      if (!res.headersSent) fail(res, 500, 'internal', 'unerwarteter Fehler');
    });
  });
}

async function handle(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://sote.invalid');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const now = ctx.now();

  /*
   * Die Zeitzone der Person, aus der Anfrage.
   *
   * Der Container steht auf UTC, und das ist richtig — eine Instanz, die für
   * Leute in drei Zeitzonen läuft, kann keine eigene haben. Die Zone kommt
   * darum vom Browser, der sie kennt (`Intl…resolvedOptions().timeZone`), und
   * wird **geprüft statt geglaubt**: was die Laufzeit nicht als Zone erkennt,
   * ist ein Tippfehler und wird zu UTC.
   *
   * Ohne Angabe bleibt es UTC — genau das Verhalten von vorher, also ändert
   * sich für einen alten Aufrufer nichts.
   */
  const askedZone = url.searchParams.get('tz');
  const zone = askedZone !== null && isZone(askedZone) ? askedZone : 'UTC';

  if (!path.startsWith('/api/')) {
    if (ctx.webRoot === undefined) {
      fail(res, 404, 'no_web', 'diese Instanz liefert keine Oberfläche aus');
      return;
    }
    const served = await serveFrom(ctx.webRoot)(path, res);
    if (!served) fail(res, 404, 'no_file', `${path} gibt es nicht`);
    return;
  }

  if (path === '/api/health') {
    json(res, 200, { ok: true });
    return;
  }

  /* ── Anmelden ─────────────────────────────────────────────────────────── */

  /*
   * Die Einrichtung. Vor der Sitzungsprüfung, weil es hier noch keine gibt.
   *
   * `needed` sagt nur, ob es überhaupt kein Konto gibt — nicht, ob ein
   * Schlüssel bereitliegt. Das ist ohnehin öffentlich sichtbar: eine Instanz
   * ohne Konto zeigt eine Einrichtungsmaske. Was nicht öffentlich ist, ist der
   * Schlüssel.
   */
  if (path === '/api/setup' && method === 'GET') {
    json(res, 200, { needed: (await userCount(ctx.pool)) === 0 });
    return;
  }

  if (path === '/api/setup' && method === 'POST') {
    if (ctx.setup === undefined) {
      fail(res, 410, 'setup_done', 'diese Instanz richtet nicht ein');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : '');
    const id = await setupFirstAccount(ctx.pool, ctx.setup, str('key'), {
      email: str('email'),
      displayName: str('displayName'),
      password: str('password'),
      ...(str('workspaceName') === '' ? {} : { workspaceName: str('workspaceName') }),
    });
    // Gleich angemeldet: wer gerade sein Konto angelegt hat, soll nicht als
    // Erstes ein Anmeldeformular sehen.
    const session = await signIn(
      ctx.pool,
      str('email'),
      str('password'),
      ctx.config.sessionDays,
      now,
    );
    if (session !== null) {
      res.setHeader(
        'set-cookie',
        `${COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${
          ctx.config.sessionDays * 86_400
        }`,
      );
    }
    json(res, 201, { userId: id });
    return;
  }

  if (path === '/api/session' && method === 'POST') {
    const body = (await readJson(req)) as { email?: unknown; password?: unknown };
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (email === '' || password === '') {
      fail(res, 400, 'missing_fields', 'E-Mail und Kennwort sind nötig');
      return;
    }
    const session = await signIn(ctx.pool, email, password, ctx.config.sessionDays, now);
    if (session === null) {
      // Dieselbe Antwort für „gibt es nicht" und „falsches Kennwort".
      fail(res, 401, 'bad_credentials', 'E-Mail oder Kennwort stimmt nicht');
      return;
    }
    res.setHeader(
      'set-cookie',
      `${COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${
        ctx.config.sessionDays * 86_400
      }`,
    );
    json(res, 200, { ok: true });
    return;
  }

  const token = cookie(req.headers.cookie, COOKIE);
  const userId = token === undefined ? null : await userOfToken(ctx.pool, token, now);
  if (userId === null) {
    fail(res, 401, 'no_session', 'nicht angemeldet');
    return;
  }

  if (path === '/api/session' && method === 'DELETE') {
    if (token !== undefined) await signOut(ctx.pool, token);
    res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    json(res, 200, { ok: true });
    return;
  }

  if (path === '/api/me' && method === 'GET') {
    const me = await queryOne<{ id: string; email: string; display_name: string }>(
      ctx.pool,
      'SELECT id, email, display_name FROM users WHERE id = $1',
      [userId],
    );
    const spaces = await queryRows<{
      id: string;
      name: string;
      icon: unknown;
      is_owner: boolean;
    }>(
      ctx.pool,
      // `is_owner` kommt mit, weil die Übersicht die Rolle nennt. Vorher stand
      // dort „Eigentümer" fest — richtig, solange es ein Konto je
      // Arbeitsbereich gibt, und falsch ab der ersten Einladung.
      `SELECT w.id, w.name, w.icon, m.is_owner FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
        ORDER BY w.created_at`,
      [userId],
    );
    json(res, 200, {
      id: me?.id,
      email: me?.email,
      displayName: me?.display_name,
      workspaces: spaces.map((w) => ({
        id: w.id,
        name: w.name,
        icon: readIcon(w.icon),
        // „Eigentümer" oder „Mitglied" — mehr sagt diese Antwort nicht, weil
        // sie mehr nicht braucht. Welche Rechte eine Rolle trägt, ist eine
        // Frage an den Arbeitsbereich und nicht an das Konto.
        owner: w.is_owner,
      })),
    });
    return;
  }

  /* ── Ab hier braucht alles einen Arbeitsbereich ──────────────────────── */

  const workspaceId = await memberWorkspace(ctx, userId, url.searchParams.get('workspace'));
  if (workspaceId === null) {
    fail(res, 403, 'not_a_member', 'kein Zugriff auf diesen Arbeitsbereich');
    return;
  }

  if (path === '/api/today' && method === 'GET') {
    const rows = await list(ctx.pool, 'today', workspaceId, now);
    const sections = splitOverdue(rows, now, zone);
    json(res, 200, {
      overdue: sections.overdue.map(taskView),
      today: sections.rest.map(taskView),
    });
    return;
  }

  if (path === '/api/tasks' && method === 'GET') {
    const wanted = url.searchParams.get('view') ?? 'today';
    if (!VIEWS.includes(wanted as ViewId)) {
      fail(res, 400, 'no_view', `Ansicht „${wanted}" gibt es nicht`);
      return;
    }
    const view = wanted as ViewId;
    const projectId = url.searchParams.get('project');
    if (view === 'project' && projectId === null) {
      fail(res, 400, 'no_project', 'diese Ansicht braucht ein Projekt');
      return;
    }
    /*
     * `?done=1` blendet Erledigtes ein.
     *
     * Ein Parameter an der Abfrage und keine Einstellung am Konto: „zeig mir
     * gerade auch das Abgehakte" ist eine Frage an diese Liste in diesem
     * Moment. Was davon gemerkt wird, entscheidet der Browser — dieselbe Regel
     * wie bei der Breite der Leiste (ADR-0124).
     */
    const withDone = url.searchParams.get('done') === '1';
    const rows = await list(ctx.pool, view, workspaceId, now, projectId, zone, withDone);
    const sections = view === 'today' ? splitOverdue(rows, now, zone) : undefined;
    json(res, 200, {
      view,
      // Nur Heute trennt überfällig ab: in Demnächst wäre der Abschnitt leer,
      // und in einem Projekt beantwortet er eine Frage, die dort nicht gestellt
      // wird.
      overdue: sections === undefined ? [] : sections.overdue.map(taskView),
      tasks: (sections === undefined ? rows : sections.rest).map(taskView),
    });
    return;
  }

  if (path === '/api/search' && method === 'GET') {
    const raw = url.searchParams.get('q') ?? '';
    const out = await search(ctx.pool, workspaceId, raw, now, 100, zone);
    json(res, 200, {
      q: raw,
      // Die gelesene Abfrage kommt mit zurück, damit die Oberfläche ihre Chips
      // nicht selbst rät — dieselbe Funktion, dasselbe Ergebnis.
      read: out.query.read,
      status: out.query.status,
      tasks: out.tasks.map(taskView),
      more: out.more,
    });
    return;
  }

  /*
   * Was gilt, und wer was gesagt hat.
   *
   * Beides in einer Antwort: die Oberfläche braucht das Ergebnis, um zu
   * zeichnen, und die einzelnen Ebenen, um im Einstellungsbildschirm zu
   * zeigen, WOHER ein Wert kommt. Ein Schalter, der „dunkel" zeigt, ohne zu
   * sagen, dass der Arbeitsbereich das vorgibt, ist eine Auskunft, die zur
   * Frage wird, sobald man sie ändert und nichts passiert.
   */
  /*
   * Name und Zeichen eines Arbeitsbereichs.
   *
   * Kein `/api/workspaces/:id`, sondern der Arbeitsbereich, in dem man steht:
   * die Route liegt hinter der Mitgliedsprüfung, also ist „welcher" schon
   * beantwortet. Ein zweiter Weg, einen anderen zu benennen, wäre ein zweiter
   * Ort für dieselbe Rechteprüfung.
   */
  if (path === '/api/workspace' && method === 'PATCH') {
    if (!(await mayChange(ctx.pool, 'workspace', userId, workspaceId))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht ändern');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [workspaceId];

    if ('name' in (body ?? {})) {
      const name = String(body['name'] ?? '').trim();
      if (name === '') {
        fail(res, 400, 'conflict', 'ein Arbeitsbereich braucht einen Namen');
        return;
      }
      params.push(name.slice(0, 120));
      sets.push(`name = $${params.length}`);
    }
    if ('icon' in (body ?? {})) {
      // `null` leert, ein fehlender Schlüssel lässt stehen — dieselbe Regel
      // wie überall. `readIcon` wirft weg, was keine Form hat.
      const icon = body['icon'] === null ? null : readIcon(body['icon']);
      params.push(icon === null ? null : JSON.stringify(icon));
      sets.push(`icon = $${params.length}`);
    }
    if (sets.length === 0) {
      fail(res, 409, 'conflict', 'nichts zu ändern');
      return;
    }

    const row = await queryOne<{ id: string; name: string; icon: unknown }>(
      ctx.pool,
      `UPDATE workspaces SET ${sets.join(', ')} WHERE id = $1
        RETURNING id, name, icon`,
      params,
    );
    json(res, 200, {
      workspace: { id: row!.id, name: row!.name, icon: readIcon(row!.icon) },
    });
    return;
  }

  if (path === '/api/settings' && method === 'GET') {
    json(res, 200, await effectiveFor(ctx.pool, userId, workspaceId));
    return;
  }

  const oneScope = /^\/api\/settings\/(instance|workspace|user)$/.exec(path);
  if (oneScope && method === 'PATCH') {
    const scope = oneScope[1] as Scope;
    if (!(await mayChange(ctx.pool, scope, userId, workspaceId))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht ändern');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const scopeId = scope === 'instance' ? null : scope === 'user' ? userId : workspaceId;
    json(res, 200, { settings: await patchSettings(ctx.pool, scope, scopeId, body ?? {}) });
    return;
  }

  if (path === '/api/counts' && method === 'GET') {
    json(res, 200, await counts(ctx.pool, workspaceId, now, zone));
    return;
  }

  if (path === '/api/projects' && method === 'GET') {
    /*
     * Tiefensuche, nicht global nach Sortierschlüssel.
     *
     * Die erste Fassung sortierte über alle Ebenen hinweg, also standen
     * Unterprojekte vor ihren Eltern. Die Oberfläche baut den Baum selbst und
     * lag damit richtig — ein globaler Sort erhält die Reihenfolge innerhalb
     * jedes Geschwisterkreises —, aber eine Liste, deren Reihenfolge nur
     * zufällig brauchbar ist, lädt den nächsten Aufrufer zum Fehler ein. Jetzt
     * kommt sie in Baumreihenfolge und trägt ihre Tiefe mit.
     */
    const rows = await queryRows<{
      id: string;
      parent_id: string | null;
      name: string;
      color: string | null;
      icon: unknown;
      kind: 'folder' | 'list';
      depth: number;
      open: string;
    }>(
      ctx.pool,
      `WITH RECURSIVE walk AS (
         SELECT p.id, p.parent_id, p.name, p.color, p.icon, p.kind, p.sort_key,
                0 AS depth, ARRAY[p.sort_key] AS path
           FROM projects p
          WHERE p.workspace_id = $1 AND p.parent_id IS NULL AND p.trashed_at IS NULL
         UNION ALL
         SELECT c.id, c.parent_id, c.name, c.color, c.icon, c.kind, c.sort_key,
                w.depth + 1, w.path || c.sort_key
           FROM projects c JOIN walk w ON c.parent_id = w.id
          WHERE c.workspace_id = $1 AND c.trashed_at IS NULL
       )
       SELECT w.id, w.parent_id, w.name, w.color, w.icon, w.kind, w.depth,
              count(t.id) FILTER (
                WHERE t.completed_at IS NULL AND t.trashed_at IS NULL
              ) AS open
         FROM walk w
         LEFT JOIN tasks t ON t.project_id = w.id
        GROUP BY w.id, w.parent_id, w.name, w.color, w.icon, w.kind, w.depth, w.path
        ORDER BY w.path`,
      [workspaceId],
    );
    json(res, 200, {
      projects: rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        color: r.color,
        icon: readIcon(r.icon),
        kind: r.kind,
        depth: r.depth,

        // Keine Null: eine Zahl über nichts ist Rauschen in einer ruhigen
        // Zeile (SONE, ADR-0092).
        open: Number(r.open) === 0 ? null : Number(r.open),
      })),
    });
    return;
  }

  /*
   * Eine Projektzeile, wie die Oberfläche sie braucht.
   *
   * `open: null` weil eine gerade angelegte Zeile keine offenen Aufgaben hat —
   * und keine Null, weil eine Zahl über nichts Rauschen ist.
   */
  const projectView = (row: {
    id: string;
    parent_id: string | null;
    name: string;
    color: string | null;
    icon: unknown;
    kind: 'folder' | 'list';
  }) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: readIcon(row.icon),
    kind: row.kind,
    depth: 0,
    open: null,
  });

  if (path === '/api/projects' && method === 'POST') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const row = await createProject(ctx.pool, workspaceId, {
      name: typeof body?.['name'] === 'string' ? body['name'] : '',
      ...('parentId' in (body ?? {})
        ? { parentId: body['parentId'] === null ? null : String(body['parentId']) }
        : {}),
      ...('color' in (body ?? {})
        ? { color: body['color'] === null ? null : String(body['color']) }
        : {}),
      ...('icon' in (body ?? {}) ? { icon: body['icon'] } : {}),
      ...(body?.['kind'] === 'folder' || body?.['kind'] === 'list'
        ? { kind: body['kind'] }
        : {}),
    });
    json(res, 201, { project: projectView(row) });
    return;
  }

  const oneProject = /^\/api\/projects\/([0-9a-f-]{36})$/.exec(path);
  if (oneProject && method === 'PATCH') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const row = await updateProject(ctx.pool, oneProject[1]!, workspaceId, {
      ...('name' in (body ?? {}) ? { name: String(body['name']) } : {}),
      ...('color' in (body ?? {})
        ? { color: body['color'] === null ? null : String(body['color']) }
        : {}),
      ...('parentId' in (body ?? {})
        ? { parentId: body['parentId'] === null ? null : String(body['parentId']) }
        : {}),
      ...('icon' in (body ?? {}) ? { icon: body['icon'] } : {}),
    });
    json(res, 200, { project: projectView(row) });
    return;
  }

  if (path === '/api/tasks' && method === 'POST') {
    const body = (await readJson(req)) as { line?: unknown; projectId?: unknown };
    const line = typeof body?.line === 'string' ? body.line : '';
    if (line.trim() === '') {
      fail(res, 400, 'empty_line', 'ohne Text keine Aufgabe');
      return;
    }
    const out = await createFromLine(ctx.pool, {
      zone,
      workspaceId,
      userId,
      line,
      now,
      projectId: typeof body?.projectId === 'string' ? body.projectId : null,
    });
    json(res, 201, {
      task: taskView(out.task),
      // Gemeldet, nicht erfunden: die Oberfläche kann sagen „Projekt
      // steuer2025 gibt es nicht — anlegen?"
      unknownProject: out.unknownProject ?? null,
      ambiguousProject: out.ambiguousProject ?? null,
      // Die fuenfte Meldung: der Name gehoert einem Ordner (Konzept 10d).
      folderProject: out.folderProject ?? null,
      unknownAssignees: out.unknownAssignees,
      ambiguousAssignees: out.ambiguousAssignees,
    });
    return;
  }

  const completePath = /^\/api\/tasks\/([0-9a-f-]{36})\/complete$/.exec(path);
  /*
   * DELETE auf denselben Weg, nicht POST auf einen zweiten.
   *
   * Abhaken legt eine Erledigung an, Wiedereröffnen nimmt sie weg — dasselbe
   * Ding, zwei Richtungen. Ein `/reopen` daneben wäre ein zweiter Name für die
   * Rücknahme von etwas, das schon einen Namen hat.
   */
  if (completePath && method === 'DELETE') {
    const row = await reopen(ctx.pool, completePath[1]!, workspaceId);
    json(res, 200, { task: taskView(row) });
    return;
  }
  if (completePath && method === 'POST') {
    const out = await complete(ctx.pool, completePath[1]!, userId, now);
    if (out.completed.workspace_id !== workspaceId) {
      fail(res, 404, 'not_found', 'Aufgabe gibt es nicht');
      return;
    }
    json(res, 200, {
      completed: taskView(out.completed),
      next: out.next === undefined ? null : taskView(out.next),
    });
    return;
  }

  if (path === '/api/trash' && method === 'GET') {
    const wanted = url.searchParams.get('kind') ?? 'task';
    if (wanted !== 'task' && wanted !== 'project') {
      fail(res, 400, 'no_kind', 'der Papierkorb kennt Aufgaben und Projekte');
      return;
    }
    const entries = await listTrash(ctx.pool, workspaceId, wanted);
    json(res, 200, {
      kind: wanted,
      entries: entries.map((e) => ({
        ...e,
        trashedAt: e.trashedAt.toISOString(),
      })),
    });
    return;
  }

  const bin = /^\/api\/(tasks|projects)\/([0-9a-f-]{36})\/(trash|restore|purge)$/.exec(path);
  if (bin && method === 'POST') {
    const kind: TrashKind = bin[1] === 'tasks' ? 'task' : 'project';
    const id = bin[2]!;
    if (bin[3] === 'trash') {
      await trash(ctx.pool, kind, id, workspaceId, userId);
    } else if (bin[3] === 'restore') {
      const body = (await readJson(req)) as Record<string, unknown> | undefined;
      // Anwesenheit des Schlüssels, nicht Wahrheit des Werts: `null` heißt
      // „ohne Projekt", ein fehlender Schlüssel heißt „ich habe keins genannt".
      const target =
        body !== undefined && 'projectId' in body
          ? body['projectId'] === null
            ? null
            : String(body['projectId'])
          : undefined;
      await restore(ctx.pool, kind, id, workspaceId, target);
    } else {
      await purge(ctx.pool, kind, id, workspaceId);
    }
    json(res, 200, { ok: true });
    return;
  }

  const move_ = /^\/api\/tasks\/([0-9a-f-]{36})\/move$/.exec(path);
  if (move_ && method === 'POST') {
    const body = (await readJson(req)) as { afterId?: unknown; beforeId?: unknown };
    const row = await move(ctx.pool, move_[1]!, workspaceId, {
      afterId: typeof body?.afterId === 'string' ? body.afterId : null,
      beforeId: typeof body?.beforeId === 'string' ? body.beforeId : null,
    });
    json(res, 200, { task: taskView(row) });
    return;
  }

  const kid = /^\/api\/tasks\/([0-9a-f-]{36})\/children$/.exec(path);
  if (kid && method === 'POST') {
    const body = (await readJson(req)) as { title?: unknown };
    const row = await addChild(
      ctx.pool,
      kid[1]!,
      workspaceId,
      userId,
      typeof body?.title === 'string' ? body.title : '',
    );
    json(res, 201, { task: taskView(row) });
    return;
  }

  const talk = /^\/api\/tasks\/([0-9a-f-]{36})\/comments$/.exec(path);
  if (talk && method === 'POST') {
    const body = (await readJson(req)) as { body?: unknown };
    const comment = await addComment(
      ctx.pool,
      talk[1]!,
      workspaceId,
      userId,
      typeof body?.body === 'string' ? body.body : '',
    );
    json(res, 201, {
      comment: { ...comment, createdAt: comment.createdAt.toISOString() },
    });
    return;
  }

  const one = /^\/api\/tasks\/([0-9a-f-]{36})$/.exec(path);
  if (one && method === 'GET') {
    const d = await detail(ctx.pool, one[1]!, workspaceId);
    json(res, 200, {
      task: taskView(d.task),
      projectName: d.projectName,
      children: d.children.map(taskView),
      comments: d.comments.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
      assignees: d.assignees,
      // Kein Feld „Herkunft: keine".
      ...(d.origin === undefined
        ? {}
        : {
            origin: {
              url: d.origin.url,
              pageTitle: d.origin.pageTitle,
              seenAt: d.origin.seenAt.toISOString(),
            },
          }),
    });
    return;
  }

  if (one && method === 'PATCH') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const row = await patch(ctx.pool, one[1]!, workspaceId, readPatch(body));
    json(res, 200, { task: taskView(row) });
    return;
  }

  fail(res, 404, 'no_route', `${method} ${path} gibt es nicht`);
}
