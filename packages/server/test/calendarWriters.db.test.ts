import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addFeed, eventsOf } from '../src/calendarSources.js';
import { acceptWriterConflict, disconnectWriter, pauseWriter, saveWriter, syncWriter, writerStatus } from '../src/calendarWriters.js';
import { eventUid, type DavTransport } from '../src/caldav.js';

let pool: Pool;
const now = new Date('2026-09-14T08:00:00Z');
before(async () => {
  process.env['SOTE_SHARE_KEY'] = '9'.repeat(64);
  pool = makePool(process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test');
  await migrate(pool);
});
after(async () => { await pool.end(); });

async function fixture() {
  const user = (await queryOne<{id:string}>(pool, 'INSERT INTO users(email,display_name) VALUES ($1,$2) RETURNING id', [`writer-${randomUUID()}@example.com`, 'Writer']))!.id;
  const workspace = (await queryOne<{id:string}>(pool, "INSERT INTO workspaces(name) VALUES ('CalDAV-Test') RETURNING id"))!.id;
  const role = (await queryOne<{id:string}>(pool, "INSERT INTO roles(workspace_id,name,list_level) VALUES ($1,'member','editor') RETURNING id", [workspace]))!.id;
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role_id) VALUES ($1,$2,$3)', [workspace,user,role]);
  const feed = await addFeed(pool,user,{name:'Kalender',url:'https://calendar.example/read.ics',color:'blue'});
  assert.notEqual(typeof feed,'string'); if (typeof feed === 'string') throw new Error(feed);
  const task = async (title = 'Aufgabe') => (await queryOne<{id:string}>(pool,
    `INSERT INTO tasks(workspace_id,title,sort_key,planned_at,planned_all_day,duration_min) VALUES ($1,$2,$3,'2026-09-14T09:00:00Z',false,30) RETURNING id`, [workspace,title,randomUUID()]))!.id;
  const objects = new Map<string,{body:string;etag:string}>();
  const calls: {method:string;url:string;headers:Record<string,string>|undefined}[] = [];
  let version = 0;
  const transport: DavTransport = async (url, _creds, method, body='', headers) => {
    calls.push({method,url,headers});
    if (method === 'PROPFIND') return {status:207,etag:null,body:'<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/mine/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'};
    const old = objects.get(url);
    if (method === 'GET') return old ? {status:200,...old} : {status:404,etag:null,body:''};
    if ((headers?.['if-none-match'] === '*' && old) || (headers?.['if-match'] !== undefined && headers['if-match'] !== old?.etag)) return {status:412,etag:null,body:''};
    if (method === 'DELETE') { objects.delete(url); return {status:204,etag:null,body:''}; }
    assert.equal(method,'PUT'); const etag = `"v${++version}"`; objects.set(url,{body,etag}); return {status:old?204:201,etag,body:''};
  };
  const input = {url:'https://calendar.example/mine/',username:'test-user',password:'app-secret',workspaces:[workspace],mode:'planned',timezone:'Europe/Berlin',enabled:true};
  const save = () => saveWriter(pool,user,feed.id,input,transport);
  const sync = () => syncWriter(pool,feed.id,now,transport);
  return {user,workspace,feed:feed.id,task,objects,calls,transport,input,save,sync};
}

test('Anlegen, Umplanen, Wiederholung des Abgleichs und endgültiges Löschen behalten genau eine Kalenderkopie', async () => {
  const f = await fixture(); const task = await f.task(); await f.save(); await f.sync();
  assert.equal(f.objects.size,1); const url = [...f.objects.keys()][0]!;
  const puts = () => f.calls.filter((c)=>c.method==='PUT');
  assert.equal(puts().length,1); await f.sync(); assert.equal(puts().length,1);
  await pool.query("UPDATE tasks SET title='Neu', planned_at='2026-09-15T12:00:00Z' WHERE id=$1",[task]);
  await f.sync(); assert.equal(f.objects.size,1); assert.ok(f.objects.get(url)?.body.includes('DTSTART:20260915T120000Z'));
  assert.ok(puts()[1]?.headers?.['if-match']);
  await pool.query('DELETE FROM tasks WHERE id=$1',[task]); await f.sync(); assert.equal(f.objects.size,0);
  assert.equal((await writerStatus(pool,f.user))[f.feed]?.lastError,null);
});

test('Plan und Frist werden getrennt geschrieben; Erledigung entfernt beide eigenen Ressourcen', async () => {
  const f = await fixture(); const task = await f.task();
  await pool.query("UPDATE tasks SET due_at='2026-09-16T15:00:00Z', due_all_day=false WHERE id=$1",[task]);
  await saveWriter(pool,f.user,f.feed,{...f.input,mode:'both'},f.transport); await f.sync();
  assert.equal(f.objects.size,2); assert.equal([...f.objects.values()].filter(v=>v.body.includes('SUMMARY:Frist:')).length,1);
  await pool.query('UPDATE tasks SET completed_at=now() WHERE id=$1',[task]); await f.sync(); assert.equal(f.objects.size,0);
});

