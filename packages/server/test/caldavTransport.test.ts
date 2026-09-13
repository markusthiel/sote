import { strict as assert } from 'node:assert';
import dns from 'node:dns/promises';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { davRequest } from '../src/caldav.js';
import { putEvent } from '../src/calendarWriters.js';

test('Der HTTP-Transport sendet eine eigene Programmkennung, UTF-8 und bedingte Schreibzugriffe', async (t) => {
  const received: { method: string | undefined; path: string | undefined; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201, { etag: '"saved"' });
      res.end();
    });
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const local = `http://127.0.0.1:${address.port}`;

  // Nur DNS und TLS-Endpunkt ersetzen. Node serialisiert die echten Request-
  // Optionen; kein Zugriff auf Apple und keine Abschaltung des Produktionsschutzes.
  const resolve = t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  const request = t.mock.method(https, 'request', (url: URL, options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    assert.equal(url.origin, 'https://p39-caldav.icloud.com');
    const { lookup: _lookup, ...forwarded } = options;
    return http.request(new URL(url.pathname, local), forwarded, callback);
  });
  syncBuiltinESMExports();
  t.after(() => { resolve.mock.restore(); request.mock.restore(); syncBuiltinESMExports(); });

  const credentials = { url: 'https://p39-caldav.icloud.com/123/calendars/home/', username: 'test-user', password: 'test-password' };
  const entry = { writer_id: 'writer', task_id: 'task', kind: 'plan' as const, uid: 'a'.repeat(32), etag: null, content_hash: null, pending_hash: null };
  const body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:' + entry.uid + '\r\nDTSTAMP:20260913T100000Z\r\nDTSTART:20260914T100000Z\r\nSUMMARY:Büro 🗓\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal(await putEvent(credentials, entry, body, davRequest), '"saved"');
  assert.equal(await putEvent(credentials, { ...entry, etag: '"before"' }, body, davRequest), '"saved"');
  for (const method of ['PROPFIND', 'GET', 'DELETE']) await davRequest(credentials.url, credentials, method);

  assert.deepEqual(received.map((r) => r.method), ['PUT', 'PUT', 'PROPFIND', 'GET', 'DELETE']);
  for (const req of received) {
    assert.match(req.headers['user-agent'] ?? '', /^SOTE\//);
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('test-user:test-password').toString('base64')}`);
    assert.equal(Number(req.headers['content-length']), req.body.length);
  }
  for (const req of received.slice(0, 2)) {
    assert.equal(req.path, `/123/calendars/home/${entry.uid}.ics`);
    assert.equal(req.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.equal(req.body.toString('utf8'), body);
  }
  assert.equal(received[0]!.headers['if-none-match'], '*');
  assert.equal(received[0]!.headers['if-match'], undefined);
  assert.equal(received[1]!.headers['if-match'], '"before"');
  assert.equal(received[1]!.headers['if-none-match'], undefined);
});
