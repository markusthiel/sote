/**
 * SOTE — die Routen.
 *
 * Eine Route übersetzt HTTP und entscheidet nichts. Was Abhaken bedeutet, steht
 * in `tasks.ts`; was eine Zeile bedeutet, in `@sote/core`. Diese Datei prüft
 * Zugriff, liest Parameter und gibt Gründe zurück.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { describe as describeRecurrence, isListLevel, isZone, readIcon } from '@sote/core';
import type { Pool } from 'pg';

import { openSession, signIn, signOut, userOfToken } from './auth.js';
import {
  BadSetupKey,
  createAccount,
  createWorkspace,
  SetupClosed,
  setupFirstAccount,
  userCount,
  type SetupKey,
} from './bootstrap.js';
import { addChild, addComment, detail } from './detail.js';
import {
  effectiveFor,
  isAdmin,
  mayChange,
  mayDo,
  mayWriteLists,
  patchSettings,
  type Scope,
} from './settings.js';
import { queryOne, queryRows } from './db.js';
import { create as createProject, NameTaken, update as updateProject } from './projects.js';
import type { Config } from './env.js';
import { cookie, fail, json, readJson } from './http/respond.js';
import { accounts, deleteAccount, setAdmin } from './accounts.js';
import { TRASH_DAYS } from './handlers.js';
import {
  baseUrl,
  invite,
  listInvitations,
  openInvitation,
  revokeInvitation,
} from './invitations.js';
import { mailConfig } from './mail.js';
import {
  begin,
  findAccount,
  ssoConfig,
  sweepFlows,
  takeFlow,
  whoami,
} from './sso.js';
import { knownKinds } from './jobs.js';
import { list as listNotifications, markRead, unreadCount } from './notifications.js';
import { stream } from './nudge.js';
import { deleteWorkspace, exportWorkspace } from './workspace.js';
import {
  add as addToGroup,
  create as createGroup,
  drop as dropFromGroup,
  list as listGroups,
  remove as removeGroup,
  update as updateGroup,
} from './groups.js';
import {
  create as createRole,
  list as listRoles,
  remove as removeRole,
  update as updateRole,
} from './roles.js';
import { addPerson, findPeople, people, removePerson, roles, setRole } from './people.js';
import { shareRoutes } from './shareRoutes.js';
import { createShare, listShares, revokeShare, shareKeyPresent } from './shares.js';
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
    /*
     * Ob es SSO gibt, kommt hier mit — und nicht als eigene Route.
     *
     * Die Anmeldemaske fragt diese eine Antwort ohnehin, bevor sie etwas
     * zeichnet. Eine zweite Route dafür wäre ein zweiter Umlauf für eine
     * Auskunft, die zur ersten gehört: *was kann man hier tun, ohne
     * angemeldet zu sein*.
     */
    const sso = ssoConfig();
    json(res, 200, {
      needed: (await userCount(ctx.pool)) === 0,
      // Nur mit Rückkehradresse: ein Knopf ohne sie führt in einen Fehler,
      // und ein Knopf, der in einen Fehler führt, ist schlimmer als keiner.
      sso: sso !== undefined && baseUrl() !== undefined ? { label: sso.label } : null,
    });
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

  /* ── Freigaben: der eine Weg ohne Konto ──────────────────────────────────
   *
   * VOR der Anmeldeschranke, und das ist die ganze Idee einer Freigabe: sie
   * gilt ohne Konto. Der Abschnitt liegt darum bewusst hier oben und nicht
   * verstreut — wer prüfen will, was ein Fremder erreichen kann, liest diese
   * zwanzig Zeilen und nicht die ganze Datei.
   *
   * Jeder Weg hier holt sein Recht aus `accessByToken` und bekommt es nicht
   * übergeben (ADR-0087). Und jeder nennt seinen Token in der Adresse: ein
   * Link muss sich weitergeben lassen, sonst ist er keiner.
   */
  const sharePath = /^\/api\/share\/([A-Za-z0-9_-]{20,200})(\/.*)?$/.exec(path);
  if (sharePath !== null) {
    await shareRoutes(ctx, req, res, sharePath[1]!, sharePath[2] ?? '', method, now);
    return;
  }

  /* ── SSO: der dritte Weg ohne Konto ──────────────────────────────────────
   *
   * Vor der Anmeldeschranke, denn hier wird man erst angemeldet. Alle drei
   * kontolosen Wege stehen damit an einer Stelle: Freigaben, Einladungen, SSO.
   */
  if (path === '/api/sso/start' && method === 'GET') {
    const cfg = ssoConfig();
    if (cfg === undefined) {
      fail(res, 404, 'no_sso', 'dieser Server hat kein Single-Sign-on');
      return;
    }
    const base = baseUrl();
    if (base === undefined) {
      /*
       * Die Rückkehradresse muss die sein, die beim Anbieter eingetragen ist —
       * und die kann nur der Betreiber wissen. Sie aus der Anfrage zu bauen
       * hieße, sie vom Aufrufer nehmen: wer sie fälscht, lässt den Anbieter
       * den Code an eine fremde Stelle schicken.
       */
      fail(res, 409, 'no_base', 'für Single-Sign-on fehlt SOTE_BASE_URL');
      return;
    }
    await sweepFlows(ctx.pool, now);
    const einladung = url.searchParams.get('invitation');
    let wohin: string;
    try {
      wohin = await begin(ctx.pool, cfg, `${base}/api/sso/callback`, {
        ...(url.searchParams.get('next') === null
          ? {}
          : { nextPath: url.searchParams.get('next')! }),
        // Eine Einladung wird als Id mitgeführt und nicht als Token: der Token
        // wäre auf dem Weg zum Anbieter in einer Adresse unterwegs.
        ...(einladung !== null && /^[0-9a-f-]{36}$/.test(einladung)
          ? { invitationId: einladung }
          : {}),
      });
    } catch (e) {
      /*
       * **Ein Anbieter, der nicht antwortet, ist keine Ausnahme.**
       *
       * Vorher gab dieser Weg eine 500 — im Browser eine leere Seite mit
       * „unerwarteter Fehler", und das ist genau die Auskunft, die niemandem
       * hilft: der Anbieter ist unerreichbar oder falsch eingetragen, und
       * beides gehört auf die Anmeldemaske. Gefunden mit einem erfundenen
       * Aussteller, der nicht auflöst.
       */
      res.statusCode = 302;
      res.setHeader(
        'location',
        `/?sso=${encodeURIComponent(
          e instanceof OutOfOrder ? e.message : 'der Anbieter ist nicht erreichbar',
        )}`,
      );
      res.end();
      return;
    }
    // 302 und keine JSON-Antwort: der Browser soll gehen, nicht etwas anzeigen.
    res.statusCode = 302;
    res.setHeader('location', wohin);
    res.end();
    return;
  }

  if (path === '/api/sso/callback' && method === 'GET') {
    const cfg = ssoConfig();
    const base = baseUrl();
    if (cfg === undefined || base === undefined) {
      fail(res, 404, 'no_sso', 'dieser Server hat kein Single-Sign-on');
      return;
    }
    const zurück = (grund: string): void => {
      // Zurück zur Anmeldung, mit einem Grund in der Adresse — und nicht eine
      // nackte Fehlerseite: wer hier landet, wollte sich anmelden.
      res.statusCode = 302;
      res.setHeader('location', `/?sso=${encodeURIComponent(grund)}`);
      res.end();
    };
    const flow = await takeFlow(ctx.pool, url.searchParams.get('state') ?? '', now);
    const code = url.searchParams.get('code');
    if (flow === null || code === null) {
      // Ein Satz für beides: „kein state" und „schon benutzt" sind für den
      // Fremden dieselbe Auskunft.
      zurück('abgelaufen');
      return;
    }
    let userId: string | null;
    try {
      const who = await whoami(cfg, code, flow.verifier, `${base}/api/sso/callback`);
      userId = await findAccount(ctx.pool, who);
      if (userId === null && flow.invitationId !== null) {
        /*
         * Eine Einladung mit SSO annehmen.
         *
         * Kein Kennwort: wer sich über den Anbieter anmeldet, braucht keines,
         * und eines zu verlangen wäre ein zweites Geheimnis für denselben
         * Zugang. Die Adresse muss übereinstimmen — sonst wäre eine Einladung
         * an eine Adresse ein Konto für jede andere.
         */
        const inv = await queryOne<{ email: string }>(
          ctx.pool,
          `SELECT email FROM invitations
            WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
              AND expires_at > $2`,
          [flow.invitationId, now],
        );
        if (inv !== undefined && inv.email === who.email) {
          userId = await createAccount(ctx.pool, {
            email: who.email,
            displayName: who.name,
            workspaceName: `${who.name}s Arbeitsbereich`,
          });
          await ctx.pool.query('UPDATE users SET sso_subject = $2 WHERE id = $1', [
            userId,
            who.subject,
          ]);
          await ctx.pool.query(
            'UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
            [flow.invitationId, userId],
          );
        }
      }
    } catch (e) {
      zurück(e instanceof OutOfOrder ? e.message : 'fehlgeschlagen');
      return;
    }
    if (userId === null) {
      // SSO meldet an, es lädt nicht ein (ADR-0073). Der Satz sagt, was fehlt.
      zurück('kein Konto auf diesem Server — lass dich einladen');
      return;
    }
    const session = await openSession(ctx.pool, userId, now, ctx.config.sessionDays);
    res.statusCode = 302;
    res.setHeader(
      'set-cookie',
      `${COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${
        ctx.config.sessionDays * 86_400
      }`,
    );
    res.setHeader('location', flow.nextPath ?? '/');
    res.end();
    return;
  }

  /* ── Einladungen: der zweite Weg ohne Konto ──────────────────────────────
   *
   * Vor der Anmeldeschranke, und das ist der Sinn: wer eingeladen ist, HAT
   * noch kein Konto. Beide Wege stehen hier zusammen, damit man nachlesen
   * kann, was ein Fremder erreicht — wie bei den Freigaben.
   */
  const invitePath = /^\/api\/invitation\/([A-Za-z0-9_-]{20,200})$/.exec(path);
  if (invitePath !== null && (method === 'GET' || method === 'POST')) {
    const einladung = await openInvitation(ctx.pool, invitePath[1]!, now);
    if (einladung === null) {
      // Ein Satz für alle Fälle: „abgelaufen" gegen „zurückgenommen" gegen
      // „gibt es nicht" wäre eine Auskunft darüber, ob ein geratener Token
      // einmal gültig war.
      fail(res, 404, 'no_invitation', 'diese Einladung gilt nicht mehr');
      return;
    }
    if (method === 'GET') {
      // Die Adresse, damit der Bildschirm sie zeigen kann — und sonst nichts.
      json(res, 200, { email: einladung.email });
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = String(body?.['displayName'] ?? '').trim();
    const password = String(body?.['password'] ?? '');
    if (name === '' || password.length < 8) {
      fail(res, 400, 'weak', 'Name und ein Kennwort mit mindestens acht Zeichen');
      return;
    }
    /*
     * Dieselbe Stelle wie die Einrichtung: `createAccount`.
     *
     * Zwei Umsetzungen von „ein Konto anlegen" wären zwei Rollenlisten, und
     * die eine hätte irgendwann eine Rolle, die die andere nicht hat — das
     * steht schon in `bootstrap.ts`, und hier gilt es wieder.
     *
     * Die Adresse kommt aus der EINLADUNG und nicht aus dem Formular: sonst
     * wäre ein Einladungslink ein Konto auf beliebigen Namen.
     */
    const neu = await createAccount(ctx.pool, {
      email: einladung.email,
      displayName: name,
      password,
      workspaceName: `${name}s Arbeitsbereich`,
    });
    await ctx.pool.query(
      'UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
      [einladung.id, neu],
    );
    // Reihenfolge aus der Signatur abgelesen und nicht geraten: `sessionDays`
    // vor `now`. Der Übersetzer hat mir das gesagt, bevor es ein Fehler wurde.
    const session = await signIn(
      ctx.pool,
      einladung.email,
      password,
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
    json(res, 201, { ok: true });
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
      /*
       * Ob diese Person die Instanz verwaltet.
       *
       * Damit die Oberfläche „Verwaltung" nicht anbietet, wo sie 403 antwortet
       * — ein Eintrag, der auf „das darfst du nicht" führt, bringt Leute dazu,
       * dem Menü zu misstrauen (ADR-0027: abwesend statt anwesend und
       * verweigernd).
       */
      isAdmin: await isAdmin(ctx.pool, userId),
      /*
       * Die Zahl an der Glocke.
       *
       * Hier und nicht in einer eigenen Route: `/api/me` wird beim Laden
       * ohnehin geholt, und eine zweite Anfrage für eine Zahl wäre ein Umlauf
       * für etwas, das zur ersten Antwort gehört — *was gibt es über mich zu
       * wissen*.
       */
      unread: await unreadCount(ctx.pool, userId),
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

  /* ── Benachrichtigungen ──────────────────────────────────────────────────
   *
   * **Ohne Arbeitsbereich**, und das ist der Punkt: eine Benachrichtigung
   * betrifft mich, nicht den Bereich, in dem ich gerade stehe (wie SONE, dessen
   * ADR-0052 dafür angeführt wird). Wer sie nur im richtigen Bereich sähe,
   * müsste die Bereiche durchgehen, um zu wissen, ob etwas liegt — und genau
   * das soll eine Glocke ersparen.
   */
  if (path === '/api/stream' && method === 'GET') {
    /*
     * Der Strom eines Mitglieds.
     *
     * Auf seinen Arbeitsbereich gefiltert — und das ist die ganze Prüfung, die
     * hier nötig ist: die Klingel nennt nur einen Scope. Was er dann sieht,
     * entscheidet die Route, die die Liste liefert.
     */
    stream(req, res, (ws) => ws === workspaceId);
    return;
  }

  if (path === '/api/notifications' && method === 'GET') {
    // Alles auf einmal: die Oberfläche zählt ihre Ansichten daraus. Eine
    // Abfrage je Zahl wäre eine Abfrage je Ansicht, und die Zahlen kämen aus
    // verschiedenen Augenblicken (SONEs `InboxPanel`).
    json(res, 200, {
      notifications: (await listNotifications(ctx.pool, userId)).map((n) => ({
        id: n.id,
        kind: n.kind,
        taskId: n.taskId,
        taskTitle: n.taskTitle,
        workspaceId: n.workspaceId,
        workspaceName: n.workspaceName,
        actorName: n.actorName,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      })),
    });
    return;
  }

  const notifPath = /^\/api\/notifications(\/([0-9a-f-]{36}))?\/read$/.exec(path);
  if (notifPath !== null && method === 'POST') {
    // Ohne Id: alles. Mit Id: diese eine. Zwei Routen für dieselbe Sache wären
    // zwei Wege, von denen einer die Begrenzung auf eigene Zeilen vergisst.
    await markRead(ctx.pool, userId, notifPath[2]);
    json(res, 200, { ok: true });
    return;
  }

  if (path === '/api/workspaces' && method === 'POST') {
    /*
     * Einen Arbeitsbereich anlegen darf **jedes Konto**, und das ist eine
     * Entscheidung.
     *
     * Nicht der Instanzadministrator: ein Arbeitsbereich ist der Ort, an dem
     * jemand seine eigene Arbeit führt, und ihn beantragen zu müssen macht aus
     * einer Notiz einen Vorgang. Wer auf diesem Server ein Konto hat, hat es
     * bekommen (ADR-0073: die Instanz lädt ein) — die Entscheidung, wer hier
     * sein darf, ist damit schon getroffen.
     *
     * Die Grenze, falls sie einmal nötig wird, ist eine Zahl je Konto und kein
     * Recht: „darf anlegen" wäre ein Schalter, der bei allen aus ist.
     */
    const body = (await readJson(req)) as Record<string, unknown>;
    const id = await createWorkspace(ctx.pool, {
      name: String(body?.['name'] ?? ''),
      ownerId: userId,
    });
    json(res, 201, { id });
    return;
  }

  /* ── Mitnehmen und wegwerfen ─────────────────────────────────────────────
   *
   * Beides nur für Eigentümer, und nicht über ein Recht: einen Arbeitsbereich
   * zu löschen ist keine Verwaltungsaufgabe, sondern die letzte. Eine Rolle
   * könnte man aus Versehen mit dem Recht ausstatten; die Eigentümerspalte
   * lässt sich nicht aus Versehen setzen (ADR-0087).
   */
  if (path === '/api/workspace/export' && method === 'GET') {
    const chef = await queryOne<{ is_owner: boolean }>(
      ctx.pool,
      'SELECT is_owner FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (chef?.is_owner !== true) {
      fail(res, 403, 'not_allowed', 'einen Arbeitsbereich nimmt sein Eigentümer mit');
      return;
    }
    json(res, 200, await exportWorkspace(ctx.pool, workspaceId));
    return;
  }

  if (path === '/api/workspace' && method === 'DELETE') {
    const chef = await queryOne<{ is_owner: boolean }>(
      ctx.pool,
      'SELECT is_owner FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (chef?.is_owner !== true) {
      fail(res, 403, 'not_allowed', 'einen Arbeitsbereich wirft sein Eigentümer weg');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    await deleteWorkspace(ctx.pool, workspaceId, userId, String(body?.['name'] ?? ''));
    json(res, 200, { ok: true });
    return;
  }

  /* ── Gruppen ─────────────────────────────────────────────────────────────
   *
   * `groups.manage` — das Recht, das in Migration 0013 entfernt wurde, weil es
   * nichts bewachte. Hier sind die Prüfungen, im selben Commit wie seine
   * Rückkehr (ADR-0087).
   */
  if (path === '/api/groups' && method === 'GET') {
    json(res, 200, {
      groups: await listGroups(ctx.pool, workspaceId),
      mayManage: await mayDo(ctx.pool, userId, workspaceId, 'groups.manage'),
    });
    return;
  }

  if (path === '/api/groups' && method === 'POST') {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'groups.manage'))) {
      fail(res, 403, 'not_allowed', 'Gruppen zu verwalten darfst du hier nicht');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const out = await createGroup(ctx.pool, workspaceId, String(body?.['name'] ?? ''));
    json(res, 201, { id: out.id });
    return;
  }

  const groupPath = /^\/api\/groups\/([0-9a-f-]{36})(\/members(\/([0-9a-f-]{36}))?)?$/.exec(path);
  if (groupPath !== null && method !== 'GET') {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'groups.manage'))) {
      fail(res, 403, 'not_allowed', 'Gruppen zu verwalten darfst du hier nicht');
      return;
    }
    const id = groupPath[1]!;
    if (groupPath[2] === undefined) {
      if (method === 'DELETE') {
        await removeGroup(ctx.pool, id, workspaceId);
        json(res, 200, { ok: true });
        return;
      }
      if (method === 'PATCH') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const rolle = body?.['roleId'];
        await updateGroup(ctx.pool, id, workspaceId, {
          ...('name' in (body ?? {}) ? { name: String(body['name'] ?? '') } : {}),
          // `null` ist eine Angabe („trägt keine Rolle", ordnet nur), ein
          // fehlender Schlüssel nicht — sonst ließe sich eine Rolle nicht mehr
          // wegnehmen.
          ...('roleId' in (body ?? {})
            ? { roleId: typeof rolle === 'string' && rolle !== '' ? rolle : null }
            : {}),
        });
        json(res, 200, { ok: true });
        return;
      }
    } else if (method === 'POST') {
      const body = (await readJson(req)) as Record<string, unknown>;
      await addToGroup(ctx.pool, id, workspaceId, String(body?.['userId'] ?? ''));
      json(res, 201, { ok: true });
      return;
    } else if (method === 'DELETE' && groupPath[4] !== undefined) {
      await dropFromGroup(ctx.pool, id, workspaceId, groupPath[4]);
      json(res, 200, { ok: true });
      return;
    }
  }

  /* ── Rollen ──────────────────────────────────────────────────────────────
   *
   * `roles.manage`, und das ist der einzige Ort, der es prüft. Der Wächter in
   * `rights.test.ts` verlangt genau das: jedes Recht aus der Liste kommt im
   * Server vor — sonst ist es ein Schalter, bei dem jemand etwas glaubt.
   */
  if (path === '/api/roles' && method === 'GET') {
    // Sehen darf jedes Mitglied: welche Rollen es gibt, steht schon in der
    // Leute-Liste, und zwei Antworten auf dieselbe Frage wären zwei Wahrheiten.
    json(res, 200, {
      roles: await listRoles(ctx.pool, workspaceId),
      mayManage: await mayDo(ctx.pool, userId, workspaceId, 'roles.manage'),
    });
    return;
  }

  if (path === '/api/roles' && method === 'POST') {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'roles.manage'))) {
      fail(res, 403, 'not_allowed', 'Rollen festzulegen darfst du hier nicht');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const level = body?.['listLevel'];
    const role = await createRole(ctx.pool, workspaceId, {
      name: String(body?.['name'] ?? ''),
      listLevel: isListLevel(level) ? level : null,
      rights: Array.isArray(body?.['rights']) ? (body['rights'] as string[]) : [],
    });
    json(res, 201, { role });
    return;
  }

  const rolePath = /^\/api\/roles\/([0-9a-f-]{36})$/.exec(path);
  if (rolePath !== null && (method === 'PATCH' || method === 'DELETE')) {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'roles.manage'))) {
      fail(res, 403, 'not_allowed', 'Rollen festzulegen darfst du hier nicht');
      return;
    }
    if (method === 'DELETE') {
      await removeRole(ctx.pool, rolePath[1]!, workspaceId);
      json(res, 200, { ok: true });
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const level = body?.['listLevel'];
    await updateRole(ctx.pool, rolePath[1]!, workspaceId, {
      ...('name' in (body ?? {}) ? { name: String(body['name'] ?? '') } : {}),
      // `null` ist eine Angabe („keine Stufe" = Gast), ein fehlender Schlüssel
      // nicht. Beides zusammenzuwerfen hieße, dass man eine Stufe nicht mehr
      // wegnehmen kann.
      ...('listLevel' in (body ?? {})
        ? { listLevel: isListLevel(level) ? level : null }
        : {}),
      ...(Array.isArray(body?.['rights']) ? { rights: body['rights'] as string[] } : {}),
    });
    json(res, 200, { ok: true });
    return;
  }

  /* ── Konten: die Instanzseite ─────────────────────────────────────────────
   *
   * Alle drei Wege nehmen dasselbe Recht, und es ist nicht das des
   * Arbeitsbereichs: die Instanz gehört keinem (Migration 0012).
   */
  if (path === '/api/accounts' && method === 'GET') {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'das darf nur, wer die Instanz verwaltet');
      return;
    }
    json(res, 200, {
      you: userId,
      accounts: (await accounts(ctx.pool)).map((a) => ({
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        isAdmin: a.isAdmin,
        workspaces: a.workspaces,
        createdAt: a.createdAt.toISOString(),
      })),
    });
    return;
  }

  if (path === '/api/invitations' && method === 'GET') {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'einladen darf, wer die Instanz verwaltet');
      return;
    }
    json(res, 200, {
      // Ob eine Mail überhaupt hinausgeht — die Oberfläche soll den Grund
      // nennen können, statt einen Link zu zeigen und Versand vorzugeben.
      mails: mailConfig() !== undefined && baseUrl() !== undefined,
      base: baseUrl() ?? null,
      invitations: (await listInvitations(ctx.pool)).map((i) => ({
        id: i.id,
        email: i.email,
        token: i.token,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
      })),
    });
    return;
  }

  if (path === '/api/invitations' && method === 'POST') {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'einladen darf, wer die Instanz verwaltet');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    /*
     * Der Browser schickt eine ADRESSE, keine URL (ADR-0126).
     *
     * Eine Route, die eine übergebene URL verschickt, wäre ein kleiner offener
     * Verteiler mit dem Namen dieser Instanz auf dem Umschlag — und sie hätte
     * ausgesehen wie der naheliegende Weg, weil der Browser den Link ohnehin
     * anzeigt.
     */
    const out = await invite(ctx.pool, String(body?.['email'] ?? ''), userId, now);
    json(res, 201, { id: out.id, token: out.token, mailed: out.mailed });
    return;
  }

  const invRevoke = /^\/api\/invitations\/([0-9a-f-]{36})$/.exec(path);
  if (invRevoke !== null && method === 'DELETE') {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'einladen darf, wer die Instanz verwaltet');
      return;
    }
    await revokeInvitation(ctx.pool, invRevoke[1]!);
    json(res, 200, { ok: true });
    return;
  }

  if (path === '/api/maintenance' && method === 'GET') {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'das darf nur, wer die Instanz verwaltet');
      return;
    }
    /*
     * Was dieser Server von selbst tut, und wo es klemmt.
     *
     * Der Grund für diesen Bildschirm: ein Läufer, dessen Aufträge liegen
     * bleiben, ist eine Anwendung, die still weniger tut als versprochen.
     * „Nichts wird still weggeworfen" (Migration 0015) hilft nur, wenn es
     * irgendwo zu sehen ist.
     */
    const offen = await queryRows<{
      kind: string;
      run_at: Date;
      attempts: number;
      last_error: string | null;
    }>(
      ctx.pool,
      `SELECT kind, run_at, attempts, last_error FROM jobs
        WHERE done_at IS NULL ORDER BY run_at LIMIT 50`,
    );
    const fertig = await queryOne<{ n: string; letzte: Date | null }>(
      ctx.pool,
      'SELECT count(*) AS n, max(done_at) AS letzte FROM jobs WHERE done_at IS NOT NULL',
    );
    json(res, 200, {
      kinds: knownKinds(),
      trashDays: TRASH_DAYS,
      done: { count: Number(fertig?.n ?? 0), last: fertig?.letzte?.toISOString() ?? null },
      open: offen.map((j) => ({
        kind: j.kind,
        runAt: j.run_at.toISOString(),
        attempts: j.attempts,
        // Aufgegeben heißt: liegt da, läuft nicht mehr von selbst. Die Zahl
        // allein sagt das nicht, also sagt es ein Feld.
        givenUp: j.attempts >= 5,
        lastError: j.last_error,
      })),
    });
    return;
  }

  const accountPath = /^\/api\/accounts\/([0-9a-f-]{36})$/.exec(path);
  if (accountPath !== null && (method === 'PATCH' || method === 'DELETE')) {
    if (!(await isAdmin(ctx.pool, userId))) {
      fail(res, 403, 'not_allowed', 'das darf nur, wer die Instanz verwaltet');
      return;
    }
    if (method === 'DELETE') {
      await deleteAccount(ctx.pool, accountPath[1]!);
      json(res, 200, { ok: true });
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body?.['isAdmin'] !== 'boolean') {
      fail(res, 400, 'no_flag', 'verwalten: ja oder nein');
      return;
    }
    await setAdmin(ctx.pool, accountPath[1]!, body['isAdmin']);
    json(res, 200, { ok: true });
    return;
  }

  /* ── Leute ───────────────────────────────────────────────────────────────
   *
   * Alle vier Wege nehmen DASSELBE Recht wie das Hinzufügen — auch das Suchen
   * (ADR-0119). Was daran neu ist, ist Name → Adresse; darum wird das Recht
   * nicht gelockert, nur weil die Antwort kürzer aussieht.
   */
  if (path === '/api/people' && method === 'GET') {
    const q = url.searchParams.get('q');
    if (q !== null) {
      // `people.manage`, nicht das Recht für Einstellungen: das Suchen nimmt
      // dasselbe Recht wie das Hinzufügen (ADR-0119), und beide heißen Leute.
      if (!(await mayDo(ctx.pool, userId, workspaceId, 'people.manage'))) {
        fail(res, 403, 'not_allowed', 'das darfst du hier nicht');
        return;
      }
      json(res, 200, { found: await findPeople(ctx.pool, workspaceId, q) });
      return;
    }
    // Ohne Suche: wer hier ist. Das darf jedes Mitglied sehen — mit wem man
    // einen Arbeitsbereich teilt, ist keine Auskunft über den Server.
    json(res, 200, {
      people: await people(ctx.pool, workspaceId),
      roles: await roles(ctx.pool, workspaceId),
      mayManage: await mayDo(ctx.pool, userId, workspaceId, 'people.manage'),
      you: userId,
    });
    return;
  }

  if (path === '/api/people' && method === 'POST') {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'people.manage'))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const wer = String(body?.['userId'] ?? '');
    const rolle = String(body?.['roleId'] ?? '');
    if (!/^[0-9a-f-]{36}$/.test(wer) || !/^[0-9a-f-]{36}$/.test(rolle)) {
      fail(res, 400, 'no_person', 'wer, und mit welcher Rolle?');
      return;
    }
    await addPerson(ctx.pool, workspaceId, wer, rolle);
    json(res, 201, { ok: true });
    return;
  }

  const personPath = /^\/api\/people\/([0-9a-f-]{36})$/.exec(path);
  if (personPath !== null && (method === 'PATCH' || method === 'DELETE')) {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'people.manage'))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht');
      return;
    }
    if (method === 'DELETE') {
      await removePerson(ctx.pool, workspaceId, personPath[1]!);
      json(res, 200, { ok: true });
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const rolle = String(body?.['roleId'] ?? '');
    if (!/^[0-9a-f-]{36}$/.test(rolle)) {
      fail(res, 400, 'no_role', 'welche Rolle?');
      return;
    }
    await setRole(ctx.pool, workspaceId, personPath[1]!, rolle);
    json(res, 200, { ok: true });
    return;
  }

  /* ── Freigaben verwalten (mit Konto) ─────────────────────────────────── */

  if (path === '/api/shares' && method === 'GET') {
    json(res, 200, {
      // Ob es überhaupt geht, kommt mit: die Oberfläche soll den Grund nennen
      // können, statt eine leere Liste zu zeigen (ADR-0112).
      possible: shareKeyPresent(),
      shares: (await listShares(ctx.pool, workspaceId)).map((s) => ({
        id: s.id,
        projectId: s.project_id,
        projectName: s.projectName,
        right: s.right_level,
        // `null` heißt: mit diesem Schlüssel nicht anzeigbar. Die Freigabe
        // bleibt sichtbar, damit man sie widerrufen kann.
        token: s.token,
        expiresAt: s.expires_at?.toISOString() ?? null,
        lastUsedAt: s.last_used_at?.toISOString() ?? null,
        createdAt: s.created_at.toISOString(),
      })),
    });
    return;
  }

  if (path === '/api/shares' && method === 'POST') {
    /*
     * Wer schreiben darf, darf freigeben — und „schreiben" ist die STUFE.
     *
     * Eine Freigabe gibt nicht mehr her als das, was der Freigebende selbst am
     * Projekt tun kann; wer nur lesen darf, würde sonst ein Schreibrecht
     * ausgeben, das er nicht hat. Hier stand `workspace.settings`, und das war
     * die falsche Frage: wer die Farben ändern darf, hat damit nichts über
     * Aufgaben gesagt.
     */
    if (!(await mayWriteLists(ctx.pool, userId, workspaceId))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht');
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const right = body?.['right'];
    if (right !== 'read' && right !== 'edit') {
      fail(res, 400, 'no_right', 'ein Link liest oder bearbeitet');
      return;
    }
    const projectId = String(body?.['projectId'] ?? '');
    if (!/^[0-9a-f-]{36}$/.test(projectId)) {
      fail(res, 400, 'no_project', 'ein Link gilt für ein Projekt');
      return;
    }
    const bis = body?.['expiresAt'];
    const expiresAt = typeof bis === 'string' && bis !== '' ? new Date(bis) : null;
    if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
      fail(res, 400, 'no_date', 'diesen Ablauf kann ich nicht lesen');
      return;
    }
    const out = await createShare(ctx.pool, {
      workspaceId,
      projectId,
      right,
      userId,
      expiresAt,
    });
    json(res, 201, {
      share: {
        id: out.share.id,
        projectId: out.share.project_id,
        right: out.share.right_level,
        token: out.token,
        expiresAt: out.share.expires_at?.toISOString() ?? null,
      },
    });
    return;
  }

  const revokePath = /^\/api\/shares\/([0-9a-f-]{36})$/.exec(path);
  if (revokePath !== null && method === 'DELETE') {
    // Widerrufen darf, wer freigeben darf: sonst gäbe es Links, die niemand
    // zurücknehmen kann außer dem, der sie angelegt hat.
    if (!(await mayWriteLists(ctx.pool, userId, workspaceId))) {
      fail(res, 403, 'not_allowed', 'das darfst du hier nicht');
      return;
    }
    await revokeShare(ctx.pool, revokePath[1]!, workspaceId);
    json(res, 200, { ok: true });
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
      sort_key: string;
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
       SELECT w.id, w.parent_id, w.name, w.color, w.icon, w.kind, w.sort_key, w.depth,
              count(t.id) FILTER (
                WHERE t.completed_at IS NULL AND t.trashed_at IS NULL
              ) AS open
         FROM walk w
         LEFT JOIN tasks t ON t.project_id = w.id
        -- sort_key muss mit ins GROUP BY: eine neue Spalte im SELECT neben
        -- einer Zaehlung ist sonst ein SQL-Fehler, und die Route antwortet mit
        -- 500. Genau das hat der Projekt-Test gemeldet.
        --
        -- Und dieser Kommentar stand zuerst MIT Rueckwaertsstrichen um den
        -- Spaltennamen -- die beenden ein Template-Literal, worauf der
        -- Uebersetzer eine Klammer vermisste. Ich hatte also einen Kommentar
        -- ueber diese Falle geschrieben und war dabei hineingetreten; sie ist
        -- die dritte ihrer Art in diesem Projekt.
        GROUP BY w.id, w.parent_id, w.name, w.color, w.icon, w.kind, w.sort_key,
                 w.depth, w.path
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
        /*
         * Der Sortierschlüssel.
         *
         * Er fehlte hier, obwohl ich ihn in `projectView` schon eingetragen
         * hatte: **die Liste bildet ihre Zeilen selbst ab** und geht nicht
         * durch `projectView`. Zwei Stellen, die dasselbe herausgeben, und ich
         * habe eine gepflegt — der Baum bekam darum keine Schlüssel, `siblings`
         * verglich `undefined` mit `undefined`, und alle Verschieben-Knöpfe
         * waren gesperrt.
         */
        sortKey: r.sort_key,

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
    sort_key?: string;
  }) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: readIcon(row.icon),
    kind: row.kind,
    /*
     * Der Sortierschlüssel geht mit hinaus.
     *
     * Damit die Leiste „einen Platz weiter" rechnen kann: sie braucht die
     * Schlüssel der Nachbarn, um einen dazwischen zu bauen. Ohne sie müsste
     * der Server die Reihenfolge nachbilden, in der die Leiste zeichnet — zwei
     * Wahrheiten über dieselbe Liste.
     */
    sortKey: row.sort_key ?? '',
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
      // Kommt fertig von der Oberfläche: nur sie weiß, zwischen welche zwei
      // Nachbarn etwas soll (siehe `update` in projects.ts).
      ...('sortKey' in (body ?? {}) ? { sortKey: String(body['sortKey']) } : {}),
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
