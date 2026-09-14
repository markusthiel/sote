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
  // Der Wert ist der Token — ein String mit Länge, kein `[object Object]`
  // (Audit 12.09.2026, F09: die SSO-Stelle schrieb das Sitzungsobjekt).
  assert.match(set.split(';')[0]!, /^sote_session=[A-Za-z0-9_-]{20,}$/);
  // Ohne Basisadresse kein `Secure`: eine Testinstanz ohne TLS soll gehen.
  assert.doesNotMatch(set, /Secure/);
  sessionCookie = set.split(';')[0]!;
});

test('auf einer HTTPS-Instanz trägt der Keks Secure', async () => {
  /*
   * Audit 12.09.2026, F12. Woher der Server das weiss: aus `SOTE_BASE_URL`,
   * derselben Angabe, aus der die Links in Mails gebaut werden.
   */
  const vorher = process.env['SOTE_BASE_URL'];
  process.env['SOTE_BASE_URL'] = 'https://sote.example';
  try {
    const res = await call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'ein gutes Kennwort' }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /; Secure/);
    // Und das Abmelden löscht mit denselben Attributen — sonst löscht es nichts.
    const weg = await fetch(`${base}/api/session`, {
      method: 'DELETE',
      headers: { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]! },
    });
    assert.match(weg.headers.get('set-cookie') ?? '', /Max-Age=0.*Secure/);
  } finally {
    if (vorher === undefined) delete process.env['SOTE_BASE_URL'];
    else process.env['SOTE_BASE_URL'] = vorher;
  }
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
    body: JSON.stringify({ line: 'Filter reinigen jeden zweiten Dienstag 8 Uhr +haus !!' }),
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
    body: JSON.stringify({ line: 'Beleg suchen +gibtesnicht' }),
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

test('Aufgabenlinks finden den lesbaren Arbeitsbereich unabhängig vom aktuellen Bereich', async (t) => {
  const me = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE email=$1', [email]);
  const ws = await queryOne<{ id: string }>(pool, "INSERT INTO workspaces(name) VALUES('Linkziel') RETURNING id");
  t.after(async () => { await pool.query('DELETE FROM workspaces WHERE id=$1', [ws!.id]); });
  const role = await queryOne<{ id: string }>(pool,
    "INSERT INTO roles(workspace_id,name,list_level) VALUES($1,'reader','viewer') RETURNING id", [ws!.id]);
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role_id) VALUES($1,$2,$3)', [ws!.id, me!.id, role!.id]);
  const task = await queryOne<{ id: string }>(pool,
    "INSERT INTO tasks(workspace_id,title,sort_key) VALUES($1,'Verlinkte Aufgabe','a0') RETURNING id", [ws!.id]);
  const path = `/api/tasks/${task!.id}/location`;
  assert.equal((await fetch(base + path)).status, 401, 'Sitzung erforderlich');
  for (const suffix of ['', `?workspace=${workspaceId}`]) {
    const found = await call(path + suffix);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { workspaceId: ws!.id });
  }
  assert.equal((await call(`/api/tasks/${task!.id}?workspace=${workspaceId}`)).status, 404, 'Detail bleibt auf seinen Bereich begrenzt');
  assert.equal((await call(`/api/tasks/${task!.id}?workspace=${ws!.id}`)).status, 200);
  const unavailable = await call('/api/tasks/00000000-0000-0000-0000-000000000000/location');
  assert.equal(unavailable.status, 404);
  const expectedError = await unavailable.json();
  const expectHidden = async () => {
    const result = await call(path);
    assert.equal(result.status, 404);
    assert.deepEqual(await result.json(), expectedError, 'keine Auskunft über unzugängliche Aufgaben');
  };
  await pool.query('UPDATE roles SET list_level=NULL WHERE id=$1', [role!.id]);
  await expectHidden();
  await pool.query("UPDATE roles SET list_level='viewer' WHERE id=$1", [role!.id]);
  await pool.query('UPDATE tasks SET trashed_at=now() WHERE id=$1', [task!.id]);
  await expectHidden();
  await pool.query('UPDATE tasks SET trashed_at=NULL WHERE id=$1', [task!.id]);
  await pool.query('UPDATE workspaces SET deleted_at=now() WHERE id=$1', [ws!.id]);
  await expectHidden();
  await pool.query('UPDATE workspaces SET deleted_at=NULL WHERE id=$1', [ws!.id]);
  await pool.query('DELETE FROM workspace_members WHERE workspace_id=$1', [ws!.id]);
  await expectHidden();
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

