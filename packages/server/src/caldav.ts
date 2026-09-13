/** CalDAV-Transport: direkte Kalenderadresse, HTTPS, keine Weitergabe von Zugangsdaten bei Redirects. */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import ICAL from 'ical.js';

export class CalDavError extends Error {}
export class CalDavConflict extends CalDavError {}
export interface CalDavCredentials { url: string; username: string; password: string }
export interface DavResponse { status: number; body: string; etag: string | null; location?: string; server?: string }
export type DavTransport = (url: string, credentials: CalDavCredentials, method: string,
  body?: string, headers?: Record<string, string>) => Promise<DavResponse>;

export function calendarUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new CalDavError('Die CalDAV-Adresse ist ungültig.'); }
  if (url.protocol === 'webcal:' || (/^(?:p\d+-)?caldav\.icloud\.com$/i.test(url.hostname) && url.pathname.startsWith('/published/'))) {
    throw new CalDavError('Diese Adresse ist ein Kalender-Leselink. Auch mit HTTPS erlaubt er kein Schreiben. Für iCloud bitte Apple Account und App-Kennwort eintragen und „iCloud-Kalender suchen“ wählen.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new CalDavError('Eine HTTPS-Adresse des Kalenderordners angeben, mit abschließendem / und ohne Abfrage oder eingebettetes Kennwort.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new CalDavError('Lokale Kalenderadressen sind nicht erlaubt.');
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !publicAddress(literal)) throw new CalDavError('Lokale Kalenderadressen sind nicht erlaubt.');
  return url.href;
}

