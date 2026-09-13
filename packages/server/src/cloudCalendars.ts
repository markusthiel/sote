/** Gemeinsame Kalenderoperationen über Google Calendar API und Microsoft Graph. */
import ICAL from 'ical.js';
import type { Pool, PoolClient } from 'pg';
import { queryOne } from './db.js';
import { seal } from './secretbox.js';
import { CalDavError, CalDavConflict } from './caldav.js';
import { accountProvider, cloudToken, fetchCloudJson, hash, type CloudAccess, type CloudProvider, type Json } from './calendarOAuth.js';
import type { FeedEvent } from './calendarSources.js';

const ROOT = { google:'https://www.googleapis.com/calendar/v3', microsoft:'https://graph.microsoft.com/v1.0' };
const PROPERTY = 'String {f6528932-f892-477b-920f-507540aca80c} Name SOTEUid';
const enc = encodeURIComponent;
export interface CloudCalendarInfo { id:string; name:string; writable:boolean }
interface Entry { writer_id:string; uid:string; remote_id?:string|null; etag:string|null; content_hash:string|null; pending_hash:string|null }
const conflict = () => new CalDavConflict('Der Termin wurde im Zielkalender geändert. Bitte den Konflikt prüfen.');
function failed(status:number): never {
  throw new CalDavError(status === 401 ? 'Kalenderzugriff abgelaufen. Bitte das Konto erneut anmelden.' : status === 403 ? 'Der Anbieter erlaubt diesen Kalenderzugriff nicht.' : status === 429 ? 'Zu viele Kalenderanfragen. Der nächste Abgleich versucht es erneut.' : `Der Kalenderanbieter antwortet mit HTTP ${status}.`);
}
const etagOf = (event:Json): string => {
  const etag = event['etag'] ?? event['@odata.etag'];
  if (typeof etag !== 'string' || !/^(?:W\/)?"[^\r\n]+"$/.test(etag)) throw new CalDavError('Der Kalenderanbieter liefert keine gültige Versionskennung.');
  return etag;
};
export function ownUid(provider:CloudProvider,event:Json): string | undefined {
  const uid = provider === 'google' ? event['extendedProperties']?.private?.soteUid
    : event['singleValueExtendedProperties']?.find((p:Json) => p['id'] === PROPERTY)?.value;
  return typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid) ? uid : undefined;
}
function instant(value:unknown): string {
  if (typeof value !== 'string' || !value) throw new CalDavError('Ein Kalendertermin enthält keinen gültigen Zeitpunkt.');
  // Graph liefert mit Prefer UTC häufig eine Uhrzeit ohne Z.
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value+'Z');
  if (!Number.isFinite(date.getTime())) throw new CalDavError('Ein Kalendertermin enthält keinen gültigen Zeitpunkt.');
  return date.toISOString();
}
function day(value:unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) throw new CalDavError('Ein Ganztagstermin enthält kein gültiges Datum.');
  const out=value.slice(0,10); if (new Date(out+'T00:00:00Z').toISOString().slice(0,10)!==out) throw new CalDavError('Ungültiges Kalenderdatum.'); return out;
}
interface Fields { title:string; description:string; start:string; end:string; allDay:boolean; free:boolean; reminders:boolean; location:string; extra:boolean }
const clean = (v:unknown) => String(v ?? '').replace(/\r\n/g,'\n').trimEnd();
/** Nur SOTE-Felder normalisieren; fremde Teilnehmer/Serien werden niemals übernommen. */
export function eventFields(provider:CloudProvider,event:Json): Fields {
  const allDay=provider==='google' ? !!event['start']?.date : event['isAllDay'] === true;
  const start=provider==='google' ? event['start']?.[allDay?'date':'dateTime'] : event['start']?.dateTime;
  const end=provider==='google' ? event['end']?.[allDay?'date':'dateTime'] : event['end']?.dateTime;
  return {title:clean(event[provider==='google'?'summary':'subject']),description:clean(provider==='google'?event['description']:event['body']?.content),
    start:allDay?day(start):instant(start),end:allDay?day(end):instant(end),allDay,
    free:provider==='google'?event['transparency']==='transparent':event['showAs']==='free',
    reminders:provider==='google' ? !!(event['reminders']?.useDefault || event['reminders']?.overrides?.length) : event['isReminderOn']===true,
    location:clean(provider==='google'?event['location']:event['location']?.displayName),
    extra:!!(event['attendees']?.length || event['recurrence'] || event['conferenceData'] || event['isOnlineMeeting'])};
}
export function fieldsFromIcs(ics:string): Fields {
  const event=new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!);
  const start=event.startDate, end=event.endDate ?? start;
  const allDay=start.isDate;
  const s=allDay?start.toString():start.toJSDate().toISOString();
  // Google verlangt eine positive Dauer. Reine Zeitpunkte erscheinen eine Minute lang.
  const e=allDay?end.toString():new Date(Math.max(end.toJSDate().getTime(),start.toJSDate().getTime()+60_000)).toISOString();
  return {title:clean(event.summary),description:clean(event.description),start:s,end:e,allDay,free:true,reminders:false,location:'',extra:false};
}
export function eventPayload(provider:CloudProvider,uid:string,f:Fields): Json {
  if (provider==='google') return { summary:f.title,description:f.description,start:{[f.allDay?'date':'dateTime']:f.start},end:{[f.allDay?'date':'dateTime']:f.end},
    transparency:'transparent',reminders:{useDefault:false},extendedProperties:{private:{soteUid:uid}} };
  return {subject:f.title,body:{contentType:'text',content:f.description},isAllDay:f.allDay,
    start:{dateTime:f.allDay?f.start+'T00:00:00':f.start.replace('Z',''),timeZone:'UTC'},end:{dateTime:f.allDay?f.end+'T00:00:00':f.end.replace('Z',''),timeZone:'UTC'},
    showAs:'free',isReminderOn:false,singleValueExtendedProperties:[{id:PROPERTY,value:uid}]};
}
export function readCloudEvent(provider:CloudProvider,event:Json): FeedEvent | undefined {
  if (event['status']==='cancelled' || event['isCancelled']) return undefined;
  const f=eventFields(provider,event);
  const remoteId=event['id']; if (typeof remoteId !== 'string' || !remoteId) throw new CalDavError('Ein Kalendertermin enthält keine Kennung.');
  return {uid:ownUid(provider,event) ?? remoteId,recurrenceId:'',title:f.title || '(ohne Titel)',
    start:new Date(f.allDay?f.start+'T00:00:00Z':f.start),end:new Date(f.allDay?f.end+'T00:00:00Z':f.end),allDay:f.allDay,location:f.location || null};
}
export class CloudCalendar {
  constructor(readonly pool:Pool,readonly access:CloudAccess,readonly fetcher:typeof fetch=fetch,readonly db?:PoolClient) {}
  private get root() { return ROOT[this.access.provider]; }
  private get calendarPath() { return this.access.provider==='google' ? `/calendars/${enc(this.access.calendarId)}` : `/me/calendars/${enc(this.access.calendarId)}`; }
  async request(path:string,method='GET',body?:Json,etag?:string) {
    const url=new URL(path.startsWith('https:')?path:this.root+path);
    if (url.origin !== new URL(this.root).origin || !url.pathname.startsWith(new URL(this.root).pathname+'/') || url.username || url.password || url.hash) throw new CalDavError('Ungültige Kalender-Weiterleitung.');
    const token=await cloudToken(this.pool,this.access,this.fetcher,this.db);
    return fetchCloudJson(url.href,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',
      ...(this.access.provider==='microsoft'?{Prefer:'outlook.timezone="UTC", outlook.body-content-type="text", IdType="ImmutableId"'}:{}),...(etag?{'if-match':etag}:{})},
      ...(body?{body:JSON.stringify(body)}:{})},this.fetcher);
  }
  private async pages(path:string,limit:number): Promise<Json[]> {
    const out:Json[]=[]; const seen=new Set<string>(); const initial=new URL(this.root+path);
    for (let page=0;page<30;page++) {
      if (seen.has(path)) throw new CalDavError('Der Kalenderanbieter wiederholt dieselbe Ergebnisseite.'); seen.add(path);
      const res=await this.request(path); if (res.status!==200) failed(res.status);
      const items=res.data[this.access.provider==='google'?'items':'value'];
      if (!Array.isArray(items) || items.some(i=>!i||typeof i!=='object'||Array.isArray(i))) throw new CalDavError('Unvollständige Kalenderliste.');
      out.push(...items); if(out.length>limit) throw new CalDavError('Zu viele Kalendereinträge. Bitte die Kalenderauswahl eingrenzen.');
      if(this.access.provider==='google') {
        if(!res.data['nextPageToken']) return out;
        const next=new URL(initial);next.searchParams.set('pageToken',String(res.data['nextPageToken']));path=next.href;
      } else {
        if(!res.data['@odata.nextLink']) return out;
        const next=new URL(String(res.data['@odata.nextLink']));
        if(next.origin!==initial.origin || next.pathname!==initial.pathname) throw new CalDavError('Ungültige Kalender-Folgeseite.');path=next.href;
      }
    }
    throw new CalDavError('Zu viele Ergebnisseiten beim Kalenderabruf.');
  }
  async calendars(): Promise<CloudCalendarInfo[]> {
    const items=await this.pages(this.access.provider==='google'?'/users/me/calendarList?maxResults=250':'/me/calendars?$top=100',1000);
    return items.filter(e=>this.access.provider!=='google'||e['accessRole']!=='freeBusyReader').map(e=>{
      if(typeof e['id']!=='string') throw new CalDavError('Kalender ohne Kennung empfangen.');
      return {id:e['id'],name:String(e[this.access.provider==='google'?'summary':'name']??'Kalender').slice(0,120),
        writable:this.access.provider==='google'?['owner','writer'].includes(e['accessRole']):e['canEdit']===true};
    });
  }
  async check(write=false): Promise<CloudCalendarInfo> {
    const found=(await this.calendars()).find(c=>c.id===this.access.calendarId);
    if(!found) throw new CalDavError('Dieser Kalender ist für das Konto nicht verfügbar.');
    if(write&&!found.writable) throw new CalDavError('Für diesen Kalender fehlen Schreibrechte.');return found;
  }
  async read(from:Date,to:Date): Promise<FeedEvent[]> {
    const query=this.access.provider==='google'?new URLSearchParams({timeMin:from.toISOString(),timeMax:to.toISOString(),singleEvents:'true',maxResults:'2500',showDeleted:'false'})
      :new URLSearchParams({startDateTime:from.toISOString(),endDateTime:to.toISOString(),'$top':'500','$expand':`singleValueExtendedProperties($filter=id eq '${PROPERTY}')`});
    const items=await this.pages(`${this.calendarPath}/${this.access.provider==='google'?'events':'calendarView'}?${query}`,2000);
    return items.flatMap(e=>{const out=readCloudEvent(this.access.provider,e);return out?[out]:[];});
  }
  private eventPath(id:string) { return `${this.calendarPath}/events/${enc(id)}`; }
  private expand() { return this.access.provider==='microsoft'?`?$expand=${enc(`singleValueExtendedProperties($filter=id eq '${PROPERTY}')`)}`:''; }
  async current(entry:Entry): Promise<Json | undefined> {
    let id=entry.remote_id ?? (this.access.provider==='google'?entry.uid:undefined);
    if(!id) {
      const q=new URLSearchParams({'$filter':`singleValueExtendedProperties/Any(ep: ep/id eq '${PROPERTY}' and ep/value eq '${entry.uid}')`,'$expand':`singleValueExtendedProperties($filter=id eq '${PROPERTY}')`});
      const matches=await this.pages(`${this.calendarPath}/events?${q}`,2);
      if(matches.length>1) throw conflict(); if(!matches.length)return undefined; id=String(matches[0]!['id']);
    }
    const res=await this.request(this.eventPath(id)+this.expand());
    if(res.status===404||res.status===410||res.data['status']==='cancelled')return undefined;
    if(res.status!==200)failed(res.status);
    if(ownUid(this.access.provider,res.data)!==entry.uid)throw conflict();
    await (this.db??this.pool).query('UPDATE calendar_write_events SET remote_id=$3 WHERE writer_id=$1 AND uid=$2',[entry.writer_id,entry.uid,id]);
    return res.data;
  }
  async put(entry:Entry,ics:string): Promise<string> {
    const fields=fieldsFromIcs(ics); const current=await this.current(entry);
    if(current) {
      const tag=etagOf(current);
      if(hash(JSON.stringify(eventFields(this.access.provider,current)))===hash(JSON.stringify(fields))) return tag;
      if(entry.etag===null||entry.etag!==tag)throw conflict();
    } else if(entry.etag!==null) throw conflict();
    const payload=eventPayload(this.access.provider,entry.uid,fields);
    const creating=!current;
    if(creating) { if(this.access.provider==='google')payload['id']=entry.uid;else payload['transactionId']=entry.uid; }
    const res=await this.request(creating?`${this.calendarPath}/events`:this.eventPath(String(current!['id'])),creating?'POST':'PATCH',payload,current?etagOf(current):undefined);
    if(res.status===409||res.status===412)throw conflict();
    if(![200,201].includes(res.status))failed(res.status);
    if(typeof res.data['id']!=='string')throw new CalDavError('Der Anbieter hat das Schreiben nicht vollständig bestätigt.');
    const tag=etagOf(res.data);
    await (this.db??this.pool).query('UPDATE calendar_write_events SET remote_id=$3 WHERE writer_id=$1 AND uid=$2',[entry.writer_id,entry.uid,res.data['id']]);
    return tag;
  }
  async remove(entry:Entry): Promise<void> {
    const current=await this.current(entry);if(!current)return;
    if(entry.etag===null||entry.etag!==etagOf(current))throw conflict();
    const res=await this.request(this.eventPath(String(current['id'])),'DELETE',undefined,etagOf(current));
    if(res.status===412)throw conflict();if(![200,204,404,410].includes(res.status))failed(res.status);
  }
  async accept(entry:Entry): Promise<string|null> {const current=await this.current(entry);return current?etagOf(current):null;}
}
export async function createCloudSource(pool:Pool,userId:string,accountId:string,calendarId:string,name:string,fetcher:typeof fetch=fetch): Promise<string> {
  if(!calendarId || calendarId.length>2048)throw new CalDavError('Bitte einen Kalender auswählen.');
  const provider=await accountProvider(pool,userId,accountId);
  const selected=await new CloudCalendar(pool,{provider,accountId,calendarId},fetcher).check();
  const db=await pool.connect();
  try {
    await db.query('BEGIN');await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const existing=await queryOne<{id:string}>(db,'SELECT id FROM calendar_sources WHERE user_id=$1 AND oauth_account_id=$2 AND remote_calendar_id=$3',[userId,accountId,calendarId]);
    if(existing){await db.query('COMMIT');return existing.id;}
    const count=await queryOne<{n:string}>(db,'SELECT count(*) AS n FROM calendar_sources WHERE user_id=$1',[userId]);
    if(Number(count?.n)>=12)throw new CalDavError('Höchstens 12 Kalender können verbunden werden.');
    const source=await queryOne<{id:string}>(db,`INSERT INTO calendar_sources (user_id,name,color,url_sealed,connection_kind,oauth_account_id,remote_calendar_id)
      VALUES ($1,$2,'blue',$3,$4,$5,$6) RETURNING id`,[userId,(name.trim()||selected.name).slice(0,120),seal(ROOT[provider]),provider,accountId,calendarId]);
    await db.query('COMMIT');return source!.id;
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
