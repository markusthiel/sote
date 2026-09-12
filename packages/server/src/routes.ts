/**
 * SOTE — die Routen.
 *
 * Eine Route übersetzt HTTP und entscheidet nichts. Was Abhaken bedeutet, steht
 * in `tasks.ts`; was eine Zeile bedeutet, in `@sote/core`. Diese Datei prüft
 * Zugriff, liest Parameter und gibt Gründe zurück.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { AVATAR_MAX_BYTES, isAvatarType, describe as describeRecurrence, isListLevel, isZone, readIcon, readTaskCover, readTaskLook, isInlineSafe, NOTE_KINDS, channelDefaults, isNoteKind } from '@sote/core';
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
  effectiveListLevel,
  levelWrites,
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
import { setChannels } from './deliver.js';
import { stream } from './nudge.js';
import { pushKeys, subscribePush, unsubscribePush } from './push.js';
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
import { addFile, attachWeb, filesDir, filesOf, maxBytes, readFileOf, removeFile } from './taskFiles.js';
import { addReminder, remindersOf, removeReminder } from './taskReminders.js';
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
import {
  calendarKeyPresent,
  feedOf,
  icsByToken,
  newFeed,
  NoCalendar,
  revokeFeed,
} from './calendar.js';
import {
  addColumn,
  BoardTrouble,
  columnsOf,
  placeCard,
  removeColumn,
  updateColumn,
} from './board.js';
import { colorLabel, LabelTrouble, labelsOfWorkspace, removeLabel, renameLabel } from './labels.js';
import { listViewsOf, setListView, ViewTrouble } from './listViews.js';
import { childrenOf, counts, list, listAcross, splitOverdue, type ViewId } from './views.js';

const COOKIE = 'sote_session';

/**
 * Der Sitzungskeks — EINE Stelle, die ihn schreibt.
 *
 * Vorher stand dieselbe Zeile fünfmal in dieser Datei, und die fünfte (SSO)
 * war falsch: sie schrieb `${session}` statt `${session.token}`, der Keks
 * hiess `[object Object]`, und wer sich beim Anbieter angemeldet hatte, war
 * hier trotzdem niemand. Der Typprüfer kann das nicht sehen — in einem
 * Template-Literal ist jedes Objekt ein String. Gefunden im Audit vom
 * 12.09.2026 (F09). Eine Funktion mit einem `string`-Parameter kann den
 * Fehler nicht mehr machen.
 *
 * `Secure`, wenn die Instanz über HTTPS erreichbar ist (F12). Woher der
 * Server das weiss: aus `SOTE_BASE_URL` — dieselbe Angabe, aus der auch die
 * Links in Mails gebaut werden. Ohne Basisadresse oder mit `http://` fehlt
 * das Attribut, damit eine Testinstanz ohne TLS weiter funktioniert; der
 * Reverse Proxy davor bleibt trotzdem die Regel (docker-compose.yml).
 */
