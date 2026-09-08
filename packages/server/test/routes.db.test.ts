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
import { makePool, queryOne, queryRows } from '../src/db.js';
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
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,'Zuhause','folder','a0')`,
    [workspaceId],
  );
  // Ein Projekt darin, denn `#haus` meint ein Projekt und keinen Ordner
  // (Konzept 10d). Der Ordner heisst anders, damit der Test sichtbar macht,
  // welche der beiden Zeilen die Aufgaben traegt.
  await pool.query(
    `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
     SELECT $1, id, 'Haus', 'list', 'a0' FROM projects
      WHERE workspace_id = $1 AND name = 'Zuhause'`,
    [workspaceId],
  );

  server = makeServer({
    pool,
    config: {
      databaseUrl: URL_,
      port: 0,
      sessionDays: 30,
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
    `INSERT INTO projects (workspace_id, name, kind, sort_key)
     VALUES ($1,'Leer','folder','a5')`,
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

test('vier gleichzeitige Migrationsläufe stören sich nicht', async () => {
  // Gefunden in der CI und nicht hier: `pnpm -r test` fährt die Testdateien
  // parallel, jede ruft `migrate` auf, und mehrere führten 0001 gleichzeitig
  // aus. Postgres antwortet dann mit `duplicate key value violates unique
  // constraint "pg_type_typname_nsp_index"` — `CREATE TYPE` und
  // `CREATE EXTENSION IF NOT EXISTS` sind gegen Nebenläufigkeit nicht sicher.
  //
  // Lokal fiel es nie auf, weil die Testdatenbank vom letzten Lauf schon
  // migriert war und alle vier nur das Migrationsbuch lasen. Der Test stellt
  // darum eine **eigene, leere** Datenbank her.
  //
  // Und es ist kein Testproblem: zwei Container, die gleichzeitig starten,
  // migrieren gleichzeitig.
  const admin = makePool(URL_);
  const name = `sote_race_${process.pid}`;
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } catch {
    // Ohne das Recht, Datenbanken anzulegen, ist hier nichts zu prüfen — dann
    // schweigt der Test statt einen Fehlschlag zu behaupten, der keiner ist.
    await admin.end();
    return;
  }

  const fresh = URL_.replace(/\/[^/]+$/, `/${name}`);
  const pools = [makePool(fresh), makePool(fresh), makePool(fresh), makePool(fresh)];
  try {
    const results = await Promise.allSettled(pools.map((p) => migrate(p)));
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(
      rejected.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 90)),
      [],
      'kein Lauf darf scheitern',
    );
    const ran = results
      .filter((r): r is PromiseFulfilledResult<string[]> => r.status === 'fulfilled')
      .map((r) => r.value.length);
    assert.equal(
      ran.filter((n) => n > 0).length,
      1,
      'genau einer migriert, die anderen sehen das Buch und überspringen',
    );
  } finally {
    await Promise.all(pools.map((p) => p.end()));
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
});

/* ── Freigaben über HTTP ─────────────────────────────────────────────────── */

/**
 * Wieder anmelden.
 *
 * Ein Test weiter oben meldet sich ab, und die Sitzung liegt in einer Variablen
 * dieser Datei — meine neuen Tests hingen hinter dem Abmelden und bekamen 401.
 * Der Fehler steckte nicht in den Freigaben, sondern in der Reihenfolge; ein
 * eigenes Anmelden hier macht diese Gruppe unabhängig davon, was vorher lief.
 */
test('für die Freigaben wieder anmelden', async () => {
  const res = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'ein gutes Kennwort' }),
  });
  assert.equal(res.status, 200);
  sessionCookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  // Und ab hier gilt derselbe Schlüssel für alle Tests dieser Gruppe.
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
});

test('ein Link ohne Konto liest sein Projekt und sonst nichts', async () => {
  /*
   * Der Kern der Rechtefläche: dieser Aufruf trägt KEIN Sitzungsplätzchen.
   * Genau das ist die Idee einer Freigabe — und genau das muss geprüft werden,
   * denn ein Weg, der nur mit Konto funktioniert, ist keine Freigabe, und
   * einer, der zu viel hergibt, ist ein Loch.
   */
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const projectId = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM projects WHERE workspace_id = $1 AND kind = 'list' LIMIT 1`,
    [workspaceId],
  );
  const antwort = await call('/api/shares', {
    method: 'POST',
    body: JSON.stringify({ projectId: projectId!.id, right: 'read' }),
  });
  // Die Antwort wird GEPRÜFT, bevor daraus gelesen wird: sonst meldet der Test
  // „cannot read properties of undefined" und verschweigt, was der Server
  // wirklich gesagt hat.
  const made = (await antwort.json()) as { share?: { token: string }; error?: string };
  assert.equal(antwort.status, 201, `Freigabe anlegen: ${JSON.stringify(made)}`);
  const token = made.share!.token;

  // Ohne Plätzchen: der Link selbst.
  const ohne = await fetch(`${base}/api/share/${token}`);
  assert.equal(ohne.status, 200);
  const body = (await ohne.json()) as { project: { name: string }; right: string };
  assert.equal(body.right, 'read');
  assert.ok(body.project.name.length > 0);
  // Und NICHT der Arbeitsbereich, nicht die anderen Projekte, nicht die Leute.
  assert.equal('workspace' in body, false);
  assert.equal('projects' in body, false);

  // Schreiben darf er nicht.
  const schreiben = await fetch(`${base}/api/share/${token}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line: 'geht nicht' }),
  });
  assert.equal(schreiben.status, 403);
});

