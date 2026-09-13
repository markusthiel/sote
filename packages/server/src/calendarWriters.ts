/** Einseitige Veröffentlichung von Aufgaben. Nur selbst angelegte Ressourcen werden geändert. */
import { buildCalDavEvent, type IcsTask } from '@sote/core';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { queryOne, queryRows, type PoolClient } from './db.js';
import { enqueue, handle } from './jobs.js';
import { keyPresent, seal, unseal } from './secretbox.js';
import { effectiveListLevel } from './settings.js';
import { baseUrl } from './env.js';
import { rejectedPutError } from './caldavDiagnostics.js';
import { calendarUrl, CalDavError, CalDavConflict, checkCalendar, davFailure, davRequest, eventFingerprint, eventUid, strongEtag,
  type CalDavCredentials, type DavTransport } from './caldav.js';

type Mode = 'planned' | 'due' | 'both';
interface WriterRow {
  id: string; feed_id: string; credentials_sealed: string; workspaces: string[]; mode: Mode;
  timezone: string; enabled: boolean; synced_at: Date | null; last_error: string | null; conflict_uid: string | null;
}
export interface CalendarWriter {
  enabled: boolean; workspaces: string[]; mode: Mode; timezone: string;
  syncedAt: string | null; lastError: string | null; count: number; conflict: boolean;
}
interface WrittenEvent {
  writer_id: string; task_id: string; kind: 'plan' | 'due'; uid: string;
  etag: string | null; content_hash: string | null; pending_hash: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function writerStatus(pool: Pool, userId: string): Promise<Record<string, CalendarWriter>> {
  const rows = await queryRows<WriterRow & { count: string }>(pool,
    `SELECT w.id, w.feed_id, w.workspaces, w.mode, w.timezone, w.enabled, w.synced_at, w.last_error, w.conflict_uid,
       (SELECT count(*) FROM calendar_write_events e WHERE e.writer_id = w.id AND e.content_hash IS NOT NULL) AS count
       FROM calendar_writers w JOIN calendar_sources f ON f.id = w.feed_id WHERE f.user_id = $1`, [userId]);
  return Object.fromEntries(rows.map((r) => [r.feed_id, {
    enabled: r.enabled, workspaces: r.workspaces, mode: r.mode, timezone: r.timezone,
    syncedAt: r.synced_at?.toISOString() ?? null, lastError: r.last_error, count: Number(r.count), conflict: r.conflict_uid !== null,
  }]));
}

/** Derselbe Lock schützt Läufer, Konfigurationswechsel und Entfernen der Quelle. */
export async function withCalendarWriteLock<T>(pool: Pool, feedId: string, fn: (db: PoolClient) => Promise<T>, tryOnly = false): Promise<T | undefined> {
  const db = await pool.connect();
  let locked = false;
  try {
    if (tryOnly) {
      locked = (await queryOne<{ locked: boolean }>(db, 'SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`calendar-writer:${feedId}`]))!.locked;
      if (!locked) return undefined;
    } else { await db.query('SELECT pg_advisory_lock(hashtext($1))', [`calendar-writer:${feedId}`]); locked = true; }
    return await fn(db);
  } finally {
    try { if (locked) await db.query('SELECT pg_advisory_unlock(hashtext($1))', [`calendar-writer:${feedId}`]); }
    finally { db.release(); }
  }
}

export async function assertSource(db: Pool | PoolClient, userId: string, feedId: string): Promise<void> {
  if (!await queryOne(db, 'SELECT id FROM calendar_sources WHERE id = $1 AND user_id = $2', [feedId, userId])) throw new CalDavError('Diesen Kalender gibt es nicht.');
}

export function readWriterInput(body: Record<string, unknown>): {
  workspaces: string[]; mode: Mode; timezone: string; enabled: boolean;
  url?: string; username?: string; password?: string;
} {
  const workspaces = body['workspaces'];
  const mode = body['mode'];
  const timezone = body['timezone'];
  if (!Array.isArray(workspaces) || workspaces.length === 0 || workspaces.length > 100 || workspaces.some((id) => typeof id !== 'string' || !uuid.test(id))) {
    throw new CalDavError('Mindestens einen gültigen Arbeitsbereich auswählen.');
  }
  if (mode !== 'planned' && mode !== 'due' && mode !== 'both') throw new CalDavError('Geplante Aufgaben, Fristen oder beides auswählen.');
  if (typeof timezone !== 'string' || timezone.length > 100) throw new CalDavError('Eine gültige Zeitzone angeben.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new CalDavError('Die Zeitzone ist ungültig.'); }
  if (typeof body['enabled'] !== 'boolean') throw new CalDavError('Angeben, ob das Schreiben eingeschaltet ist.');
  for (const field of ['url', 'username', 'password']) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || (body[field] as string).length > 4096)) throw new CalDavError('Die Zugangsdaten sind ungültig.');
  }
  const username = typeof body['username'] === 'string' ? body['username'].trim() : undefined;
  if (username?.includes(':') || /[\r\n]/.test(username ?? '')) throw new CalDavError('Der Benutzername darf keinen Doppelpunkt oder Zeilenumbruch enthalten.');
  return { workspaces: [...new Set(workspaces as string[])], mode, timezone, enabled: body['enabled'],
    ...(body['url'] ? { url: calendarUrl(body['url'] as string) } : {}),
    ...(username ? { username } : {}), ...(body['password'] ? { password: body['password'] as string } : {}),
  };
}

function credentialsOf(row: WriterRow): CalDavCredentials {
  const plain = unseal(row.credentials_sealed);
  if (!plain) throw new CalDavError('Der gespeicherte Schreibzugang kann nicht entschlüsselt werden. Zugang erneut eintragen.');
  return JSON.parse(plain) as CalDavCredentials;
}

export async function saveWriter(pool: Pool, userId: string, feedId: string, raw: Record<string, unknown>, transport: DavTransport = davRequest): Promise<void> {
  const input = readWriterInput(raw);
  if (!keyPresent()) throw new CalDavError('Für den Schreibzugang fehlt SOTE_SHARE_KEY.');
  await withCalendarWriteLock(pool, feedId, async (db) => {
    await assertSource(db, userId, feedId);
    for (const workspace of input.workspaces) if (await effectiveListLevel(db, userId, workspace) === null) throw new CalDavError('Du kannst nicht alle gewählten Arbeitsbereiche lesen.');
    const old = await queryOne<WriterRow>(db, 'SELECT * FROM calendar_writers WHERE feed_id = $1', [feedId]);
    const source = !old ? await queryOne<{ caldav_credentials_sealed: string | null }>(db,
      'SELECT caldav_credentials_sealed FROM calendar_sources WHERE id=$1', [feedId]) : undefined;
    const readAccess = source?.caldav_credentials_sealed && unseal(source.caldav_credentials_sealed);
    const prior = old && !(input.url && input.username && input.password) ? credentialsOf(old)
      : !old && readAccess ? JSON.parse(readAccess) as CalDavCredentials : undefined;
    const credentials = { url: input.url ?? prior?.url ?? '', username: input.username ?? prior?.username ?? '', password: input.password ?? prior?.password ?? '' };
    if (!credentials.url || !credentials.username || !credentials.password) throw new CalDavError('Kalenderadresse, Benutzername und App-Kennwort angeben.');
    if (old) {
      // Ein anderes Ziel darf die Quittungen des alten Ziels nicht übernehmen.
      const previous = unseal(old.credentials_sealed);
      if (!previous || (JSON.parse(previous) as CalDavCredentials).url !== credentials.url) {
        if (await queryOne(db, 'SELECT 1 FROM calendar_write_events WHERE writer_id = $1 LIMIT 1', [old.id])) {
          throw new CalDavError('Zum Wechsel der Kalenderadresse zuerst die Verbindung trennen. Vorhandene Kopien bleiben im bisherigen Kalender.');
        }
      }
    }
    await checkCalendar(credentials, transport);
    await db.query(`INSERT INTO calendar_writers (feed_id, credentials_sealed, workspaces, mode, timezone, enabled)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (feed_id) DO UPDATE SET credentials_sealed=$2,
      workspaces=$3, mode=$4, timezone=$5, enabled=$6, last_error=NULL`,
      [feedId, seal(JSON.stringify(credentials)), input.workspaces, input.mode, input.timezone, input.enabled]);
  });
  if (input.enabled) await requestWrite(pool, feedId);
}

export async function disconnectWriter(pool: Pool, userId: string, feedId: string): Promise<void> {
  await withCalendarWriteLock(pool, feedId, async (db) => {
    await assertSource(db, userId, feedId);
    await db.query('DELETE FROM calendar_writers WHERE feed_id = $1', [feedId]);
  });
}

export async function pauseWriter(pool: Pool, userId: string, feedId: string): Promise<void> {
  await withCalendarWriteLock(pool, feedId, async (db) => {
    await assertSource(db, userId, feedId);
    await db.query('UPDATE calendar_writers SET enabled=false WHERE feed_id=$1', [feedId]);
  });
}

/** Erst auf ausdrücklichen Knopfdruck wird die aktuelle fremde Version als Ausgangsstand akzeptiert. */
export async function acceptWriterConflict(pool: Pool, userId: string, feedId: string, transport: DavTransport = davRequest): Promise<void> {
  await withCalendarWriteLock(pool, feedId, async (db) => {
    await assertSource(db, userId, feedId);
    const writer = await queryOne<WriterRow>(db, 'SELECT * FROM calendar_writers WHERE feed_id=$1', [feedId]);
    if (!writer?.conflict_uid) throw new CalDavError('Für diesen Kalender liegt kein gemeldeter Konflikt vor.');
    const entry = await queryOne<WrittenEvent>(db, 'SELECT * FROM calendar_write_events WHERE writer_id=$1 AND uid=$2', [writer.id, writer.conflict_uid]);
    if (!entry) throw new CalDavError('Der gemeldete Kalendereintrag ist nicht mehr vorhanden.');
    const credentials = credentialsOf(writer);
    const remote = await transport(`${credentials.url}${entry.uid.split('@')[0]}.ics`, credentials, 'GET');
    if (remote.status !== 404) {
      if (remote.status !== 200) throw davFailure(remote.status);
      if (!strongEtag(remote.etag) || eventUid(remote.body) !== entry.uid) throw new CalDavError('Die fremde Ressource gehört nicht mehr zu diesem SOTE-Eintrag. Bitte im Kalenderdienst prüfen.');
    }
    await db.query('UPDATE calendar_write_events SET etag=$3, content_hash=NULL, pending_hash=NULL WHERE writer_id=$1 AND uid=$2', [writer.id, entry.uid, remote.status === 404 ? null : remote.etag]);
    await db.query('UPDATE calendar_writers SET conflict_uid=NULL, last_error=NULL WHERE id=$1', [writer.id]);
  });
  await requestWrite(pool, feedId);
}

export const requestWrite = (pool: Pool, feedId: string) => enqueue(pool, 'calendars.write', { payload: { feedId }, uniqueKey: `calendars.write:${feedId}` });

function remoteFingerprint(body: string): string {
  try { return eventFingerprint(body); } catch { throw davFailure(412); }
}

/** Kurze, stabile Kennung: lange UIDs werden von iCloud teils als HTTP 404 abgelehnt. */
export const calendarEventUid = (writerId: string, taskId: string, kind: 'plan' | 'due'): string =>
  createHash('sha256').update(JSON.stringify([writerId, taskId, kind])).digest('hex').slice(0, 32);

/** Nur nie bestätigte Altversuche reparieren, und erst nach Nachweis, dass ihre Ressource fehlt. */
export async function prepareWrittenEvent(credentials: CalDavCredentials, entry: WrittenEvent, transport: DavTransport): Promise<WrittenEvent> {
  const legacy = `sote-${entry.writer_id}-${entry.task_id}-${entry.kind}@sote`;
  if (entry.uid !== legacy || entry.etag !== null || entry.content_hash !== null ||
      !/^(?:p\d+-)?caldav\.icloud\.com$/.test(new URL(credentials.url).hostname)) return entry;
  const current = await transport(`${credentials.url}${entry.uid.split('@')[0]}.ics`, credentials, 'GET');
  if (current.status === 200) return entry;
  if (current.status !== 404) throw davFailure(current.status);
  return { ...entry, uid: calendarEventUid(entry.writer_id, entry.task_id, entry.kind), pending_hash: null };
}

/** Bedingte PUTs verhindern verlorene fremde Änderungen. Ein verlorenes Antwortpaket erzeugt kein Duplikat. */
export async function putEvent(credentials: CalDavCredentials, written: WrittenEvent, ics: string, transport: DavTransport): Promise<string> {
  const url = `${credentials.url}${written.uid.split('@')[0]}.ics`;
  const headers = written.etag === null ? { 'if-none-match': '*' } : { 'if-match': written.etag };
  const response = await transport(url, credentials, 'PUT', ics, headers);
  if (response.status === 412 || ((response.status === 200 || response.status === 201 || response.status === 204) && !strongEtag(response.etag))) {
    const current = await transport(url, credentials, 'GET');
    if (current.status !== 200 || !strongEtag(current.etag) || remoteFingerprint(current.body) !== eventFingerprint(ics)) throw davFailure(412);
    return current.etag;
  }
  if (![200, 201, 204].includes(response.status)) throw await rejectedPutError(credentials, written.uid, response, transport);
  if (!strongEtag(response.etag)) throw new CalDavError('Der Kalenderdienst liefert keinen brauchbaren ETag.');
  return response.etag;
}

export async function deleteEvent(credentials: CalDavCredentials, written: WrittenEvent, transport: DavTransport): Promise<void> {
  const url = `${credentials.url}${written.uid.split('@')[0]}.ics`;
  let etag = written.etag;
  if (etag === null) {
    const current = await transport(url, credentials, 'GET');
    if (current.status === 404) return;
    if (current.status !== 200) throw davFailure(current.status);
    const hash = remoteFingerprint(current.body);
    if (!strongEtag(current.etag) || (hash !== written.content_hash && hash !== written.pending_hash)) throw davFailure(412);
    etag = current.etag;
  }
  const response = await transport(url, credentials, 'DELETE', '', { 'if-match': etag });
  if (![200, 204, 404, 410].includes(response.status)) throw davFailure(response.status);
}

interface ExportTask extends IcsTask { workspaceId: string }
async function tasksToWrite(db: PoolClient, writer: WriterRow): Promise<ExportTask[]> {
  const rows = await queryRows<{
    id: string; workspace_id: string; title: string; note: string; planned_at: Date | null;
    planned_all_day: boolean; due_at: Date | null; due_all_day: boolean; duration_min: number | null;
    updated_at: Date; project_name: string | null;
  }>(db, `SELECT t.id, t.workspace_id, t.title, t.note, t.planned_at, t.planned_all_day, t.due_at,
      t.due_all_day, t.duration_min, t.updated_at, p.name AS project_name
    FROM tasks t JOIN workspaces ws ON ws.id=t.workspace_id AND ws.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.workspace_id = ANY($1) AND t.completed_at IS NULL AND t.trashed_at IS NULL
      AND (t.project_id IS NULL OR NOT project_in_trash(t.project_id))
      AND (($2 IN ('planned','both') AND t.planned_at IS NOT NULL) OR ($2 IN ('due','both') AND t.due_at IS NOT NULL))
    ORDER BY t.id LIMIT 1001`, [writer.workspaces, writer.mode]);
  if (rows.length > 1000) throw new CalDavError('Mehr als 1000 Aufgaben ausgewählt. Bitte die Arbeitsbereiche eingrenzen.');
  return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, title: r.title, note: r.note,
    planned: r.planned_at, plannedAllDay: r.planned_all_day, due: r.due_at, dueAllDay: r.due_all_day,
    duration: r.duration_min, updatedAt: r.updated_at, projectName: r.project_name }));
}