test('ein Link legt nichts in ein fremdes Projekt, auch nicht über +projekt', async () => {
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
    body: JSON.stringify({ line: 'Kabel +Zuhause' }),
  });
  const id = ((await angelegt.json()) as { id: string }).id;
  const row = await queryOne<{ project_id: string }>(
    pool,
    'SELECT project_id FROM tasks WHERE id = $1',
    [id],
  );
  assert.equal(row!.project_id, projectId!.id, 'liegt im freigegebenen Projekt');
});

/* ── Die Detailspalte eines Gasts ────────────────────────────────────────────
 *
 * Gemeldet: „Die Seitenleiste mit Aufgabendetails braucht ein geteilter User
 * auch." Geprüft wird hier über HTTP, weil genau die **Verzweigung** in
 * `shareRoutes` die Sache ist — welcher Weg bei welchem Recht antwortet.
 */

/**
 * Ein Link auf ein Projekt, über die Route des Eigentümers.
 *
 * Projekt und Ordner werden **einmal** angelegt und dann wiederverwendet:
 * `projects_sibling_name` verbietet zwei Geschwister gleichen Namens, und mein
 * erster Helfer legte sie bei jedem Aufruf neu an — vier Tests, drei
 * Schlüsselverletzungen. Die Aufgabe ist neu je Aufruf, damit die Tests sich
 * nicht gegenseitig die Kommentare und Teilaufgaben zählen.
 */
let gastProjekt: string | undefined;
let gastZaehler = 0;
async function linkAuf(right: 'read' | 'edit'): Promise<{ token: string; taskId: string }> {
  /*
   * Ohne Schlüssel gibt es keine Freigaben — und dann antwortet jeder Gast-Weg
   * 404, was aussieht wie ein Fehler in der Route. Genau so ist es mir
   * passiert: sechs Tests rot, und der Grund war eine fehlende Variable in
   * dieser Datei.
   */
  process.env['SOTE_SHARE_KEY'] ??= Buffer.alloc(32, 7).toString('hex');
  if (gastProjekt === undefined) {
    const ordner = await pool.query(
      `INSERT INTO projects (workspace_id, name, kind, sort_key)
       VALUES ($1,'Gast-Ordner','folder','zz1') RETURNING id`,
      [workspaceId],
    );
    const projekt = await pool.query(
      `INSERT INTO projects (workspace_id, parent_id, name, kind, sort_key)
       VALUES ($1,$2,'Gast-Projekt','list','zz2') RETURNING id`,
      [workspaceId, ordner.rows[0].id],
    );
    gastProjekt = projekt.rows[0].id as string;
  }
  /*
   * Ein eigener Sortierschlüssel je Aufruf.
   *
   * `tasks_sibling_order` verbietet zwei Geschwister mit demselben Schlüssel,
   * und mein Helfer nahm jedes Mal `'a'` im **selben** Projekt — der zweite
   * Test scheiterte am Anlegen, nicht an der Sache. Die Regel gilt auch für
   * Tests, und das ist ihr Sinn.
   */
  gastZaehler += 1;
  const aufgabe = await pool.query(
    `INSERT INTO tasks (workspace_id, project_id, title, sort_key)
     VALUES ($1,$2,'Dach dichten','a' || $3) RETURNING id`,
    [workspaceId, gastProjekt, String(gastZaehler)],
  );
  const res = await call('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: gastProjekt, right }),
  });
  if (res.status !== 201) {
    // Die Auskunft, die mir gefehlt hat: sechs Tests waren rot mit „404", und
    // der Grund lag im Anlegen des Links, nicht im Lesen.
    throw new Error(`Link anlegen: ${res.status} ${await res.text()}`);
  }
  /*
   * Der Token steht unter `share`, nicht oben.
   *
   * Mein erster Helfer las `body.token` und bekam `undefined` — die Adresse
   * hieß dann `/api/share/undefined/…` und der Server antwortete
   * ehrlicherweise „gibt es nicht". Sechs Tests rot, und die Ursache war ein
   * Feldname, den ich geraten statt nachgesehen habe. Zum dritten Mal in
   * diesem Projekt.
   */
  const body = (await res.json()) as { share: { token: string } };
  return { token: body.share.token, taskId: aufgabe.rows[0].id };
}

