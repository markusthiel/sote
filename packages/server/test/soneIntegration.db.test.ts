import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { makeServer } from '../src/routes.js';
import { openSession } from '../src/auth.js';
import { makeList } from './support/tree.js';
import { patch, createFromLine } from '../src/tasks.js';
test('SONE: persönliche Freigabe, PKCE, atomare Aufgaben und Entzug über HTTP', async (t) => {
    const databaseUrl = process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';
    const pool = makePool(databaseUrl);
    t.after(() => pool.end());
    await migrate(pool);
    const server = makeServer({ pool, config: { databaseUrl, port: 0, sessionDays: 30 }, now: () => new Date() });
    t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrations/sone`;
    const user = (await queryOne<{
        id: string;
    }>(pool, "INSERT INTO users(email,display_name,is_admin) VALUES($1,'Integration',true) RETURNING id", [randomUUID() + '@example.org']))!.id;
    const workspace = (await queryOne<{
        id: string;
    }>(pool, "INSERT INTO workspaces(name) VALUES('Integration') RETURNING id"))!.id;
    const role = (await queryOne<{
        id: string;
    }>(pool, "INSERT INTO roles(workspace_id,name,list_level) VALUES($1,'Editor','editor') RETURNING id", [workspace]))!.id;
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role_id,is_owner) VALUES($1,$2,$3,true)', [workspace, user, role]);
    const project = await makeList(pool, workspace, 'Projekt'), other = await makeList(pool, workspace, 'Anderes', 'a1');
    const session = await openSession(pool, user, new Date(), 30);
    const cookie = { 'content-type': 'application/json', cookie: 'sote_session=' + session.token };
    async function request(path: string, method = 'GET', body: unknown = undefined, token?: string, expected = 200) {
        const res = await fetch(base + path, { method, headers: token ? { 'content-type': 'application/json', authorization: 'Bearer ' + token } : cookie, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const text = await res.text();
        assert.equal(res.status, expected, text);
        return JSON.parse(text);
    }
    const client = await request('/clients', 'POST', { baseUrl: 'https://sone-' + randomUUID() + '.example.org', name: 'SONE' }, undefined, 201);
    const clientRow = await queryOne<{
        base_url: string;
        secret_hash: string;
    }>(pool, 'SELECT * FROM integration_clients WHERE id=$1', [client.id]);
    assert.notEqual(clientRow!.secret_hash, client.secret);
    const verifier = randomBytes(48).toString('base64url');
    const consent = { client_id: client.id, redirect_uri: clientRow!.base_url + '/api/integrations/sote/callback', state: randomBytes(32).toString('base64url'), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), projects: [project], writable: true };
    await request('/consent', 'POST', { ...consent, redirect_uri: 'https://attacker.example/callback' }, undefined, 400);
    const approved = await request('/consent', 'POST', consent);
    const tokenBody = { client_id: client.id, client_secret: client.secret, grant_type: 'authorization_code', redirect_uri: consent.redirect_uri, code: new URL(approved.url).searchParams.get('code'), code_verifier: verifier };
    await request('/token', 'POST', { ...tokenBody, code_verifier: 'x'.repeat(64) }, undefined, 400);
    const token = (await request('/token', 'POST', tokenBody)).access_token;
    await request('/token', 'POST', tokenBody, undefined, 400);
    await request('/v1/projects', 'GET', undefined, undefined, 401); // Cookies cannot stand in for a grant.
    assert.deepEqual((await request('/v1/projects', 'GET', undefined, token)).projects.map((p: {
        id: string;
    }) => p.id), [project]);
    await request('/v1/tasks?projectId=' + other, 'GET', undefined, token, 404);
    const input = { projectId: project, operationId: randomUUID(), pageId: randomUUID(), blockId: randomUUID(), fields: { title: 'Morgen +Projekt !! bleibt wörtlich', planned: '2026-09-15T09:30:00Z', plannedAllDay: false, duration: 30, note: 'Details' } };
    const [first, retry] = await Promise.all([request('/v1/tasks', 'POST', input, token), request('/v1/tasks', 'POST', input, token)]);
    assert.equal(first.task.id, retry.task.id);
    assert.equal(first.task.title, input.fields.title);
    assert.equal(first.task.priority, 4);
    assert.equal(first.task.duration, 30);
    assert.equal(first.task.planned, input.fields.planned.replace('Z', '.000Z'));
    assert.equal((await request('/v1/operations/' + input.operationId, 'GET', undefined, token)).task.id, first.task.id);
    assert.equal((await request('/v1/operations/' + randomUUID(), 'GET', undefined, token)).task, null);
    assert.equal((await queryOne<{
        n: string;
    }>(pool, 'SELECT count(*) AS n FROM tasks WHERE project_id=$1', [project]))!.n, '1');
    assert.equal((await queryOne<{
        url: string;
    }>(pool, 'SELECT url FROM task_origins WHERE task_id=$1', [first.task.id]))!.url, clientRow!.base_url + `/p/${input.pageId}#b-${input.blockId}`);
    await request('/v1/tasks', 'POST', { ...input, fields: { title: 'Geändert' } }, token, 409);
    // Failed validation after task creation must roll the entire operation back.
    await request('/v1/tasks', 'POST', { ...input, operationId: randomUUID(), blockId: 'invalid' }, token, 400);
    assert.equal((await queryOne<{
        n: string;
    }>(pool, 'SELECT count(*) AS n FROM tasks WHERE project_id=$1', [project]))!.n, '1');
    await patch(pool, first.task.id, workspace, { title: 'In SOTE geändert' }, user);
    await request('/v1/tasks/' + first.task.id, 'PATCH', { projectId: project, revision: first.task.revision, fields: { title: 'Veralteter Entwurf' } }, token, 409);
    const fresh = (await request('/v1/tasks/' + first.task.id, 'GET', undefined, token)).task;
    await request('/v1/tasks/' + first.task.id, 'PATCH', { projectId: other, revision: fresh.revision, fields: { title: 'Falscher Block' } }, token, 404);
    const done = (await request('/v1/tasks/' + first.task.id, 'PATCH', { projectId: project, revision: fresh.revision, fields: { completed: true } }, token)).task;
    assert.ok(done.completed);
    const reopened = (await request('/v1/tasks/' + first.task.id, 'PATCH', { projectId: project, revision: done.revision, fields: { completed: false } }, token)).task;
    assert.equal(reopened.completed, null);
    // New operations may race for the last sort key; savepoints retain a usable transaction.
    const simultaneous = await Promise.all(Array.from({ length: 4 }, () => request('/v1/tasks', 'POST', { ...input, operationId: randomUUID() }, token)));
    assert.equal(new Set(simultaneous.map(x => x.task.id)).size, 4);
    const repeating = await createFromLine(pool, { workspaceId: workspace, projectId: project, userId: user, line: 'Prüfen 3 Monate nach dem Abhaken', now: new Date(), may: { pinProject: true } });
    const recurring = (await request('/v1/tasks/' + repeating.task.id, 'GET', undefined, token)).task;
    const before = (await queryOne<{
        n: string;
    }>(pool, 'SELECT count(*) AS n FROM tasks WHERE project_id=$1', [project]))!.n;
    await request('/v1/tasks/' + recurring.id, 'PATCH', { projectId: project, revision: recurring.revision, fields: { completed: true } }, token);
    await request('/v1/tasks/' + recurring.id, 'PATCH', { projectId: project, revision: recurring.revision, fields: { completed: true } }, token, 409);
    assert.equal(Number((await queryOne<{
        n: string;
    }>(pool, 'SELECT count(*) AS n FROM tasks WHERE project_id=$1', [project]))!.n), Number(before) + 1);
    await pool.query('DELETE FROM tasks WHERE id=$1', [first.task.id]);
    await request('/v1/tasks', 'POST', input, token, 410);
    // A read grant never inherits the user's editor role.
    const readApproval = await request('/consent', 'POST', { ...consent, writable: false });
    const readToken = (await request('/token', 'POST', { ...tokenBody, code: new URL(readApproval.url).searchParams.get('code') })).access_token;
    await request('/v1/tasks', 'POST', { ...input, operationId: randomUUID() }, readToken, 403);
    await pool.query('DELETE FROM workspace_members WHERE user_id=$1 AND workspace_id=$2', [user, workspace]);
    // Instance admins still have workspace rights in SOTE, so remove that too.
    await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [user]);
    await request('/v1/tasks?projectId=' + project, 'GET', undefined, token, 404);
    await pool.query('UPDATE integration_clients SET revoked_at=now() WHERE id=$1', [client.id]);
    await request('/v1/projects', 'GET', undefined, token, 401);
    await request('/token', 'POST', null, undefined, 400);
});
