/**
 * SOTE — fremde Kalender, lesend: die Quellen.
 *
 * `calendar.ts` ist die Richtung hinaus (SOTE als ICS für ein
 * Kalenderprogramm); hier kommt ein Kalender HEREIN. Migration 0042.
 *
 * Migration 0042 sagt, WARUM: neben den Aufgaben soll stehen, wo der Tag schon
 * voll ist. Hier steht, WIE — und die drei Entscheidungen, die man beim Lesen
 * fremder Adressen treffen muss.
 *
 * ## Ein fremder Parser, kein eigener
 *
 * `ical.js` liest — dieselbe Bibliothek, die im Kern die EIGENE Ausgabe
 * gegenprüft (`icsParse.test.ts`), und die Bibliothek hinter Thunderbird.
 * ICS aus der Wildbahn ist voller Sonderfälle (Faltung, Zeitzonen mit
 * eigenen VTIMEZONE-Blöcken, Ausnahmen an wiederkehrenden Terminen), und
 * jeder davon ist in einem eigenen Parser ein Fehler, den jemand erst
 * meldet, wenn sein Zahnarzttermin fehlt.
 *
 * ## Die Adresse wird geprüft wie ein Push-Endpunkt
 *
 * Ein Server, der eine Adresse aus einem Formular abruft, ist ein Server,
 * den man auf sein eigenes Netz zeigen lassen kann (SSRF). Darum dieselbe
 * Regel wie für Push-Endpunkte: nur `https`, keine lokalen und privaten
 * Adressen — und Weiterleitungen werden VON HAND verfolgt, damit die Regel
 * auch für das Ziel gilt, nicht nur für den Anfang. `webcal://` ist nur ein
 * anderes Schild an derselben Tür und wird zu `https://`.
 *
 * ## Abrufen ist ein Auftrag
 *
 * Nicht im Aufruf: ein Kalenderdienst antwortet in Sekunden oder gar nicht,
 * und `/api/span` soll nicht auf Google warten. Ein Auftrag je Kalender, ein
 * Takt, der stündlich alle einreiht; der Abruf schreibt das Fenster neu und
 * merkt sich Fehler AN der Zeile — der Bildschirm zeigt sie, statt still eine
 * leere Spalte zu lassen.
 */

import ICAL from 'ical.js';
import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows, withTransaction } from './db.js';
import { enqueue, handle, type JobContext } from './jobs.js';
import { isPushEndpoint } from './push.js';
import { keyPresent, seal, unseal } from './secretbox.js';
import { readCalDavCalendar } from './caldavCalendars.js';
import { CalDavError, type CalDavCredentials, type DavTransport, davRequest } from './caldav.js';
import { CloudCalendar } from './cloudCalendars.js';
import { isCloudProvider } from './calendarOAuth.js';

/** Ein Termin, wie er aus einem fremden Kalender kommt — schon ausgerollt. */
export interface FeedEvent {
  uid: string;
  recurrenceId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
}

export interface Feed {
  id: string;
  name: string;
  color: string | null;
  /** `null`: in jedem Arbeitsbereich; sonst nur in diesen. */
  showsIn: string[] | null;
  fetchedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  kind: 'ics' | 'caldav' | 'google' | 'microsoft';
  provider: 'icloud' | 'google' | 'microsoft' | 'caldav' | 'ics';
}

/** Wie viele Kalender eine Person höchstens einbindet. */
export const MAX_FEEDS = 12;
/** Grösser wird kein Kalender gelesen — ein Jahr Termine sind Kilobytes, nicht Megabytes. */
export const MAX_ICS_BYTES = 5 * 1024 * 1024;
/** Das Fenster, das ein Abruf ausrollt: ein Monat zurück, zwölf voraus. */
const WINDOW_BACK_DAYS = 31;
const WINDOW_AHEAD_DAYS = 366;
/** Wiederholungen ohne Ende: mehr Vorkommen als das je Termin schreibt niemand. */
const MAX_OCCURRENCES = 2000;
/** Der Takt, in dem alle Kalender neu gelesen werden. */
const EVERY_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

/** `webcal://` ist `https://` mit anderem Schild. */
export function normalizeFeedUrl(raw: string): string {
  const t = raw.trim();
  return /^webcal:\/\//i.test(t) ? `https://${t.slice('webcal://'.length)}` : t;
}

export const isFeedUrl = (raw: string): boolean => isPushEndpoint(normalizeFeedUrl(raw));

