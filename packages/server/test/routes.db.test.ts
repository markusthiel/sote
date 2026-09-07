/**
 * SOTE — die Routen über echtes HTTP und eine echte Datenbank.
 *
 * Nicht die Handler direkt aufgerufen: was ein Keks tut, was ein 401 auslöst
 * und ob eine Route ohne Sitzung wirklich schweigt, sieht nur ein Aufruf über
 * die Leitung. Genau die Naht, in der SONEs teure Fehler lagen.
 */

import { strict as assert } from 'node:assert';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { setPassword } from '../src/auth.js';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { makeServer } from '../src/routes.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ??
  'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let base: string;
let server: ReturnType<typeof makeServer>;
let workspaceId: string;
const email = `routes-${process.pid}@example.org`;
const NOW = new Date(Date.UTC(2026, 8, 7, 10, 0));

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);

  const u = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [email, 'Markus'],
  );
  await setPassword(pool, u!.id, 'ein gutes Kennwort');
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    ['Routen'],
  );
  workspaceId = w!.id;
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor')
     RETURNING id`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [workspaceId, u!.id, r!.id],
  );
  await pool.query(
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Haus','a0')`,
    [workspaceId],
  );

  server = makeServer({
    pool,
    config: {
      databaseUrl: URL_,
      port: 0,
      sessionDays: 30,
      reminderMailAfterMinutes: 10,
    },
    now: () => NOW,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

let sessionCookie = '';

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(sessionCookie === '' ? {} : { cookie: sessionCookie }),
      ...(init.headers ?? {}),
    },
  });

test('ohne Sitzung antwortet jede Route mit 401 und einem Grund', async () => {
  const res = await call('/api/today');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'no_session');
});

test('die Gesundheitsroute braucht keine Sitzung', async () => {
  const res = await call('/api/health');
  assert.equal(res.status, 200);
});

test('ein falsches Kennwort und ein unbekanntes Konto geben denselben Grund', async () => {
  const a = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'falsch' }),
  });
  const b = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email: 'niemand@example.org', password: 'falsch' }),
  });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test('anmelden setzt einen HttpOnly-Keks', async () => {
  const res = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'ein gutes Kennwort' }),
  });
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  sessionCookie = set.split(';')[0]!;
});

test('me nennt den Arbeitsbereich, in dem man Mitglied ist', async () => {
  const res = await call('/api/me');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    displayName: string;
    workspaces: { id: string }[];
  };
  assert.equal(body.displayName, 'Markus');
  assert.deepEqual(
    body.workspaces.map((w) => w.id),
    [workspaceId],
  );
});

test('eine Zeile anlegen, und der Satz zur Wiederholung kommt mit', async () => {
  const res = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Filter reinigen jeden zweiten Dienstag 8 Uhr #haus !!' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    task: { title: string; priority: number; recurrence: { says: string } | null };
    unknownProject: string | null;
  };
  assert.equal(body.task.title, 'Filter reinigen');
  assert.equal(body.task.priority, 2);
  assert.equal(body.task.recurrence?.says, 'Jeden zweiten Dienstag um 08:00 Uhr, ohne Ende.');
  assert.equal(body.unknownProject, null);
});

test('ein unbekanntes Projekt wird gemeldet, nicht angelegt', async () => {
  const res = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Beleg suchen #gibtesnicht' }),
  });
  const body = (await res.json()) as { unknownProject: string | null };
  assert.equal(body.unknownProject, 'gibtesnicht');
});

test('eine leere Zeile wird abgelehnt und nennt den Grund', async () => {
  const res = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: '   ' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'empty_line');
});

test('Heute zeigt, was heute dran ist, und Abhaken liefert die Nachfolgerin', async () => {
  await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Pfand wegbringen heute' }),
  });
  const list = (await (await call('/api/today')).json()) as {
    today: { id: string; title: string }[];
  };
  const row = list.today.find((t) => t.title === 'Pfand wegbringen');
  assert.ok(row, 'die Aufgabe muss in Heute stehen');

  const done = await call(`/api/tasks/${row.id}/complete`, { method: 'POST' });
  assert.equal(done.status, 200);
  const body = (await done.json()) as {
    completed: { completed: string | null };
    next: unknown;
  };
  assert.ok(body.completed.completed !== null);
  assert.equal(body.next, null, 'ohne Wiederholung keine Nachfolgerin');

  const again = (await (await call('/api/today')).json()) as {
    today: { title: string }[];
  };
  assert.equal(
    again.today.some((t) => t.title === 'Pfand wegbringen'),
    false,
  );
});

test('Projekte zählen offene Aufgaben und lassen die Null weg', async () => {
  const body = (await (await call('/api/projects')).json()) as {
    projects: { name: string; open: number | null }[];
  };
  const haus = body.projects.find((p) => p.name === 'Haus');
  assert.ok(haus);
  assert.ok(haus.open !== null && haus.open > 0, 'Haus hat offene Aufgaben');

  await pool.query(
    `INSERT INTO projects (workspace_id, name, sort_key) VALUES ($1,'Leer','a5')`,
    [workspaceId],
  );
  const after_ = (await (await call('/api/projects')).json()) as {
    projects: { name: string; open: number | null }[];
  };
  assert.equal(after_.projects.find((p) => p.name === 'Leer')?.open, null);
});

test('eine unbekannte Route sagt, welche es nicht gibt', async () => {
  const res = await call('/api/gibtsnicht');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'no_route');
  assert.match(body.error.message, /gibtsnicht/);
});

test('abmelden macht den Keks wertlos', async () => {
  const out = await call('/api/session', { method: 'DELETE' });
  assert.equal(out.status, 200);
  const res = await call('/api/today');
  assert.equal(res.status, 401);
});

/* ── Die Oberfläche ausliefern ─────────────────────────────────────────── */

test('ohne gebaute Oberfläche antwortet ein Nicht-API-Pfad mit einem Grund', async () => {
  // Diese Instanz im Test hat keinen webRoot. Sie soll das sagen und nicht
  // einen leeren 404 auf jeden Pfad geben.
  const res = await call('/');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'no_web');
});
