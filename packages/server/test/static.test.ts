/**
 * SOTE — die statische Auslieferung.
 *
 * Der Test, der hier zählt, ist der Pfad nach oben: `/../../etc/passwd` darf
 * keine Datei sein. `normalize` allein reicht dafür nicht — geprüft wird, dass
 * der aufgelöste Pfad unter der Wurzel liegt.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { makeStatic } from '../src/http/static.js';

let base: string;
let server: Server;
let root: string;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'sote-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>SOTE</title>');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'export const a = 1;');
  // Wie das Buendel den PDF-Arbeiter nennt: die Endung bleibt, weil die Datei
  // ueber `?url` durchgereicht wird.
  writeFileSync(join(root, 'assets', 'pdf.worker.min-abc123.mjs'), 'export const b = 2;');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  // Ein Geheimnis eine Ebene über der Wurzel.
  writeFileSync(join(root, '..', 'sote-secret.txt'), 'nicht ausliefern');

  const serve = makeStatic(root);
  server = createServer((req, res) => {
    void serve(new URL(req.url ?? '/', 'http://x').pathname, res).then((ok) => {
      if (!ok) {
        res.writeHead(404);
        res.end('nein');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('die Wurzel liefert index.html', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /SOTE/);
});

test('ein tiefer Pfad ohne Endung liefert auch index.html', async () => {
  // Die Anwendung hat einen eigenen Router; ein Neuladen darf nicht 404 sein.
  const res = await fetch(`${base}/projekt/haus`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /SOTE/);
});

test('eine Anwendungsdatei kommt mit ihrem Typ und darf lange liegen', async () => {
  const res = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.match(res.headers.get('cache-control') ?? '', /immutable/);
});

test('index.html darf nicht lange liegen', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
});

test('der Pfad nach oben führt nicht hinaus', async () => {
  for (const path of [
    '/../sote-secret.txt',
    '/..%2Fsote-secret.txt',
    '/assets/../../sote-secret.txt',
    '/%2e%2e/sote-secret.txt',
  ]) {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    assert.equal(
      text.includes('nicht ausliefern'),
      false,
      `${path} hat die Datei über der Wurzel ausgeliefert`,
    );
  }
});

test('nichts wird geraten: eine unbekannte Endung wird nicht als Text geschickt', async () => {
  const res = await fetch(`${base}/favicon.svg`);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('`.mjs` wird als JavaScript ausgeliefert', async () => {
  /*
   * GEMELDET: „PDF laesst sich immer noch nicht oeffnen."
   *
   * Hier lag es. Die Typentabelle kannte `.js`, aber nicht `.mjs` — und das
   * Buendel nennt den PDF-Arbeiter `pdf.worker.min-<hash>.mjs`. Ohne Eintrag
   * kam `application/octet-stream`, und ein Browser LEHNT einen Arbeiter mit
   * falschem Typ ab. Die Meldung landet im Arbeiter und nicht auf der Seite;
   * nach aussen blieb nur „liess sich nicht oeffnen".
   *
   * Auf meinem Probeserver fiel es nicht auf, weil der `.mjs` richtig
   * auslieferte -- der Unterschied zwischen „im Browser geprueft" und „mit
   * DIESEM Server geprueft".
   */
  const res = await fetch(`${base}/assets/pdf.worker.min-abc123.mjs`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/javascript/);
});

test('was die Tabelle nicht kennt, wird nicht ausgefuehrt', async () => {
  // Der Rueckfall auf `application/octet-stream` bleibt richtig: eine
  // unbekannte Endung soll heruntergeladen und nicht ausgefuehrt werden. Der
  // Fehler oben war der fehlende Eintrag, nicht der Rueckfall.
  writeFileSync(join(root, 'assets', 'seltsam.xyz'), 'egal');
  const res = await fetch(`${base}/assets/seltsam.xyz`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /octet-stream/);
});
