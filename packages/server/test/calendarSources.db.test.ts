/**
 * SOTE — fremde Kalender: lesen, ausrollen, filtern.
 *
 * Drei Dinge, die schiefgehen können und hier festgehalten sind:
 *
 * 1. Ein ICS aus der Wildbahn — mit VTIMEZONE, Wiederholung, Ausnahme und
 *    Ganztagstermin — kommt als die Termine an, die ein Kalenderprogramm
 *    zeigen würde. Geprüft am Ergebnis in UTC, nicht an meinem Bild davon.
 * 2. Der Abruf folgt keiner Weiterleitung ins eigene Netz, glaubt keiner
 *    `content-length` und nimmt `304` als „unverändert".
 * 3. `shows_in` ist ein Filter am Kalender, kein Recht: gesetzt, erscheint er
 *    nur in seinen Bereichen; `null` überall — und immer nur der eigenen Person.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import {
  addFeed,
  eventsOf,
  fetchFeed,
  fetchIcs,
  FeedFetchError,
  isFeedUrl,
  listFeeds,
  normalizeFeedUrl,
  readIcs,
  removeFeed,
  updateFeed,
} from '../src/calendarSources.js';
import { migrate } from '../src/migrate.js';
import type { DavTransport } from '../src/caldav.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;
let andereId: string;

before(async () => {
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 5).toString('hex');
  pool = makePool(URL_);
  await migrate(pool);
  const mach = async (mail: string): Promise<string> => {
    const u = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO users (email, display_name) VALUES ($1,'Kalender')
       ON CONFLICT (email) DO UPDATE SET display_name = 'Kalender' RETURNING id`,
      [mail],
    );
    await pool.query('DELETE FROM calendar_sources WHERE user_id = $1', [u!.id]);
    return u!.id;
  };
  userId = await mach(`feeds-${process.pid}@example.org`);
  andereId = await mach(`feeds-andere-${process.pid}@example.org`);
});

after(async () => {
  await pool.end();
});

test('Privater CalDAV-Abruf speichert Zugang verschlüsselt, importiert Termine und erhält sie bei Teilausfall', async () => {
  const credentials = {url:'https://cloud.example/calendars/private/',username:'private-user',password:'private-password'};
  const feed = await addFeed(pool,userId,{name:'Privater Test',url:credentials.url,color:'blue',credentials});
  assert.ok(typeof feed === 'object'); assert.equal(feed.kind,'caldav'); assert.equal(feed.provider,'caldav');
  const status = JSON.stringify(await listFeeds(pool,userId));
  for (const value of Object.values(credentials)) assert.equal(status.includes(value),false);
  const content='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:private-event\r\nDTSTART:20260914T090000Z\r\nDTEND:20260914T100000Z\r\nSUMMARY:Privater Termin\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const transport: DavTransport = async (_url,auth,method) => {
    assert.deepEqual(auth,credentials); assert.equal(method,'REPORT');
    return {status:207,etag:null,body:`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/event.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${content}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`};
  };
  const never: typeof fetch = async () => { throw new Error('Kein öffentlicher Abruf erwartet'); };
  assert.equal(await fetchFeed(pool,feed.id,new Date('2026-09-13T10:00:00Z'),never,transport),'ok');
  const count = async () => (await pool.query('SELECT count(*)::int AS n FROM calendar_source_events WHERE feed_id=$1',[feed.id])).rows[0].n;
  assert.equal(await count(),1);
  assert.equal(await fetchFeed(pool,feed.id,new Date('2026-09-13T11:00:00Z'),never,async () => ({status:401,body:'private-password',etag:null})),'failed');
  assert.equal(await count(),1);
  assert.equal(await fetchFeed(pool,feed.id,new Date('2026-09-13T12:00:00Z'),never,async () => ({status:207,body:'<multistatus xmlns="DAV:"/>',etag:null})),'ok');
  assert.equal(await count(),0);
  await removeFeed(pool,userId,feed.id);
});

/* ── Ein Kalender, wie Outlook oder Google ihn herausgeben ───────────────── */

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//DE',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  // Ein einzelner Termin, in Berliner Zeit.
  'BEGIN:VEVENT',
  'UID:einzel@test',
  'DTSTAMP:20260901T000000Z',
  'DTSTART;TZID=Europe/Berlin:20260915T140000',
  'DTEND;TZID=Europe/Berlin:20260915T150000',
  'SUMMARY:Zahnarzt',
  'LOCATION:Eberbach',
  'END:VEVENT',
  // Ein Ganztagstermin.
  'BEGIN:VEVENT',
  'UID:ganz@test',
  'DTSTAMP:20260901T000000Z',
  'DTSTART;VALUE=DATE:20260916',
  'DTEND;VALUE=DATE:20260917',
  'SUMMARY:Feiertag',
  'END:VEVENT',
  // Wöchentlich, dreimal — mit einer Ausnahme, die das zweite Vorkommen verschiebt.
  'BEGIN:VEVENT',
  'UID:reihe@test',
  'DTSTAMP:20260901T000000Z',
  'DTSTART;TZID=Europe/Berlin:20260914T090000',
  'DTEND;TZID=Europe/Berlin:20260914T093000',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'SUMMARY:Stand-up',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:reihe@test',
  'RECURRENCE-ID;TZID=Europe/Berlin:20260921T090000',
  'DTSTAMP:20260901T000000Z',
  'DTSTART;TZID=Europe/Berlin:20260921T110000',
  'DTEND;TZID=Europe/Berlin:20260921T113000',
  'SUMMARY:Stand-up (verschoben)',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-10-31T00:00:00Z');

