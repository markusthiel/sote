import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calendarUrl, type DavTransport } from '../src/caldav.js';
import { discoverICloudCalendars } from '../src/icloudCalDav.js';

const root = 'https://caldav.icloud.com/';
const shard = 'https://p39-caldav.icloud.com';
const login = { username: 'test@example.com', password: 'app-password' };
const prop = (href: string, properties: string, status = '200 OK') => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`;
const xml = (responses: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
const eventProps = '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>';
const privilege = (name: string) => `<d:current-user-privilege-set><d:privilege><d:${name}/></d:privilege></d:current-user-privilege-set>`;

function fixture() {
  const calls: { url: string; depth: string | undefined }[] = [];
  const documents = new Map([
    [root, xml(prop('/', '<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>'))],
    [root + '123/principal/', xml(prop('/123/principal/', `<c:calendar-home-set><d:href>${shard}/123/calendars/</d:href></c:calendar-home-set>`))],
    [shard + '/123/calendars/', xml(
      prop('/123/calendars/', '<d:resourcetype><d:collection/></d:resourcetype>') +
      prop('/123/calendars/home', eventProps + '<d:displayname>Privat &amp; Familie</d:displayname>' + privilege('write')) +
      prop('/123/calendars/read-only/', eventProps + privilege('read')) +
      prop('/123/calendars/reminders/', eventProps.replace('VEVENT', 'VTODO')) +
      prop('/123/calendars/denied/', eventProps, '403 Forbidden'))],
  ]);
  const transport: DavTransport = async (url, credentials, method, body, headers) => {
    calls.push({url,depth:headers?.['depth']});
    assert.equal(method, 'PROPFIND');
    assert.equal(credentials.username, login.username); assert.equal(credentials.password, login.password);
    assert.equal(credentials.url, new URL(url).origin + '/');
    assert.ok(body?.includes('<d:propfind'));
    const document = documents.get(url);
    assert.ok(document, `unerwartetes Ziel ${url}`);
    return {status:207, body:document, etag:null};
  };
  return {calls,documents,transport};
}

test('iCloud-Suche ermittelt Principal und Server und bietet nur beschreibbare Terminkalender an', async () => {
  const f = fixture();
  assert.deepEqual(await discoverICloudCalendars(login, f.transport), [{url:shard + '/123/calendars/home/',name:'Privat & Familie'}]);
  assert.deepEqual(f.calls.map(c => c.depth), ['0','0','1']);
});

test('Apple-Weiterleitung behält PROPFIND und wird nur auf geprüften CalDAV-Hosts verfolgt', async () => {
  const f = fixture();
  f.documents.set(shard + '/', f.documents.get(root)!);
  f.documents.set(shard + '/123/principal/', f.documents.get(root + '123/principal/')!);
  const redirect: DavTransport = async (...args) => args[0] === root ? {status:301, body:'',etag:null,location:shard + '/'} : f.transport(...args);
  assert.equal((await discoverICloudCalendars(login,redirect)).length,1);
  assert.equal(f.calls[0]?.url, shard + '/');
});

test('Fremde Hosts, HTTP, Kennwörter im URL und fremde iCloud-Dienste bekommen keine Zugangsdaten', async () => {
  for (const location of ['https://evil.example/', 'https://p39-caldav.icloud.com.evil.example/', 'https://www.icloud.com/', 'http://p39-caldav.icloud.com/', 'https://user@p39-caldav.icloud.com/', 'https://p39-caldav.icloud.com:8443/', shard + '/published/2/example', shard + '/?token=example']) {
    let calls = 0;
    await assert.rejects(() => discoverICloudCalendars(login, async () => { calls++; return {status:302,body:'',etag:null,location}; }), /Zieladresse/);
    assert.equal(calls,1);
  }
  const f = fixture();
  f.documents.set(root, xml(prop('/', '<d:current-user-principal><d:href>https://evil.example/</d:href></d:current-user-principal>')));
  await assert.rejects(() => discoverICloudCalendars(login,f.transport), /Zieladresse/);
  assert.equal(f.calls.length,1);
});

test('Erfolglose oder fremde Principal-Eigenschaften werden nicht übernommen', async () => {
  for (const response of [prop('/', '<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>', '404 Not Found'), prop('/other/', '<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>')]) {
    const f = fixture(); f.documents.set(root,xml(response));
    await assert.rejects(() => discoverICloudCalendars(login,f.transport), /keinen angemeldeten/);
    assert.equal(f.calls.length,1);
  }
});

test('Ungültiges XML und Loginfehler werden ohne Antworttexte gemeldet', async () => {
  for (const body of ['<!DOCTYPE foo><foo/>', '<d:multistatus', '<html>app-password</html>']) {
    await assert.rejects(() => discoverICloudCalendars(login,async () => ({status:207,body,etag:null})), /keine lesbare/);
  }
  await assert.rejects(() => discoverICloudCalendars(login,async () => ({status:401,body:'app-password',etag:null})), /Anmeldung abgelehnt/);
});

test('Schleifen sind begrenzt und fehlende Zugangsdaten lösen keine Anfrage aus', async () => {
  let calls = 0;
  const redirect: DavTransport = async () => { calls++; return {status:307,body:'',etag:null,location:root}; };
  await assert.rejects(() => discoverICloudCalendars(login,redirect), /zu viele/); assert.equal(calls,12);
  for (const invalid of [{}, {...login,username:'name:password'}, {...login,password:''}]) {
    await assert.rejects(() => discoverICloudCalendars(invalid,redirect), /App-spezifisches/);
  }
  assert.equal(calls,12);
});

test('Öffentliche iCloud-Leselinks werden auch mit HTTPS als schreibgeschützt erklärt', () => {
  for (const url of ['webcal://p39-caldav.icloud.com/published/2/example', 'https://p39-caldav.icloud.com/published/2/example/']) {
    assert.throws(() => calendarUrl(url), /Kalender-Leselink/);
  }
});