test('ein Lese-Link darf die Aufgabe ANSEHEN', async () => {
  /*
   * Die Reihenfolge, die die Sache selbst hat: lesen zuerst.
   *
   * Vorher stand die Schreibprüfung ganz oben in `/tasks/:id` und verweigerte
   * jeden Weg darunter — ein Lese-Link hätte eine Detailspalte gehabt, die 403
   * sagt. Gefunden beim Bauen, nicht durch einen Test: darum steht er jetzt da.
   */
  const { token, taskId } = await linkAuf('read');
  const res = await call(`/api/share/${token}/tasks/${taskId}`);
  const text = await res.text();
  assert.equal(res.status, 200, `Antwort: ${res.status} ${text}`);
  const body = JSON.parse(text) as { task: { title: string } };
  assert.equal(body.task.title, 'Dach dichten');
});

test('ein Lese-Link darf nichts daran ändern', async () => {
  const { token, taskId } = await linkAuf('read');
  for (const [weg, art, koerper] of [
    [`/tasks/${taskId}`, 'PATCH', { title: 'anders' }],
    [`/tasks/${taskId}/children`, 'POST', { title: 'Teil' }],
    [`/tasks/${taskId}/comments`, 'POST', { body: 'hallo' }],
  ] as const) {
    const res = await call(`/api/share/${token}${weg}`, {
      method: art,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });
    assert.equal(res.status, 403, `${art} ${weg}`);
  }
});

test('ein Gast kommentiert als „über einen Link"', async () => {
  /*
   * Ein CHECK in Migration 0001 (`comment_author_is_one_kind`) verlangt genau
   * eines von beiden: ein Konto ODER ein Name. Mit `author_id = NULL` allein
   * bricht der Einfügeversuch — die Sorte Regel, die man beim ersten
   * Gast-Kommentar findet, und besser dort als später in einer Zeile ohne
   * Urheber.
   */
  const { token, taskId } = await linkAuf('edit');
  const res = await call(`/api/share/${token}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Regen kommt' }),
  });
  assert.equal(res.status, 201);
  const frisch = (await res.json()) as { authorName: string | null; authorGuest: string | null };
  assert.equal(frisch.authorName, null, 'kein Konto');
  assert.match(frisch.authorGuest ?? '', /Link/, 'und ein ehrlicher Name');

  // Und beim Neuladen dasselbe: sonst zeigt die Oberfläche direkt nach dem
  // Schreiben einen Kommentar ohne Urheber und danach einen mit.
  const wieder = await call(`/api/share/${token}/tasks/${taskId}`);
  const gelesen = (await wieder.json()) as { comments: { authorGuest: string | null }[] };
  assert.match(gelesen.comments[0]?.authorGuest ?? '', /Link/);
});

test('ein Gast legt eine Teilaufgabe an, und sie zählt zur Aufgabe', async () => {
  const { token, taskId } = await linkAuf('edit');
  const res = await call(`/api/share/${token}/tasks/${taskId}/children`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Ziegel holen' }),
  });
  assert.equal(res.status, 201);
  const wieder = await call(`/api/share/${token}/tasks/${taskId}`);
  const gelesen = (await wieder.json()) as { children: { title: string }[] };
  assert.equal(gelesen.children.length, 1);
  assert.equal(gelesen.children[0]?.title, 'Ziegel holen');
});

test('eine fremde Aufgabe bleibt fremd, auch für die Detailspalte', async () => {
  // Die Prüfung sitzt VOR jeder Verzweigung: eine Id in der Adresse ist eine
  // Behauptung des Aufrufers, nicht eine Auskunft.
  const { token } = await linkAuf('edit');
  const fremd = await pool.query(
    `INSERT INTO tasks (workspace_id, title, sort_key) VALUES ($1,'Fremd','zz') RETURNING id`,
    [workspaceId],
  );
  const res = await call(`/api/share/${token}/tasks/${fremd.rows[0].id}`);
  assert.equal(res.status, 404);
});

test('ein Gast darf das Projekt einer Aufgabe nicht ändern', async () => {
  /*
   * Das wäre ein Weg aus der Freigabe hinaus. Als **Auswahlliste** geprüft und
   * nicht als Sperrliste: was nicht in der Liste steht, geht nicht — und ein
   * neues Feld an der Aufgabe wird damit nicht versehentlich zu einem Recht
   * des Gasts.
   */
  const { token, taskId } = await linkAuf('edit');
  const res = await call(`/api/share/${token}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: null }),
  });
  assert.equal(res.status, 400, 'nichts Erlaubtes dabei');
});