test('ein geratener Token bekommt immer denselben Satz', async () => {
  /*
   * Anders begründet als ADR-0073s „no such account is said plainly": dort
   * fragt jemand, der schon wissen darf, wer im Arbeitsbereich ist. Hier fragt
   * ein Fremder — „gibt es nicht" gegen „abgelaufen" gegen „widerrufen" wäre
   * eine Auskunft darüber, ob ein geratener Token einmal existiert hat, und das
   * macht Raten lohnend.
   */
  const a = await fetch(`${base}/api/share/${'a'.repeat(43)}`);
  assert.equal(a.status, 404);
  // `error` ist ein Objekt {code, message} — mit `assert.equal` verglichen
  // schlägt es immer an, weil zwei Objekte nie gleich sind. `deepEqual` ist
  // hier die Frage, die gemeint war.
  const erste = ((await a.json()) as { error: unknown }).error;

  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const projectId = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM projects WHERE workspace_id = $1 AND kind = 'list' LIMIT 1`,
    [workspaceId],
  );
  const made = (await (
    await call('/api/shares', {
      method: 'POST',
      body: JSON.stringify({ projectId: projectId!.id, right: 'edit' }),
    })
  ).json()) as { share: { id: string; token: string } };
  await call(`/api/shares/${made.share.id}`, { method: 'DELETE' });

  const b = await fetch(`${base}/api/share/${made.share.token}`);
  assert.equal(b.status, 404);
  assert.deepEqual(((await b.json()) as { error: unknown }).error, erste, 'derselbe Satz');
});

test('ein Link darf keine fremde Aufgabe anfassen', async () => {
  /*
   * Eine Id in der Adresse ist eine BEHAUPTUNG des Aufrufers, nicht eine
   * Auskunft. Ohne diese Prüfung wäre jede Freigabe eine Freigabe auf alle
   * Aufgaben der Instanz, sobald jemand eine fremde Id einsetzt — und Ids
   * stehen in Antworten.
   */
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const zwei = await queryRows<{ id: string }>(
    pool,
    `SELECT id FROM projects WHERE workspace_id = $1 AND kind = 'list' LIMIT 1`,
    [workspaceId],
  );
  const made = (await (
    await call('/api/shares', {
      method: 'POST',
      body: JSON.stringify({ projectId: zwei[0]!.id, right: 'edit' }),
    })
  ).json()) as { share: { token: string } };

  // Eine Aufgabe, die NICHT in diesem Projekt liegt.
  const fremd = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'woanders','z9')
     RETURNING id`,
    [workspaceId],
  );
  const res_ = await fetch(`${base}/api/share/${made.share.token}/tasks/${fremd!.id}/complete`, {
    method: 'POST',
  });
  assert.equal(res_.status, 404);
  // Und sie ist wirklich nicht abgehakt.
  const row = await queryOne<{ completed_at: Date | null }>(
    pool,
    'SELECT completed_at FROM tasks WHERE id = $1',
    [fremd!.id],
  );
  assert.equal(row!.completed_at, null);
});

test('ein Link mit edit legt an, hakt ab und öffnet wieder', async () => {
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const projectId = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM projects WHERE workspace_id = $1 AND kind = 'list' LIMIT 1`,
    [workspaceId],
  );
  const made = (await (
    await call('/api/shares', {
      method: 'POST',
      body: JSON.stringify({ projectId: projectId!.id, right: 'edit' }),
    })
  ).json()) as { share: { token: string } };
  const t = made.share.token;

  const angelegt = await fetch(`${base}/api/share/${t}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line: 'vom Gast' }),
  });
  assert.equal(angelegt.status, 201);
  const id = ((await angelegt.json()) as { id: string }).id;

  // Ein Gast ist niemand: `created_by` bleibt leer, und das ist der Preis der
  // Entscheidung „ein Token, kein Konto" (Konzept 10e).
  const wer = await queryOne<{ created_by: string | null }>(
    pool,
    'SELECT created_by FROM tasks WHERE id = $1',
    [id],
  );
  assert.equal(wer!.created_by, null);

  assert.equal((await fetch(`${base}/api/share/${t}/tasks/${id}/complete`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base}/api/share/${t}/tasks/${id}/complete`, { method: 'DELETE' })).status, 200);
});

test('ein Link legt nichts in ein fremdes Projekt, auch nicht über #projekt', async () => {
  /*
   * Sonst wäre die Schnellerfassung ein Weg aus dem eigenen Gegenstand hinaus:
   * „Kabel #anderes" würde eine Aufgabe dort ablegen, wo die Freigabe nicht
   * gilt.
   */
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const projectId = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM projects WHERE workspace_id = $1 AND kind = 'list' LIMIT 1`,
    [workspaceId],
  );
  const made = (await (
    await call('/api/shares', {
      method: 'POST',
      body: JSON.stringify({ projectId: projectId!.id, right: 'edit' }),
    })
  ).json()) as { share: { token: string } };

  const angelegt = await fetch(`${base}/api/share/${made.share.token}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line: 'Kabel #Zuhause' }),
  });
  const id = ((await angelegt.json()) as { id: string }).id;
  const row = await queryOne<{ project_id: string }>(
    pool,
    'SELECT project_id FROM tasks WHERE id = $1',
    [id],
  );
  assert.equal(row!.project_id, projectId!.id, 'liegt im freigegebenen Projekt');
});
