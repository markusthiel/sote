import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after,before,test } from 'node:test';
import type { Pool } from 'pg';
import { makePool,queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seal } from '../src/secretbox.js';
import { CloudCalendar,createCloudSource,eventFields,eventPayload,fieldsFromIcs,readCloudEvent } from '../src/cloudCalendars.js';
import { type CloudProvider } from '../src/calendarOAuth.js';
import { saveWriter,syncWriter,writerStatus,acceptWriterConflict,pauseWriter } from '../src/calendarWriters.js';
import { fetchFeed,eventsOf,listFeeds } from '../src/calendarSources.js';

let pool:Pool;const now=new Date('2026-09-14T08:00:00Z');
before(async()=>{process.env['SOTE_SHARE_KEY']='d'.repeat(64);process.env['SOTE_BASE_URL']='https://sote.example';pool=makePool(process.env['SOTE_TEST_DATABASE_URL']??'postgres://sote:sote@127.0.0.1:5433/sote_test');await migrate(pool);});
after(async()=>pool.end());
const json=(body:unknown,status=200)=>new Response(status===204?null:JSON.stringify(body),{status});
async function fixture(provider:CloudProvider){
  const user=(await queryOne<{id:string}>(pool,"INSERT INTO users(email,display_name) VALUES ($1,'Cloud') RETURNING id",[randomUUID()+'@example.com']))!.id;
  const account=(await queryOne<{id:string}>(pool,"INSERT INTO calendar_accounts(user_id,provider,subject,label,tokens_sealed) VALUES ($1,$2,$3,'Konto',$4) RETURNING id",[user,provider,randomUUID(),seal(JSON.stringify({access:'access',refresh:'refresh',expires:Date.now()+3600_000}))]))!.id;
  const workspace=(await queryOne<{id:string}>(pool,"INSERT INTO workspaces(name) VALUES ('Cloud') RETURNING id"))!.id;
  const role=(await queryOne<{id:string}>(pool,"INSERT INTO roles(workspace_id,name,list_level) VALUES ($1,'editor','editor') RETURNING id",[workspace]))!.id;
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role_id) VALUES ($1,$2,$3)',[workspace,user,role]);
  const task=(await queryOne<{id:string}>(pool,"INSERT INTO tasks(workspace_id,title,sort_key,planned_at,planned_all_day,duration_min) VALUES ($1,'Aufgabe','a','2026-09-14T09:00:00Z',false,30) RETURNING id",[workspace]))!.id;
  const objects=new Map<string,Record<string,any>>();let version=0;const calls:{method:string;url:string}[]=[];let lose=false;
  const fetcher:typeof fetch=async(raw,init)=>{
    const url=new URL(String(raw)),method=init?.method??'GET';calls.push({method,url:url.href});assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer access');
    const list=provider==='google'?{items:[{id:'cal',summary:'Kalender',accessRole:'owner'},{id:'readonly',summary:'Lesen',accessRole:'reader'}]}:{value:[{id:'cal',name:'Kalender',canEdit:true},{id:'readonly',name:'Lesen',canEdit:false}]};
    if(url.pathname.endsWith('/calendarList')||url.pathname.endsWith('/me/calendars'))return json(list);
    if(method==='GET'&&(url.pathname.endsWith('/events')||url.pathname.endsWith('/calendarView'))){
      const uid=/ep\/value eq '([a-f0-9]{32})'/.exec(url.searchParams.get('$filter')??'')?.[1];
      const values=[...objects.values()].filter(e=>!uid||e['singleValueExtendedProperties']?.some((p:Record<string,any>)=>p['value']===uid));
      return json({[provider==='google'?'items':'value']:values});
    }
    const id=decodeURIComponent(url.pathname.split('/').at(-1)!);const old=objects.get(id);
    if(method==='GET')return old?json(old):json({},404);
    if(method==='POST'){
      const body=JSON.parse(String(init?.body));const key=provider==='google'?body.id:'graph-id-'+(++version);if(objects.has(key))return json({},409);
      const event={...body,id:key,[provider==='google'?'etag':'@odata.etag']:(provider==='google'?'':'W/')+`"v${++version}"`};objects.set(key,event);
      if(lose){lose=false;throw new Error('Antwort verloren');}return json(event,201);
    }
    if(!old)return json({},404);
    assert.equal(new Headers(init?.headers).get('if-match'),old[provider==='google'?'etag':'@odata.etag']);
    if(method==='DELETE'){objects.delete(id);return json({},204);}
    assert.equal(method,'PATCH');const event={...old,...JSON.parse(String(init?.body)),[provider==='google'?'etag':'@odata.etag']:(provider==='google'?'':'W/')+`"v${++version}"`};objects.set(id,event);return json(event);
  };
  const feed=await createCloudSource(pool,user,account,'cal','Mein Kalender',fetcher);
  return {user,account,workspace,task,feed,fetcher,objects,calls,lose:()=>{lose=true;},input:{workspaces:[workspace],mode:'planned',timezone:'Europe/Berlin',enabled:true}};
}
for(const provider of ['google','microsoft'] as const){
  test(`${provider}: Lesen, Schreiben, Änderung und Erledigung mit versionsgebundenen Zugriffen`,async(t)=>{
    const f=await fixture(provider);t.mock.method(globalThis,'fetch',f.fetcher);
    await saveWriter(pool,f.user,f.feed,f.input);await syncWriter(pool,f.feed,now);
    assert.equal(f.objects.size,1);assert.equal((await writerStatus(pool,f.user))[f.feed]?.count,1);
    const event=[...f.objects.values()][0]!;assert.ok(JSON.stringify(event).includes('https://sote.example/a/'+f.task));
    await syncWriter(pool,f.feed,now);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
    assert.equal(await fetchFeed(pool,f.feed,now),'ok');
    // Eigene zurückgelesene Plantermine werden neben der Aufgabe nicht doppelt gezeigt.
    assert.equal((await eventsOf(pool,f.user,new Date('2026-09-01'),new Date('2026-10-01'))).length,0);
    await pool.query("UPDATE tasks SET title='Neu',planned_at='2026-09-15T10:00:00Z' WHERE id=$1",[f.task]);await syncWriter(pool,f.feed,now);
    assert.equal([...f.objects.values()][0]![provider==='google'?'summary':'subject'],'Neu');
    await pool.query('UPDATE tasks SET completed_at=now() WHERE id=$1',[f.task]);await syncWriter(pool,f.feed,now);assert.equal(f.objects.size,0);
    assert.equal((await writerStatus(pool,f.user))[f.feed]?.lastError,null);
  });
  test(`${provider}: Verlorene Erstantwort erzeugt beim Wiederholen keine zusätzliche Kopie`,async(t)=>{
    const f=await fixture(provider);t.mock.method(globalThis,'fetch',f.fetcher);await saveWriter(pool,f.user,f.feed,f.input);f.lose();
    await syncWriter(pool,f.feed,now);assert.equal(f.objects.size,1);assert.equal((await writerStatus(pool,f.user))[f.feed]?.count,0);
    await syncWriter(pool,f.feed,now);assert.equal(f.objects.size,1);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal((await writerStatus(pool,f.user))[f.feed]?.count,1);
  });
  test(`${provider}: Fremde Änderungen erfordern Freigabe; Pausieren verändert keine Termine`,async(t)=>{
    const f=await fixture(provider);t.mock.method(globalThis,'fetch',f.fetcher);await saveWriter(pool,f.user,f.feed,f.input);await syncWriter(pool,f.feed,now);
    const event=[...f.objects.values()][0]!;event[provider==='google'?'summary':'subject']='Fremd';event[provider==='google'?'etag':'@odata.etag']='"external"';
    await pool.query("UPDATE tasks SET title='SOTE neu' WHERE id=$1",[f.task]);await syncWriter(pool,f.feed,now);assert.equal((await writerStatus(pool,f.user))[f.feed]?.conflict,true);assert.equal(event[provider==='google'?'summary':'subject'],'Fremd');
    await acceptWriterConflict(pool,f.user,f.feed);await syncWriter(pool,f.feed,now);assert.equal((await writerStatus(pool,f.user))[f.feed]?.conflict,false);assert.equal([...f.objects.values()][0]![provider==='google'?'summary':'subject'],'SOTE neu');
    await pauseWriter(pool,f.user,f.feed);f.calls.length=0;await syncWriter(pool,f.feed,now);assert.equal(f.calls.length,0);
  });
  test(`${provider}: Kalenderauswahl prüft Besitz und Schreibrechte, erneutes Verbinden bleibt eindeutig`,async(t)=>{
    const f=await fixture(provider);t.mock.method(globalThis,'fetch',f.fetcher);
    assert.equal(await createCloudSource(pool,f.user,f.account,'cal','Doppelt',f.fetcher),f.feed);
    assert.equal((await listFeeds(pool,f.user)).find(feed=>feed.id===f.feed)?.writable,true);
    await assert.rejects(()=>createCloudSource(pool,randomUUID(),f.account,'cal','',f.fetcher),/gibt es nicht/);
    const readonly=await createCloudSource(pool,f.user,f.account,'readonly','Nur lesen',f.fetcher);await assert.rejects(()=>saveWriter(pool,f.user,readonly,f.input),/Schreibrechte/);
    assert.equal((await listFeeds(pool,f.user)).find(feed=>feed.id===readonly)?.writable,false);
    await pool.query('UPDATE calendar_sources SET writable=NULL WHERE id=$1',[f.feed]);
    await fetchFeed(pool,f.feed,now);
    assert.equal((await listFeeds(pool,f.user)).find(feed=>feed.id===f.feed)?.writable,true);
    assert.equal((await listFeeds(pool,f.user))[0]?.kind,provider);assert.ok(!JSON.stringify(await listFeeds(pool,f.user)).includes('refresh'));
  });
  test(`${provider}: Plan und Frist bleiben getrennt; Fehler beim Lesen erhalten fremde Termine`,async(t)=>{
    const f=await fixture(provider);t.mock.method(globalThis,'fetch',f.fetcher);
    await pool.query("UPDATE tasks SET due_at='2026-09-16T12:00:00Z',due_all_day=true WHERE id=$1",[f.task]);
    await saveWriter(pool,f.user,f.feed,{...f.input,mode:'both'});await syncWriter(pool,f.feed,now);assert.equal(f.objects.size,2);
    const due=[...f.objects.values()].find(e=>String(e[provider==='google'?'summary':'subject']).startsWith('Frist:'))!;
    assert.equal(eventFields(provider,due).start,'2026-09-16');assert.equal(eventFields(provider,due).end,'2026-09-17');
    assert.equal(await fetchFeed(pool,f.feed,now),'ok');
    const count=async()=>Number((await pool.query('SELECT count(*) AS n FROM calendar_source_events WHERE feed_id=$1',[f.feed])).rows[0].n);
    assert.equal(await count(),2);
    assert.equal(await fetchFeed(pool,f.feed,now,async()=>json({error:'private details'},403)),'failed');assert.equal(await count(),2);
    await pool.query('UPDATE tasks SET completed_at=now() WHERE id=$1',[f.task]);await syncWriter(pool,f.feed,now);assert.equal(f.objects.size,0);
  });
}
test('Ganztage behalten ihr Datum; reine Zeitpunkte erhalten eine Minute; UTC und Serieninstanzen werden gelesen',()=>{
  for(const provider of ['google','microsoft'] as const){
    const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20260914\r\nDTEND;VALUE=DATE:20260915\r\nSUMMARY:Ganztag\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const fields=fieldsFromIcs(ics);assert.equal(fields.start,'2026-09-14');assert.equal(fields.end,'2026-09-15');
    const payload=eventPayload(provider,'a'.repeat(32),fields);assert.deepEqual(eventFields(provider,payload),fields);
    const event=readCloudEvent(provider,{...payload,id:'instance'});assert.equal(event?.start.toISOString(),'2026-09-14T00:00:00.000Z');
    const instant=fieldsFromIcs(ics.replace('DTSTART;VALUE=DATE:20260914','DTSTART:20260914T120000Z').replace('DTEND;VALUE=DATE:20260915\r\n',''));assert.equal(instant.end,'2026-09-14T12:01:00.000Z');
  }
});
test('Pagination wird vollständig gelesen; fremde Graph-Folgeseiten erhalten keine Tokens',async()=>{
  const f=await fixture('microsoft');let calls=0;
  const client=new CloudCalendar(pool,{provider:'microsoft',accountId:f.account,calendarId:'cal'},async()=>{calls++;return json({value:[],'@odata.nextLink':'https://evil.example/next'});});
  await assert.rejects(()=>client.calendars(),/Folgeseite/);assert.equal(calls,1);
  const google=await fixture('google');let pages=0;
  const g=new CloudCalendar(pool,{provider:'google',accountId:google.account,calendarId:'cal'},async(url)=>{pages++;return json(pages===1?{items:[{id:'one',summary:'Eins',accessRole:'owner'}],nextPageToken:'page2'}:{items:[{id:'two',summary:'Zwei',accessRole:'reader'}]});});
  assert.equal((await g.calendars()).length,2);assert.equal(pages,2);
});