function sessionCookie(token: string, days: number): string {
  const secure = baseUrl()?.startsWith('https://') === true ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86_400}${secure}`;
}

/** Das Gegenstück: ein Keks, der sofort abläuft. Dieselben Attribute, sonst löscht er nichts. */
function clearedSessionCookie(): string {
  const secure = baseUrl()?.startsWith('https://') === true ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
const VIEWS: readonly ViewId[] = ['today', 'upcoming', 'someday', 'inbox', 'project'];

/**
 * Aus dem Körper einer PATCH-Anfrage die genannten Felder — und nur die.
 *
 * `undefined` heißt „nicht angefasst", `null` heißt „leeren". Ein Körper, der
 * ein Feld nicht nennt, darf es nicht auf null setzen; genau deshalb wird hier
 * auf Anwesenheit des Schlüssels geprüft und nicht auf Wahrheit des Werts.
 */
export function readPatch(body: Record<string, unknown>): import('./tasks.js').Patch {
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
  /*
   * Die Dauer: MINUTEN, `null` nimmt sie weg.
   *
   * Kein Auslegen von „1h30" hier. Das Vokabular gehört dem Kern, und eine
   * Route, die es ein zweites Mal kennt, ist die zweite Sprache, in der
   * dasselbe gemeint ist — die Oberfläche legt aus und schickt die Zahl.
   */
  if ('duration' in body) {
    out['duration'] = body['duration'] === null ? null : Number(body['duration']);
  }
  /*
   * Das Titelbild: ROH weitergereicht, `null` nimmt es weg.
   *
   * Keine Prüfung hier. Sie steht in `patch` (`isTaskCover`), weil der Grund
   * für die Regel kein Formfehler ist, sondern eine Frage der Privatheit: ein
   * Titelbild wird bei jedem Zeichnen geladen, und eine fremde Adresse darin
   * meldet jeden Betrachter bei jemand anderem. Eine zweite Prüfung hier wäre
   * eine zweite Antwort auf „was darf hinein" — und die laxere gewinnt immer,
   * weil sie zuerst drankommt.
   */
  if ('cover' in body) {
    out['cover'] = body['cover'] ?? null;
  }
  /* Das Aussehen: roh weitergereicht, geprüft wird in `patch`. */
  if ('look' in body) {
    out['look'] = body['look'] ?? null;
  }
  /*
   * Wiederholung: `null` nimmt sie weg, sonst eine der zwei Formen.
   *
   * Die Form wird hier ERKANNT und nicht erfragt: was `rrule` trägt, ist eine
   * Kalenderregel; was `n` trägt, zählt nach dem Abhaken. Ein zusätzliches
   * `kind` im Körper wäre eine dritte Stelle, an der dasselbe steht — und
   * eine, die dem Rest widersprechen kann.
   */
  if ('recurrence' in body) {
    const r = body['recurrence'];
    if (r === null) {
      out['recurrence'] = null;
    } else if (typeof r === 'object' && 'rrule' in (r as object)) {
      const raw = r as { rrule: unknown; dtstart?: unknown };
      out['recurrence'] = {
        kind: 'calendar',
        rrule: String(raw.rrule),
        // Ohne Anker: jetzt. Bei INTERVAL > 1 entscheidet er, welche Wochen
        // zählen, und ein fehlender Anker wäre eine Regel ohne Bezug.
        dtstart: raw.dtstart === undefined ? new Date() : new Date(String(raw.dtstart)),
      };
    } else if (typeof r === 'object' && 'n' in (r as object)) {
      const raw = r as { n: unknown; unit: unknown };
      out['recurrence'] = {
        kind: 'afterCompletion',
        n: Number(raw.n),
        unit: String(raw.unit),
      };
    } else {
      throw new OutOfOrder('eine Wiederholung braucht `rrule` oder `n` und `unit`');
    }
  }
  /* Schlagwörter: eine vollständige Liste von NAMEN, `[]` nimmt alle weg.
     Namen und nicht Ids, weil ein Schlagwort beim Vergeben entsteht. */
  if ('labels' in body) {
    const l = body['labels'];
    if (!Array.isArray(l)) throw new OutOfOrder('`labels` ist eine Liste von Namen');
    out['labels'] = l.map((x) => String(x));
  }
  /* Zuständige: eine vollständige Liste von Ids, `[]` nimmt alle weg. */
  if ('assignees' in body) {
    const a = body['assignees'];
    if (!Array.isArray(a)) throw new OutOfOrder('`assignees` ist eine Liste von Konto-Ids');
    out['assignees'] = a.map((x) => String(x));
  }
  return out as import('./tasks.js').Patch;
}

/** Was die Oberfläche von einer Aufgabe braucht. Nicht die Zeile. */
/**
 * Eine Aufgabe **und ihr Umfeld**, wie die Detailspalte sie braucht.
 *
 * Herausgezogen, weil es zwei Türen gibt: ein Mitglied ruft `/api/tasks/:id`,
 * ein Gast `/api/share/:token/tasks/:id`. Mein erster Gast-Zweig gab die
 * **innere** Form zurück — Daten statt ISO-Zeichenketten und `recurrence:
 * undefined` statt `null` —, und die Spalte prüfte `!== null`, fand `undefined`
 * und griff auf `.says` zu: ein JS-Fehler beim Gast und eine leere Spalte.
 *
 * Zwei Abbildungen für eine Ansicht sind zwei Wahrheiten über eine Aufgabe. Ich
 * habe das im Kommentar über `DetailIO` selbst geschrieben und es einen Zweig
 * weiter falsch gemacht.
 */
export function detailView(
  d: Awaited<ReturnType<typeof detail>>,
  /*
   * Die Erinnerungen kommen als Parameter und nicht aus `detail()`.
   *
   * Der Gastweg (`shareRoutes`) benutzt dieselbe Abbildung und hat keine — ein
   * Gast hat kein Konto, also auch keine Erinnerung. Ohne Parameter wäre die
   * Liste dort entweder leer gelogen oder eine Abfrage, die nichts findet.
   */
  reminders: readonly {
    id: string;
    userId: string;
    says: string;
    sentAt: Date | null;
    dueAt: Date | null;
  }[] = [],
  /* Ebenso als Parameter: der Gastweg hat keine Anhänge zu zeigen. */
  files: readonly {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }[] = [],
) {
  return {
    task: taskView(d.task),
    projectName: d.projectName,
    children: d.children.map(taskView),
    comments: d.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    assignees: d.assignees,
    /* Der Vorrat, aus dem das Schlagwortfeld vorschlägt. */
    known: d.known,
    reminders: reminders.map((r) => ({
      id: r.id,
      userId: r.userId,
      says: r.says,
      sentAt: r.sentAt?.toISOString() ?? null,
      dueAt: r.dueAt?.toISOString() ?? null,
    })),
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt.toISOString(),
    })),
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
  };
}

/**
 * Eine Aufgabe, wie die Oberfläche sie kennt.
 *
 * EXPORTIERT, seit die Freigabe dieselbe Form braucht: sie lieferte lange eine
 * eigene, kürzere (sechs Felder) — und damit fehlten dem Gast alle Angaben, die
 * seitdem dazugekommen sind: Schlagwörter, Dauer, Zeichen, Notiz-Merkmal,
 * Aussehen. Zwei Formen für dieselbe Sache laufen auseinander, und diese hier
 * sind es über Monate.
 */
export function taskView(row: TaskRow) {
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
    /* Die Zahl und nicht der Satz: die Oberfläche schreibt sie zurück, und
       ein „1:30 h" müsste sie dafür erst wieder auseinandernehmen. Wie es
       aussieht, sagt `formatDuration` an der Stelle, an der es steht. */
    duration: row.duration_min,
    labels: row.labels,
    marks: row.marks,
    columnId: row.column_id,
    cover: readTaskCover(row.cover),
    look: readTaskLook(row.look),
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

/**
 * Was ein Weg hinter der Arbeitsbereichsschranke an Listenstufe braucht.
 *
 * `none`: persönlich (Bild, Glocke, Kanäle, eigene Einstellungen, ein neuer
 * Arbeitsbereich) oder verwaltend (Leute, Gruppen, Rollen, Konten,
 * Einladungen, Wartung, der Arbeitsbereich selbst) — die verwaltenden Wege
 * prüfen ihr Recht selbst.
 *
 * `read`: alles, was nur liest — und die wenigen Schreibwege, die etwas
 * PERSÖNLICHES an eine Aufgabe hängen, ohne sie zu ändern: eine Erinnerung,
 * die eigene Sicht auf eine Liste, das eigene Kalenderabonnement. Ein viewer
 * darf das; er darf nur die Aufgabe selbst nicht anfassen.
 *
 * `write`: der Rest. Als Vorgabe und nicht als Liste, damit ein neuer Weg
 * geschützt zur Welt kommt.
 */
export function listAccessNeeded(path: string, method: string): 'none' | 'read' | 'write' {
  if (
    path.startsWith('/api/me/') ||
    path.startsWith('/api/users/') ||
    path.startsWith('/api/notification') ||
    path === '/api/workspaces' ||
    path === '/api/stream' ||
    path === '/api/settings' ||
    /^\/api\/settings\/(instance|workspace|user)$/.test(path) ||
    path === '/api/workspace' ||
    path === '/api/workspace/export' ||
    /^\/api\/(people|groups|roles|accounts|invitations|maintenance)(\/|$)/.test(path)
  ) {
    return 'none';
  }
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (path === '/api/calendar' || path === '/api/list-views') return 'read';
  if (/^\/api\/tasks\/[0-9a-f-]{36}\/reminders(\/|$)/.test(path)) return 'read';
  return 'write';
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

  /* ── Kalender: der Weg, den ein Kalenderprogramm gehen kann ──────────────
   *
   * VOR der Anmeldeschranke, und zwar zwangsweise: ein Kalenderprogramm kann
   * sich nicht anmelden. Es holt eine Adresse ab, in einem Rutsch, ohne Konto
   * — also trägt die Adresse das Geheimnis.
   *
   * `.ics` am Ende, weil manche Programme nach der Endung gehen und nicht nach
   * dem Kopf der Antwort. Er steht trotzdem richtig da.
   *
   * UND VOR DEM STATISCHEN RÜCKFALL. Der Weg heißt `/kalender/…` und nicht
   * `/api/…` — der Zweig unten, der alles außerhalb `/api/` als Datei der
   * Oberfläche behandelt, hat ihn darum verschluckt: 404 für jedes
   * Kalenderprogramm, ohne dass eine Datenbankabfrage lief. Dieselbe Form
   * wie die Gast-Klingel in `shareRoutes.ts` („eine Route hinter einer, die
   * sie verschluckt, ist still"), nur dass `calendar.db.test.ts` `icsByToken`
   * direkt rief und es nicht sehen konnte. Gefunden im Audit vom 12.09.2026
   * (F07); seitdem gibt es einen Test, der den Weg über HTTP geht.
   */
  const icsPath = /^\/kalender\/([A-Za-z0-9_-]{20,200})\.ics$/.exec(path);
  if (icsPath !== null) {
    if (method !== 'GET' && method !== 'HEAD') {
      fail(res, 405, 'no_method', 'ein Kalender wird geholt und nicht geschrieben');
      return;
    }
    const text = await icsByToken(ctx.pool, icsPath[1]!, now, baseUrl());
    if (text === undefined) {
      /*
       * Unbekannt und widerrufen sehen GLEICH aus. Ein „widerrufen" wäre die
       * Auskunft, dass es diesen Link einmal gab — die schuldet der Server
       * niemandem, der ihn nicht (mehr) hat.
       */
      fail(res, 404, 'no_calendar', 'diesen Kalender gibt es nicht');
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    // Kein Zwischenspeichern: ein Kalender, der eine alte Antwort aus einem
    // Puffer bekommt, zeigt mit Überzeugung den Stand von vorher.
    res.setHeader('cache-control', 'no-store');
    res.end(method === 'HEAD' ? undefined : text);
    return;
  }

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
      res.setHeader('set-cookie', sessionCookie(session.token, ctx.config.sessionDays));
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
    res.setHeader('set-cookie', sessionCookie(session.token, ctx.config.sessionDays));
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
    await shareRoutes(ctx, req, res, sharePath[1]!, sharePath[2] ?? '', method, now, zone);
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
    res.setHeader('set-cookie', sessionCookie(session.token, ctx.config.sessionDays));
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
      res.setHeader('set-cookie', sessionCookie(session.token, ctx.config.sessionDays));
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
    res.setHeader('set-cookie', clearedSessionCookie());
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
      workspaces: await Promise.all(
        spaces.map(async (w) => ({
          id: w.id,
          name: w.name,
          icon: readIcon(w.icon),
          // „Eigentümer" oder „Mitglied" — mehr sagt diese Antwort nicht, weil
          // sie mehr nicht braucht. Welche Rechte eine Rolle trägt, ist eine
          // Frage an den Arbeitsbereich und nicht an das Konto.
          owner: w.is_owner,
          /*
           * Die Listenstufe kommt mit, seit der Server sie durchsetzt (Audit
           * 12.09.2026, F01): eine Oberfläche, die jeden Knopf zeigt und auf
           * jeden 403 bekommt, ist eine Lüge und keine Absicherung (SONE
           * ADR-0095). `null` heisst: hier gibt es für dich keine Listen.
           */
          listLevel: await effectiveListLevel(ctx.pool, userId, w.id),
        })),
      ),
    });
    return;
  }

  /*
   * ÜBERALL: dieselben Orte, über alle Arbeitsbereiche.
   *
   * GEFRAGT: „Macht es Sinn, noch eine übergeordnete Home-Seite zu bauen …
   * von der aus man sozusagen in allen Workspaces arbeiten kann?" Bei
   * mindestens drei Bereichen ja.
   *
   * HIER OBEN, vor der Bereichsprüfung, und das ist der ganze Punkt dieser
   * Route: sie hat keinen EINEN Arbeitsbereich. Die Prüfung darunter verlangt
   * `?workspace=` und prüft die Mitgliedschaft; diese Route fragt stattdessen,
   * in welchen Bereichen jemand Mitglied IST, und nimmt genau die. Damit ist
   * die Rechteprüfung nicht schwächer, sondern dieselbe — nur für mehrere.
   *
   * Gelöschte Bereiche fallen heraus (`deleted_at IS NULL`), wie in der
   * Kontoantwort auch: ein Bereich im Papierkorb soll nicht aus einer
   * Übersicht heraus weiterleben.
   */
  if (path === '/api/across' && method === 'GET') {
    const gefragt = url.searchParams.get('view');
    const view = gefragt === 'upcoming' ? 'upcoming' : 'today';
    const meine = await queryRows<{ id: string; name: string; icon: unknown }>(
      ctx.pool,
      `SELECT w.id, w.name, w.icon FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
        ORDER BY w.created_at`,
      [userId],
    );
    const rows = await listAcross(
      ctx.pool,
      view,
      meine.map((w) => w.id),
      new Date(),
      url.searchParams.get('tz') ?? undefined,
    );
    json(res, 200, {
      view,
      /*
       * Mit dem Bereich an JEDER Aufgabe.
       *
       * Nur hier und nicht in `taskView` für alle: in einer Liste innerhalb
       * eines Bereichs wäre es derselbe Wert dreissigmal, und eine Antwort,
       * die sich selbst wiederholt, wird beim Lesen überflogen. Hier ist er
       * der Unterschied zwischen zwei Zeilen.
       */
      tasks: rows.map((r) => ({ ...taskView(r), workspaceId: r.workspace_id })),
      /*
       * Die Bereiche kommen MIT, als Karte für die Marke an jeder Zeile.
       *
       * Nicht an jeder Aufgabe der Name: das wäre derselbe Name dreissigmal.
       * Und nicht aus der Kontoantwort geholt — die Oberfläche soll diese
       * Ansicht aus EINER Antwort zeichnen können, sonst hängt sie an der
       * Reihenfolge zweier Abrufe.
       */
      workspaces: meine.map((w) => ({ id: w.id, name: w.name, icon: readIcon(w.icon) })),
    });
    return;
  }

  /*
   * ECHTE BENACHRICHTIGUNGEN — drei Wege, alle OHNE Arbeitsbereich.
   *
   * GEWÜNSCHT: „Wenn ich als App installiere, dass es richtige
   * App-Benachrichtigungen sendet."
   *
   * Sie hängen am KONTO und nicht an einem Bereich: ein Gerät gehört einer
   * Person, und eine Erinnerung an eine Aufgabe kommt aus dem Bereich, in dem
   * sie liegt — welcher das ist, weiss der Versender und nicht das Gerät.
   */
  if (path === '/api/push/key' && method === 'GET') {
    /* Der öffentliche Schlüssel ist öffentlich: der Browser braucht ihn, um
       überhaupt ein Abonnement anzulegen. Er wird beim ersten Abruf erzeugt. */
    json(res, 200, { key: (await pushKeys(ctx.pool)).publicKey });
    return;
  }

  if (path === '/api/push' && method === 'POST') {
    const body = (await readJson(req)) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
      says?: unknown;
    };
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : '';
    if (endpoint === '' || p256dh === '' || auth === '') {
      fail(res, 400, 'bad_subscription', 'dieses Abonnement ist unvollständig');
      return;
    }
    await subscribePush(ctx.pool, {
      userId,
      endpoint,
      p256dh,
      auth,
      ...(typeof body.says === 'string' ? { says: body.says.slice(0, 80) } : {}),
    });
    json(res, 200, { ok: true });
    return;
  }

  if (path === '/api/push' && method === 'DELETE') {
    const body = (await readJson(req)) as { endpoint?: unknown };
    if (typeof body?.endpoint === 'string') await unsubscribePush(ctx.pool, body.endpoint);
    json(res, 200, { ok: true });
    return;
  }

  /* ── Ab hier braucht alles einen Arbeitsbereich ──────────────────────── */

  const workspaceId = await memberWorkspace(ctx, userId, url.searchParams.get('workspace'));
  if (workspaceId === null) {
    fail(res, 403, 'not_a_member', 'kein Zugriff auf diesen Arbeitsbereich');
    return;
  }

  /*
   * ── Und ab hier braucht fast alles eine Listenstufe ──────────────────────
   *
   * Mitglied zu sein heisst nicht, die Listen zu sehen. Eine Rolle ist (eine
   * Stufe, eine Menge von Rechten), und `list_level = NULL` heisst wirklich
   * nichts (ADR-0110, Konzept §7, `bootstrap.ts`). Bis zum Audit vom
   * 12.09.2026 (F01) stand diese Regel in drei Kommentaren und in KEINER
   * Route: `mayWriteLists` wurde nur beim Anlegen einer Freigabe gefragt, und
   * jede Aufgabenroute prüfte die Zeile in `workspace_members` und sonst
   * nichts. Ein viewer konnte patchen, ein Gast mit Konto alles lesen und
   * exportieren. Genau der Schalter, der nichts bewacht (ADR-0087).
   *
   * EINE Frage, EINMAL gestellt, VOR den Routen — und nicht sechzig Prüfungen
   * in sechzig Zweigen, von denen der einundsechzigste sie vergisst. Was
   * eine Route braucht, sagt `listAccessNeeded`; die Regel ist fail-closed:
   * ein neuer Weg braucht Schreibrecht, bis jemand ihn ausdrücklich in die
   * Liste der persönlichen oder verwaltenden Wege aufnimmt.
   *
   * Die Rechte (`people.manage` …) sind die ANDERE Hälfte der Rolle und von
   * der Stufe unabhängig: wer Leute verwalten darf, darf es auch ohne die
   * Listen zu sehen. Darum laufen die verwaltenden Wege an dieser Prüfung
   * vorbei — sie haben ihre eigenen Wächter, und `check-rights-enforced.mjs`
   * hält die im Bau fest.
   */
  const level = await effectiveListLevel(ctx.pool, userId, workspaceId);
  const need = listAccessNeeded(path, method);
  if (need !== 'none' && level === null) {
    fail(res, 403, 'no_list_level', 'deine Rolle hier zeigt dir keine Listen — nur, was dir freigegeben wurde');
    return;
  }
  if (need === 'write' && !levelWrites(level)) {
    fail(res, 403, 'read_only', 'deine Rolle hier liest mit, sie schreibt nicht');
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
      /*
       * Die Unteraufgaben, nach Elternteil geordnet.
       *
       * Mit der Liste und nicht beim Aufklappen: das Ziehen braucht sie schon
       * vorher — wer eine Aufgabe auf eine ZUGEKLAPPTE zieht, soll sie ans
       * Ende der Kinder setzen, und der Schlüssel dafür wird in der
       * Oberfläche gerechnet.
       */
      children: Object.fromEntries(
        Object.entries(
          await childrenOf(
            ctx.pool,
            workspaceId,
            rows.map((r) => r.id),
            withDone,
          ),
        ).map(([id, kinder]) => [id, kinder.map(taskView)]),
      ),
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

  /*
   * WOHIN MELDUNGEN GEHEN — je Person und Art.
   *
   * GEWÜNSCHT: „konfigurierbar machen, was per E-Mail benachrichtigt wird, über
   * die Oberfläche oder per App".
   *
   * Ohne Arbeitsbereich, denn die Wahl gehört dem KONTO: wer keine Mail über
   * Kommentare will, will sie in keinem Bereich. Darum steht die Route über
   * der Bereichsprüfung.
   */
  if (path === '/api/notification-channels' && method === 'GET') {
    const rows = await queryRows<{ kind: string; email: boolean; push: boolean }>(
      ctx.pool,
      'SELECT kind, email, push FROM notification_channels WHERE user_id = $1',
      [userId],
    );
    const gesetzt = new Map(rows.map((r) => [r.kind, { email: r.email, push: r.push }]));
    json(res, 200, {
      /*
       * Immer ALLE Arten, mit der geltenden Wahl — gesetzt oder Vorgabe. Die
       * Oberfläche soll nicht wissen müssen, was die Vorgaben sind: zwei
       * Stellen, die dieselbe Vorgabe kennen, laufen beim ersten Ändern
       * auseinander.
       */
      channels: NOTE_KINDS.map((kind) => ({
        kind,
        ...(gesetzt.get(kind) ?? channelDefaults(kind)),
        eigen: gesetzt.has(kind),
      })),
      /* Ob dieser Server überhaupt Mail verschicken kann — sonst ist der
         Schalter ein Versprechen ohne Deckung. */
      mailOn: mailConfig() !== undefined,
    });
    return;
  }

  if (path === '/api/notification-channels' && method === 'PUT') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const kind = body['kind'];
    if (!isNoteKind(kind)) {
      fail(res, 422, 'bad_kind', 'diese Art von Meldung gibt es nicht');
      return;
    }
    await setChannels(
      ctx.pool,
      userId,
      kind,
      body['channels'] === null
        ? null
        : {
            email: Boolean((body['channels'] as Record<string, unknown>)?.['email']),
            push: Boolean((body['channels'] as Record<string, unknown>)?.['push']),
          },
    );
    json(res, 200, { ok: true });
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

  /* ── Profilbilder ────────────────────────────────────────────────────────
   *
   * Verkleinert wird im **Browser** (ADR-0029): serverseitig hieße eine
   * Bildbibliothek im Container, mit eigenen Sicherheitsausgaben und einem Bau,
   * der sich je Architektur unterscheidet — für Arbeit, die die hochladende
   * Maschine hinter einem Fortschrittsbalken tun kann.
   *
   * Der Server **prüft** trotzdem, denn eine Verkleinerung im Browser ist eine
   * Zusage des Aufrufers: Typ und Größe stehen hier, und der CHECK in Migration
   * 0021 steht noch einmal darunter. Was er nicht prüft, ist die Kantenlänge —
   * dafür bräuchte er die Bibliothek, die er gerade nicht haben will, und der
   * Deckel in Bytes fängt denselben Missbrauch.
   */
  if (path === '/api/me/picture' && method === 'PUT') {
    const typ = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!isAvatarType(typ)) {
      fail(res, 415, 'bad_type', 'nur JPEG, PNG oder WebP');
      return;
    }
    const stücke: Buffer[] = [];
    let größe = 0;
    let zuGroß = false;
    for await (const stück of req) {
      größe += (stück as Buffer).length;
      if (größe > AVATAR_MAX_BYTES) {
        /*
         * Abbrechen, **während** es kommt, und nicht danach messen.
         *
         * Sonst hält der Server erst ein Gigabyte im Speicher und sagt dann,
         * dass es zu groß war — ein Deckel, der erst nach dem Schaden gilt,
         * ist keiner.
         */
        zuGroß = true;
        break;
      }
      stücke.push(stück as Buffer);
    }
    if (zuGroß) {
      req.destroy();
      fail(res, 413, 'too_big', 'das Bild ist zu groß — es sollte verkleinert ankommen');
      return;
    }
    if (größe === 0) {
      fail(res, 400, 'empty', 'kein Bild dabei');
      return;
    }
    await ctx.pool.query(
      `INSERT INTO user_avatars (user_id, content_type, bytes)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE
         SET content_type = EXCLUDED.content_type,
             bytes = EXCLUDED.bytes,
             updated_at = now()`,
      [userId, typ, Buffer.concat(stücke)],
    );
    json(res, 200, { ok: true });
    return;
  }

  if (path === '/api/me/picture' && method === 'DELETE') {
    await ctx.pool.query('DELETE FROM user_avatars WHERE user_id = $1', [userId]);
    json(res, 200, { ok: true });
    return;
  }

  const bildPath = /^\/api\/users\/([0-9a-f-]{36})\/picture$/.exec(path);
  if (bildPath !== null && method === 'GET') {
    /*
     * Das Bild eines **anderen** — hinter der Anmeldeschranke.
     *
     * Es gehört in Listen (Leute, Konten, Kommentare), also muss es zu einer
     * fremden Kennung abrufbar sein. Ohne Prüfung, welchen Arbeitsbereich man
     * teilt: ein Profilbild ist das, was jemand über sich zeigt, und die Frage
     * „darf ich dein Bild sehen" wäre eine Rechtefläche für etwas, das man
     * ohnehin neben seinem Namen sieht.
     */
    const row = await queryOne<{ content_type: string; bytes: Buffer; updated_at: Date }>(
      ctx.pool,
      'SELECT content_type, bytes, updated_at FROM user_avatars WHERE user_id = $1',
      [bildPath[1]!],
    );
    if (row === undefined) {
      // 404 und kein Platzhalterbild: wer keines hat, hat keines, und die
      // Oberfläche zeichnet dann ihre Initialen — die kennt sie schon.
      fail(res, 404, 'no_picture', 'kein Bild');
      return;
    }
    const etag = `"${row.updated_at.getTime()}"`;
    if (req.headers['if-none-match'] === etag) {
      // Ein Bild ändert sich selten. Ohne ETag holt ein Browser es bei jedem
      // Zeichnen neu — bei einer Liste mit zwanzig Leuten zwanzigmal.
      res.statusCode = 304;
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': row.content_type,
      'content-length': String(row.bytes.length),
      etag,
      // Kurz, aber nicht null: wer sein Bild wechselt, will es sehen, und die
      // Liste daneben soll nicht eine Minute lang das alte zeigen.
      'cache-control': 'private, max-age=60, must-revalidate',
    });
    res.end(row.bytes);
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
  /*
   * ── Schlagwörter eines Arbeitsbereichs ───────────────────────────────────
   *
   * Vergeben werden sie an der Aufgabe; hier steht, was danach kommt:
   * nachsehen, einen Tippfehler richtigstellen, ein totes wegräumen. Ohne das
   * wäre ein Vokabular, das nur wachsen kann — und `unterwegs` neben
   * `unterweg` bekäme niemand mehr zusammen.
   *
   * LESEN DARF JEDES MITGLIED. Die Liste sagt nichts, was die Suche nicht
   * ohnehin zeigt; sie zu verstecken hieße, ein Wort geheim zu halten, das an
   * jeder Zeile steht.
   *
   * ÄNDERN BRAUCHT `workspace.settings`. Kein fünftes Recht dafür: ein
   * Schlagwort gehört dem Arbeitsbereich wie sein Name und seine Farben, und
   * ein Name mehr im Rechte-Vokabular ist einer, den jemand in jeder Rolle
   * einzeln entscheiden muss.
   */
  /*
   * ── Der Kalender-Link dieser Person in diesem Bereich ────────────────────
   *
   * Je Person und nicht je Bereich: der Link ist ein Passwort-Ersatz, und ein
   * gemeinsamer wäre einer, den niemand allein widerrufen kann. Darum braucht
   * es hier auch kein Recht — wer Mitglied ist, darf sich selbst einen machen,
   * und er zeigt nichts, was die Listen nicht ohnehin zeigen.
   */
  if (path === '/api/calendar' && method === 'GET') {
    const feed = await feedOf(ctx.pool, workspaceId, userId);
    json(res, 200, {
      // Der Schlüssel der Instanz fehlt? Dann sagt das die Antwort, statt
      // einen Knopf anzubieten, der nichts tut.
      possible: calendarKeyPresent(),
      base: baseUrl() ?? null,
      feed:
        feed === undefined
          ? null
          : {
              token: feed.token,
              createdAt: feed.created_at.toISOString(),
              lastUsedAt: feed.last_used_at?.toISOString() ?? null,
            },
    });
    return;
  }

  if (path === '/api/calendar' && (method === 'POST' || method === 'DELETE')) {
    try {
      if (method === 'DELETE') {
        await revokeFeed(ctx.pool, workspaceId, userId);
        json(res, 200, { ok: true });
        return;
      }
      const out = await newFeed(ctx.pool, workspaceId, userId);
      json(res, 201, { token: out.token });
      return;
    } catch (e) {
      if (e instanceof NoCalendar) {
        fail(res, 409, 'no_calendar', e.message);
        return;
      }
      throw e;
    }
  }

  /*
   * ── Wie dicht eine Liste gezeichnet wird ─────────────────────────────────
   *
   * Die Wahl gehört der PERSON und dem Ort zusammen, darum kein Recht: sie
   * ändert nichts, was ein anderer sieht. Die Vorgabe des Arbeitsbereichs
   * liegt bei den Einstellungen und wird dort auch bewacht.
   */
  /*
   * ── Die Tafel: Spalten einer Liste ───────────────────────────────────────
   *
   * Gelesen darf jedes Mitglied, geändert auch: Spalten sind die Gliederung
   * eines Vorhabens und keine Einstellung des Arbeitsbereichs — wer die
   * Aufgaben darin bearbeiten darf, darf auch sagen, wie sie liegen.
   */
  if (path === '/api/board' && method === 'GET') {
    const projectId = url.searchParams.get('project');
    if (projectId === null) {
      fail(res, 400, 'no_project', 'welche Liste?');
      return;
    }
    json(res, 200, { columns: await columnsOf(ctx.pool, workspaceId, projectId) });
    return;
  }

  if (path === '/api/board' && method === 'POST') {
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      const column = await addColumn(ctx.pool, workspaceId, String(body?.['project'] ?? ''), {
        name: String(body?.['name'] ?? ''),
        sortKey: String(body?.['sortKey'] ?? ''),
        ...(body?.['isDone'] === true ? { isDone: true } : {}),
      });
      json(res, 201, { column });
      return;
    } catch (e) {
      if (e instanceof BoardTrouble) {
        fail(res, 409, 'board_trouble', e.message);
        return;
      }
      throw e;
    }
  }

  const spalte = /^\/api\/board\/([0-9a-f-]{36})$/.exec(path);
  if (spalte !== null && (method === 'PATCH' || method === 'DELETE')) {
    try {
      if (method === 'DELETE') {
        await removeColumn(ctx.pool, workspaceId, spalte[1]!);
        json(res, 200, { ok: true });
        return;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      const column = await updateColumn(ctx.pool, workspaceId, spalte[1]!, {
        ...(typeof body?.['name'] === 'string' ? { name: body['name'] } : {}),
        ...(typeof body?.['sortKey'] === 'string' ? { sortKey: body['sortKey'] } : {}),
        ...(typeof body?.['isDone'] === 'boolean' ? { isDone: body['isDone'] } : {}),
      });
      json(res, 200, { column });
      return;
    } catch (e) {
      if (e instanceof BoardTrouble) {
        fail(res, 409, 'board_trouble', e.message);
        return;
      }
      throw e;
    }
  }

  const karte = /^\/api\/tasks\/([0-9a-f-]{36})\/column$/.exec(path);
  if (karte !== null && method === 'PUT') {
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      await placeCard(
        ctx.pool,
        workspaceId,
        karte[1]!,
        typeof body?.['columnId'] === 'string' ? body['columnId'] : null,
        userId,
        now,
        {
          // Fehlend heißt „Reihenfolge lassen" — `null` heißt „ganz nach
          // oben". Zwei verschiedene Dinge, wie beim Umhängen.
          ...('afterId' in (body ?? {})
            ? { afterId: body['afterId'] === null ? null : String(body['afterId']) }
            : {}),
          ...('beforeId' in (body ?? {})
            ? { beforeId: body['beforeId'] === null ? null : String(body['beforeId']) }
            : {}),
        },
      );
      json(res, 200, { ok: true });
      return;
    } catch (e) {
      if (e instanceof BoardTrouble) {
        fail(res, 409, 'board_trouble', e.message);
        return;
      }
      throw e;
    }
  }

  if (path === '/api/list-views' && method === 'GET') {
    json(res, 200, await listViewsOf(ctx.pool, workspaceId, userId));
    return;
  }

  if (path === '/api/list-views' && method === 'PUT') {
    const body = (await readJson(req)) as Record<string, unknown>;
    try {
      await setListView(ctx.pool, {
        workspaceId,
        userId,
        ...(typeof body?.['projectId'] === 'string'
          ? { projectId: body['projectId'] }
          : {}),
        ...(typeof body?.['place'] === 'string' ? { place: body['place'] } : {}),
        // `null` heißt „wie der Arbeitsbereich sagt" und ist eine eigene
        // Antwort — nicht dasselbe wie „voll".
        display: body?.['display'] === null ? null : (body?.['display'] as never),
      });
      json(res, 200, { ok: true });
      return;
    } catch (e) {
      if (e instanceof ViewTrouble) {
        fail(res, 409, 'view_trouble', e.message);
        return;
      }
      throw e;
    }
  }

  if (path === '/api/labels' && method === 'GET') {
    json(res, 200, {
      labels: await labelsOfWorkspace(ctx.pool, workspaceId),
      mayManage: await mayDo(ctx.pool, userId, workspaceId, 'workspace.settings'),
    });
    return;
  }

  const labelPath = /^\/api\/labels\/([0-9a-f-]{36})$/.exec(path);
  if (labelPath !== null && (method === 'PATCH' || method === 'DELETE')) {
    if (!(await mayDo(ctx.pool, userId, workspaceId, 'workspace.settings'))) {
      fail(res, 403, 'not_allowed', 'Schlagwörter zu ändern darfst du hier nicht');
      return;
    }
    const id = labelPath[1]!;
    try {
      if (method === 'DELETE') {
        await removeLabel(ctx.pool, workspaceId, id);
        json(res, 200, { ok: true });
        return;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      /*
       * Die Farbe allein: dann wird nicht umbenannt.
       *
       * Umbenennen kann zwei Schlagwörter zusammenführen — das Färben nie. Ein
       * Aufruf, der nur färben will, soll nicht durch die Zusammenführung
       * laufen müssen.
       */
      if ('color' in (body ?? {}) && !('name' in (body ?? {}))) {
        await colorLabel(
          ctx.pool,
          workspaceId,
          id,
          body['color'] === null ? null : String(body['color']),
        );
        json(res, 200, { ok: true });
        return;
      }
      const out = await renameLabel(ctx.pool, workspaceId, id, String(body?.['name'] ?? ''));
      json(res, 200, out);
      return;
    } catch (e) {
      if (e instanceof LabelTrouble) {
        fail(res, 409, 'label_trouble', e.message);
        return;
      }
      throw e;
    }
  }

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
      /*
       * Ob diese Person Freigaben anlegen, widerrufen — und darum auch ihre
       * Tokens sehen darf. Dieselbe Frage wie bei POST und DELETE.
       */
      mayManage: levelWrites(level),
      shares: (await listShares(ctx.pool, workspaceId)).map((s) => ({
        id: s.id,
        projectId: s.project_id,
        projectName: s.projectName,
        right: s.right_level,
        /*
         * `null` heißt: mit diesem Schlüssel nicht anzeigbar — ODER nicht
         * für diese Person. Ein Token IST das Recht des Links; wer ihn liest,
         * kann anonym mit dessen Stufe schreiben. Ein viewer, der hier einen
         * Bearbeitungslink ablesen konnte, hatte damit mehr als seine Rolle
         * (Audit 12.09.2026, F02). Die Zeile bleibt sichtbar: dass es eine
         * Freigabe gibt, darf jeder wissen, der die Liste sieht.
         */
        token: levelWrites(level) ? s.token : null,
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
    const body = (await readJson(req)) as {
      line?: unknown;
      projectId?: unknown;
      assigneeIds?: unknown;
    };
    const line = typeof body?.line === 'string' ? body.line : '';
    if (line.trim() === '') {
      fail(res, 400, 'empty_line', 'ohne Text keine Aufgabe');
      return;
    }
    /*
     * Wer als Pille im Feld stand — Konto-Ids. Nur Ids, die wie eine aussehen;
     * ob sie Mitglied sind, prüft `createFromLine` und lehnt sonst ab.
     */
    const assigneeIds = Array.isArray(body?.assigneeIds)
      ? body.assigneeIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x))
      : [];
    const out = await createFromLine(ctx.pool, {
      zone,
      workspaceId,
      userId,
      line,
      now,
      projectId: typeof body?.projectId === 'string' ? body.projectId : null,
      assigneeIds,
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
    const body = (await readJson(req)) as {
      afterId?: unknown;
      beforeId?: unknown;
      parentId?: unknown;
    };
    try {
      const row = await move(ctx.pool, move_[1]!, workspaceId, {
        afterId: typeof body?.afterId === 'string' ? body.afterId : null,
        beforeId: typeof body?.beforeId === 'string' ? body.beforeId : null,
        /*
         * Der Schlüssel muss FEHLEN dürfen: „nicht umhängen" und „ganz nach
         * oben hängen" sind zwei Dinge, und `null` ist das zweite. Ohne diese
         * Unterscheidung würde jedes Umsortieren innerhalb einer Aufgabe die
         * Unteraufgabe nach oben werfen.
         */
        ...('parentId' in (body ?? {})
          ? { parentId: body.parentId === null ? null : String(body.parentId) }
          : {}),
      });
      json(res, 200, { task: taskView(row) });
      return;
    } catch (e) {
      if (e instanceof OutOfOrder) {
        fail(res, 409, 'out_of_order', e.message);
        return;
      }
      throw e;
    }
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
    const body = (await readJson(req)) as { body?: unknown; parentId?: unknown };
    const comment = await addComment(
      ctx.pool,
      talk[1]!,
      workspaceId,
      userId,
      typeof body?.body === 'string' ? body.body : '',
      undefined,
      /* Worauf geantwortet wird — der Server loest auf eine Ebene auf. */
      typeof body?.parentId === 'string' ? body.parentId : null,
    );
    json(res, 201, {
      comment: { ...comment, createdAt: comment.createdAt.toISOString() },
    });
    return;
  }

  /*
   * Anhänge: hochladen, holen, wegnehmen.
   *
   * ROHE BYTES und kein Multipart — dieselbe Bauart wie beim Profilbild
   * (`PUT /api/me/picture`). Der Dateiname kommt als `?name=`, der Typ aus
   * `content-type`. Ein Multipart-Leser wäre ein Parser, den ich schreiben
   * müsste, für einen Vorteil, den niemand sieht: der Browser kann `fetch` mit
   * einem `File` als Körper genauso gut.
   *
   * Die Größe wird STÜCKWEISE geprüft und die Verbindung abgebrochen. Erst
   * alles einzulesen und dann zu messen heißt, dass eine Datei von zwei
   * Gigabyte zuerst im Arbeitsspeicher liegt.
   */
  const fileList = /^\/api\/tasks\/([0-9a-f-]{36})\/files$/.exec(path);
  if (fileList && method === 'POST') {
    const taskId = fileList[1]!;
    if (filesDir() === undefined) {
      fail(res, 501, 'files_off', 'dieser Server nimmt keine Anhänge');
      return;
    }
    // Liegt die Aufgabe in DIESEM Arbeitsbereich? Sonst legt eine geratene Id
    // eine Datei an etwas, das man nicht sehen darf.
    await detail(ctx.pool, taskId, workspaceId);

    const grenze = maxBytes();
    const stücke: Buffer[] = [];
    let größe = 0;
    let zuGroß = false;
    for await (const stück of req) {
      größe += (stück as Buffer).length;
      if (größe > grenze) {
        zuGroß = true;
        break;
      }
      stücke.push(stück as Buffer);
    }
    if (zuGroß) {
      req.destroy();
      fail(res, 413, 'too_big', `größer als ${Math.floor(grenze / 1024 / 1024)} MB`);
      return;
    }
    if (größe === 0) {
      fail(res, 400, 'empty', 'keine Datei dabei');
      return;
    }
    const f = await addFile(ctx.pool, {
      taskId,
      workspaceId,
      userId,
      filename: url.searchParams.get('name') ?? 'Datei',
      mimeType: (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim(),
      bytes: Buffer.concat(stücke),
    });
    json(res, 200, { file: { ...f, createdAt: f.createdAt.toISOString() } });
    return;
  }

  /*
   * Die kleine Fassung nachreichen — im Browser gerechnet.
   *
   * Der Server rechnet sie nicht selbst: eine Leitung, die eine 8-MB-Aufnahme
   * hochträgt, trägt sie langsam, und wer im Browser rechnet, überträgt
   * zweimal wenig statt einmal viel. Ausserdem wäre es Rechenzeit auf der
   * Maschine, die davon am wenigsten hat.
   */
  const fileWeb = /^\/api\/tasks\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})\/web$/.exec(path);
  if (fileWeb && method === 'PUT') {
    if (filesDir() === undefined) {
      fail(res, 501, 'files_off', 'dieser Server nimmt keine Anhänge');
      return;
    }
    await detail(ctx.pool, fileWeb[1]!, workspaceId);
    const grenze = maxBytes();
    const stücke: Buffer[] = [];
    let größe = 0;
    for await (const stück of req) {
      größe += (stück as Buffer).length;
      if (größe > grenze) {
        req.destroy();
        fail(res, 413, 'too_big', 'die kleine Fassung ist zu groß');
        return;
      }
      stücke.push(stück as Buffer);
    }
    const ok = await attachWeb(ctx.pool, {
      id: fileWeb[2]!,
      taskId: fileWeb[1]!,
      workspaceId,
      bytes: Buffer.concat(stücke),
    });
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  const fileOne = /^\/api\/tasks\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/.exec(path);
  if (fileOne && method === 'GET') {
    const got = await readFileOf(ctx.pool, {
      id: fileOne[2]!,
      taskId: fileOne[1]!,
      workspaceId,
      // `?size=web` ist eine BITTE: gibt es keine kleine Fassung, kommt das
      // Original. Eine Vorschau, die 404 sagt, weil ein Bild zu klein für eine
      // zweite Fassung war, wäre ein Fehler, den die Regel selbst gemacht hat.
      ...(url.searchParams.get('size') === 'web' ? { size: 'web' as const } : {}),
    });
    if (got === undefined) {
      fail(res, 404, 'no_file', 'diesen Anhang gibt es nicht');
      return;
    }
    /*
     * `attachment` ist die VORGABE, und sie hat einen Grund: ohne sie öffnet
     * der Browser eine hochgeladene HTML-Datei IM Kontext dieser Anwendung,
     * und damit kann sie an die Sitzung. `nosniff` dazu, damit er den Typ
     * nicht selbst errät.
     *
     * `?inline=1` bittet um das Gegenteil — und bekommt es nur für Arten, die
     * nichts ausführen können (`isInlineSafe`). Gemeldet war der Fall, der das
     * nötig machte: ein PDF in der Vorschau startete den Download, weil ein
     * `<object>` sich an diese Kopfzeile hält (ein `<img>` tut es nicht, darum
     * gingen Bilder).
     *
     * Die BITTE entscheidet nicht, die Art entscheidet: wer `?inline=1` an
     * eine HTML-Datei hängt, bekommt trotzdem `attachment`.
     */
    const inline =
      url.searchParams.get('inline') === '1' && isInlineSafe(got.file.mimeType);
    res.writeHead(200, {
      'content-type': got.file.mimeType,
      'content-length': String(got.bytes.length),
      'x-content-type-options': 'nosniff',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(got.file.filename)}`,
    });
    res.end(got.bytes);
    return;
  }

  if (fileOne && method === 'DELETE') {
    const weg = await removeFile(ctx.pool, {
      id: fileOne[2]!,
      taskId: fileOne[1]!,
      workspaceId,
    });
    if (!weg) {
      fail(res, 404, 'no_file', 'diesen Anhang gibt es nicht');
      return;
    }
    json(res, 200, { ok: true });
    return;
  }

  /*
   * Erinnerungen an einer Aufgabe: setzen und wegnehmen.
   *
   * Eigene Wege und kein Feld in `PATCH`: eine Aufgabe hat MEHRERE, und ein
   * Feld, das eine Liste ganz ersetzt, wäre hier falsch — zwei Leute setzen
   * jeder ihre eigene, und wer als Zweiter schreibt, würde die des Ersten
   * wegnehmen. (Bei den Zuständigen ist es umgekehrt richtig: dort ist die
   * Liste eine Aussage über die Aufgabe, hier ist jede Zeile eine über eine
   * Person.)
   */
  const remOne = /^\/api\/tasks\/([0-9a-f-]{36})\/reminders$/.exec(path);
  if (remOne && method === 'POST') {
    const taskId = remOne[1]!;
    // Erst prüfen, ob die Aufgabe in DIESEM Arbeitsbereich liegt: sonst setzt
    // eine geratene Id eine Erinnerung an etwas, das man nicht sehen darf.
    const d = await detail(ctx.pool, taskId, workspaceId);
    // Der Körper wird je Route gelesen — es gibt kein globales `body`.
    const b = (await readJson(req)) as Record<string, unknown>;
    const rem =
      'minutes' in b
        ? ({ kind: 'before', minutes: Number(b['minutes']) } as const)
        : ({ kind: 'at', at: new Date(String(b['at'])) } as const);
    if (rem.kind === 'before' && (!Number.isInteger(rem.minutes) || rem.minutes < 0)) {
      throw new OutOfOrder('ein Vorlauf ist eine ganze Zahl Minuten, nicht negativ');
    }
    if (rem.kind === 'at' && Number.isNaN(rem.at.getTime())) {
      throw new OutOfOrder('`at` ist kein Zeitpunkt');
    }
    await addReminder(ctx.pool, { taskId, userId, reminder: rem });
    json(
      res,
      200,
      detailView(
        d,
        await remindersOf(ctx.pool, taskId, d.task.planned_at, zone),
        await filesOf(ctx.pool, taskId),
      ),
    );
    return;
  }

  const remDel = /^\/api\/tasks\/([0-9a-f-]{36})\/reminders\/([0-9a-f-]{36})$/.exec(path);
  if (remDel && method === 'DELETE') {
    const taskId = remDel[1]!;
    const d = await detail(ctx.pool, taskId, workspaceId);
    // Nur die eigene — die Bedingung steht im Schreibweg selbst.
    const weg = await removeReminder(ctx.pool, { id: remDel[2]!, taskId, userId });
    if (!weg) throw new NotFound('diese Erinnerung gibt es nicht (oder sie ist nicht deine)');
    json(
      res,
      200,
      detailView(
        d,
        await remindersOf(ctx.pool, taskId, d.task.planned_at, zone),
        await filesOf(ctx.pool, taskId),
      ),
    );
    return;
  }

  const one = /^\/api\/tasks\/([0-9a-f-]{36})$/.exec(path);
  if (one && method === 'GET') {
    const d = await detail(ctx.pool, one[1]!, workspaceId);
    json(
      res,
      200,
      // `zone` steht schon bereit — aus der Anfrage, wie überall hier. Meine
      // erfundene `zoneOf` hätte eine zweite Quelle für dieselbe Angabe
      // gewesen.
      detailView(
        d,
        await remindersOf(ctx.pool, one[1]!, d.task.planned_at, zone),
        await filesOf(ctx.pool, one[1]!),
      ),
    );
    return;
  }

  if (one && method === 'PATCH') {
    const body = (await readJson(req)) as Record<string, unknown>;
    const row = await patch(ctx.pool, one[1]!, workspaceId, readPatch(body), userId);
    json(res, 200, { task: taskView(row) });
    return;
  }

  fail(res, 404, 'no_route', `${method} ${path} gibt es nicht`);
}
