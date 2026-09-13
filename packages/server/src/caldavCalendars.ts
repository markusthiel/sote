/** Anbieteroffene CalDAV-Suche und privater Kalenderabruf. */
import { DOMParser, type Element } from '@xmldom/xmldom';
import { calendarUrl, CalDavError, davFailure, davRequest, type CalDavCredentials, type DavTransport } from './caldav.js';
import { discoverICloudCalendars } from './icloudCalDav.js';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const children = (el: Element, ns: string, name: string): Element[] =>
  Array.from({ length: el.childNodes.length }, (_, i) => el.childNodes.item(i))
    .filter((n): n is Element => n?.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === name);
function responses(xml: string): Element[] {
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error();
    const doc = new DOMParser({ onError: () => { throw new Error(); } }).parseFromString(xml, 'application/xml');
    const root = doc.documentElement!;
    if (root.namespaceURI !== DAV || root.localName !== 'multistatus') throw new Error();
    return children(root, DAV, 'response');
  } catch { throw new CalDavError('Der Kalenderdienst hat keine lesbare CalDAV-Antwort geliefert.'); }
}
function property(response: Element, ns: string, name: string): Element | undefined {
  for (const stat of children(response, DAV, 'propstat')) {
    if (!/^HTTP\/\S+\s+200(?:\s|$)/.test(children(stat, DAV, 'status')[0]?.textContent?.trim() ?? '')) continue;
    for (const prop of children(stat, DAV, 'prop')) {
      const found = children(prop, ns, name)[0];
      if (found) return found;
    }
  }
  return undefined;
}

export function readCalDavCredentials(raw: Record<string, unknown>): CalDavCredentials {
  const username = typeof raw['username'] === 'string' ? raw['username'].trim() : '';
  const password = typeof raw['password'] === 'string' ? raw['password'].trim() : '';
  if (!username || !password || username.length > 4096 || password.length > 4096 || /[:\r\n]/.test(username) || /[\r\n]/.test(password)) {
    throw new CalDavError('Benutzername und App-Passwort eintragen.');
  }
  return { url: calendarUrl(String(raw['url'] ?? '')), username, password };
}

export interface DiscoveredCalendar { url: string; name: string; writable: boolean | null }
export async function discoverCalDavCalendars(raw: Record<string, unknown>, transport: DavTransport = davRequest): Promise<DiscoveredCalendar[]> {
  if (raw['provider'] === 'icloud') return (await discoverICloudCalendars(raw, transport, true)).map((c) => ({ ...c, writable: c.writable ?? null }));
  const start = String(raw['url'] ?? '').trim();
  const credentials = readCalDavCredentials({ ...raw, url: start.endsWith('/') ? start : start + '/' });
  const origin = new URL(credentials.url).origin;
  const target = (rawUrl: string, base: string) => {
    let url: URL;
    try { url = new URL(rawUrl, base); }
    catch { throw new CalDavError('Der Kalenderdienst hat eine ungültige Kalenderadresse geliefert.'); }
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) throw new CalDavError('Der Dienst verweist auf einen anderen Server. Bitte dessen endgültige CalDAV-Adresse eintragen.');
    return url.href;
  };
  let calls = 0;
  async function props(rawUrl: string, depth = '0'): Promise<{ url: string; items: Element[] }> {
    let url = target(rawUrl, credentials.url);
    while (++calls <= 12) {
      const result = await transport(url, { ...credentials, url: origin + '/' }, 'PROPFIND',
        `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`, { depth });
      if ([301,302,303,307,308].includes(result.status) && result.location) { url = target(result.location, url); continue; }
      if (result.status !== 207) {
        if (calls === 1 && [404,405].includes(result.status)) { url = origin + '/.well-known/caldav'; continue; }
        throw davFailure(result.status);
      }
      return { url, items: responses(result.body) };
    }
    throw new CalDavError('Die Kalendersuche benötigt zu viele Weiterleitungen oder Ordner.');
  }
  function calendars(result: Awaited<ReturnType<typeof props>>): DiscoveredCalendar[] {
    return result.items.flatMap((item) => {
      const resource = property(item, DAV, 'resourcetype');
      if (!resource || !children(resource, CAL, 'calendar').length) return [];
      const components = property(item, CAL, 'supported-calendar-component-set');
      if (components && !children(components, CAL, 'comp').some((c) => c.getAttribute('name') === 'VEVENT')) return [];
      const href = children(item, DAV, 'href')[0]?.textContent?.trim();
      if (!href) return [];
      const found = target(href, result.url);
      const privileges = property(item, DAV, 'current-user-privilege-set');
      const has = (name: string) => privileges?.getElementsByTagNameNS(DAV, name).length;
      return [{ url: calendarUrl(found.endsWith('/') ? found : found + '/'),
        name: property(item, DAV, 'displayname')?.textContent?.trim().slice(0, 120) || 'Kalender',
        writable: privileges ? !!(has('all') || has('write') || (has('write-content') && has('bind') && has('unbind'))) : null }];
    });
  }
  function links(result: Awaited<ReturnType<typeof props>>, ns: string, name: string): string[] {
    const item = result.items.find((r) => {
      const href = children(r, DAV, 'href')[0]?.textContent?.trim();
      return href && target(href, result.url).replace(/\/$/, '') === result.url.replace(/\/$/, '');
    });
    const prop = item && property(item, ns, name);
    return prop ? children(prop, DAV, 'href').map((h) => target(h.textContent?.trim() ?? '', result.url)) : [];
  }
  const root = await props(credentials.url);
  const direct = calendars(root);
  if (direct.length) return direct;
  let homes = links(root, CAL, 'calendar-home-set');
  if (!homes.length) {
    const principal = links(root, DAV, 'current-user-principal')[0];
    if (principal) homes = links(await props(principal), CAL, 'calendar-home-set');
  }
  // Eine eingegebene Kalender-Heimat kann direkt Unterkalender enthalten.
  if (!homes.length) homes = [root.url];
  if (homes.length > 5) throw new CalDavError('Der Dienst meldet zu viele Kalenderordner.');
  const found = new Map<string, DiscoveredCalendar>();
  for (const home of new Set(homes)) for (const calendar of calendars(await props(home, '1'))) found.set(calendar.url, calendar);
  if (!found.size) throw new CalDavError('Keine Terminkalender gefunden. Bitte die CalDAV-Adresse des Anbieters prüfen.');
  if (found.size > 100) throw new CalDavError('Mehr als 100 Kalender gefunden. Bitte eine genauere Adresse eintragen.');
  return [...found.values()].sort((a,b) => a.name.localeCompare(b.name, 'de'));
}

export async function readCalDavCalendar(credentials: CalDavCredentials, from: Date, to: Date, transport: DavTransport = davRequest): Promise<string[]> {
  const stamp = (d: Date) => d.toISOString().slice(0,19).replace(/[-:]/g, '') + 'Z';
  const res = await transport(calendarUrl(credentials.url), credentials, 'REPORT',
    `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, { depth: '1' });
  if (res.status !== 207) throw davFailure(res.status);
  const items = responses(res.body);
  if (items.length > 1000) throw new CalDavError('Der Kalender enthält zu viele Einträge im Abrufzeitraum.');
  return items.map((item) => {
    const data = property(item, CAL, 'calendar-data');
    if (!data?.textContent) throw new CalDavError('Der Kalenderdienst hat einen Eintrag nicht vollständig geliefert.');
    return data.textContent;
  });
}
