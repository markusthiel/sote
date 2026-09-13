import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { comparisonTransport, fetchRequest } from './diagnose-caldav.mjs';

const credentials = { url: 'https://p39-caldav.icloud.com/private-account/calendars/private-calendar/', username: 'private-user', password: 'private-password' };
const url = credentials.url + 'private-uid.ics';
const answer = (status) => ({ status, body: '', etag: null });

test('Vergleich wiederholt denselben bedingten PUT und verwendet danach denselben Client zur Quittierung', async () => {
  const calls = [];
  const output = [];
  const primary = async (...args) => { calls.push(['primary', ...args]); return answer(404); };
  const alternate = async (...args) => { calls.push(['alternate', ...args]); return answer(201); };
  const transport = comparisonTransport(primary, alternate, (line) => output.push(line));
  const put = [url, credentials, 'PUT', 'private-event', { 'if-none-match': '*' }];
  assert.equal((await transport(...put)).status, 201);
  await transport(url, credentials, 'GET');
  assert.deepEqual(calls, [['primary', ...put], ['alternate', ...put], ['alternate', url, credentials, 'GET']]);
  for (const secret of ['private-account', 'private-calendar', 'private-uid', 'private-user', 'private-password', 'private-event']) assert.equal(output.join('\n').includes(secret), false);
});

test('Erfolge, Konflikte, Anmeldung und lesende 404 lösen keinen zweiten Schreibversuch aus', async () => {
  for (const [method, status] of [['PUT', 201], ['PUT', 401], ['PUT', 403], ['PUT', 412], ['GET', 404], ['DELETE', 404]]) {
    const transport = comparisonTransport(async () => answer(status), async () => assert.fail('Kein Wechsel erwartet'), () => {});
    assert.equal((await transport(url, credentials, method)).status, status);
  }
});

test('fetch behält Inhalt, Schreibbedingungen und Programmkennung, folgt aber keinen Redirects', async () => {
  for (const conditional of [{ 'if-none-match': '*' }, { 'if-match': '"saved"' }]) {
    const result = await fetchRequest(url, credentials, 'PUT', 'Büro 🗓', conditional, async (target, options) => {
      assert.equal(target.href, url);
      assert.equal(options.method, 'PUT');
      assert.equal(options.body, 'Büro 🗓');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['user-agent'], 'SOTE/1.0 (CalDAV)');
      assert.equal(options.headers.authorization, `Basic ${Buffer.from('private-user:private-password').toString('base64')}`);
      for (const [key, value] of Object.entries(conditional)) assert.equal(options.headers[key], value);
      return new Response('', { status: 201, headers: { etag: '"new"' } });
    });
    assert.equal(result.etag, '"new"');
  }
});

test('Vergleich gibt Zugangsdaten nicht an fremde Ziele und schreibt nie ohne Bedingung', async () => {
  const never = async () => assert.fail('Kein Netzaufruf erwartet');
  for (const target of ['http://p39-caldav.icloud.com/path/', 'https://example.com/', 'https://p39-caldav.icloud.com/other/', url + '?key=x', url + '#x']) {
    await assert.rejects(fetchRequest(target, credentials, 'PUT', '', { 'if-none-match': '*' }, never));
  }
  for (const base of ['https://p39-caldav.icloud.com/published/2/example/', 'https://example.com/calendars/', 'https://p39-caldav.icloud.com:444/calendars/']) {
    await assert.rejects(fetchRequest(base, { ...credentials, url: base }, 'PUT', '', { 'if-none-match': '*' }, never));
  }
  await assert.rejects(fetchRequest(url, credentials, 'PUT', '', {}, never));
  await assert.rejects(fetchRequest(url, credentials, 'DELETE', '', {}, never));
});

test('fetch begrenzt Antwortgrößen', async () => {
  await assert.rejects(fetchRequest(url, credentials, 'GET', '', {}, async () => new Response('x'.repeat(1024 * 1024 + 1))), /groß/);
});
