/** OAuth ist an die anfordernde SOTE-Sitzung gebunden; Tokens verlassen nie den Server. */
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { queryOne, queryRows } from './db.js';
import { baseUrl } from './env.js';
import { keyPresent, seal, unseal } from './secretbox.js';
import { CalDavError } from './caldav.js';

export type CloudProvider = 'google' | 'microsoft';
export const isCloudProvider = (p: unknown): p is CloudProvider => p === 'google' || p === 'microsoft';
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scopes = {
  google: 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events',
  microsoft: 'openid offline_access User.Read Calendars.ReadWrite',
};
export function cloudConfig(provider: CloudProvider) {
  const clientId = (provider === 'google' ? process.env['SOTE_GOOGLE_CALENDAR_CLIENT_ID'] : process.env['SOTE_MICROSOFT_CALENDAR_CLIENT_ID'])?.trim();
  const secret = (provider === 'google' ? process.env['SOTE_GOOGLE_CALENDAR_CLIENT_SECRET'] : process.env['SOTE_MICROSOFT_CALENDAR_CLIENT_SECRET'])?.trim();
  const tenant = process.env['SOTE_MICROSOFT_CALENDAR_TENANT']?.trim() || 'common';
  if (!/^(?:common|organizations|consumers|[0-9a-f-]{36}|[a-zA-Z0-9.-]+)$/.test(tenant)) throw new CalDavError('Ungültiger Microsoft-Mandant in der Serverkonfiguration.');
  const base = baseUrl();
  if (!clientId || !secret || !base || !keyPresent()) return undefined;
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return undefined;
  return { clientId, secret, redirect: `${base}/api/calendar-accounts/${provider}/callback`, scope: scopes[provider],
    authorize: provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: provider === 'google' ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token` };
}
export function cloudAvailability() {
  return Object.fromEntries((['google','microsoft'] as const).map(p => [p, {
    ready: !!cloudConfig(p), callback: baseUrl() ? `${baseUrl()}/api/calendar-accounts/${p}/callback` : null,
  }]));
}
export type Json = Record<string, any>;
/** Begrenzte JSON-Antwort, keine Redirects und keine fremden Antworttexte in Fehlern. */
export async function fetchCloudJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<{ status: number; data: Json }> {
  try {
    const res = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    let size = 0; const chunks: Uint8Array[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new CalDavError('Die Kalenderantwort ist zu groß.'); } chunks.push(part.value);
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const data: unknown = text ? JSON.parse(text) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return { status: res.status, data: data as Json };
  } catch (e) { if (e instanceof CalDavError) throw e; throw new CalDavError('Der Kalenderanbieter ist nicht erreichbar oder liefert keine lesbare Antwort.'); }
}
interface Tokens { access: string; refresh: string; expires: number }
function tokens(data: Json, prior?: Tokens): Tokens {
  if (typeof data['access_token'] !== 'string' || !data['access_token'] || typeof (data['refresh_token'] ?? prior?.refresh) !== 'string' || !(data['refresh_token'] ?? prior?.refresh)) {
    throw new CalDavError('Keine dauerhafte Kalenderfreigabe erhalten. Bitte erneut anmelden und den Zugriff erlauben.');
  }
  const expires = Number(data['expires_in']);
  if (!Number.isFinite(expires) || expires <= 0) throw new CalDavError('Der Anbieter liefert keine gültige Token-Laufzeit.');
  return { access: data['access_token'], refresh: data['refresh_token'] ?? prior!.refresh, expires: Date.now() + expires * 1000 };
}
export async function beginCloudLogin(pool: Pool, userId: string, session: string, provider: CloudProvider, now = new Date()): Promise<string> {
  const cfg = cloudConfig(provider);
  if (!cfg) throw new CalDavError('Die Administration muss die Kalender-App für diesen Anbieter zuerst konfigurieren.');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  await pool.query('DELETE FROM calendar_oauth_flows WHERE expires_at < $1 OR (user_id=$2 AND provider=$3)', [now,userId,provider]);
  await pool.query('INSERT INTO calendar_oauth_flows (state_hash,user_id,session_hash,provider,verifier_sealed,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [hash(state),userId,hash(session),provider,seal(verifier),new Date(now.getTime()+10*60_000)]);
  const url = new URL(cfg.authorize);
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirect, response_type:'code', scope:cfg.scope, state,
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',
    ...(provider === 'google' ? { access_type:'offline',prompt:'consent select_account' } : { prompt:'select_account',response_mode:'query' }) }).toString();
  return url.href;
}
export async function finishCloudLogin(pool: Pool, userId: string, session: string, provider: CloudProvider, state: string, code: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<string> {
  const cfg = cloudConfig(provider); if (!cfg) throw new CalDavError('Kalender-App nicht konfiguriert.');
  if (!state || !code || state.length > 200 || code.length > 8192) throw new CalDavError('Die Kalenderanmeldung ist ungültig. Bitte neu starten.');
  const flow = await queryOne<{ verifier_sealed: string }>(pool,
    'DELETE FROM calendar_oauth_flows WHERE state_hash=$1 AND user_id=$2 AND session_hash=$3 AND provider=$4 AND expires_at>$5 RETURNING verifier_sealed',
    [hash(state),userId,hash(session),provider,now]);
  const verifier = flow && unseal(flow.verifier_sealed);
  if (!verifier) throw new CalDavError('Die Kalenderanmeldung ist abgelaufen oder gehört zu einer anderen Sitzung. Bitte neu starten.');
  const result = await fetchCloudJson(cfg.token, { method:'POST',body:new URLSearchParams({ client_id:cfg.clientId,client_secret:cfg.secret,redirect_uri:cfg.redirect,grant_type:'authorization_code',code,code_verifier:verifier }) }, fetcher);
  if (result.status !== 200) throw new CalDavError('Die Kalenderanmeldung wurde abgelehnt. Bitte erneut anmelden.');
  const granted = String(result.data['scope'] ?? '').split(' ');
  const required = provider === 'google' ? ['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events'] : ['Calendars.ReadWrite','User.Read'];
  if (required.some(s => !granted.includes(s))) throw new CalDavError('Die benötigten Kalenderberechtigungen wurden nicht vollständig freigegeben.');
  const saved = tokens(result.data);
  const profile = await fetchCloudJson(provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
    {headers:{authorization:`Bearer ${saved.access}`}},fetcher);
  const subject = profile.data[provider === 'google' ? 'sub' : 'id'];
  if (profile.status !== 200 || typeof subject !== 'string' || !subject) throw new CalDavError('Das Kalenderkonto konnte nicht erkannt werden.');
  const label = String(profile.data['email'] ?? profile.data['mail'] ?? profile.data['userPrincipalName'] ?? profile.data['displayName'] ?? provider).slice(0,200);
  const row = await queryOne<{id:string}>(pool, `INSERT INTO calendar_accounts (user_id,provider,subject,label,tokens_sealed) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id,provider,subject) DO UPDATE SET label=$4,tokens_sealed=$5,last_error=NULL RETURNING id`, [userId,provider,subject,label,seal(JSON.stringify(saved))]);
  return row!.id;
}
export async function listCloudAccounts(pool: Pool, userId: string) {
  return queryRows<{id:string;provider:CloudProvider;label:string;lastError:string|null}>(pool,
    'SELECT id,provider,label,last_error AS "lastError" FROM calendar_accounts WHERE user_id=$1 ORDER BY created_at',[userId]);
}
export interface CloudAccess { provider: CloudProvider; accountId: string; calendarId: string }
export async function accountProvider(db: Pool | PoolClient, userId: string, accountId: string): Promise<CloudProvider> {
  const row = await queryOne<{provider:CloudProvider}>(db,'SELECT provider FROM calendar_accounts WHERE id=$1 AND user_id=$2',[accountId,userId]);
  if (!row) throw new CalDavError('Dieses Kalenderkonto gibt es nicht.'); return row.provider;
}
/** Der Zeilenlock verhindert parallele Erneuerungen rotierender Refresh-Tokens. */
export async function cloudToken(pool: Pool, access: CloudAccess, fetcher: typeof fetch = fetch, lockedDb?: PoolClient): Promise<string> {
  const db = lockedDb ?? await pool.connect();
  try {
    await db.query('BEGIN');
    const row = await queryOne<{tokens_sealed:string}>(db,'SELECT tokens_sealed FROM calendar_accounts WHERE id=$1 AND provider=$2 FOR UPDATE',[access.accountId,access.provider]);
    const plain = row && unseal(row.tokens_sealed);
    if (!plain) throw new CalDavError('Kalenderkonto getrennt oder Zugang nicht entschlüsselbar. Bitte erneut anmelden.');
    let current = JSON.parse(plain) as Tokens;
    if (current.expires <= Date.now()+60_000) {
      const cfg = cloudConfig(access.provider); if (!cfg) throw new CalDavError('Die Kalender-App ist nicht mehr konfiguriert.');
      const result = await fetchCloudJson(cfg.token,{method:'POST',body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.secret,grant_type:'refresh_token',refresh_token:current.refresh})},fetcher);
      if (result.status !== 200) throw new CalDavError('Der Kalenderzugriff ist abgelaufen oder widerrufen. Bitte das Konto erneut anmelden.');
      current = tokens(result.data,current);
      await db.query('UPDATE calendar_accounts SET tokens_sealed=$2,last_error=NULL WHERE id=$1',[access.accountId,seal(JSON.stringify(current))]);
    }
    await db.query('COMMIT'); return current.access;
  } catch (e) {
    await db.query('ROLLBACK');
    await db.query('UPDATE calendar_accounts SET last_error=$2 WHERE id=$1',[access.accountId,e instanceof CalDavError ? e.message : 'Kalenderzugang konnte nicht erneuert werden.']);
    throw e;
  } finally { if (!lockedDb) db.release(); }
}