/* ── Profilbilder ──────────────────────────────────────────────────────────── */

/** Ein winziges gültiges PNG — 1×1 Pixel, damit der Inhalt echt ist. */
const EIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

test('ein Bild setzen, holen und wegnehmen', async () => {
  const setzen = await call('/api/me/picture', {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: EIN_PNG,
  });
  assert.equal(setzen.status, 200);

  const meineId = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE email = $1', [
    email,
  ]);
  const holen = await call(`/api/users/${meineId!.id}/picture`);
  assert.equal(holen.status, 200);
  assert.equal(holen.headers.get('content-type'), 'image/png');
  assert.ok((holen.headers.get('etag') ?? '').length > 2, 'ein ETag, sonst holt der Browser neu');

  // Und mit dem ETag: 304. Ohne das holt ein Browser das Bild bei jedem
  // Zeichnen neu — bei einer Liste mit zwanzig Leuten zwanzigmal.
  const nochmal = await call(`/api/users/${meineId!.id}/picture`, {
    headers: { 'if-none-match': holen.headers.get('etag') ?? '' },
  });
  assert.equal(nochmal.status, 304);

  const weg = await call('/api/me/picture', { method: 'DELETE' });
  assert.equal(weg.status, 200);
  const danach = await call(`/api/users/${meineId!.id}/picture`);
  assert.equal(danach.status, 404, 'wer keines hat, hat keines');
});

test('nur Bilder, die sich verkleinern lassen', async () => {
  for (const typ of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html']) {
    const res = await call('/api/me/picture', {
      method: 'PUT',
      headers: { 'content-type': typ },
      body: EIN_PNG,
    });
    // SVG besonders: es ist ein Dokument, das Skripte tragen kann, und ein
    // Profilbild ist der letzte Ort, an dem man das haben will.
    assert.equal(res.status, 415, typ);
  }
});

test('ein zu großes Bild wird abgewiesen, nicht angenommen', async () => {
  /*
   * Der Deckel steht an drei Stellen, und das ist Absicht: im Browser (die
   * Verkleinerung), hier in der Route, und als CHECK in Migration 0021. Die
   * Verkleinerung im Browser ist eine **Zusage des Aufrufers** — und eine
   * Zusage prüft man.
   */
  const zuGroß = Buffer.alloc(300_000, 7);
  const res = await call('/api/me/picture', {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: zuGroß,
  });
  assert.equal(res.status, 413);
});

test('ein Bild ohne Inhalt ist keines', async () => {
  const res = await call('/api/me/picture', {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: Buffer.alloc(0),
  });
  assert.equal(res.status, 400);
});

