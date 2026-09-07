/**
 * SOTE — die Routen.
 *
 * Eine Route übersetzt HTTP und entscheidet nichts. Was Abhaken bedeutet, steht
 * in `tasks.ts`; was eine Zeile bedeutet, in `@sote/core`. Diese Datei prüft
 * Zugriff, liest Parameter und gibt Gründe zurück.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { describe as describeRecurrence } from '@sote/core';
import type { Pool } from 'pg';

import { signIn, signOut, userOfToken } from './auth.js';
import { queryOne, queryRows } from './db.js';
import type { Config } from './env.js';
import { cookie, fail, json, readJson } from './http/respond.js';
import { makeStatic } from './http/static.js';
import {
  complete,
  createFromLine,
  NotFound,
  recurrenceOf,
  today,
  type TaskRow,
} from './tasks.js';

const COOKIE = 'sote_session';

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
    const spaces = await queryRows<{ id: string; name: string }>(
      ctx.pool,
      `SELECT w.id, w.name FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
        ORDER BY w.created_at`,
      [userId],
    );
    json(res, 200, {
      id: me?.id,
      email: me?.email,
      displayName: me?.display_name,
      workspaces: spaces,
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
    const sections = await today(ctx.pool, workspaceId, now);
    json(res, 200, {
      overdue: sections.overdue.map(taskView),
      today: sections.today.map(taskView),
    });
    return;
  }

  if (path === '/api/projects' && method === 'GET') {
    const rows = await queryRows<{
      id: string;
      parent_id: string | null;
      name: string;
      color: string | null;
      open: string;
    }>(
      ctx.pool,
      `SELECT p.id, p.parent_id, p.name, p.color,
              count(t.id) FILTER (
                WHERE t.completed_at IS NULL AND t.trashed_at IS NULL
              ) AS open
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.workspace_id = $1 AND p.trashed_at IS NULL
        GROUP BY p.id
        ORDER BY p.sort_key`,
      [workspaceId],
    );
    json(res, 200, {
      projects: rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        color: r.color,
        // Keine Null: eine Zahl über nichts ist Rauschen in einer ruhigen
        // Zeile (SONE, ADR-0092).
        open: Number(r.open) === 0 ? null : Number(r.open),
      })),
    });
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
      unknownAssignees: out.unknownAssignees,
    });
    return;
  }

  const completePath = /^\/api\/tasks\/([0-9a-f-]{36})\/complete$/.exec(path);
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

  fail(res, 404, 'no_route', `${method} ${path} gibt es nicht`);
}
