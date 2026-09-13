/** Persönliche, widerrufbare Projektfreigaben. Niemals eine fremde Sitzung übernehmen. */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { atomic, queryOne, queryRows } from './db.js';
import { effectiveListLevel, isAdmin, levelWrites, mayDo } from './settings.js';
import { complete, createFromLine, patch, reopen, OutOfOrder, type TaskRow } from './tasks.js';
import { readPatch, taskView } from './routes.js';
import { fail, json, readJson } from './http/respond.js';
const ROOT = '/api/integrations/sone';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
class Problem extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const demand = (yes: unknown, message = 'Keine Berechtigung.', status = 403) => { if (!yes)
    throw new Problem(status, message); };
export function integrationBase(raw: unknown): string {
    let u: URL;
    try {
        u = new URL(String(raw));
    }
    catch {
        throw new Problem(400, 'Ungültige Basisadresse.');
    }
    demand((u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/', 'Bitte eine HTTPS-Basisadresse ohne Pfad eingeben.', 400);
    return u.origin;
}
export const callbackOf = (base: string) => base + '/api/integrations/sote/callback';
type Client = {
    id: string;
    name: string;
    base_url: string;
    secret_hash: string;
};
type Grant = {
    id: string;
    client_id: string;
    user_id: string;
    projects: string[];
    writable: boolean;
    base_url: string;
};
async function clientOf(pool: Pool, id: unknown) {
    demand(uuid(id), 'Unbekannte Verbindung.', 400);
    const c = await queryOne<Client>(pool, 'SELECT * FROM integration_clients WHERE id=$1 AND revoked_at IS NULL', [id]);
    demand(c, 'Diese Verbindung ist nicht verfügbar.', 400);
    return c!;
}
export async function integrationProjects(pool: Pool, user: string, allowed?: string[]) {
    const rows = await queryRows<{
        id: string;
        name: string;
        workspaceId: string;
        workspaceName: string;
    }>(pool, `SELECT p.id,p.name,p.workspace_id AS "workspaceId",w.name AS "workspaceName" FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.kind='list' AND w.deleted_at IS NULL AND NOT project_in_trash(p.id) ORDER BY w.name,p.name`);
    const result = [];
    for (const p of rows) {
        if (allowed && !allowed.includes(p.id))
            continue;
        const level = await effectiveListLevel(pool, user, p.workspaceId);
        if (level)
            result.push({ ...p, writable: levelWrites(level), manageable: await mayDo(pool, user, p.workspaceId, 'people.manage') });
    }
    return result;
}
export async function integrationGrant(pool: Pool, token: string): Promise<Grant> {
    demand(token.length >= 32 && token.length <= 200, 'Bitte SOTE erneut verbinden.', 401);
    const g = await queryOne<Grant>(pool, `SELECT g.*,c.base_url FROM integration_grants g JOIN integration_clients c ON c.id=g.client_id JOIN users u ON u.id=g.user_id WHERE token_hash=$1 AND g.revoked_at IS NULL AND c.revoked_at IS NULL AND g.expires_at>now()`, [hash(token)]);
    demand(g, 'Bitte SOTE erneut verbinden.', 401);
    return g!;
}
async function projectOf(pool: Pool, g: Grant, id: unknown, write = false) {
    demand(uuid(id) && g.projects.includes(id), 'Projekt nicht verfügbar.', 404);
    const p = (await integrationProjects(pool, g.user_id, [String(id)]))[0];
    demand(p, 'Projekt nicht verfügbar.', 404);
    demand(!write || (g.writable && p!.writable), 'Diese Verbindung hat nur Lesezugriff.');
    return p!;
}
function fieldsOf(raw: unknown) {
    demand(raw && typeof raw === 'object' && !Array.isArray(raw), 'Ungültige Aufgabe.', 400);
    const b = raw as Record<string, unknown>;
    const keys = ['title', 'note', 'planned', 'plannedAllDay', 'due', 'dueAllDay', 'duration', 'priority', 'completed'];
    demand(Object.keys(b).every(k => keys.includes(k)), 'Dieses Feld kann hier nicht geändert werden.', 400);
    if ('title' in b)
        demand(typeof b['title'] === 'string' && b['title'].trim() && b['title'].length <= 1000, 'Bitte einen Titel eingeben (höchstens 1000 Zeichen).', 400);
    if ('note' in b)
        demand(typeof b['note'] === 'string' && b['note'].length <= 100000, 'Beschreibung zu lang.', 400);
    for (const k of ['planned', 'due'])
        if (k in b && b[k] !== null)
            demand(typeof b[k] === 'string' && Number.isFinite(Date.parse(b[k] as string)), 'Ungültiger Zeitpunkt.', 400);
    for (const k of ['plannedAllDay', 'dueAllDay', 'completed'])
        if (k in b)
            demand(typeof b[k] === 'boolean', 'Ungültiger Zustand.', 400);
    if ('duration' in b)
        demand(b['duration'] === null || (Number.isInteger(b['duration']) && Number(b['duration']) > 0 && Number(b['duration']) <= 10080), 'Ungültige Dauer.', 400);
    if ('priority' in b)
        demand(Number.isInteger(b['priority']) && Number(b['priority']) >= 1 && Number(b['priority']) <= 4, 'Ungültige Priorität.', 400);
    return b;
}
async function taskOf(pool: Pool, g: Grant, id: string, write = false, lock = false) {
    demand(uuid(id), 'Aufgabe nicht verfügbar.', 404);
    const t = await queryOne<TaskRow & {
        integration_revision: string;
    }>(pool, `SELECT t.*,labels_of(t.id) AS labels,marks_of(t.id) AS marks FROM tasks t WHERE t.id=$1 AND t.trashed_at IS NULL ${lock ? 'FOR UPDATE OF t' : ''}`, [id]);
    demand(t, 'Aufgabe nicht verfügbar.', 404);
    await projectOf(pool, g, t!.project_id, write);
    return t!;
}
const view = (t: TaskRow & {
    integration_revision: string;
}) => ({ ...taskView(t), revision: String(t.integration_revision) });
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
    let b: unknown;
    try {
        b = await readJson(req, 128 * 1024);
    }
    catch {
        throw new Problem(400, 'Ungültige oder zu große Anfrage.');
    }
    demand(b && typeof b === 'object' && !Array.isArray(b), 'JSON-Objekt erforderlich.', 400);
    return b as Record<string, unknown>;
}
export async function integrationWrite(pool: Pool, g: Grant, input: {
    projectId?: unknown;
    taskId?: string;
    operationId?: unknown;
    revision?: unknown;
    fields: unknown;
    pageId?: unknown;
    blockId?: unknown;
}) {
    const fields = fieldsOf(input.fields);
    return atomic(pool, async (q) => {
        let id = input.taskId;
        if (!id) {
            demand(uuid(input.operationId), 'Eine Operations-ID fehlt.', 400);
            const p = await projectOf(q, g, input.projectId, true);
            const fingerprint = hash(JSON.stringify({ projectId: p.id, fields, pageId: input.pageId, blockId: input.blockId }));
            await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${g.client_id}:${g.user_id}:${input.operationId}`]);
            const prior = await queryOne<{
                task_id: string | null;
                payload_hash: string;
            }>(q, 'SELECT * FROM integration_operations WHERE client_id=$1 AND user_id=$2 AND operation_id=$3', [g.client_id, g.user_id, input.operationId]);
            if (prior) {
                demand(prior.payload_hash === fingerprint, 'Dieser Vorgang wurde bereits mit anderem Inhalt gespeichert.', 409);
                demand(prior.task_id, 'Die angelegte Aufgabe wurde gelöscht.', 410);
                return view(await taskOf(q, g, prior.task_id!));
            }
            demand(typeof fields['title'] === 'string', 'Bitte einen Titel eingeben.', 400);
            // Dasselbe Projektschloss wie andere Erstellvorgänge ist nicht vorausgesetzt;
            // bei einer Sortierkollision rollt die äußere Transaktion zurück, die UI behält ihre ID.
            const created = await createFromLine(q, { workspaceId: p.workspaceId, projectId: p.id, userId: g.user_id, line: 'SONE', now: new Date(), may: { pinProject: true, assign: false } });
            id = created.task.id;
            await patch(q, id, p.workspaceId, readPatch(fields), g.user_id);
            await q.query('INSERT INTO integration_operations(client_id,user_id,operation_id,payload_hash,task_id) VALUES ($1,$2,$3,$4,$5)', [g.client_id, g.user_id, input.operationId, fingerprint, id]);
        }
        else {
            const current = await taskOf(q, g, id, true, true);
            demand(input.projectId === undefined || input.projectId === current.project_id, 'Die Aufgabe wurde in ein anderes Projekt verschoben.', 404);
            demand(typeof input.revision === 'string' && input.revision === String(current.integration_revision), 'Die Aufgabe wurde inzwischen geändert. Bitte den aktuellen Stand laden.', 409);
            if (Object.keys(fields).some(key => key !== 'completed'))
                await patch(q, id, current.workspace_id, readPatch(fields), g.user_id);
        }
        const current = await taskOf(q, g, id!, true, true);
        if (fields['completed'] === true)
            await complete(q, id!, g.user_id, new Date());
        if (fields['completed'] === false && current.completed_at)
            await reopen(q, id!, current.workspace_id);
        if (input.pageId !== undefined || input.blockId !== undefined) {
            demand(uuid(input.pageId) && uuid(input.blockId), 'Ungültiger Quellenverweis.', 400);
            await q.query('INSERT INTO integration_references(client_id,page_id,block_id,task_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [g.client_id, input.pageId, input.blockId, id]);
            await q.query(`INSERT INTO task_origins(task_id,url,page_title) VALUES ($1,$2,'Quelle in SONE') ON CONFLICT(task_id) DO NOTHING`, [id, `${g.base_url}/p/${input.pageId}#b-${input.blockId}`]);
        }
        return view(await taskOf(q, g, id!));
    });
}
/** Tokenaustausch und persönliche API; ausschließlich Bearer, keine Sitzungscookies. */
export async function sonePublicRoutes(pool: Pool, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith(ROOT + '/v1/') && path !== ROOT + '/token')
        return false;
    res.setHeader('cache-control', 'no-store');
    try {
        if (path === ROOT + '/token') {
            demand(req.method === 'POST', 'POST erforderlich.', 405);
            const b = await bodyOf(req);
            const c = await clientOf(pool, b['client_id']);
            demand(typeof b['client_secret'] === 'string' && hash(b['client_secret']) === c.secret_hash, 'Zugang abgelehnt.', 401);
            demand(typeof b['code_verifier'] === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(b['code_verifier']), 'Zugang abgelehnt.', 400);
            demand(b['redirect_uri'] === callbackOf(c.base_url) && b['grant_type'] === 'authorization_code', 'Zugang abgelehnt.', 400);
            const token = random();
            const identity = await atomic(pool, async (q) => {
                const code = await queryOne<{
                    user_id: string;
                    projects: string[];
                    writable: boolean;
                }>(q, `DELETE FROM integration_codes WHERE code_hash=$1 AND client_id=$2 AND challenge=$3 AND expires_at>now() RETURNING *`, [hash(String(b['code'] ?? '')), c.id, createHash('sha256').update(b['code_verifier'] as string).digest('base64url')]);
                demand(code, 'Die Anmeldung ist abgelaufen oder wurde bereits verwendet.', 400);
                await q.query(`INSERT INTO integration_grants(client_id,user_id,token_hash,projects,writable,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '30 days')`, [c.id, code!.user_id, hash(token), code!.projects, code!.writable]);
                return code!.user_id;
            });
            json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 30 * 86400, user_id: identity });
            return true;
        }
        const header = req.headers.authorization ?? '';
        demand(header.startsWith('Bearer '), 'Bitte SOTE verbinden.', 401);
        const g = await integrationGrant(pool, header.slice(7));
        const rel = path.slice((ROOT + '/v1/').length);
        if (rel === 'revoke' && req.method === 'POST') {
            await pool.query('UPDATE integration_grants SET revoked_at=now() WHERE id=$1', [g.id]);
            json(res, 200, { ok: true });
            return true;
        }
        if (rel === 'projects' && req.method === 'GET') {
            json(res, 200, { projects: (await integrationProjects(pool, g.user_id, g.projects)).map(p => ({ ...p, writable: p.writable && g.writable })) });
            return true;
        }
        if (rel === 'tasks' && req.method === 'GET') {
            const p = await projectOf(pool, g, url.searchParams.get('projectId'));
            const offset = Number(url.searchParams.get('offset') ?? 0);
            demand(Number.isInteger(offset) && offset >= 0 && offset <= 100000, 'Ungültige Seite.', 400);
            const rows = await queryRows<TaskRow & {
                integration_revision: string;
            }>(pool, `SELECT t.*,labels_of(t.id) AS labels,marks_of(t.id) AS marks FROM tasks t WHERE project_id=$1 AND trashed_at IS NULL ORDER BY sort_key,id LIMIT 101 OFFSET $2`, [p.id, offset]);
            json(res, 200, { tasks: rows.slice(0, 100).map(view), next: rows.length > 100 ? offset + 100 : null, writable: p.writable && g.writable });
            return true;
        }
        const one = /^tasks\/([0-9a-f-]{36})$/.exec(rel);
        const operation = /^operations\/([0-9a-f-]{36})$/.exec(rel);
        if (operation && req.method === 'GET') {
            demand(uuid(operation[1]), 'Ungültiger Vorgang.', 400);
            const prior = await queryOne<{
                task_id: string | null;
            }>(pool, 'SELECT task_id FROM integration_operations WHERE client_id=$1 AND user_id=$2 AND operation_id=$3', [g.client_id, g.user_id, operation[1]]);
            if (!prior) {
                json(res, 200, { task: null });
                return true;
            }
            demand(prior.task_id, 'Die angelegte Aufgabe wurde gelöscht.', 410);
            json(res, 200, { task: view(await taskOf(pool, g, prior.task_id!)) });
            return true;
        }
        if (one && req.method === 'GET') {
            json(res, 200, { task: view(await taskOf(pool, g, one[1]!)), writable: g.writable && (await projectOf(pool, g, (await taskOf(pool, g, one[1]!)).project_id)).writable });
            return true;
        }
        if ((rel === 'tasks' && req.method === 'POST') || (one && req.method === 'PATCH')) {
            const b = await bodyOf(req);
            json(res, 200, { task: await integrationWrite(pool, g, { ...(one ? { taskId: one[1]! } : {}), projectId: b['projectId'], operationId: b['operationId'], revision: b['revision'], pageId: b['pageId'], blockId: b['blockId'], fields: b['fields'] }) });
            return true;
        }
        throw new Problem(404, 'Diese Schnittstelle gibt es nicht.');
    }
    catch (e) {
        if (e instanceof Problem)
            fail(res, e.status, 'integration', e.message);
        else if (e instanceof OutOfOrder)
            fail(res, 409, 'integration', e.message);
        else
            throw e;
    }
    return true;
}
/** Hinter Sitzungs- und CSRF-Prüfung. Verwaltung und persönliche Zustimmung getrennt. */
export async function soneSessionRoutes(pool: Pool, user: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith(ROOT))
        return false;
    res.setHeader('cache-control', 'no-store');
    try {
        const rel = url.pathname.slice(ROOT.length), admin = await isAdmin(pool, user);
        if (req.method !== 'GET')
            demand(req.headers['content-type']?.startsWith('application/json'), 'JSON erforderlich.', 415);
        if (rel === '' && req.method === 'GET') {
            json(res, 200, { admin, clients: admin ? await queryRows(pool, 'SELECT id,name,base_url AS "baseUrl",revoked_at AS "revokedAt" FROM integration_clients ORDER BY name') : [], grants: await queryRows(pool, `SELECT g.id,c.name,g.writable,g.expires_at AS "expiresAt" FROM integration_grants g JOIN integration_clients c ON c.id=g.client_id WHERE g.user_id=$1 AND g.revoked_at IS NULL AND c.revoked_at IS NULL AND g.expires_at>now()`, [user]) });
            return true;
        }
        if (rel === '/clients' && req.method === 'POST') {
            demand(admin);
            const b = await bodyOf(req), base = integrationBase(b['baseUrl']);
            const secret = random();
            const name = String(b['name'] ?? 'SONE').trim().slice(0, 100);
            demand(name, 'Name fehlt.', 400);
            const found = await queryOne(pool, 'SELECT id FROM integration_clients WHERE base_url=$1 AND revoked_at IS NULL', [base]);
            demand(!found, 'Diese Instanz ist bereits registriert.', 409);
            const c = await queryOne<{
                id: string;
            }>(pool, 'INSERT INTO integration_clients(name,base_url,secret_hash,created_by) VALUES($1,$2,$3,$4) RETURNING id', [name, base, hash(secret), user]);
            json(res, 201, { id: c!.id, secret });
            return true;
        }
        const revoke = /^\/(clients|grants)\/([0-9a-f-]{36})$/.exec(rel);
        if (revoke && req.method === 'DELETE') {
            if (revoke[1] === 'clients') {
                demand(admin);
                await pool.query('UPDATE integration_clients SET revoked_at=now() WHERE id=$1', [revoke[2]]);
            }
            else
                await pool.query('UPDATE integration_grants SET revoked_at=now() WHERE id=$1 AND user_id=$2', [revoke[2], user]);
            json(res, 200, { ok: true });
            return true;
        }
        if (rel === '/consent' && (req.method === 'GET' || req.method === 'POST')) {
            const b = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await bodyOf(req);
            const c = await clientOf(pool, b['client_id']);
            demand(b['redirect_uri'] === callbackOf(c.base_url) && b['code_challenge_method'] === 'S256' && typeof b['code_challenge'] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(b['code_challenge']) && typeof b['state'] === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(b['state']), 'Ungültige Verbindungsanfrage.', 400);
            const projects = await integrationProjects(pool, user);
            if (req.method === 'GET') {
                json(res, 200, { name: c.name, baseUrl: c.base_url, projects });
                return true;
            }
            demand(Array.isArray(b['projects']) && b['projects'].length > 0 && b['projects'].length <= 100 && b['projects'].every(id => projects.some(p => p.id === id)), 'Bitte erlaubte Projekte auswählen.', 400);
            const code = random();
            await pool.query('DELETE FROM integration_codes WHERE expires_at<now()');
            await pool.query(`INSERT INTO integration_codes(code_hash,client_id,user_id,challenge,projects,writable,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 minutes')`, [hash(code), c.id, user, b['code_challenge'], b['projects'], b['writable'] === true]);
            const dest = new URL(callbackOf(c.base_url));
            dest.search = new URLSearchParams({ code, state: b['state'] as string }).toString();
            json(res, 200, { url: dest.href });
            return true;
        }
        throw new Problem(404, 'Diese Verbindung gibt es nicht.');
    }
    catch (e) {
        if (e instanceof Problem)
            fail(res, e.status, 'integration', e.message);
        else
            throw e;
    }
    return true;
}
