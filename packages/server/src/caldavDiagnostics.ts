/** Beschränkte Diagnose: keine Antworttexte, Kontopfade, Termininhalte oder Zugangsdaten. */
import { DOMParser } from '@xmldom/xmldom';
import { CalDavError, checkCalendar, davFailure, type CalDavCredentials, type DavResponse, type DavTransport } from './caldav.js';

export function davResponseDetails(response: DavResponse): string {
  const server = /AppleHttpServer/i.test(response.server ?? '') ? 'Apple' : /nginx/i.test(response.server ?? '') ? 'nginx' : /cloudflare/i.test(response.server ?? '') ? 'Cloudflare' : 'nicht angegeben';
  const body = response.body.trim();
  let format = body ? 'Text' : 'leer';
  const codes: string[] = [];
  if (/<(?:!doctype\s+html|html)(?:\s|>)/i.test(body)) format = 'HTML';
  else if (body.startsWith('<')) {
    format = 'XML';
    try {
      if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error('XML');
      const doc = new DOMParser({ onError: () => { throw new Error('XML'); } }).parseFromString(body, 'application/xml');
      for (const [ns, names] of [
        ['DAV:', ['need-privileges', 'not-found', 'resource-must-be-null', 'quota-not-exceeded', 'lock-token-submitted']],
        ['urn:ietf:params:xml:ns:caldav', ['valid-calendar-data', 'valid-calendar-object-resource', 'supported-calendar-data', 'supported-calendar-component', 'no-uid-conflict', 'max-resource-size', 'min-date-time', 'max-date-time']],
      ] as const) {
        for (const name of names) if (doc.getElementsByTagNameNS(ns, name).length) codes.push(name);
      }
    } catch { format = 'unlesbares XML'; }
  }
  return `Antwort: ${server}, ${format}${codes.length ? `; Fehlercode: ${codes.join(', ')}` : ''}.`;
}

export async function rejectedPutError(credentials: CalDavCredentials, uid: string, response: DavResponse, transport: DavTransport): Promise<CalDavError> {
  let message = `Termin schreiben (PUT): ${davFailure(response.status).message}`;
  if (response.status !== 404) return new CalDavError(message);
  message += ` Zielserver: ${new URL(credentials.url).hostname}; Termin-ID: ${Buffer.byteLength(uid)} Bytes. ${davResponseDetails(response)}`;
  try {
    await checkCalendar(credentials, transport);
    message += ' Kalenderprüfung (PROPFIND): erfolgreich. Der Kalenderordner ist erreichbar; abgelehnt wurde das Schreiben des Termins.';
  } catch (e) {
    message += ` Kalenderprüfung (PROPFIND): ${e instanceof CalDavError ? e.message : 'Prüfung fehlgeschlagen.'}`;
  }
  return new CalDavError(message);
}
