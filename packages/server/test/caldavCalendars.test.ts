import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { discoverCalDavCalendars, readCalDavCalendar } from '../src/caldavCalendars.js';
import { checkCalendar, type DavTransport } from '../src/caldav.js';

const credentials = { url:'https://cloud.example/remote.php/dav/', username:'person', password:'private-password' };
const response = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const xml = (inner: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
const calendar = '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Team</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>';

test('Allgemeine CalDAV-Suche folgt Principal und Kalender-Heimat, einschließlich Lesekalendern', async () => {
  const calls: string[] = [];
  const transport: DavTransport = async (url, auth, method, _body, headers) => {
    assert.equal(auth.password, credentials.password); assert.equal(method, 'PROPFIND'); calls.push(url);
    if (calls.length === 1) return {status:207,etag:null,body:xml(response('/remote.php/dav/', '<d:current-user-principal><d:href>/principals/person/</d:href></d:current-user-principal>'))};
    if (calls.length === 2) return {status:207,etag:null,body:xml(response('/principals/person/', '<c:calendar-home-set><d:href>/calendars/person/</d:href></c:calendar-home-set>'))};
    assert.equal(headers?.['depth'], '1');
    return {status:207,etag:null,body:xml(response('/calendars/person/team/', calendar) + response('/calendars/person/read/', calendar + '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>'))};
  };
  const found = await discoverCalDavCalendars(credentials, transport);
  assert.equal(found.length,2); assert.equal(found[0]!.writable,true); assert.equal(found[1]!.writable,false);
  assert.deepEqual(calls,[credentials.url,'https://cloud.example/principals/person/','https://cloud.example/calendars/person/']);
});

test('Direkte Kalenderadresse und gleiche Herkunft bei Weiterleitungen werden unterstützt', async () => {
  const found = await discoverCalDavCalendars(credentials,async () => ({status:207,etag:null,body:xml(response('/remote.php/dav/',calendar))}));
  assert.equal(found[0]?.url,credentials.url);
  let calls=0;
  await discoverCalDavCalendars(credentials,async () => ++calls === 1 ? {status:404,etag:null,body:''} : {status:207,etag:null,body:xml(response('/.well-known/caldav/',calendar))});
  assert.equal(calls,2);
});

test('Fremde Hrefs und Redirects erhalten keine Zugangsdaten; XML-Entitäten werden abgelehnt', async () => {
  for (const target of ['https://evil.example/dav/','http://cloud.example/dav/','https://cloud.example:444/dav/']) {
    let calls=0;
    await assert.rejects(() => discoverCalDavCalendars(credentials,async () => { calls++; return {status:302,etag:null,body:'',location:target}; }), /anderen Server/);
    assert.equal(calls,1);
    await assert.rejects(() => discoverCalDavCalendars(credentials,async () => ({status:207,etag:null,body:xml(response(target,calendar))})), /anderen Server/);
  }
  await assert.rejects(() => discoverCalDavCalendars(credentials,async () => ({status:207,etag:null,body:'<!DOCTYPE x><x/>'})), /lesbare/);
  await assert.rejects(() => discoverCalDavCalendars(credentials,async () => ({status:302,etag:null,body:'',location:'https://[broken/'})), /ungültige Kalenderadresse/);
});

test('Private Kalender werden mit begrenztem REPORT-Zeitfenster gelesen; Teilausfälle sind Fehler', async () => {
  const from=new Date('2026-09-01T00:00:00Z'), to=new Date('2027-09-01T00:00:00Z');
  const transport: DavTransport = async (url,auth,method,body,headers) => {
    assert.equal(url,credentials.url); assert.equal(auth,credentials); assert.equal(method,'REPORT'); assert.equal(headers?.['depth'],'1');
    assert.match(body!,/start="20260901T000000Z" end="20270901T000000Z"/);
    return {status:207,etag:null,body:xml(response('/event.ics','<c:calendar-data>BEGIN:VCALENDAR\r\nEND:VCALENDAR</c:calendar-data>'))};
  };
  assert.deepEqual(await readCalDavCalendar(credentials,from,to,transport),['BEGIN:VCALENDAR\nEND:VCALENDAR']);
  assert.deepEqual(await readCalDavCalendar(credentials,from,to,async () => ({status:207,etag:null,body:xml('')})),[]);
  await assert.rejects(() => readCalDavCalendar(credentials,from,to,async () => ({status:207,etag:null,body:xml(response('/missing.ics',''))})), /nicht vollständig/);
});

test('Lesekalender können geprüft werden, ein Schreibzugang verlangt weiterhin Schreibrechte', async () => {
  const transport: DavTransport = async () => ({status:207,etag:null,body:xml(response('/remote.php/dav/',calendar+'<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>'))});
  await checkCalendar(credentials,transport,false);
  await assert.rejects(() => checkCalendar(credentials,transport),/Schreibrechte/);
});
