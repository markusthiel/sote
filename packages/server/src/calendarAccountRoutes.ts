import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { accountProvider, beginCloudLogin, cloudAvailability, finishCloudLogin, isCloudProvider, listCloudAccounts } from './calendarOAuth.js';
import { CloudCalendar, createCloudSource } from './cloudCalendars.js';
import { CalDavError } from './caldav.js';
import { requestFetchOf } from './calendarSources.js';
import { fail, json, readJson } from './http/respond.js';

/** Ausschließlich hinter der SOTE-Anmeldeschranke aufrufen. */
export async function calendarAccountRoutes(pool:Pool,userId:string,session:string,req:IncomingMessage,res:ServerResponse,url:URL): Promise<boolean> {
  if(!url.pathname.startsWith('/api/calendar-accounts'))return false;
  const path=url.pathname,method=req.method;
  const callback=/^\/api\/calendar-accounts\/(google|microsoft)\/callback$/.exec(path);
  const redirect=(query:Record<string,string>)=>{res.writeHead(303,{location:'/kalender/quellen?'+new URLSearchParams(query),'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();};
  try {
    if(callback&&method==='GET') {
      if(url.searchParams.has('error')){redirect({calendar_error:'Die Kalenderanmeldung wurde abgebrochen oder abgelehnt.'});return true;}
      const provider=callback[1]!;if(!isCloudProvider(provider))throw new CalDavError('Unbekannter Anbieter.');
      const id=await finishCloudLogin(pool,userId,session,provider,url.searchParams.get('state')??'',url.searchParams.get('code')??'');
      redirect({calendar_account:id,calendar_provider:provider});return true;
    }
    if(method!=='GET'&&!req.headers['content-type']?.startsWith('application/json')){fail(res,415,'json_required','Kalenderaktionen benötigen JSON.');return true;}
    if(path==='/api/calendar-accounts'&&method==='GET') {json(res,200,{providers:cloudAvailability(),accounts:await listCloudAccounts(pool,userId)});return true;}
    const login=/^\/api\/calendar-accounts\/(google|microsoft)\/authorize$/.exec(path);
    if(login&&method==='POST') {
      const provider=login[1]!;if(!isCloudProvider(provider))throw new CalDavError('Unbekannter Anbieter.');
      json(res,200,{url:await beginCloudLogin(pool,userId,session,provider)});return true;
    }
    const account=/^\/api\/calendar-accounts\/([0-9a-f-]{36})(\/calendars)?$/.exec(path);
    if(account) {
      const id=account[1]!,provider=await accountProvider(pool,userId,id);
      if(account[2]&&method==='GET'){json(res,200,{calendars:await new CloudCalendar(pool,{provider,accountId:id,calendarId:''}).calendars()});return true;}
      if(account[2]&&method==='POST'){
        const body:unknown=await readJson(req);if(!body||typeof body!=='object'||Array.isArray(body))throw new CalDavError('Ungültige Kalenderauswahl.');
        const b=body as Record<string,unknown>;
        const feedId=await createCloudSource(pool,userId,id,String(b['calendarId']??''),String(b['name']??''));
        await requestFetchOf(pool,userId,feedId,new Date());json(res,201,{id:feedId});return true;
      }
      if(!account[2]&&method==='DELETE'){
        const result=await pool.query('DELETE FROM calendar_accounts a WHERE id=$1 AND user_id=$2 AND NOT EXISTS (SELECT 1 FROM calendar_sources f WHERE f.oauth_account_id=a.id)',[id,userId]);
        if(!result.rowCount)throw new CalDavError('Bitte zuerst die Kalender dieses Kontos aus SOTE entfernen. Bereits übertragene Termine bleiben beim Anbieter.');
        json(res,200,{ok:true});return true;
      }
    }
    fail(res,404,'not_found','Diesen Kalenderzugang gibt es nicht.');
  }catch(e){
    const message=e instanceof CalDavError?e.message:'Der Kalenderzugang konnte nicht eingerichtet werden.';
    if(callback)redirect({calendar_error:message});else fail(res,400,'calendar_account',message);
  }
  return true;
}