test('readIcs: Zeitzone, Ganztag, Wiederholung und Ausnahme kommen als Termine an', () => {
  const t = readIcs(ICS, FROM, TO);
  const nachUid = (uid: string) => t.filter((x) => x.uid === uid);

  const zahn = nachUid('einzel@test');
  assert.equal(zahn.length, 1);
  // 14:00 Berlin im September ist 12:00 UTC.
  assert.equal(zahn[0]!.start.toISOString(), '2026-09-15T12:00:00.000Z');
  assert.equal(zahn[0]!.end.toISOString(), '2026-09-15T13:00:00.000Z');
  assert.equal(zahn[0]!.allDay, false);
  assert.equal(zahn[0]!.location, 'Eberbach');

  const ganz = nachUid('ganz@test');
  assert.equal(ganz.length, 1);
  assert.equal(ganz[0]!.allDay, true);
  assert.equal(ganz[0]!.end.getTime() - ganz[0]!.start.getTime(), 86_400_000);

  const reihe = nachUid('reihe@test').map((x) => [x.start.toISOString(), x.title]);
  assert.deepEqual(reihe, [
    ['2026-09-14T07:00:00.000Z', 'Stand-up'],
    ['2026-09-21T09:00:00.000Z', 'Stand-up (verschoben)'],
    ['2026-09-28T07:00:00.000Z', 'Stand-up'],
  ]);
  // Die Ausnahme trägt ihre Kennung, die regulären Vorkommen nicht.
  const verschoben = nachUid('reihe@test').find((x) => x.title.includes('verschoben'));
  assert.notEqual(verschoben!.recurrenceId, '');
});

test('readIcs: das Fenster schneidet — was davor endet oder danach beginnt, fehlt', () => {
  const nur = readIcs(ICS, new Date('2026-09-20T00:00:00Z'), new Date('2026-09-22T00:00:00Z'));
  assert.deepEqual(nur.map((x) => x.title), ['Stand-up (verschoben)']);
});

test('readIcs: kein Kalender ist ein Fehler, kein leeres Ergebnis', () => {
  assert.throws(() => readIcs('<html>Anmelden</html>', FROM, TO));
});

/* ── Der Abruf ───────────────────────────────────────────────────────────── */

test('Adressen: webcal wird https, lokale und private Ziele sind keine Kalender', () => {
  assert.equal(normalizeFeedUrl('webcal://example.org/k.ics'), 'https://example.org/k.ics');
  assert.equal(isFeedUrl('webcal://calendar.google.com/x/basic.ics'), true);
  assert.equal(isFeedUrl('http://example.org/k.ics'), false);
  assert.equal(isFeedUrl('https://localhost/k.ics'), false);
  assert.equal(isFeedUrl('https://192.168.1.10/k.ics'), false);
  assert.equal(isFeedUrl('https://[::1]/k.ics'), false);
});

const antwort = (status: number, body = '', headers: Record<string, string> = {}): Response =>
  new Response(status === 304 ? null : body, { status, headers });

test('fetchIcs: eine Weiterleitung ins eigene Netz wird nicht verfolgt', async () => {
  const gesehen: string[] = [];
  const fake: typeof fetch = async (u) => {
    gesehen.push(String(u));
    return antwort(302, '', { location: 'https://10.0.0.5/geheim' });
  };
  await assert.rejects(fetchIcs('https://example.org/k.ics', null, fake), FeedFetchError);
  // Die zweite Station wurde geprüft und NICHT abgerufen.
  assert.deepEqual(gesehen, ['https://example.org/k.ics']);
});

