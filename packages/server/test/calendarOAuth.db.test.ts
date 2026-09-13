import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { makePool, queryOne } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { beginCloudLogin, cloudConfig, cloudToken, finishCloudLogin, listCloudAccounts, type CloudProvider } from '../src/calendarOAuth.js';
import { seal, unseal } from '../src/secretbox.js';
let pool:Pool;
before(async()=>{
  process.env['SOTE_SHARE_KEY']='b'.repeat(64);process.env['SOTE_BASE_URL']='https://sote.example';
  process.env['SOTE_GOOGLE_CALENDAR_CLIENT_ID']='google-client';process.env['SOTE_GOOGLE_CALENDAR_CLIENT_SECRET']='google-secret';
  process.env['SOTE_MICROSOFT_CALENDAR_CLIENT_ID']='microsoft-client';process.env['SOTE_MICROSOFT_CALENDAR_CLIENT_SECRET']='microsoft-secret';
  pool=makePool(process.env['SOTE_TEST_DATABASE_URL']??'postgres://sote:sote@127.0.0.1:5433/sote_test');await migrate(pool);
});
after(async()=>pool.end());
const user=async()=> (await queryOne<{id:string}>(pool,"INSERT INTO users(email,display_name) VALUES ($1,'OAuth') RETURNING id",[randomUUID()+'@example.com']))!.id;
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
for(const provider of ['google','microsoft'] as const) test(`${provider}: OAuth bindet State/PKCE an Sitzung und Konto; erneute Anmeldung erhält Verbindungen`,async()=>{
  const owner=await user(),other=await user();const login=new URL(await beginCloudLogin(pool,owner,'session',provider));
  assert.equal(login.searchParams.get('code_challenge_method'),'S256');assert.ok(login.searchParams.get('code_challenge'));
  assert.equal(login.searchParams.get('redirect_uri'),`https://sote.example/api/calendar-accounts/${provider}/callback`);
  const state=login.searchParams.get('state')!;let calls=0;
  const fetcher:typeof fetch=async(url,init)=>{
    calls++;assert.equal(init?.redirect,'error');
    if(String(url).includes('/token')){
      assert.ok((init?.body as URLSearchParams).get('code_verifier'));assert.equal((init?.body as URLSearchParams).get('grant_type'),'authorization_code');
      return response({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:cloudConfig(provider)!.scope});
    }
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-access');
    return response(provider==='google'?{sub:'same-subject',email:'calendar@example.com'}:{id:'same-subject',mail:'calendar@example.com'});
  };
  await assert.rejects(()=>finishCloudLogin(pool,other,'session',provider,state,'code',fetcher),/anderen Sitzung/);
  await assert.rejects(()=>finishCloudLogin(pool,owner,'other-session',provider,state,'code',fetcher),/anderen Sitzung/);assert.equal(calls,0);
  const id=await finishCloudLogin(pool,owner,'session',provider,state,'code',fetcher);assert.equal(calls,2);
  await assert.rejects(()=>finishCloudLogin(pool,owner,'session',provider,state,'code',fetcher),/abgelaufen/);assert.equal(calls,2);
  const status=JSON.stringify(await listCloudAccounts(pool,owner));assert.ok(!status.includes('private-access')&&!status.includes('private-refresh'));
  assert.equal((await listCloudAccounts(pool,other)).length,0);
  const next=new URL(await beginCloudLogin(pool,owner,'session',provider));
  assert.equal(await finishCloudLogin(pool,owner,'session',provider,next.searchParams.get('state')!,'code',fetcher),id);
});
test('Abgelaufene oder unvollständig freigegebene OAuth-Anmeldung speichert kein Konto',async()=>{
  const owner=await user();const provider='google';
  const old=new URL(await beginCloudLogin(pool,owner,'session',provider,new Date(Date.now()-11*60_000)));
  const never:typeof fetch=async()=>{throw new Error('Kein Netzaufruf erwartet');};
  await assert.rejects(()=>finishCloudLogin(pool,owner,'session',provider,old.searchParams.get('state')!,'code',never),/abgelaufen/);
  const login=new URL(await beginCloudLogin(pool,owner,'session',provider));
  await assert.rejects(()=>finishCloudLogin(pool,owner,'session',provider,login.searchParams.get('state')!,'code',async()=>response({access_token:'token',refresh_token:'refresh',expires_in:3600,scope:'openid'})),/nicht vollständig/);
  assert.equal((await listCloudAccounts(pool,owner)).length,0);
});
test('Rotierende Refresh-Tokens werden seriell erneuert, verschlüsselt gespeichert und Widerruf bleibt sichtbar',async()=>{
  const owner=await user();const provider:CloudProvider='microsoft';
  const row=await queryOne<{id:string}>(pool,"INSERT INTO calendar_accounts(user_id,provider,subject,label,tokens_sealed) VALUES ($1,$2,'subject','Konto',$3) RETURNING id",[owner,provider,seal(JSON.stringify({access:'old',refresh:'old-refresh',expires:0}))]);
  const access={provider,accountId:row!.id,calendarId:'cal'};let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal((init?.body as URLSearchParams).get('refresh_token'),'old-refresh');return response({access_token:'new',refresh_token:'rotated',expires_in:3600});};
  assert.deepEqual(await Promise.all([cloudToken(pool,access,fetcher),cloudToken(pool,access,fetcher)]),['new','new']);assert.equal(calls,1);
  const saved=(await queryOne<{tokens_sealed:string}>(pool,'SELECT tokens_sealed FROM calendar_accounts WHERE id=$1',[row!.id]))!;
  assert.ok(!saved.tokens_sealed.includes('rotated'));assert.equal(JSON.parse(unseal(saved.tokens_sealed)!).refresh,'rotated');
  await pool.query('UPDATE calendar_accounts SET tokens_sealed=$2 WHERE id=$1',[row!.id,seal(JSON.stringify({access:'old',refresh:'revoked',expires:0}))]);
  await assert.rejects(()=>cloudToken(pool,access,async()=>response({error:'invalid_grant',error_description:'SECRET'},400)),/widerrufen/);
  const status=JSON.stringify(await listCloudAccounts(pool,owner));assert.ok(status.includes('widerrufen'));assert.ok(!status.includes('SECRET'));
});