export async function syncWriter(pool: Pool, feedId: string, now: Date, transport: DavTransport = davRequest): Promise<void> {
  await withCalendarWriteLock(pool, feedId, async (db) => {
    const writer = await queryOne<WriterRow & { user_id: string }>(db,
      'SELECT w.*, f.user_id FROM calendar_writers w JOIN calendar_sources f ON f.id=w.feed_id WHERE w.feed_id=$1', [feedId]);
    if (!writer?.enabled) return;
    let currentUid: string | null = null;
    try {
      const credentials = credentialsOf(writer);
      for (const workspace of writer.workspaces) if (await effectiveListLevel(db, writer.user_id, workspace) === null) throw new CalDavError('Schreiben angehalten: Zugriff auf einen ausgewählten Arbeitsbereich fehlt.');
      const desired = new Map<string, { task: ExportTask; kind: 'plan' | 'due' }>();
      for (const task of await tasksToWrite(db, writer)) {
        if (task.planned !== null && writer.mode !== 'due') desired.set(`${task.id}:plan`, { task, kind: 'plan' });
        if (task.due !== null && writer.mode !== 'planned') desired.set(`${task.id}:due`, { task, kind: 'due' });
      }
      const existing = await queryRows<WrittenEvent>(db, 'SELECT * FROM calendar_write_events WHERE writer_id=$1', [writer.id]);
      const written = new Map(existing.map((e) => [`${e.task_id}:${e.kind}`, e]));
      let operations = 0;
      let more = false;
      const started = Date.now();
      const full = () => operations >= 20 || Date.now() - started > 80_000;
      for (const [key, { task, kind }] of desired) {
        let entry = written.get(key) ?? { writer_id: writer.id, task_id: task.id, kind,
          uid: calendarEventUid(writer.id, task.id, kind), etag: null, content_hash: null, pending_hash: null };
        if (entry.uid.startsWith('sote-') && entry.etag === null && entry.content_hash === null) {
          if (full()) { more = true; break; }
          currentUid = entry.uid;
          entry = await prepareWrittenEvent(credentials, entry, transport);
        }
        // iCloud lehnt VEVENT ohne DTEND teils mit PUT 404 ab. Vor dem Fingerprint
        // normalisieren, damit Quittierung und Wiederholung denselben Inhalt vergleichen.
        const body = buildCalDavEvent({ task, kind, uid: entry.uid, timezone: writer.timezone, base: baseUrl(),
          explicitInstantEnd: /^(?:p\d+-)?caldav\.icloud\.com$/.test(new URL(credentials.url).hostname) });
        const hash = eventFingerprint(body);
        if (entry.content_hash === hash && entry.pending_hash === null) continue;
        if (full()) { more = true; break; }
        currentUid = entry.uid;
        // Die Absicht vor dem Netzaufruf speichern, um nach einem Abbruch die eigene Kopie zu erkennen.
        await db.query(`INSERT INTO calendar_write_events (writer_id, task_id, kind, uid, pending_hash)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (writer_id,task_id,kind) DO UPDATE SET uid=$4, pending_hash=$5`, [writer.id, task.id, kind, entry.uid, hash]);
        const etag = await putEvent(credentials, entry, body, transport);
        await db.query(`UPDATE calendar_write_events SET etag=$4, content_hash=$5, pending_hash=NULL
          WHERE writer_id=$1 AND task_id=$2 AND kind=$3`, [writer.id, task.id, kind, etag, hash]);
        operations++;
      }
      for (const entry of existing) {
        if (desired.has(`${entry.task_id}:${entry.kind}`)) continue;
        if (full()) { more = true; break; }
        currentUid = entry.uid;
        await deleteEvent(credentials, entry, transport);
        await db.query('DELETE FROM calendar_write_events WHERE writer_id=$1 AND task_id=$2 AND kind=$3', [writer.id, entry.task_id, entry.kind]);
        operations++;
      }
      await db.query('UPDATE calendar_writers SET synced_at=CASE WHEN $2 THEN synced_at ELSE $3 END, last_error=NULL, conflict_uid=NULL WHERE id=$1', [writer.id, more, now]);
      if (operations > 0) await enqueue(pool, 'feeds.fetch', { payload: { feedId }, uniqueKey: `feeds.fetch:${feedId}` });
      if (more) await requestWrite(pool, feedId);
    } catch (e) {
      // Keine Antworttexte/URLs/Kennwörter in DB oder Protokollen.
      await db.query('UPDATE calendar_writers SET last_error=$2, conflict_uid=$3 WHERE id=$1', [writer.id,
        e instanceof CalDavError ? e.message : 'Schreiben fehlgeschlagen. Bitte erneut versuchen.',
        e instanceof CalDavConflict ? currentUid : null]);
    }
  }, true);
}

handle('calendars.write', async ({ pool, job, now }) => {
  const feedId = job.payload['feedId'];
  if (typeof feedId !== 'string' || !uuid.test(feedId)) throw new Error('calendars.write ohne feedId');
  await syncWriter(pool, feedId, now);
});

export async function scheduleCalendarWrites(pool: Pool): Promise<void> {
  if (!keyPresent()) return;
  await enqueue(pool, 'calendars.tick', { uniqueKey: 'calendars.tick' });
}
handle('calendars.tick', async ({ pool, now }) => {
  if (!keyPresent()) return;
  const writers = await queryRows<{ feed_id: string }>(pool, 'SELECT feed_id FROM calendar_writers WHERE enabled');
  for (const writer of writers) await requestWrite(pool, writer.feed_id);
  await enqueue(pool, 'calendars.tick', { runAt: new Date(now.getTime() + 60_000), uniqueKey: 'calendars.tick' });
});
