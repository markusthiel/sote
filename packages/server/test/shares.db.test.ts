/**
 * SOTE — Freigaben.
 *
 * Eine Rechtefläche, also prüft dieser Lauf vor allem, was **nicht** geht.
 * Konzept 10e.
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import type { Pool } from 'pg';

import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import {
  accessByToken,
  createShare,
  listShares,
  NoShareKey,
  revokeShare,
  shareKeyPresent,
} from '../src/shares.js';
import { NotFound, OutOfOrder } from '../src/tasks.js';
import { makeFolder, makeList } from './support/tree.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let userId: string;

before(async () => {
  // Der Schlüssel für diesen Lauf. In der Umgebung und nicht in der Datenbank:
  // läge er dort, wäre die Verschlüsselung Theater — wer die Tabelle liest,
  // liest den Schlüssel daneben.
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 7).toString('hex');
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,'Freigabe')
     ON CONFLICT (email) DO UPDATE SET display_name = 'Freigabe'
     RETURNING id`,
    [`shares-${process.pid}@example.org`],
  );
  userId = u!.id;
});

after(async () => {
  await pool.end();
});

async function scratch(name: string): Promise<{ workspaceId: string; projectId: string }> {
  const w = await queryOne<{ id: string }>(
    pool,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const r = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO roles (workspace_id, name, list_level) VALUES ($1,'member','editor')
     RETURNING id`,
    [w!.id],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [w!.id, userId, r!.id],
  );
  const projectId = await makeList(pool, w!.id, 'Haus');
  return { workspaceId: w!.id, projectId };
}

/* ── Anlegen und nachschlagen ────────────────────────────────────────────── */

test('ein Link führt auf sein Projekt, mit seinem Recht', async () => {
  const { workspaceId, projectId } = await scratch('s-basic');
  const { token } = await createShare(pool, {
    workspaceId, projectId, right: 'read', userId,
  });
  const a = await accessByToken(pool, token);
  assert.equal(a?.projectId, projectId);
  assert.equal(a?.right, 'read');
});

test('zwei Links sind zwei verschiedene Tokens', async () => {
  // Ein Token, das aus einer Projekt-Id abgeleitet wäre, wäre ein Token, das
  // man errät, sobald man eine Id kennt.
  const { workspaceId, projectId } = await scratch('s-two');
  const a = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  const b = await createShare(pool, { workspaceId, projectId, right: 'edit', userId });
  assert.notEqual(a.token, b.token);
  assert.equal((await accessByToken(pool, a.token))?.right, 'read');
  assert.equal((await accessByToken(pool, b.token))?.right, 'edit');
});

test('der Link lässt sich wieder anzeigen', async () => {
  // SONEs ADR-0113. Ein Link, den man nur einmal sieht, führt dazu, dass jemand
  // einen zweiten anlegt und den ersten zu widerrufen vergisst — und die
  // vergessene Freigabe ist der eigentliche Schaden.
  const { workspaceId, projectId } = await scratch('s-show');
  const { token } = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  const list = await listShares(pool, workspaceId);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.token, token);
  assert.equal(list[0]!.projectName, 'Haus');
});

/* ── Was nicht geht ──────────────────────────────────────────────────────── */

test('ein Ordner wird nicht freigegeben', async () => {
  // Ein Ordner ist kein Ort, an dem Aufgaben stehen. Gehalten von einem
  // Trigger und nicht nur vom Anwendungscode: eine Regel, die nur im Code
  // steht, kennt der nächste Schreibweg nicht.
  const { workspaceId } = await scratch('s-folder');
  const folder = await makeFolder(pool, workspaceId, 'Nur Ordner', 'a9');
  await assert.rejects(
    () => createShare(pool, { workspaceId, projectId: folder, right: 'read', userId }),
    OutOfOrder,
  );
});

test('ein widerrufener Link führt nirgendwohin', async () => {
  const { workspaceId, projectId } = await scratch('s-revoke');
  const { share, token } = await createShare(pool, {
    workspaceId, projectId, right: 'edit', userId,
  });
  await revokeShare(pool, share.id, workspaceId);
  assert.equal(await accessByToken(pool, token), null);
  // Und er steht nicht mehr in der Liste: „widerrufen, aber sichtbar" wäre ein
  // Eintrag, den man noch einmal widerrufen möchte.
  assert.equal((await listShares(pool, workspaceId)).length, 0);
});

test('zweimal widerrufen ist ein Fehler, nicht ein Nichts', async () => {
  // Anders als beim Zurücknehmen eines Hakens: dort hat jemand zweimal
  // dasselbe gemeint. Hier heißt der zweite Aufruf, dass jemand eine Freigabe
  // widerruft, die er in einer Liste gesehen hat — und die stand dort nicht.
  const { workspaceId, projectId } = await scratch('s-revoke2');
  const { share } = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  await revokeShare(pool, share.id, workspaceId);
  await assert.rejects(() => revokeShare(pool, share.id, workspaceId), NotFound);
});