test('fetchIcs: 304 heisst unverändert, ETag wird mitgeschickt', async () => {
  let etag: string | null = null;
  const fake: typeof fetch = async (_u, init) => {
    etag = new Headers(init?.headers).get('if-none-match');
    return antwort(304);
  };
  assert.deepEqual(await fetchIcs('https://example.org/k.ics', '"v1"', fake), { status: 'unchanged' });
  assert.equal(etag, '"v1"');
});

test('fetchIcs: zu gross wird abgebrochen, nicht geglaubt', async () => {
  const fake: typeof fetch = async () =>
    antwort(200, 'X'.repeat(6 * 1024 * 1024), { 'content-length': '10' });
  await assert.rejects(fetchIcs('https://example.org/k.ics', null, fake), /5 MB/);
});

/* ── Die Zeilen ──────────────────────────────────────────────────────────── */

test('ein Kalender: einbinden, abrufen, Termine im Fenster — nur für die eigene Person', async () => {
  const feed = await addFeed(pool, userId, {
    name: 'Arbeit',
    url: 'webcal://example.org/arbeit.ics',
    color: 'blau',
  });
  assert.ok(typeof feed === 'object');
  assert.equal(feed.name, 'Arbeit');
  assert.equal(feed.showsIn, null);

  const fake: typeof fetch = async () => antwort(200, ICS, { etag: '"v1"' });
  assert.equal(await fetchFeed(pool, feed.id, new Date('2026-09-10T00:00:00Z'), fake), 'ok');

  const termine = await eventsOf(pool, userId, FROM, TO);
  assert.equal(termine.length, 5);
  assert.equal(termine[0]!.feedId, feed.id);
  // Die andere Person sieht davon nichts.
  assert.equal((await eventsOf(pool, andereId, FROM, TO)).length, 0);

  // Der zweite Abruf mit 304 lässt die Termine stehen und merkt sich die Zeit.
  const nochmal: typeof fetch = async () => antwort(304);
  assert.equal(await fetchFeed(pool, feed.id, new Date('2026-09-10T01:00:00Z'), nochmal), 'unchanged');
  const [liste] = await listFeeds(pool, userId);
  assert.equal(liste!.lastError, null);
  assert.equal(liste!.fetchedAt?.toISOString(), '2026-09-10T01:00:00.000Z');
  assert.equal((await eventsOf(pool, userId, FROM, TO)).length, 5);

  // Ein Fehler steht an der Zeile — und die alten Termine bleiben.
  const kaputt: typeof fetch = async () => antwort(500);
  assert.equal(await fetchFeed(pool, feed.id, new Date('2026-09-10T02:00:00Z'), kaputt), 'failed');
  assert.match((await listFeeds(pool, userId))[0]!.lastError ?? '', /500/);
  assert.equal((await eventsOf(pool, userId, FROM, TO)).length, 5);

  assert.equal(await removeFeed(pool, userId, feed.id), true);
  assert.equal((await eventsOf(pool, userId, FROM, TO)).length, 0);
});

test('showsIn: ein Kalender folgt dem Filter der Schiene', async () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const feed = await addFeed(pool, userId, {
    name: 'Privat',
    url: 'https://example.org/privat.ics',
    color: null,
    showsIn: [a],
  });
  assert.ok(typeof feed === 'object');
  const fake: typeof fetch = async () => antwort(200, ICS);
  await fetchFeed(pool, feed.id, new Date('2026-09-10T00:00:00Z'), fake);

  assert.equal((await eventsOf(pool, userId, FROM, TO, null)).length, 5, 'alle Bereiche: dabei');
  assert.equal((await eventsOf(pool, userId, FROM, TO, a)).length, 5, 'sein Bereich: dabei');
  assert.equal((await eventsOf(pool, userId, FROM, TO, b)).length, 0, 'fremder Bereich: nicht');

  const geändert = await updateFeed(pool, userId, feed.id, { showsIn: null, name: 'Überall' });
  assert.equal(geändert?.name, 'Überall');
  assert.equal(geändert?.showsIn, null);
  assert.equal((await eventsOf(pool, userId, FROM, TO, b)).length, 5);
  // Die andere Person kann ihn weder ändern noch löschen.
  assert.equal(await updateFeed(pool, andereId, feed.id, { name: 'x' }), null);
  assert.equal(await removeFeed(pool, andereId, feed.id), false);
  await removeFeed(pool, userId, feed.id);
});

test('eine Adresse, die kein Kalenderdienst ist, wird nicht angenommen', async () => {
  assert.equal(await addFeed(pool, userId, { name: '', url: 'http://example.org/k.ics', color: null }), 'bad_url');
  assert.equal(await addFeed(pool, userId, { name: '', url: 'https://127.0.0.1/k.ics', color: null }), 'bad_url');
});