test('ein Kalenderabonnement ist über HTTP erreichbar — nicht nur als Funktion', async () => {
  /*
   * Audit 12.09.2026, F07: der Weg `/kalender/:token.ics` stand HINTER dem
   * Zweig, der alles außerhalb `/api/` als Datei der Oberfläche behandelt.
   * Jedes Kalenderprogramm bekam 404, bevor eine Datenbankabfrage lief.
   * `calendar.db.test.ts` rief `icsByToken` direkt und konnte das nicht
   * sehen — ein Test, der die Kette selbst schließt, prüft eine Kette, die
   * es nicht gibt. Dieser hier geht den Weg, den Apple Kalender geht.
   */
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 3).toString('hex');
  const angelegt = await call('/api/calendar', { method: 'POST' });
  assert.equal(angelegt.status, 201);
  const feed = (await angelegt.json()) as { token: string };

  // Ohne Sitzung, wie ein Kalenderprogramm.
  const res = await fetch(`${base}/kalender/${feed.token}.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/calendar/);
  assert.match(await res.text(), /BEGIN:VCALENDAR/);

  const kopf = await fetch(`${base}/kalender/${feed.token}.ics`, { method: 'HEAD' });
  assert.equal(kopf.status, 200);

  const fremd = await fetch(`${base}/kalender/${'x'.repeat(43)}.ics`);
  assert.equal(fremd.status, 404);
  const grund = (await fremd.json()) as { error: { code: string } };
  assert.equal(grund.error.code, 'no_calendar', 'die Route antwortet — nicht der Dateiausgeber');

  const schreiben = await fetch(`${base}/kalender/${feed.token}.ics`, { method: 'POST' });
  assert.equal(schreiben.status, 405);
});

/* ── Die Listenstufe an den Routen (Audit 12.09.2026, F01) ────────────────── */

/**
 * Ein zweites Konto in DIESEM Arbeitsbereich, mit einer Rolle der genannten
 * Stufe — und sein Keks. `null` ist der Gast mit Konto.
 */
async function mitgliedMit(level: 'viewer' | 'editor' | null): Promise<{ cookie: string; userId: string }> {
  const adresse = `stufe-${level ?? 'gast'}-${process.pid}-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const u = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [adresse, level ?? 'Gast'],
  );
  await setPassword(pool, u!.id, 'ein gutes Kennwort');
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,$2,$3) RETURNING id`,
    [workspaceId, `Rolle ${adresse}`, level],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner) VALUES ($1,$2,$3,false)`,
    [workspaceId, u!.id, r!.id],
  );
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adresse, password: 'ein gutes Kennwort' }),
  });
  assert.equal(res.status, 200);
  return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]!, userId: u!.id };
}

const als = (cookie: string, path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
  });

async function eineAufgabe(): Promise<string> {
  const res = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: `Stufenprobe ${Math.random().toString(36).slice(2, 8)} +haus` }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { task: { id: string } };
  return body.task.id;
}

test('ein viewer liest — und jede schreibende Route sagt 403, ohne etwas zu ändern', async () => {
  /*
   * Vor dem Fix: HTTP 200 auf jedem dieser Wege. `list_level` wurde nur beim
   * Anlegen einer Freigabe gelesen; die Rolle „nur lesend" im Einstellungs-
   * bereich bewachte nichts (ADR-0087: der Schalter, der nichts bewacht).
   */
  const { cookie } = await mitgliedMit('viewer');
  const taskId = await eineAufgabe();

  for (const weg of ['/api/today', '/api/tasks?view=today', `/api/tasks/${taskId}`, '/api/projects', '/api/labels', '/api/shares', '/api/counts']) {
    const res = await als(cookie, weg);
    assert.equal(res.status, 200, `GET ${weg}`);
  }

  const schreibend: [string, string, unknown][] = [
    ['PATCH', `/api/tasks/${taskId}`, { title: 'umbenannt' }],
    ['POST', '/api/tasks', { line: 'neu' }],
    ['POST', `/api/tasks/${taskId}/complete`, {}],
    ['POST', `/api/tasks/${taskId}/comments`, { body: 'hallo' }],
    ['POST', `/api/tasks/${taskId}/children`, { line: 'kind' }],
    ['POST', `/api/tasks/${taskId}/move`, { projectId: null }],
    ['POST', `/api/tasks/${taskId}/trash`, {}],
    ['POST', '/api/projects', { name: 'Neu' }],
    ['POST', '/api/shares', { projectId: '00000000-0000-0000-0000-000000000000', right: 'edit' }],
    ['POST', '/api/board', { name: 'Spalte' }],
  ];
  for (const [method, weg, body] of schreibend) {
    const res = await als(cookie, weg, { method, body: JSON.stringify(body) });
    assert.equal(res.status, 403, `${method} ${weg}`);
    const grund = (await res.json()) as { error: { code: string } };
    assert.equal(grund.error.code, 'read_only', `${method} ${weg}`);
  }
  const noch = await queryOne<{ title: string; completed_at: Date | null; trashed_at: Date | null }>(
    pool,
    'SELECT title, completed_at, trashed_at FROM tasks WHERE id = $1',
    [taskId],
  );
  assert.match(noch!.title, /^Stufenprobe/);
  assert.equal(noch!.completed_at, null);
  assert.equal(noch!.trashed_at, null);

  // Persönliches an einer Aufgabe darf er: eine Erinnerung ist seine, nicht die der Aufgabe.
  const erinnerung = await als(cookie, `/api/tasks/${taskId}/reminders`, {
    method: 'POST',
    body: JSON.stringify({ minutes: 10 }),
  });
  assert.equal(erinnerung.status, 200);

  // Und /api/me sagt es ihm, damit die Oberfläche keine Knöpfe zeigt, die 403 antworten.
  const me = (await (await als(cookie, '/api/me')).json()) as { workspaces: { id: string; listLevel: string | null }[] };
  assert.equal(me.workspaces.find((w) => w.id === workspaceId)?.listLevel, 'viewer');
});