/** Nur öffentlich routbare Adressen. DNS wird geprüft UND für die Verbindung festgehalten. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)));
  }
  // Global Unicast; schließt insbesondere IPv4-Mapping, Loopback und ULA aus.
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2002:|^2001:(?:0*:|db8:|0?2[0-9a-f]:)/i.test(address);
  return false;
}

export const davRequest: DavTransport = async (raw, credentials, method, body = '', headers = {}) => {
  const url = new URL(raw);
  const base = calendarUrl(credentials.url);
  if (!url.href.startsWith(base) || url.origin !== new URL(base).origin) throw new CalDavError('Die Zieladresse gehört nicht zu diesem Kalender.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = await lookup(host, { all: true }); } catch { throw new CalDavError('Der Kalenderdienst ist nicht erreichbar.'); }
  if (addresses.length === 0 || addresses.some((a) => !publicAddress(a.address))) throw new CalDavError('Der Kalenderdienst zeigt auf eine nicht öffentliche Adresse.');
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const fail = (message: string) => reject(new CalDavError(message));
    const req = request(url, {
      method,
      // Kein erneuter DNS-Aufruf zwischen Prüfung und Verbindung (DNS-Rebinding).
      lookup: ((_host: string, _options: unknown, callback: (err: null, result: unknown, family?: number) => void) => {
        if ((_options as { all?: boolean }).all) callback(null, [address]);
        else callback(null, address.address, address.family);
      }) as NonNullable<Parameters<typeof request>[1]>['lookup'],
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
        'content-type': method === 'PROPFIND' ? 'application/xml; charset=utf-8' : 'text/calendar; charset=utf-8',
        'content-length': Buffer.byteLength(body), ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { req.destroy(); fail('Die Antwort des Kalenderdienstes ist zu groß.'); }
        else chunks.push(chunk);
      });
      res.on('error', () => fail('Die Verbindung zum Kalenderdienst ist abgebrochen.'));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), etag: res.headers.etag ?? null,
        ...(res.headers.location ? { location: res.headers.location } : {}),
        ...(typeof res.headers.server === 'string' ? { server: res.headers.server } : {}) }));
    });
    const timer = setTimeout(() => { req.destroy(); fail('Der Kalenderdienst antwortet nicht rechtzeitig.'); }, 10_000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => fail('Der Kalenderdienst ist nicht erreichbar oder die TLS-Verbindung ist fehlgeschlagen.'));
    req.end(body);
  });
};

export function davFailure(status: number): CalDavError {
  if (status === 401) return new CalDavError('Anmeldung abgelehnt. Benutzername und App-Kennwort prüfen.');
  if (status === 403) return new CalDavError('Der Kalenderdienst erlaubt diesen Zugriff nicht.');
  if (status >= 300 && status < 400) return new CalDavError('Der Kalenderdienst leitet weiter. Bitte die endgültige CalDAV-Kalenderadresse verwenden.');
  if (status === 412) return new CalDavConflict('Konflikt: Ein Eintrag wurde außerhalb von SOTE geändert. Die fremde Änderung bleibt erhalten.');
  return new CalDavError(`Der Kalenderdienst antwortet mit HTTP ${status}.`);
}

export async function checkCalendar(credentials: CalDavCredentials, transport: DavTransport = davRequest): Promise<void> {
  const res = await transport(calendarUrl(credentials.url), credentials, 'PROPFIND',
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>', { depth: '0' });
  if (res.status !== 207) throw davFailure(res.status);
  if (/<!DOCTYPE|<!ENTITY/i.test(res.body)) throw new CalDavError('Ungültige XML-Antwort des Kalenderdienstes.');
  try {
    const doc = new DOMParser({ onError: () => { throw new Error('XML'); } }).parseFromString(res.body, 'application/xml');
    const responses = doc.getElementsByTagNameNS('DAV:', 'response');
    for (let i = 0; i < responses.length; i++) {
      const response = responses.item(i)!;
      const href = response.getElementsByTagNameNS('DAV:', 'href').item(0)?.textContent;
      if (!href || new URL(href, credentials.url).href !== credentials.url) continue;
      const propstats = response.getElementsByTagNameNS('DAV:', 'propstat');
      let calendar = false;
      let supported = true;
      let writable = true;
      for (let p = 0; p < propstats.length; p++) {
        const propstat = propstats.item(p)!;
        if (!/\s200\s/.test(propstat.getElementsByTagNameNS('DAV:', 'status').item(0)?.textContent ?? '')) continue;
        if (propstat.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'calendar').length) calendar = true;
        const componentSet = propstat.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'supported-calendar-component-set').item(0);
        if (componentSet) {
          const comps = componentSet.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'comp');
          supported = Array.from({ length: comps.length }, (_, n) => comps.item(n)?.getAttribute('name')).includes('VEVENT');
        }
        const privileges = propstat.getElementsByTagNameNS('DAV:', 'current-user-privilege-set').item(0);
        if (privileges) writable = ['all', 'write'].some((name) => privileges.getElementsByTagNameNS('DAV:', name).length > 0) ||
          ['write-content', 'bind', 'unbind'].every((name) => privileges.getElementsByTagNameNS('DAV:', name).length > 0);
      }
      if (!calendar) throw new CalDavError('Diese Adresse ist kein CalDAV-Kalenderordner.');
      if (!supported) throw new CalDavError('Dieser Kalender unterstützt keine Termine (VEVENT).');
      if (!writable) throw new CalDavError('Für diesen Kalender fehlen Schreibrechte.');
      return;
    }
    throw new CalDavError('Die Antwort enthält den gewählten Kalender nicht.');
  } catch (e) { throw e instanceof CalDavError ? e : new CalDavError('Unverständliche XML-Antwort des Kalenderdienstes.'); }
}

/** Vergleich für Wiederholungen nach verloren gegangener PUT-Antwort; Reihenfolge ist unerheblich. */
export function eventFingerprint(ics: string): string {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  const events = calendar.getAllSubcomponents('vevent');
  if (events.length !== 1) throw new CalDavError('Ein CalDAV-Eintrag muss genau einen Termin enthalten.');
  const event = events[0]!;
  const props = event.getAllProperties().filter((p) => !['dtstamp', 'created', 'last-modified'].includes(p.name))
    .map((p) => JSON.stringify(p.toJSON())).sort();
  const children = event.getAllSubcomponents().map((c) => JSON.stringify(c.toJSON())).sort();
  return createHash('sha256').update(JSON.stringify([props, children])).digest('hex');
}

export function eventUid(ics: string): string {
  try {
    const events = new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent');
    if (events.length !== 1) throw new Error('VEVENT');
    return String(events[0]!.getFirstPropertyValue('uid') ?? '');
  } catch { throw new CalDavError('Die Kalenderressource enthält nicht genau einen lesbaren Termin.'); }
}

export const strongEtag = (value: string | null): value is string =>
  value !== null && value.length <= 1024 && /^"[^"\r\n]+"$/.test(value);
