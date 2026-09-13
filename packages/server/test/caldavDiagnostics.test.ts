import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { davResponseDetails } from '../src/caldavDiagnostics.js';
import { putEvent } from '../src/calendarWriters.js';
import type { DavTransport } from '../src/caldav.js';

const credentials = {url:'https://p39-caldav.icloud.com/private-account/calendars/private-calendar/',username:'private-user',password:'private-password'};
const entry = {writer_id:'writer',task_id:'task',kind:'plan' as const,uid:'a'.repeat(32),etag:null,content_hash:null,pending_hash:null};
const calendar = '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/private-account/calendars/private-calendar/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';

test('PUT 404 wird mit einer lesenden Kalenderprüfung eingegrenzt, ohne weitere Schreibversuche', async () => {
  const methods: string[] = [];
  const transport: DavTransport = async (url,_credentials,method,_body,headers) => {
    methods.push(method);
    if (method==='PUT') {
      assert.equal(url,credentials.url+entry.uid+'.ics'); assert.equal(headers?.['if-none-match'],'*');
      return {status:404,body:'',etag:null,server:'AppleHttpServer/version'};
    }
    assert.equal(url,credentials.url); assert.equal(headers?.['depth'],'0');
    return {status:207,body:calendar,etag:null};
  };
  await assert.rejects(() => putEvent(credentials,entry,'private-event',transport), (e: Error) => {
    assert.match(e.message,/Termin schreiben \(PUT\).*HTTP 404/);
    assert.match(e.message,/Termin-ID: 32 Bytes/); assert.match(e.message,/Antwort: Apple, leer/);
    assert.match(e.message,/Kalenderprüfung \(PROPFIND\): erfolgreich/);
    for (const secret of ['private-account','private-calendar','private-user','private-password','private-event',entry.uid]) assert.equal(e.message.includes(secret),false);
    return true;
  });
  assert.deepEqual(methods,['PUT','PROPFIND']);
});

test('Ein inzwischen fehlender Kalender ist vom abgelehnten PUT unterscheidbar', async () => {
  const methods: string[] = [];
  await assert.rejects(() => putEvent(credentials,entry,'',async (_url,_creds,method) => {
    methods.push(method); return {status:404,body:'private-password',etag:null};
  }), /Kalenderprüfung \(PROPFIND\): Der Kalenderdienst antwortet mit HTTP 404/);
  assert.deepEqual(methods,['PUT','PROPFIND']);
  methods.length=0;
  await assert.rejects(() => putEvent(credentials,entry,'',async (_url,_creds,method) => {
    methods.push(method); return {status:401,body:'',etag:null};
  }), /Anmeldung abgelehnt/);
  assert.deepEqual(methods,['PUT']);
});

test('Diagnose zeigt nur bekannte DAV-Fehlercodes, niemals beliebige XML- oder Servertexte', () => {
  const body = '<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><c:valid-calendar-data/><d:need-privileges/><d:href>private-account</d:href><d:responsedescription>private-password</d:responsedescription></d:error>';
  const details = davResponseDetails({status:404,body,etag:null,server:'private-password'});
  assert.match(details,/valid-calendar-data/); assert.match(details,/need-privileges/);
  assert.equal(details.includes('private-'),false);
  assert.match(davResponseDetails({status:404,body:'<html>private-password</html>',etag:null}),/HTML/);
  assert.match(davResponseDetails({status:404,body:'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///private-password">]><x>&secret;</x>',etag:null}),/unlesbares XML/);
});