// DATE hat keine Zeitzone. UTC-Mitternacht transportiert hier das Datum;
// toJSDate() würde stattdessen die lokale Zeitzone des Servers hineinrechnen.
const zoneOf = (t: ICAL.Time): Date => t.isDate
  ? new Date(Date.UTC(t.year, t.month - 1, t.day))
  : t.toJSDate();

/**
 * Ein ICS-Dokument im Fenster [from, to) ausrollen.
 *
 * Ausnahmen (`RECURRENCE-ID`) gehören zu ihrem Stamm und ersetzen das
 * Vorkommen, das sie nennen — `ical.js` macht das über `relateException`,
 * aber nur, wenn man ihm Stamm und Ausnahme zusammenführt. Eine Ausnahme
 * ohne Stamm (kommt vor: der Stamm liegt ausserhalb des Exports) ist ein
 * einzelner Termin.
 */
export function readIcs(text: string, from: Date, to: Date): FeedEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(tz);
    if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone);
  }
  const events = comp.getAllSubcomponents('vevent').map((e) => new ICAL.Event(e));
  const stämme = new Map<string, ICAL.Event>();
  const ausnahmen: ICAL.Event[] = [];
  for (const e of events) {
    if (e.isRecurrenceException()) ausnahmen.push(e);
    else if (e.uid) stämme.set(e.uid, e);
  }
  const einzeln: ICAL.Event[] = [];
  for (const a of ausnahmen) {
    const stamm = stämme.get(a.uid);
    if (stamm !== undefined && stamm.isRecurring()) stamm.relateException(a);
    else einzeln.push(a);
  }

  const out: FeedEvent[] = [];
  const nimm = (e: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId: string): void => {
    const s = zoneOf(start);
    const en = zoneOf(end);
    if (en <= from || s >= to) return;
    out.push({
      uid: e.uid,
      recurrenceId,
      title: (e.summary ?? '').trim() || '(ohne Titel)',
      start: s,
      end: en > s ? en : new Date(s.getTime() + (start.isDate ? 86_400_000 : 0)),
      allDay: start.isDate,
      location: e.location?.trim() || null,
    });
  };

  for (const e of [...stämme.values(), ...einzeln]) {
    if (!e.startDate) continue;
    if (!e.isRecurring()) {
      nimm(e, e.startDate, e.endDate ?? e.startDate, e.recurrenceId?.toString() ?? '');
      continue;
    }
    const it = e.iterator();
    let n = 0;
    for (let next = it.next(); next !== undefined && n < MAX_OCCURRENCES; next = it.next(), n++) {
      if (zoneOf(next) >= to) break;
      const d = e.getOccurrenceDetails(next);
      // Ein Vorkommen, das eine Ausnahme ersetzt, trägt deren Kennung.
      const kennung = d.item !== e ? next.toString() : '';
      nimm(d.item, d.startDate, d.endDate, kennung);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ── Die Zeilen ──────────────────────────────────────────────────────────── */

interface FeedRow {
  id: string;
  name: string;
  color: string | null;
  shows_in: string[] | null;
  fetched_at: Date | null;
  last_error: string | null;
  created_at: Date;
  connection_kind: Feed['kind'];
  url_sealed: string;
}

function providerOf(row: FeedRow): Feed['provider'] {
  if (isCloudProvider(row.connection_kind)) return row.connection_kind;
  try {
    const host = new URL(unseal(row.url_sealed) ?? '').hostname;
    if (host.endsWith('.icloud.com')) return 'icloud';
    if (host === 'calendar.google.com' || host.endsWith('.googleusercontent.com')) return 'google';
    if (host.endsWith('.outlook.com') || host.endsWith('.office365.com') || host.endsWith('.outlook.office.com')) return 'microsoft';
  } catch { /* Alte Verbindung ohne verfügbaren Schlüssel. */ }
  return row.connection_kind === 'caldav' ? 'caldav' : 'ics';
}

const feedOf = (r: FeedRow): Feed => ({
  id: r.id,
  name: r.name,
  color: r.color,
  showsIn: r.shows_in,
  fetchedAt: r.fetched_at,
  lastError: r.last_error,
  createdAt: r.created_at,
  kind: r.connection_kind,
  provider: providerOf(r),
});

export const feedsPossible = (): boolean => keyPresent();

export async function listFeeds(pool: Pool, userId: string): Promise<Feed[]> {
  const rows = await queryRows<FeedRow>(
    pool,
    `SELECT id, name, color, shows_in, fetched_at, last_error, created_at, connection_kind, url_sealed
       FROM calendar_sources WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map(feedOf);
}

export type AddFeedError = 'bad_url' | 'too_many' | 'no_key';

/** Einen Kalender einbinden — und gleich zum ersten Abruf einreihen. */
export async function addFeed(
  pool: Pool,
  userId: string,
  input: { name: string; url: string; color: string | null; showsIn?: string[] | null; credentials?: CalDavCredentials },
): Promise<Feed | AddFeedError> {
  if (!keyPresent()) return 'no_key';
  const url = normalizeFeedUrl(input.url);
  if (!isFeedUrl(url)) return 'bad_url';
  const anzahl = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM calendar_sources WHERE user_id = $1',
    [userId],
  );
  if (Number(anzahl?.n ?? 0) >= MAX_FEEDS) return 'too_many';
  const name = input.name.trim() || new URL(url).hostname;
  const row = await queryOne<FeedRow>(
    pool,
    `INSERT INTO calendar_sources (user_id, name, url_sealed, color, shows_in, connection_kind, caldav_credentials_sealed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, color, shows_in, fetched_at, last_error, created_at, connection_kind, url_sealed`,
    [userId, name.slice(0, 120), seal(url), input.color, input.showsIn ?? null,
      input.credentials ? 'caldav' : 'ics', input.credentials ? seal(JSON.stringify(input.credentials)) : null],
  );
  if (row === undefined) throw new Error('INSERT ohne Zeile');
  await requestFetch(pool, row.id, new Date());
  return feedOf(row);
}

export async function updateFeed(
  pool: Pool,
  userId: string,
  feedId: string,
  patch: { name?: string; color?: string | null; showsIn?: string[] | null },
): Promise<Feed | null> {
  const row = await queryOne<FeedRow>(
    pool,
    `UPDATE calendar_sources
        SET name = COALESCE($3, name),
            color = CASE WHEN $4 THEN $5 ELSE color END,
            shows_in = CASE WHEN $6 THEN $7::uuid[] ELSE shows_in END
      WHERE id = $1 AND user_id = $2
      RETURNING id, name, color, shows_in, fetched_at, last_error, created_at, connection_kind, url_sealed`,
    [
      feedId, userId,
      patch.name?.trim() || null,
      patch.color !== undefined, patch.color ?? null,
      patch.showsIn !== undefined, patch.showsIn ?? null,
    ],
  );
  return row === undefined ? null : feedOf(row);
}

export async function removeFeed(pool: Pool | PoolClient, userId: string, feedId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM calendar_sources WHERE id = $1 AND user_id = $2', [feedId, userId]);
  return (r.rowCount ?? 0) > 0;
}

/** Einen Abruf einreihen — einmal je Kalender, auch wenn zweimal gedrückt wird. */
export async function requestFetch(pool: Pool, feedId: string, now: Date): Promise<void> {
  await enqueue(pool, 'feeds.fetch', {
    payload: { feedId },
    runAt: now,
    uniqueKey: `feeds.fetch:${feedId}`,
  });
}

/** Nur die Kalender dieser Person — oder `false`, wenn er nicht ihr gehört. */
export async function requestFetchOf(pool: Pool, userId: string, feedId: string, now: Date): Promise<boolean> {
  const mine = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM calendar_sources WHERE id = $1 AND user_id = $2',
    [feedId, userId],
  );
  if (mine === undefined) return false;
  await requestFetch(pool, feedId, now);
  return true;
}

export interface SpanEvent extends FeedEvent {
  feedId: string;
}

/**
 * Die Termine der Kalender einer Person im Fenster [from, to).
 *
 * `workspaceId` ist der Filter der Schiene: gesetzt, kommen nur Kalender,
 * die in diesem Bereich erscheinen sollen; `null` („alle Bereiche") bringt alle.
 */
export async function eventsOf(
  pool: Pool,
  userId: string,
  from: Date,
  to: Date,
  workspaceId: string | null = null,
): Promise<SpanEvent[]> {
  const rows = await queryRows<{
    feed_id: string;
    uid: string;
    recurrence_id: string;
    title: string;
    starts_at: Date;
    ends_at: Date;
    all_day: boolean;
    location: string | null;
  }>(
    pool,
    `SELECT e.feed_id, e.uid, e.recurrence_id, e.title, e.starts_at, e.ends_at, e.all_day, e.location
       FROM calendar_source_events e
       JOIN calendar_sources f ON f.id = e.feed_id
      WHERE f.user_id = $1 AND e.starts_at < $3 AND e.ends_at > $2
        AND ($4::uuid IS NULL OR f.shows_in IS NULL OR $4 = ANY(f.shows_in))
        AND NOT EXISTS (
          SELECT 1 FROM calendar_write_events we
          JOIN calendar_writers w ON w.id = we.writer_id AND w.feed_id = f.id
          JOIN tasks t ON t.id = we.task_id
          WHERE we.uid = e.uid AND t.completed_at IS NULL AND t.trashed_at IS NULL
            AND (t.project_id IS NULL OR NOT project_in_trash(t.project_id))
            AND ($4::uuid IS NULL OR t.workspace_id = $4)
            AND ((we.kind = 'plan' AND t.planned_at IS NOT NULL)
              OR (we.kind = 'due' AND t.planned_at IS NULL AND t.due_at IS NOT NULL))
        )
      ORDER BY e.starts_at`,
    [userId, from, to, workspaceId],
  );
  return rows.map((r) => ({
    feedId: r.feed_id,
    uid: r.uid,
    recurrenceId: r.recurrence_id,
    title: r.title,
    start: r.starts_at,
    end: r.ends_at,
    allDay: r.all_day,
    location: r.location,
  }));
}

/* ── Der Abruf ───────────────────────────────────────────────────────────── */

export class FeedFetchError extends Error {}

/**
 * Eine Adresse lesen — mit Prüfung an JEDER Station.
 *
 * `redirect: 'manual'`, weil `fetch` sonst still einer Weiterleitung auf
 * `http://10.0.0.1/` folgen würde. Bis zu drei Stationen, jede geprüft.
 * Die Grösse wird beim Lesen gezählt, nicht aus `content-length` geglaubt.
 */
export async function fetchIcs(
  url: string,
  etag: string | null,
  doFetch: typeof fetch = fetch,
): Promise<{ status: 'ok'; text: string; etag: string | null } | { status: 'unchanged' }> {
  let ziel = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isPushEndpoint(ziel)) throw new FeedFetchError('Adresse nicht erlaubt');
    const headers: Record<string, string> = { accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1' };
    if (etag !== null) headers['if-none-match'] = etag;
    const res = await doFetch(ziel, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 304) return { status: 'unchanged' };
    if (res.status >= 300 && res.status < 400) {
      const weiter = res.headers.get('location');
      if (weiter === null) throw new FeedFetchError(`Weiterleitung ohne Ziel (${res.status})`);
      ziel = new URL(weiter, ziel).toString();
      continue;
    }
    if (!res.ok) throw new FeedFetchError(`Dienst antwortet mit ${res.status}`);
    const text = await readCapped(res, MAX_ICS_BYTES);
    return { status: 'ok', text, etag: res.headers.get('etag') };
  }
  throw new FeedFetchError('zu viele Weiterleitungen');
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const teile: Uint8Array[] = [];
  let gelesen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    gelesen += value.byteLength;
    if (gelesen > max) {
      await reader.cancel();
      throw new FeedFetchError('Kalender grösser als 5 MB');
    }
    teile.push(value);
  }
  return Buffer.concat(teile).toString('utf8');
}

/**
 * Einen Kalender lesen und das Fenster neu schreiben.
 *
 * Alles in einer Transaktion: erst leeren, dann füllen — ein Leser sieht
 * entweder den alten Stand oder den neuen, nie eine halbe Spalte. Ein
 * Fehler landet an der Zeile (`last_error`) und lässt die alten Termine
 * stehen: ein Dienst, der eine Stunde nicht antwortet, ist kein Grund, den
 * Kalender leer zu zeigen.
 */
export async function fetchFeed(
  pool: Pool,
  feedId: string,
  now: Date,
  doFetch: typeof fetch = fetch,
  transport: DavTransport = davRequest,
): Promise<'ok' | 'unchanged' | 'gone' | 'failed'> {
  const row = await queryOne<{ url_sealed: string; etag: string | null; caldav_credentials_sealed: string | null; connection_kind: Feed['kind']; oauth_account_id: string | null; remote_calendar_id: string | null }>(
    pool,
    'SELECT url_sealed, etag, caldav_credentials_sealed, connection_kind, oauth_account_id, remote_calendar_id FROM calendar_sources WHERE id = $1',
    [feedId],
  );
  if (row === undefined) return 'gone';
  const url = unseal(row.url_sealed);
  const merke = async (fehler: string | null, etag?: string | null): Promise<void> => {
    await pool.query(
      `UPDATE calendar_sources SET fetched_at = $2, last_error = $3, etag = COALESCE($4, etag) WHERE id = $1`,
      [feedId, now, fehler, etag ?? null],
    );
  };
  if (url === null) {
    await merke('Adresse mit einem anderen Schlüssel versiegelt');
    return 'failed';
  }
  try {
    const from = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000);
    const to = new Date(now.getTime() + WINDOW_AHEAD_DAYS * 86_400_000);
    let documents: string[] | undefined;
    let cloudEvents: FeedEvent[] | undefined;
    if (isCloudProvider(row.connection_kind) && row.oauth_account_id && row.remote_calendar_id) {
      cloudEvents = await new CloudCalendar(pool, { provider: row.connection_kind, accountId: row.oauth_account_id, calendarId: row.remote_calendar_id }, doFetch).read(from,to);
    }
    if (row.caldav_credentials_sealed) {
      const plain = unseal(row.caldav_credentials_sealed);
      if (!plain) throw new CalDavError('Der gespeicherte Kalenderzugang kann nicht entschlüsselt werden.');
      documents = await readCalDavCalendar(JSON.parse(plain) as CalDavCredentials, from, to, transport);
    }
    const geholt = documents || cloudEvents ? { status: 'ok' as const, text: '', etag: null } : await fetchIcs(url, row.etag, doFetch);
    if (geholt.status === 'unchanged') {
      await merke(null);
      return 'unchanged';
    }
    const termine = cloudEvents ?? (documents ?? [geholt.text]).flatMap((text) => readIcs(text, from, to));
    if (termine.length > MAX_OCCURRENCES) throw new FeedFetchError('Zu viele Termine im Abrufzeitraum');
    await withTransaction(pool, async (c) => {
      await c.query('DELETE FROM calendar_source_events WHERE feed_id = $1', [feedId]);
      // Der Schlüssel schützt vor Dubletten aus schlecht geformten Kalendern,
      // die dasselbe Vorkommen zweimal nennen.
      for (const t of termine) {
        await c.query(
          `INSERT INTO calendar_source_events
             (feed_id, uid, recurrence_id, title, starts_at, ends_at, all_day, location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [feedId, t.uid, t.recurrenceId, t.title.slice(0, 300), t.start, t.end, t.allDay, t.location],
        );
      }
    });
    await merke(null, geholt.etag);
    return 'ok';
  } catch (e: unknown) {
    const text = e instanceof FeedFetchError || e instanceof CalDavError ? e.message
      : e instanceof Error && e.name === 'TimeoutError' ? 'Dienst antwortet nicht'
      : e instanceof Error && /parse|ICAL|invalid/i.test(e.message) ? 'kein lesbarer Kalender'
      : 'Abruf fehlgeschlagen';
    await merke(text.slice(0, 300));
    return 'failed';
  }
}

handle('feeds.fetch', async (ctx: JobContext) => {
  const feedId = ctx.job.payload['feedId'];
  if (typeof feedId !== 'string') throw new Error('feeds.fetch ohne feedId');
  await fetchFeed(ctx.pool, feedId, ctx.now);
});

/** Der Takt: alle Kalender neu einreihen und den nächsten Takt legen. */
async function tick(ctx: JobContext): Promise<void> {
  const alle = await queryRows<{ id: string }>(ctx.pool, 'SELECT id FROM calendar_sources', []);
  for (const f of alle) await requestFetch(ctx.pool, f.id, ctx.now);
  await enqueue(ctx.pool, 'feeds.tick', {
    runAt: new Date(ctx.now.getTime() + EVERY_MS),
    uniqueKey: 'feeds.tick',
  });
}

handle('feeds.tick', tick);

/** Beim Start einreihen — nur, wenn dieser Server Adressen entsiegeln kann. */
export async function scheduleFeeds(pool: Pool): Promise<boolean> {
  if (!keyPresent()) return false;
  await enqueue(pool, 'feeds.tick', { uniqueKey: 'feeds.tick' });
  return true;
}