test('ein Gast mit Konto sieht keine Listen — Mitgliedschaft ersetzt keine Stufe', async () => {
  const { cookie } = await mitgliedMit(null);
  const taskId = await eineAufgabe();

  for (const weg of ['/api/today', `/api/tasks/${taskId}`, '/api/projects', '/api/labels', '/api/shares', '/api/search?q=Stufe', '/api/counts']) {
    const res = await als(cookie, weg);
    assert.equal(res.status, 403, `GET ${weg}`);
    const grund = (await res.json()) as { error: { code: string } };
    assert.equal(grund.error.code, 'no_list_level', `GET ${weg}`);
  }
  const patch = await als(cookie, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'vom Gast' }),
  });
  assert.equal(patch.status, 403);
  const erinnerung = await als(cookie, `/api/tasks/${taskId}/reminders`, {
    method: 'POST',
    body: JSON.stringify({ minutes: 10 }),
  });
  assert.equal(erinnerung.status, 403, 'auch nichts Persönliches an eine Aufgabe, die er nicht sieht');

  // Was ihm bleibt: sein Konto. Glocke, Kanäle, die eigene Antwort.
  for (const weg of ['/api/me', '/api/notifications', '/api/notification-channels', '/api/settings']) {
    const res = await als(cookie, weg);
    assert.equal(res.status, 200, `GET ${weg}`);
  }
  const me = (await (await als(cookie, '/api/me')).json()) as { workspaces: { id: string; listLevel: string | null }[] };
  assert.equal(me.workspaces.find((w) => w.id === workspaceId)?.listLevel, null);
});

test('eine Gruppe hebt hinauf: der Gast in einer Editor-Gruppe schreibt', async () => {
  // Das MAXIMUM über Rolle und Gruppen (ADR-0026) — eine Gruppe gibt dazu und nimmt nie.
  const { cookie, userId: gast } = await mitgliedMit(null);
  const editor = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,$2,'editor') RETURNING id`,
    [workspaceId, `Redaktion ${gast}`],
  );
  const gruppe = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO groups (workspace_id, name, role_id) VALUES ($1,'Redaktion',$2) RETURNING id`,
    [workspaceId, editor!.id],
  );
  await pool.query('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)', [gruppe!.id, gast]);

  const taskId = await eineAufgabe();
  const patch = await als(cookie, `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'aus der Gruppe' }),
  });
  assert.equal(patch.status, 200);
});

test('ein viewer sieht die Freigaben, aber keinen Token — der Token ist das Recht', async () => {
  // Audit 12.09.2026, F02: `GET /api/shares` gab jedem Mitglied die
  // entsiegelten Tokens. Ein viewer las einen Bearbeitungslink ab und
  // schrieb damit anonym. Die Zeile bleibt, der Token geht.
  await linkAuf('edit');
  const { cookie } = await mitgliedMit('viewer');
  const res = await als(cookie, '/api/shares');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { mayManage: boolean; shares: { token: string | null }[] };
  assert.equal(body.mayManage, false);
  assert.ok(body.shares.length > 0, 'die Freigaben sind zu sehen');
  assert.ok(body.shares.every((s) => s.token === null), 'kein Token für einen viewer');

  // Der Eigentümer sieht sie weiterhin.
  const chef = (await (await call('/api/shares')).json()) as { mayManage: boolean; shares: { token: string | null }[] };
  assert.equal(chef.mayManage, true);
  assert.ok(chef.shares.some((s) => s.token !== null));
});

test('ein Gast sieht nur die Schlagwörter seines Projekts, nicht die des Arbeitsbereichs', async () => {
  // Audit 12.09.2026, F03: `known` in der Gast-Detailansicht kam aus
  // `labels WHERE workspace_id` — jedes Schlagwort jedes Projekts.
  const { token, taskId } = await linkAuf('read');
  const geheim = `vertraulich-${Math.random().toString(36).slice(2, 8)}`;
  // Ein Schlagwort, das nur an einer Aufgabe AUSSERHALB des freigegebenen Projekts hängt.
  const fremd = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: `Interne Sache #${geheim} +haus` }),
  });
  assert.equal(fremd.status, 201);
  const res = await call(`/api/share/${token}/tasks/${taskId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { known: string[] };
  assert.ok(!body.known.includes(geheim), `„${geheim}" darf hier nicht vorkommen`);
  // Und der Eigentümer hat es in seinem Vorrat.
  const mitglied = (await (await call(`/api/tasks/${taskId}`)).json()) as { known: string[] };
  assert.ok(mitglied.known.includes(geheim));
});

