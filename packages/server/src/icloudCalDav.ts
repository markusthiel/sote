/** iCloud: Principal und Kalender ermitteln, ohne öffentliche Freigabelinks umzudeuten. */
import { DOMParser, type Element } from '@xmldom/xmldom';
import { calendarUrl, CalDavError, davFailure, davRequest, type DavTransport } from './caldav.js';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const ROOT = 'https://caldav.icloud.com/';
export interface ICloudCalendar { url: string; name: string; writable?: boolean | null }
type Step = 'Anmeldung' | 'Alternativer Sucheinstieg' | 'Kalenderordner' | 'Kalenderliste';
class ICloudHttpError extends CalDavError {
  constructor(readonly status: number, step: Step, host: string) {
    super(`iCloud-Suche – ${step} (${host}): ${davFailure(status).message}`);
  }
}

/** Nur Apples CalDAV-Hosts, auch bei Hrefs und Weiterleitungen. Nie beliebige iCloud-Subdomains. */
function appleUrl(raw: string, base: string): string {
  let url: URL;
  try { url = new URL(raw, base); } catch { throw new CalDavError('iCloud hat eine ungültige Kalenderadresse geliefert.'); }
  if (url.protocol !== 'https:' || !/^(?:p\d+-)?caldav\.icloud\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname.startsWith('/published/')) {
    throw new CalDavError('Die Kalendersuche wurde gestoppt: Die Zieladresse gehört nicht zum iCloud-CalDAV-Dienst.');
  }
  return url.href;
}

const children = (node: Element, ns: string, name: string): Element[] =>
  Array.from({ length: node.childNodes.length }, (_, i) => node.childNodes.item(i))
    .filter((child): child is Element => child?.nodeType === 1 && (child as Element).namespaceURI === ns && (child as Element).localName === name);
const property = (response: Element, ns: string, name: string): Element | undefined => {
  for (const stat of children(response, DAV, 'propstat')) {
    if (!/^HTTP\/\S+\s+200(?:\s|$)/.test(children(stat, DAV, 'status')[0]?.textContent?.trim() ?? '')) continue;
    for (const prop of children(stat, DAV, 'prop')) {
      const found = children(prop, ns, name)[0];
      if (found) return found;
    }
  }
  return undefined;
};

