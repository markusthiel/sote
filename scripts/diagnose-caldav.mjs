/** Einmaliger Vergleichsabgleich im vorhandenen SOTE-Servercontainer, ab Stand 7a0c9ab.
 * Verwendet den normalen Writer mit Sperre, Quittungen und Konfliktschutz.
 * Keine Testtermine, keine Ausgabe von Zugangsdaten, Kontopfaden oder Termininhalten.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function appleTarget(raw, credentials) {
  const base = new URL(credentials.url);
  const url = new URL(raw);
  if (base.protocol !== 'https:' || !/^(?:p\d+-)?caldav\.icloud\.com$/.test(base.hostname) ||
      base.port || base.username || base.password || base.search || base.hash ||
      !base.pathname.endsWith('/') || base.pathname.startsWith('/published/') ||
      url.origin !== base.origin || !url.href.startsWith(base.href) || url.username || url.password || url.search || url.hash) {
    throw new Error('Kein privates iCloud-Kalenderziel.');
  }
  return url;
}

/** Bewusst separater HTTP-Client, aber dasselbe Ziel, derselbe Inhalt und dieselben Bedingungen. */
export async function fetchRequest(raw, credentials, method, body = '', headers = {}, fetcher = fetch) {
  const url = appleTarget(raw, credentials);
  if (!['PUT', 'GET', 'DELETE', 'PROPFIND'].includes(method)) throw new Error('Unerwartete DAV-Methode.');
  if (method === 'PUT' && headers['if-none-match'] !== '*' && !/^"[^"\r\n]+"$/.test(headers['if-match'] ?? '')) {
    throw new Error('Schreibbedingung fehlt.');
  }
  if (method === 'DELETE' && !/^"[^"\r\n]+"$/.test(headers['if-match'] ?? '')) throw new Error('Löschbedingung fehlt.');
  const response = await fetcher(url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: {
      'user-agent': 'SOTE/1.0 (CalDAV)',
      authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      'content-type': method === 'PROPFIND' ? 'application/xml; charset=utf-8' : 'text/calendar; charset=utf-8',
      ...headers,
    },
    ...(method === 'GET' ? {} : { body }),
  });
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Antwort zu groß.'); }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8'), etag: response.headers.get('etag'),
    server: response.headers.get('server') ?? undefined };
}

export function comparisonTransport(primary, alternate, log) {
  let useAlternate = false;
  return async (...args) => {
    const [raw, credentials, method, body = ''] = args;
    const url = appleTarget(raw, credentials);
    if (method === 'PUT') {
      const shape = url.pathname.split('/').map((p) => p === 'calendars' || p === '' ? p : `<${p.length}>`).join('/');
      log(`PUT-Ziel: ${url.hostname}${shape}; Inhalt: ${Buffer.byteLength(body)} Bytes; URL-kodierte Zeichen: ${url.pathname.includes('%') ? 'ja' : 'nein'}`);
    }
    let response = await (useAlternate ? alternate : primary)(...args);
    log(`${useAlternate ? 'fetch' : 'node:https'} ${method}: HTTP ${response.status}`);
    if (!useAlternate && method === 'PUT' && response.status === 404) {
      useAlternate = true;
      response = await alternate(...args);
      log(`fetch ${method}: HTTP ${response.status}`);
    }
    return response;
  };
}

async function main() {
  if (!process.argv.includes('--sync')) {
    console.log('Mit --sync ausführen: normaler Abgleich einer eingeschalteten iCloud-Verbindung mit PUT-Fehler; bei 404 einmal auf fetch wechseln.');
    return;
  }
  const moduleAt = (name) => import(pathToFileURL(resolve(`packages/server/dist/${name}.js`)).href);
  const { makePool } = await moduleAt('db');
  const { unseal } = await moduleAt('secretbox');
  const { syncWriter } = await moduleAt('calendarWriters');
  const { davRequest } = await moduleAt('caldav');
  if (!process.env.SOTE_DATABASE_URL) throw new Error('Serverkonfiguration fehlt.');
  const pool = makePool(process.env.SOTE_DATABASE_URL);
  try {
    const { rows } = await pool.query("SELECT feed_id, credentials_sealed FROM calendar_writers WHERE enabled AND last_error LIKE 'Termin schreiben (PUT):%' LIMIT 101");
    if (rows.length > 100) throw new Error('Zu viele Verbindungen.');
    const candidates = rows.filter((r) => {
      const plain = unseal(r.credentials_sealed);
      if (!plain) return false;
      const credentials = JSON.parse(plain);
      try { appleTarget(credentials.url, credentials); return true; } catch { return false; }
    });
    if (candidates.length !== 1) {
      console.log(`Gefundene eingeschaltete iCloud-Verbindungen mit PUT-Fehler: ${candidates.length}. Kein Abgleich ausgeführt.`);
      return;
    }
    console.log(`CalDAV-Vergleich 1; Node ${process.version}. Ein normaler Abgleich, ohne zusätzliche Testtermine.`);
    const alternate = async (...args) => {
      try { return await fetchRequest(...args); }
      catch { console.log('fetch: Netzwerk- oder Antwortfehler (Details unterdrückt).'); throw new Error('Vergleichsabruf fehlgeschlagen.'); }
    };
    let networkCalls = 0;
    const primary = async (...args) => { networkCalls++; return davRequest(...args); };
    await syncWriter(pool, candidates[0].feed_id, new Date(), comparisonTransport(primary, alternate, console.log));
    if (!networkCalls) console.log('Kein Netzaufruf ausgeführt: eventuell läuft gerade der Hintergrundabgleich oder es gibt keine Änderungen.');
    const { rows: status } = await pool.query(`SELECT w.last_error, w.synced_at,
      (SELECT count(*) FROM calendar_write_events e WHERE e.writer_id=w.id AND e.content_hash IS NOT NULL) AS copies
      FROM calendar_writers w WHERE w.feed_id=$1`, [candidates[0].feed_id]);
    console.log(`Bestätigte Kopien: ${status[0]?.copies ?? 'unbekannt'}. Fehler: ${status[0]?.last_error ?? 'keiner'}`);
  } finally { await pool.end(); }
}

if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)) {
  try { await main(); }
  catch { console.error('Diagnose abgebrochen. Verbindung, Containerpfad oder Serverkonfiguration prüfen; Fehlerdetails wurden zum Schutz der Zugangsdaten unterdrückt.'); process.exitCode = 1; }
}