test('ein abgelaufener Link führt nirgendwohin', async () => {
  const { workspaceId, projectId } = await scratch('s-expired');
  const { token } = await createShare(pool, {
    workspaceId, projectId, right: 'read', userId,
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal(await accessByToken(pool, token), null);
});

test('ein fremder Arbeitsbereich widerruft nicht', async () => {
  const a = await scratch('s-cross-a');
  const b = await scratch('s-cross-b');
  const { share, token } = await createShare(pool, {
    workspaceId: a.workspaceId, projectId: a.projectId, right: 'read', userId,
  });
  await assert.rejects(() => revokeShare(pool, share.id, b.workspaceId), NotFound);
  // Und er gilt weiter — ein fehlgeschlagener Widerruf darf nicht wirken.
  assert.notEqual(await accessByToken(pool, token), null);
});

test('liegt der Ordner über dem Projekt im Papierkorb, führt der Link nirgendwohin', async () => {
  /*
   * Für Mitglieder ist das Projekt dann nicht zu sehen (Konzept 10d), und für
   * einen Link erst recht nicht. Geprüft, weil genau hier eine zweite
   * Bedingung entstehen würde, wenn man es vergisst: eine Sichtbarkeit für
   * Konten und eine andere für Links.
   */
  const { workspaceId, projectId } = await scratch('s-trash');
  const { token } = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  const parent = await queryOne<{ parent_id: string }>(
    pool,
    'SELECT parent_id FROM projects WHERE id = $1',
    [projectId],
  );
  await pool.query('UPDATE projects SET trashed_at = now() WHERE id = $1', [parent!.parent_id]);
  assert.equal(await accessByToken(pool, token), null);
});

test('Unsinn als Token führt nirgendwohin und wirft nicht', async () => {
  const { workspaceId } = await scratch('s-junk');
  for (const junk of ['', 'x', 'a'.repeat(500), '../../etc/passwd', "' OR 1=1 --"]) {
    assert.equal(await accessByToken(pool, junk), null, junk.slice(0, 12));
  }
  assert.equal((await listShares(pool, workspaceId)).length, 0);
});

/* ── Der Schlüssel ──────────────────────────────────────────────────────── */

test('ohne Schlüssel gibt es keine Freigaben, und das wird gesagt', async () => {
  /*
   * Nicht „still keine": eine Sache, die nicht wirkt und nicht sagt warum, ist
   * der Fehler, den SONE vierzehn Mal hatte (ADR-0112). Die Meldung nennt die
   * Variable, die fehlt.
   */
  const { workspaceId, projectId } = await scratch('s-nokey');
  const keep = process.env['SOTE_SHARE_KEY'];
  delete process.env['SOTE_SHARE_KEY'];
  try {
    assert.equal(shareKeyPresent(), false);
    await assert.rejects(
      () => createShare(pool, { workspaceId, projectId, right: 'read', userId }),
      (e: unknown) => e instanceof NoShareKey && /SOTE_SHARE_KEY/.test((e as Error).message),
    );
  } finally {
    process.env['SOTE_SHARE_KEY'] = keep;
  }
  assert.equal(shareKeyPresent(), true);
});

test('mit dem falschen Schlüssel lässt sich der Link nicht anzeigen — die Freigabe gilt trotzdem', async () => {
  /*
   * Der Fall, den ein Betreiber wirklich erlebt: Schlüssel verloren oder
   * getauscht. Dann ist der Klartext weg, und das darf nicht heißen, dass die
   * Freigabe unsichtbar wird — sonst kann man sie auch nicht widerrufen, und
   * das ist die Funktion, auf die es ankommt.
   */
  const { workspaceId, projectId } = await scratch('s-wrongkey');
  const { token } = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  const keep = process.env['SOTE_SHARE_KEY'];
  process.env['SOTE_SHARE_KEY'] = Buffer.alloc(32, 9).toString('hex');
  try {
    const list = await listShares(pool, workspaceId);
    assert.equal(list.length, 1, 'die Freigabe steht weiter da');
    assert.equal(list[0]!.token, null, 'nur der Klartext fehlt');
    // Und der Link selbst geht weiter: das Nachschlagen läuft über den Hash.
    assert.notEqual(await accessByToken(pool, token), null);
    await revokeShare(pool, list[0]!.id, workspaceId);
  } finally {
    process.env['SOTE_SHARE_KEY'] = keep;
  }
});

test('„zuletzt benutzt" wird beim Nachschlagen gesetzt, auch beim Lesen', async () => {
  // Die Spalte, die eine vergessene Freigabe sichtbar macht. Eine Freigabe,
  // die jemand nur liest, ist benutzt.
  const { workspaceId, projectId } = await scratch('s-used');
  const { token } = await createShare(pool, { workspaceId, projectId, right: 'read', userId });
  assert.equal((await listShares(pool, workspaceId))[0]!.last_used_at, null);
  await accessByToken(pool, token);
  assert.notEqual((await listShares(pool, workspaceId))[0]!.last_used_at, null);
});