test('Zugriff wird beim Einrichten und bei jedem Abgleich geprüft, Zugangsdaten bleiben versiegelt', async () => {
  const f = await fixture(); const other = await fixture(); await f.task();
  await assert.rejects(() => saveWriter(pool,other.user,f.feed,f.input,f.transport), /gibt es nicht/);
  await assert.rejects(() => saveWriter(pool,f.user,f.feed,{...f.input,workspaces:[other.workspace]},f.transport), /nicht alle/);
  await f.save();
  const row = (await queryOne<{credentials_sealed:string}>(pool,'SELECT credentials_sealed FROM calendar_writers WHERE feed_id=$1',[f.feed]))!;
  assert.equal(row.credentials_sealed.includes('app-secret'),false);
  const status = JSON.stringify(await writerStatus(pool,f.user));
  for (const secret of ['app-secret','test-user','https://calendar.example/mine/','credentials_sealed']) assert.equal(status.includes(secret),false);
  assert.equal((await writerStatus(pool,other.user))[f.feed],undefined);
  await pool.query('DELETE FROM workspace_members WHERE user_id=$1 AND workspace_id=$2',[f.user,f.workspace]);
  f.calls.length=0; await f.sync(); assert.equal(f.calls.length,0);
  assert.match((await writerStatus(pool,f.user))[f.feed]!.lastError!,/Zugriff/);
});

test('Fremde Änderungen lösen einen sichtbaren Konflikt aus; Pausieren und Trennen schreiben nichts', async () => {
  const f = await fixture(); const task = await f.task(); await f.save(); await f.sync();
  const url = [...f.objects.keys()][0]!; const old = f.objects.get(url)!;
  f.objects.set(url,{body:old.body.replace('SUMMARY:Aufgabe','SUMMARY:Extern'),etag:'"external"'});
  await pool.query("UPDATE tasks SET title='SOTE neu' WHERE id=$1",[task]); await f.sync();
  assert.ok(f.objects.get(url)!.body.includes('SUMMARY:Extern'));
  assert.match((await writerStatus(pool,f.user))[f.feed]!.lastError!,/Konflikt/);
  assert.equal((await writerStatus(pool,f.user))[f.feed]!.conflict,true);
  await acceptWriterConflict(pool,f.user,f.feed,f.transport);
  await f.sync();
  assert.ok(f.objects.get(url)!.body.includes('SUMMARY:SOTE neu'));
  assert.equal((await writerStatus(pool,f.user))[f.feed]!.conflict,false);
  await pauseWriter(pool,f.user,f.feed); f.calls.length=0; await f.sync(); assert.equal(f.calls.length,0);
  await disconnectWriter(pool,f.user,f.feed); assert.equal(f.objects.size,1); assert.equal(f.calls.length,0);
  assert.equal((await writerStatus(pool,f.user))[f.feed],undefined);
});

test('Ein Abbruch nach PUT erzeugt beim Wiederholen keinen zweiten Eintrag', async () => {
  const f = await fixture(); await f.task(); await f.save();
  let fail = true;
  const interrupted: DavTransport = async (...args) => {
    const result = await f.transport(...args);
    if (args[2] === 'PUT' && fail) { fail=false; throw new Error('Verbindung abgebrochen'); }
    return result;
  };
  await syncWriter(pool,f.feed,now,interrupted); assert.equal(f.objects.size,1);
  await f.sync(); assert.equal(f.objects.size,1);
  assert.equal((await writerStatus(pool,f.user))[f.feed]?.lastError,null);
  await Promise.all([f.sync(),f.sync()]); assert.equal(f.objects.size,1);
});

test('Eigene zurückgelesene Plantermine erscheinen nicht doppelt neben der Aufgabe', async () => {
  const f = await fixture(); await f.task(); await f.save(); await f.sync();
  const written = (await queryRows<{uid:string}>(pool,'SELECT e.uid FROM calendar_write_events e JOIN calendar_writers w ON w.id=e.writer_id WHERE w.feed_id=$1',[f.feed]))[0]!;
  await pool.query(`INSERT INTO calendar_source_events(feed_id,uid,title,starts_at,ends_at,all_day) VALUES ($1,$2,'Aufgabe','2026-09-14T09:00:00Z','2026-09-14T09:30:00Z',false)`,[f.feed,written.uid]);
  assert.equal((await eventsOf(pool,f.user,new Date('2026-09-14'),new Date('2026-09-15'))).length,0);
});