export async function discoverICloudCalendars(raw: Record<string, unknown>, transport: DavTransport = davRequest, includeReadOnly = false): Promise<ICloudCalendar[]> {
  const username = typeof raw['username'] === 'string' ? raw['username'].trim() : '';
  const password = typeof raw['password'] === 'string' ? raw['password'].trim() : '';
  if (!username || !password || username.length > 4096 || password.length > 4096 || /[:\r\n]/.test(username) || /[\r\n]/.test(password)) {
    throw new CalDavError('Für die iCloud-Kalendersuche Apple Account und App-spezifisches Passwort eintragen.');
  }
  let requests = 0;
  async function props(rawUrl: string, requested: string, step: Step, depth = '0'): Promise<{ url: string; responses: Element[] }> {
    let url = appleUrl(rawUrl, ROOT);
    while (++requests <= 12) {
      // Jeder Zielwechsel wird vor Übergabe der Zugangsdaten validiert. Der allgemeine Transport folgt keinem Redirect.
      const result = await transport(url, { url: new URL(url).origin + '/', username, password }, 'PROPFIND',
        `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop>${requested}</d:prop></d:propfind>`, { depth });
      if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
        url = appleUrl(result.location, url);
        continue;
      }
      if (result.status !== 207) throw new ICloudHttpError(result.status, step, new URL(url).hostname);
      try {
        if (/<!DOCTYPE|<!ENTITY/i.test(result.body)) throw new Error('XML');
        const doc = new DOMParser({ onError: () => { throw new Error('XML'); } }).parseFromString(result.body, 'application/xml');
        if (doc.documentElement?.namespaceURI !== DAV || doc.documentElement.localName !== 'multistatus') throw new Error('XML');
        return { url, responses: children(doc.documentElement, DAV, 'response') };
      } catch { throw new CalDavError(`iCloud-Suche – ${step}: iCloud hat keine lesbare CalDAV-Antwort geliefert.`); }
    }
    throw new CalDavError('Die iCloud-Kalendersuche benötigt zu viele Weiterleitungen oder Kalenderordner.');
  }
  function hrefs(result: { url: string; responses: Element[] }, ns: string, name: string): string[] {
    for (const response of result.responses) {
      const ownHref = children(response, DAV, 'href')[0]?.textContent?.trim();
      if (!ownHref || appleUrl(ownHref, result.url).replace(/\/$/, '') !== result.url.replace(/\/$/, '')) continue;
      const prop = property(response, ns, name);
      if (prop) return children(prop, DAV, 'href').map((href) => appleUrl(href.textContent?.trim() ?? '', result.url));
    }
    return [];
  }

  // RFC 6764: Kann der voreingestellte Einstieg nicht bedient werden, den
  // standardisierten Dienstpfad fragen. Keine geratenen Konto- oder Serverpfade.
  let root;
  try { root = await props(ROOT, '<d:current-user-principal/>', 'Anmeldung'); }
  catch (e) {
    if (!(e instanceof ICloudHttpError) || ![404, 405].includes(e.status)) throw e;
    root = await props(ROOT + '.well-known/caldav', '<d:current-user-principal/>', 'Alternativer Sucheinstieg');
  }
  const principal = hrefs(root, DAV, 'current-user-principal')[0];
  if (!principal) throw new CalDavError('iCloud hat keinen angemeldeten Kalenderbenutzer geliefert. Apple Account und App-Kennwort prüfen.');
  const account = await props(principal, '<c:calendar-home-set/>', 'Kalenderordner');
  const homes = [...new Set(hrefs(account, CAL, 'calendar-home-set'))];
  if (!homes.length) throw new CalDavError('Für diesen Apple Account wurde kein Kalenderordner gefunden.');
  if (homes.length > 5) throw new CalDavError('iCloud hat zu viele Kalenderordner geliefert.');
  const calendars = new Map<string, ICloudCalendar>();
  for (const home of homes) {
    const result = await props(home, '<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>', 'Kalenderliste', '1');
    for (const response of result.responses) {
      const resource = property(response, DAV, 'resourcetype');
      if (!resource || !children(resource, CAL, 'calendar').length) continue;
      const components = property(response, CAL, 'supported-calendar-component-set');
      if (components && !children(components, CAL, 'comp').some((c) => c.getAttribute('name') === 'VEVENT')) continue;
      const privileges = property(response, DAV, 'current-user-privilege-set');
      let writable: boolean | null = null;
      if (privileges) {
        const granted = children(privileges, DAV, 'privilege');
        const has = (name: string) => granted.some((p) => children(p, DAV, name).length > 0);
        writable = has('all') || has('write') || ['write-content', 'bind', 'unbind'].every(has);
        if (!writable && !includeReadOnly) continue;
      }
      const href = children(response, DAV, 'href')[0]?.textContent?.trim();
      if (!href) continue;
      const found = appleUrl(href, result.url);
      const url = calendarUrl(found.endsWith('/') ? found : found + '/');
      const name = property(response, DAV, 'displayname')?.textContent?.trim().slice(0, 200) || 'iCloud-Kalender';
      calendars.set(url, { url, name, ...(includeReadOnly ? { writable } : {}) });
      if (calendars.size > 100) throw new CalDavError('Mehr als 100 iCloud-Kalender gefunden. Bitte die direkte CalDAV-Adresse verwenden.');
    }
  }
  if (!calendars.size) throw new CalDavError('Keine beschreibbaren iCloud-Kalender für Termine gefunden. Freigaben und Schreibrechte prüfen.');
  return [...calendars.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
