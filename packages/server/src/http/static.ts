/**
 * SOTE — die gebaute Oberfläche ausliefern.
 *
 * Ein Dienst und nicht zwei: derselbe Ursprung für Oberfläche und API, damit
 * der Sitzungskeks ohne CORS und ohne `SameSite=None` auskommt. Ein zweiter
 * Ursprung wäre ein zweiter Ort für Rechte.
 *
 * Alles außerhalb von `/api` und ohne Dateiendung bekommt `index.html` —
 * die Anwendung hat einen eigenen Router, und ein Neuladen auf einem tiefen
 * Pfad darf nicht 404 sein.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Was womit ausgeliefert wird.
 *
 * GEMELDET: „PDF lässt sich immer noch nicht öffnen." Hier lag es, und der
 * Fehler ist lehrreich: `.mjs` fehlte.
 *
 * Der PDF-Betrachter lädt seinen Arbeiter aus einer Datei, die das Bündel
 * `pdf.worker.min-<hash>.mjs` nennt — die Endung bleibt, weil sie über `?url`
 * als Datei durchgereicht wird. Ohne Eintrag fällt die Tabelle auf
 * `application/octet-stream` zurück, und ein Browser LEHNT einen Arbeiter mit
 * falschem Typ ab. Die Fehlermeldung landet im Arbeiter, nicht auf der Seite,
 * und nach aussen kam davon nur „ließ sich nicht öffnen".
 *
 * Auf meinem Probeserver fiel es nicht auf, weil der `.mjs` richtig
 * auslieferte — das ist der Unterschied zwischen „im Browser geprüft" und „mit
 * DIESEM Server geprüft".
 *
 * `application/octet-stream` als Rückfall bleibt richtig: was die Tabelle
 * nicht kennt, soll heruntergeladen und nicht ausgeführt werden. Der Fehler
 * war der fehlende Eintrag, nicht der Rückfall.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // Dieselbe Sprache, andere Endung. Ein Modul-Arbeiter kommt genau so.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

export function makeStatic(root: string) {
  const base = resolve(root);

  return async function serve(pathname: string, res: ServerResponse): Promise<boolean> {
    // `normalize` allein reicht nicht: der aufgelöste Pfad muss unter der
    // Wurzel liegen, sonst ist `/../../etc/passwd` ein gültiger Dateiname.
    const wanted = resolve(join(base, normalize(decodeURIComponent(pathname))));
    const inside = wanted === base || wanted.startsWith(base + sep);

    const candidate =
      inside && extname(wanted) !== '' ? wanted : join(base, 'index.html');

    let size: number;
    try {
      const info = await stat(candidate);
      if (!info.isFile()) return false;
      size = info.size;
    } catch {
      return false;
    }

    const ext = extname(candidate);
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': size,
      // Die Anwendungsdateien tragen einen Hash im Namen, index.html nicht.
      'cache-control':
        ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(candidate).pipe(res);
    return true;
  };
}