test('Nach verlorenem Änderungs-PUT wird ein Zurücksetzen der Aufgabe nicht als unverändert übersprungen', async () => {
  const f = await fixture(); const task = await f.task(); await f.save(); await f.sync();
  await pool.query("UPDATE tasks SET title='Zwischenstand' WHERE id=$1", [task]);
  const interrupted: DavTransport = async (...args) => {
    const result = await f.transport(...args);
    if (args[2] === 'PUT') throw new Error('Abbruch nach Änderung');
    return result;
  };
  await syncWriter(pool,f.feed,now,interrupted);
  await pool.query("UPDATE tasks SET title='Aufgabe' WHERE id=$1", [task]);
  await f.sync();
  assert.equal((await writerStatus(pool,f.user))[f.feed]!.conflict,true);
  await acceptWriterConflict(pool,f.user,f.feed,f.transport); await f.sync();
  assert.ok([...f.objects.values()][0]!.body.includes('SUMMARY:Aufgabe'));
  assert.equal((await writerStatus(pool,f.user))[f.feed]!.lastError,null);
});

test('Eine andere Zieladresse übernimmt keine alten ETags und abgewählte Fristen werden aufgeräumt', async () => {
  const f = await fixture(); const task = await f.task();
  await pool.query("UPDATE tasks SET due_at='2026-09-16T15:00:00Z' WHERE id=$1",[task]);
  await saveWriter(pool,f.user,f.feed,{...f.input,mode:'both'},f.transport); await f.sync();
  await assert.rejects(() => saveWriter(pool,f.user,f.feed,{...f.input,url:'https://calendar.example/other/'},f.transport),/zuerst die Verbindung trennen/);
  await f.save(); await f.sync(); assert.equal(f.objects.size,1);
});

test('Nach verlorenem PUT und anschließender Erledigung wird nur die nachweislich eigene Kopie entfernt', async () => {
  const f = await fixture(); const task = await f.task(); await f.save();
  const interrupted: DavTransport = async (...args) => { const result = await f.transport(...args); if (args[2] === 'PUT') throw new Error('Abbruch'); return result; };
  await syncWriter(pool,f.feed,now,interrupted); assert.equal(f.objects.size,1);
  await pool.query('UPDATE tasks SET completed_at=now() WHERE id=$1',[task]); await f.sync(); assert.equal(f.objects.size,0);
});

test('Große Abgleiche werden fortgesetzt und schreiben unveränderte Einträge nicht erneut', async () => {
  const f = await fixture(); for (let n=0;n<23;n++) await f.task(`Aufgabe ${n}`); await f.save();
  await f.sync(); assert.equal(f.objects.size,20); assert.equal((await writerStatus(pool,f.user))[f.feed]!.syncedAt,null);
  await f.sync(); assert.equal(f.objects.size,23); assert.notEqual((await writerStatus(pool,f.user))[f.feed]!.syncedAt,null);
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,23);
});

test('Fehlgeschlagene iCloud-Erstversuche werden kurz neu geschrieben und erst nach Bestätigung gezählt', async () => {
  const f = await fixture(); const task = await f.task();
  const cloudUrl = 'https://p39-caldav.icloud.com/mine/';
  const cloud: DavTransport = async (...args) => {
    if (args[2] === 'PUT' && eventUid(args[3] ?? '').length > 64) return {status:404,body:'',etag:null};
    return f.transport(...args);
  };
  await saveWriter(pool,f.user,f.feed,{...f.input,url:cloudUrl},cloud);
  const writer = (await queryOne<{id:string}>(pool,'SELECT id FROM calendar_writers WHERE feed_id=$1',[f.feed]))!;
  const oldUid = `sote-${writer.id}-${task}-plan@sote`;
  await pool.query("INSERT INTO calendar_write_events(writer_id,task_id,kind,uid,pending_hash) VALUES ($1,$2,'plan',$3,'unconfirmed')",[writer.id,task,oldUid]);
  assert.equal((await writerStatus(pool,f.user))[f.feed]!.count,0);
  await syncWriter(pool,f.feed,now,cloud);
  const status = (await writerStatus(pool,f.user))[f.feed]!;
  assert.equal(status.count,1); assert.equal(status.lastError,null); assert.notEqual(status.syncedAt,null);
  const saved = (await queryOne<{uid:string}>(pool,'SELECT uid FROM calendar_write_events WHERE writer_id=$1',[writer.id]))!;
  assert.match(saved.uid,/^[a-f0-9]{32}$/); assert.equal(f.objects.size,1);
  await syncWriter(pool,f.feed,now,cloud);
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
  await pool.query('UPDATE tasks SET completed_at=now() WHERE id=$1',[task]);
  await syncWriter(pool,f.feed,now,cloud); assert.equal(f.objects.size,0);
});

test('Eine abgelehnte Übertragung erscheint nicht als bestätigte Kalenderkopie', async () => {
  const f = await fixture(); await f.task(); await f.save();
  await syncWriter(pool,f.feed,now,async () => ({status:404,body:'',etag:null}));
  const status = (await writerStatus(pool,f.user))[f.feed]!;
  assert.equal(status.count,0); assert.equal(status.syncedAt,null);
  assert.match(status.lastError!,/Termin schreiben \(PUT\).*HTTP 404/);
});