/* ── Die Gastpfade (Audit 12.09.2026, F05, F17, F04) ─────────────────────── */

test('ein Gast ändert einen Termin allein — und er wird gespeichert', async () => {
  // F05: `planned`/`due` gingen roh an `patch()`, das `plannedAt`/`dueAt`
  // kennt. Ein Termin allein hiess „nichts zu ändern"; mit Titel ging die
  // Anfrage durch und der Termin blieb.
  const { token, taskId } = await linkAuf('edit');
  const res = await call(`/api/share/${token}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ planned: '2026-09-20T09:00:00.000Z' }),
  });
  assert.equal(res.status, 200);
  let row = await queryOne<{ planned_at: Date | null; due_at: Date | null }>(
    pool,
    'SELECT planned_at, due_at FROM tasks WHERE id = $1',
    [taskId],
  );
  assert.equal(row!.planned_at?.toISOString(), '2026-09-20T09:00:00.000Z');

  const mit = await call(`/api/share/${token}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Dach dichten, dringend', due: '2026-09-21T12:00:00.000Z' }),
  });
  assert.equal(mit.status, 200);
  row = await queryOne(pool, 'SELECT planned_at, due_at FROM tasks WHERE id = $1', [taskId]);
  assert.equal(row!.due_at?.toISOString(), '2026-09-21T12:00:00.000Z');

  const weg = await call(`/api/share/${token}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ due: null }),
  });
  assert.equal(weg.status, 200);
  row = await queryOne(pool, 'SELECT planned_at, due_at FROM tasks WHERE id = $1', [taskId]);
  assert.equal(row!.due_at, null, 'ein Datum lässt sich als Gast auch löschen');
});

test('die Gast-Schnellerfassung weist niemanden zu, bleibt im Projekt und rechnet in der Zone des Browsers', async () => {
  // F17: `@name` wurde für Gäste aufgelöst, eingetragen und gemeldet — die
  // direkte Bearbeitung verbot genau das. `#projekt` wurde erst nach dem
  // Anlegen zurückgesetzt. Und die Zone fehlte: „morgen 9 Uhr" war 9 Uhr UTC.
  const { token } = await linkAuf('edit');
  const res = await fetch(`${base}/api/share/${token}/tasks?tz=Europe%2FBerlin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ line: 'Fenster putzen @Markus +haus morgen 9 Uhr' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: string; unknownAssignees: string[] };
  assert.deepEqual(body.unknownAssignees, ['Markus'], 'der Name wird gemeldet, nicht zugewiesen');

  const zust = await queryRows(pool, 'SELECT 1 FROM task_assignees WHERE task_id = $1', [body.id]);
  assert.equal(zust.length, 0, 'keine Zuweisung durch einen Gast');
  const meldungen = await queryRows(pool, 'SELECT 1 FROM notifications WHERE task_id = $1', [body.id]);
  assert.equal(meldungen.length, 0, 'und darum auch keine Meldung');

  const row = await queryOne<{ project_id: string; planned_at: Date }>(
    pool,
    'SELECT project_id, planned_at FROM tasks WHERE id = $1',
    [body.id],
  );
  assert.equal(row!.project_id, gastProjekt, '+haus zieht nicht aus der Freigabe hinaus');
  // NOW ist der 7.9.2026 10:00Z; morgen 9 Uhr in Berlin (CEST) ist 07:00Z.
  assert.equal(row!.planned_at.toISOString(), '2026-09-08T07:00:00.000Z');
});

test('die kleine Fassung eines Gast-Anhangs hat eine Grenze', async () => {
  // F04: der Zweig sammelte den ganzen Körper, bevor er irgendetwas prüfte.
  const { token, taskId } = await linkAuf('edit');
  const vorher = { max: process.env['SOTE_FILE_MAX_MB'], dir: process.env['SOTE_FILES_DIR'] };
  process.env['SOTE_FILE_MAX_MB'] = '1';
  process.env['SOTE_FILES_DIR'] ??= '/tmp/sote-files-grenze';
  try {
    const res = await fetch(
      `${base}/api/share/${token}/tasks/${taskId}/files/00000000-0000-0000-0000-000000000000/web`,
      { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(1_100_000, 1) },
    );
    assert.equal(res.status, 413);
  } finally {
    if (vorher.max === undefined) delete process.env['SOTE_FILE_MAX_MB'];
    else process.env['SOTE_FILE_MAX_MB'] = vorher.max;
    if (vorher.dir === undefined) delete process.env['SOTE_FILES_DIR'];
    else process.env['SOTE_FILES_DIR'] = vorher.dir;
  }
});

test('Kennwortraten wird gedrosselt — vor scrypt, mit Retry-After', async () => {
  // Audit 12.09.2026, F12. Zehn Fehlversuche je Konto, dann 429.
  const konto = `raten-${process.pid}-${Math.random().toString(36).slice(2, 8)}@example.org`;
  for (let i = 0; i < 10; i += 1) {
    const res = await call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: konto, password: `falsch-${i}` }),
    });
    assert.equal(res.status, 401, `Versuch ${i + 1}`);
  }
  const zuViel = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email: konto, password: 'falsch-11' }),
  });
  assert.equal(zuViel.status, 429);
  assert.ok(Number(zuViel.headers.get('retry-after')) > 0);
  const grund = (await zuViel.json()) as { error: { code: string } };
  assert.equal(grund.error.code, 'too_many_attempts');

  // Ein anderes Konto ist davon nicht betroffen — die Sperre hängt am Konto.
  const andere = await call('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'ein gutes Kennwort' }),
  });
  assert.equal(andere.status, 200);
});

test('der Kalender holt alle Aufgaben mit Zeitpunkt in einem Fenster — Plan vor Frist', async () => {
  const a = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Im Fenster 15.9.2026 9 Uhr +haus' }),
  });
  assert.equal(a.status, 201);
  const b = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Ausserhalb 30.9.2026 +haus' }),
  });
  assert.equal(b.status, 201);
  const ohne = await call('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ line: 'Ohne Zeitpunkt +haus' }),
  });
  assert.equal(ohne.status, 201);

  const res = await call('/api/span?from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tasks: { title: string }[] };
  const titel = body.tasks.map((t) => t.title);
  assert.ok(titel.includes('Im Fenster'), 'drin');
  assert.ok(!titel.includes('Ausserhalb'), 'nicht drin');
  assert.ok(!titel.includes('Ohne Zeitpunkt'), 'ohne Tag steht in keinem Kalender');

  const kaputt = await call('/api/span?from=heute&to=morgen');
  assert.equal(kaputt.status, 400);
  const zuLang = await call('/api/span?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z');
  assert.equal(zuLang.status, 400);
});

test('der Kalender zeigt nur Bereiche, in denen man eine Listenstufe hat', async () => {
  // Vor der Schranke, also mit eigener Prüfung: Mitgliedschaft allein ersetzt
  // keine Stufe (F01) — auch nicht über alle Bereiche hinweg.
  const { cookie } = await mitgliedMit(null);
  const alle = await als(cookie, '/api/span?from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z');
  assert.equal(alle.status, 200);
  const body = (await alle.json()) as { tasks: unknown[]; workspaces: { id: string }[] };
  assert.equal(body.tasks.length, 0, 'ein Gast sieht keine Aufgabe');
  assert.ok(!body.workspaces.some((w) => w.id === workspaceId), 'und der Bereich steht nicht in der Karte');
  const einer = await als(cookie, `/api/span?from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z&workspace=${workspaceId}`);
  assert.equal(einer.status, 403);
});
