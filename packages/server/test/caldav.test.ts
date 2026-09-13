import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calendarUrl, checkCalendar, davRequest, eventFingerprint, publicAddress, strongEtag, type DavTransport } from '../src/caldav.js';
import { deleteEvent, putEvent, readWriterInput } from '../src/calendarWriters.js';

const credentials = { url: 'https://calendar.example/dav/mine/', username: 'user', password: 'secret' };
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sote-one@sote\r\nDTSTART:20260914T090000Z\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const entry = { writer_id:'writer', task_id:'task', kind:'plan' as const, uid:'sote-one@sote', etag:null, content_hash:null, pending_hash:null };
const multistatus = (props: string, status = '200 OK') => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/dav/mine/</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response></d:multistatus>`;
const calendar = '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>';
const answer = (body: string): DavTransport => async () => ({ status:207, body, etag:null });

test('Zieladressen und Netzwerkadressen sperren lokale Netze, Zugang im URL und Querylinks', async () => {
  for (const url of ['http://calendar.example/dav/', 'https://a:b@calendar.example/dav/', 'https://calendar.example/dav/?key=x', 'https://calendar.example/dav/#x', 'https://localhost/dav/', 'https://127.0.0.1/dav/', 'https://[::1]/dav/', 'https://calendar.example/no-slash']) assert.throws(() => calendarUrl(url), url);
  for (const address of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(publicAddress(address), true, address);
  await assert.rejects(() => davRequest('https://calendar.example/dav/mine/../other/a.ics', credentials, 'PUT'), /gehört nicht/);
});

test('PROPFIND prüft den tatsächlichen Kalender und VEVENT-Unterstützung, nicht erfolglose Eigenschaften', async () => {
  await checkCalendar(credentials, answer(multistatus(calendar)));
  await assert.rejects(() => checkCalendar(credentials, answer(multistatus(calendar, '404 Not Found'))), /kein CalDAV/);
  await assert.rejects(() => checkCalendar(credentials, answer(multistatus(calendar + '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'))), /keine Termine/);
  await assert.rejects(() => checkCalendar(credentials, answer(multistatus(calendar + '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>'))), /Schreibrechte/);
  await assert.rejects(() => checkCalendar(credentials, answer('<!DOCTYPE foo><foo/>')), /XML/);
  await assert.rejects(() => checkCalendar(credentials, answer(multistatus(calendar).replace('/dav/mine/', '/dav/other/'))), /gewählten Kalender/);
});

test('Weiterleitungen werden nicht verfolgt und Antworttexte gelangen nicht in Fehlermeldungen', async () => {
  let calls = 0;
  await assert.rejects(() => checkCalendar(credentials, async () => { calls++; return {status:302,body:'secret password',etag:null}; }), /endgültige/);
  assert.equal(calls, 1);
  await assert.rejects(() => checkCalendar(credentials, async () => ({status:401,body:'secret password',etag:null})), /Anmeldung abgelehnt/);
});

test('PUT legt nur neue Ressourcen an und aktualisiert mit dem gespeicherten ETag', async () => {
  const calls: { method: string; headers: Record<string,string> | undefined }[] = [];
  const transport: DavTransport = async (_url, _credentials, method, _body, headers) => { calls.push({method,headers}); return {status:201,body:'',etag:'"v1"'}; };
  assert.equal(await putEvent(credentials, entry, ics, transport), '"v1"');
  assert.equal(await putEvent(credentials, {...entry,etag:'"v0"'}, ics, transport), '"v1"');
  assert.deepEqual(calls, [{method:'PUT',headers:{'if-none-match':'*'}},{method:'PUT',headers:{'if-match':'"v0"'}}]);
});

test('Verlorene PUT-Antwort wird an identischem Inhalt erkannt; fremde Änderungen bleiben unangetastet', async () => {
  const transport: DavTransport = async (_url, _credentials, method) => method === 'PUT' ? {status:412,body:'',etag:null} : {status:200,body:ics,etag:'"written"'};
  assert.equal(await putEvent(credentials, entry, ics, transport), '"written"');
  const changed: DavTransport = async (...args) => { const res = await transport(...args); return {...res,body:res.body.replace('SUMMARY:Test','SUMMARY:Fremd geändert')}; };
  await assert.rejects(() => putEvent(credentials, entry, ics, changed), /Konflikt/);
  const weak: DavTransport = async () => ({status:200,body:ics,etag:'W/"weak"'});
  await assert.rejects(() => putEvent(credentials, entry, ics, weak), /Konflikt/);
});

test('DELETE verwendet If-Match, löst unquittierte eigene PUTs auf und löscht keine veränderten Einträge', async () => {
  const calls: string[] = [];
  const transport: DavTransport = async (_url, _credentials, method, _body, headers) => {
    calls.push(method);
    if (method === 'GET') return {status:200,body:ics,etag:'"saved"'};
    assert.equal(headers?.['if-match'], '"saved"'); return {status:204,body:'',etag:null};
  };
  await deleteEvent(credentials, {...entry,pending_hash:eventFingerprint(ics)}, transport);
  assert.deepEqual(calls, ['GET','DELETE']);
  await assert.rejects(() => deleteEvent(credentials, entry, transport), /Konflikt/);
  await assert.rejects(() => deleteEvent(credentials, {...entry,etag:'"saved"'}, async () => ({status:412,body:'',etag:null})), /Konflikt/);
  await deleteEvent(credentials, entry, async () => ({status:404,body:'',etag:null}));
});

test('Vergleich toleriert Umordnung und Serverzeitstempel, aber keine zusätzlichen Alarme', () => {
  assert.equal(eventFingerprint(ics), eventFingerprint(ics.replace('UID:sote-one@sote\r\n','').replace('SUMMARY:Test','UID:sote-one@sote\r\nDTSTAMP:20260913T090000Z\r\nSUMMARY:Test')));
  assert.notEqual(eventFingerprint(ics), eventFingerprint(ics.replace('END:VEVENT','BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT')));
  assert.equal(strongEtag('W/"weak"'), false);
});

test('Schreibregeln brauchen explizite Bereiche, gültige Zeitzone und boolesche Aktivierung', () => {
  const good = {workspaces:['11111111-1111-4111-8111-111111111111'],mode:'planned',timezone:'Europe/Berlin',enabled:true};
  assert.deepEqual(readWriterInput(good), good);
  for (const invalid of [{workspaces:[]},{workspaces:['wrong']},{timezone:'Mars/Base'},{enabled:'yes'},{mode:'everything'},{username:'a:b'}]) assert.throws(() => readWriterInput({...good,...invalid}));
});
