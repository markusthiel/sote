/**
 * SOTE — Anhänge an einer Aufgabe.
 *
 * ## Die Bytes liegen im Dateisystem
 *
 * Wie in SONEs `files`: die Zeile in `task_files` beschreibt den Anhang, die
 * Bytes liegen unter `SOTE_FILES_DIR`. Bei den Profilbildern (0021) steht das
 * `bytea` in Postgres, und bei 256 KB und einem je Konto ist das vertretbar —
 * Anhänge sind beliebig viele und beliebig groß.
 *
 * **Die Folge, die man wissen muss:** ein Datenbank-Abzug allein reicht dann
 * nicht zum Wiederherstellen. Dafür bleibt die Datenbank klein, und ein Anhang
 * lässt sich ausliefern, ohne ihn durch Postgres zu ziehen.
 *
 * ## Erst die Datei, dann die Zeile
 *
 * Beim Anlegen wird zuerst geschrieben, dann die Zeile eingefügt. Bricht es
 * dazwischen, liegt eine Datei ohne Zeile da — sichtbar für niemanden und ohne
 * Schaden, nur belegter Platz. Die andere Reihenfolge gäbe eine Zeile ohne
 * Datei, und die zeigt die Oberfläche als Anhang an, den man nicht öffnen
 * kann. Von zwei unvollständigen Zuständen ist der stille der bessere.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';
import { enqueue, handle } from './jobs.js';

/** Wohin die Bytes gehen. Ohne die Variable gibt es keine Anhänge. */
export function filesDir(): string | undefined {
  const d = process.env['SOTE_FILES_DIR'];
  return d === undefined || d.trim() === '' ? undefined : resolve(d);
}

/**
 * Die Obergrenze je Datei.
 *
 * Eine Grenze und kein „unbegrenzt": ohne sie ist der erste Upload, der den
 * Datenträger füllt, ein Ausfall für alle. 25 MB, wie es die üblichen
 * Mailanhänge sind; über `SOTE_FILE_MAX_MB` zu ändern.
 */
export function maxBytes(): number {
  const raw = Number(process.env['SOTE_FILE_MAX_MB'] ?? '25');
  const mb = Number.isFinite(raw) && raw > 0 ? raw : 25;
  return Math.floor(mb * 1024 * 1024);
}

export class FilesOff extends Error {
  constructor() {
    super('dieser Server nimmt keine Anhänge (SOTE_FILES_DIR fehlt)');
    this.name = 'FilesOff';
  }
}

/**
 * Der Pfad zu einem Schlüssel.
 *
 * Zwei Ebenen aus dem Schlüssel selbst, damit kein Verzeichnis mit
 * hunderttausend Einträgen entsteht. Und `resolve` mit Prüfung: ein Schlüssel
 * aus der Datenbank ist zwar keine Nutzereingabe, aber ein Pfad, der aus dem
 * Verzeichnis herausführt, wäre ein Fehler, den niemand bemerkt, bevor er
 * ausgenutzt wird.
 */
function pathFor(dir: string, key: string): string {
  const p = resolve(join(dir, key.slice(0, 2), key.slice(2, 4), key));
  if (!p.startsWith(dir + '/')) throw new Error(`Schlüssel führt aus dem Verzeichnis: ${key}`);
  return p;
}

export interface StoredFile {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string | null;
  readonly createdAt: Date;
  /** Ob es eine kleine Fassung gibt — die Oberfläche fragt sie mit `?size=web` ab. */
  readonly hasWeb: boolean;
}

interface Row {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  uploaded_by: string | null;
  created_at: Date;
  web_key?: string | null;
}

const view = (r: Row): StoredFile => ({
  hasWeb: (r.web_key ?? null) !== null,
  id: r.id,
  filename: r.filename,
  mimeType: r.mime_type,
  // `bigint` kommt als Zeichenkette — geraten hätte ich hier eine Zahl, und
  // `size_bytes` wäre in der Antwort ein String gewesen.
  sizeBytes: Number(r.size_bytes),
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at,
});

/** Die Anhänge einer Aufgabe, älteste zuerst. */
export async function filesOf(pool: Pool, taskId: string): Promise<StoredFile[]> {
  const rows = await queryRows<Row>(
    pool,
    `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM task_files WHERE task_id = $1 ORDER BY created_at ASC`,
    [taskId],
  );
  return rows.map(view);
}

/**
 * Einen Anhang aufnehmen.
 *
 * Der Name wird auf seinen letzten Bestandteil gekürzt: ein Browser schickt
 * gelegentlich einen Pfad, und `../../etc/passwd` als Dateiname ist einer, den
 * man nicht anzeigen und schon gar nicht als Pfad benutzen will. Der
 * `storage_key` kommt ohnehin aus `randomUUID` und nicht aus dem Namen.
 */
export async function addFile(
  pool: Pool,
  input: {
    taskId: string;
    workspaceId: string;
    /**
     * Wer sie hochgeladen hat — `null` beim GAST.
     *
     * Die Spalte ist von Anfang an dafür gebaut („ein gelöschtes Konto nimmt
     * nicht die Anhänge mit, die es an gemeinsame Aufgaben gehängt hat"). Ein
     * Gast hat kein Konto, und das ist kein Grund, ihm das Anhängen zu
     * verwehren: die Datei hängt an einer AUFGABE, und die ist freigegeben.
     */
    userId: string | null;
    filename: string;
    mimeType: string;
    bytes: Buffer;
    /**
     * Die kleine Fassung, im Browser gerechnet — oder nichts.
     *
     * Der Server rechnet sie NICHT selbst: eine Leitung, die eine
     * 8-MB-Aufnahme hochträgt, trägt sie langsam, und wer im Browser rechnet,
     * überträgt zweimal wenig statt einmal viel. Ausserdem wäre es Rechenzeit
     * auf einer Maschine, die davon am wenigsten hat.
     *
     * Fehlt sie, ist das kein Fehler: ein PDF hat keine, ein kleines Bild
     * braucht keine, und ein Browser ohne `createImageBitmap` liefert keine.
     * Dann wird überall das Original gezeigt — langsamer, aber richtig.
     */
    webBytes?: Buffer | undefined;
  },
): Promise<StoredFile> {
  const dir = filesDir();
  if (dir === undefined) throw new FilesOff();
  if (input.bytes.length === 0) throw new Error('eine leere Datei ist kein Anhang');
  if (input.bytes.length > maxBytes()) {
    throw new Error(`diese Datei ist größer als ${Math.floor(maxBytes() / 1024 / 1024)} MB`);
  }

  const key = randomUUID().replace(/-/g, '');
  const p = pathFor(dir, key);
  await mkdir(dirname(p), { recursive: true });
  // Erst die Datei, dann die Zeile — siehe den Kopf dieser Datei.
  await writeFile(p, input.bytes);

  /*
   * Und die kleine Fassung, falls eine mitkam.
   *
   * Eigener Schlüssel, eigene Datei: sie liegt neben dem Original und nicht
   * darin. Schlägt sie fehl, wird sie ÜBERGANGEN und nicht der ganze Upload
   * abgebrochen — ein Anhang ohne Vorschau ist ein Anhang, ein abgelehnter
   * Anhang ist keiner.
   */
  let webKey: string | null = null;
  if (input.webBytes !== undefined && input.webBytes.length > 0) {
    webKey = randomUUID().replace(/-/g, '');
    try {
      const wp = pathFor(dir, webKey);
      await mkdir(dirname(wp), { recursive: true });
      await writeFile(wp, input.webBytes);
    } catch {
      webKey = null;
    }
  }

  const name = input.filename.split(/[/\\]/).pop()?.trim();
  const row = await queryOne<Row>(
    pool,
    `INSERT INTO task_files
       (task_id, workspace_id, filename, mime_type, size_bytes, storage, storage_key,
        uploaded_by, web_key, web_bytes)
     VALUES ($1,$2,$3,$4,$5,'local',$6,$7,$8,$9)
     RETURNING id, filename, mime_type, size_bytes, uploaded_by, created_at, web_key`,
    [
      input.taskId,
      input.workspaceId,
      name === undefined || name === '' ? 'Datei' : name,
      input.mimeType,
      input.bytes.length,
      key,
      input.userId,
      webKey,
      webKey === null ? null : (input.webBytes?.length ?? null),
    ],
  );
  if (row === undefined) {
    // Die Zeile kam nicht zustande: die Datei wieder weg, sonst bleibt sie für
    // immer liegen.
    await rm(p, { force: true });
    throw new Error('der Anhang liess sich nicht speichern');
  }
  return view(row);
}

/**
 * Verwaiste Dateien wegräumen.
 *
 * Sie entstehen auf zwei Wegen, und beide sind gewollt: eine gelöschte Aufgabe
 * nimmt ihre Zeilen mit (`ON DELETE CASCADE`), aber nicht die Bytes; und wenn
 * es zwischen `writeFile` und `INSERT` bricht, liegt eine Datei ohne Zeile da.
 * Beides ist harmlos — belegter Platz, sichtbar für niemanden — und sammelt
 * sich über Jahre trotzdem an.
 *
 * ## Die Altersgrenze ist das Entscheidende
 *
 * Eine Datei, die gerade geschrieben wird, hat noch keine Zeile: zwischen
 * `writeFile` und `INSERT` liegen Millisekunden, in denen sie genau wie ein
 * Waise aussieht. Ein Aufräumer ohne Altersgrenze löscht darum irgendwann
 * einen Anhang, den jemand in dieser Sekunde hochlädt — und das ist ein
 * Datenverlust, den niemand nachvollziehen kann. Eine Stunde ist so viel
 * länger als jeder Upload, dass die Frage nicht mehr auftaucht.
 *
 * ## Gelesen wird die Datenbank, nicht das Verzeichnis
 *
 * Erst alle Schlüssel holen, dann den Baum durchgehen. Andersherum — je Datei
 * eine Abfrage — wären das bei zehntausend Anhängen zehntausend Abfragen für
 * eine Antwort, die eine gibt.
 */
export async function sweepFiles(
  pool: Pool,
  input: { now?: Date; minAgeMs?: number } = {},
): Promise<{ geprüft: number; entfernt: number }> {
  const dir = filesDir();
  if (dir === undefined) return { geprüft: 0, entfernt: 0 };
  const now = input.now ?? new Date();
  const minAge = input.minAgeMs ?? 60 * 60 * 1000;

  /*
   * BEIDE Schlüssel, nicht nur der des Originals.
   *
   * Die kleine Fassung (`web_key`, aus `attachWeb`) liegt im selben Baum wie
   * das Original. Die erste Fassung dieser Menge kannte nur `storage_key` —
   * und hielt damit jede Bildvariante, die älter als eine Stunde war, für
   * verwaist. Einmal am Tag wurden also gültige Vorschauen gelöscht, und ihre
   * Zeile zeigte weiter auf sie. Gefunden im Audit vom 12.09.2026 (F06).
   *
   * Die Regel: **jeder Schlüssel, den eine Zeile nennt, ist bekannt.** Kommt
   * eine dritte Fassung dazu, gehört sie in diese Abfrage — nicht in einen
   * zweiten Aufräumer.
   */
  const bekannt = new Set<string>();
  for (const r of await queryRows<{ storage_key: string; web_key: string | null }>(
    pool,
    'SELECT storage_key, web_key FROM task_files',
  )) {
    bekannt.add(r.storage_key);
    if (r.web_key !== null) bekannt.add(r.web_key);
  }

  let geprüft = 0;
  let entfernt = 0;
  // `recursive` gibt Pfade relativ zu `dir`; die Blätter sind die Schlüssel.
  for (const rel of await readdir(dir, { recursive: true })) {
    const p = join(dir, rel);
    let s;
    try {
      s = await stat(p);
    } catch {
      continue; // Zwischen Auflisten und Ansehen verschwunden — dann eben.
    }
    if (!s.isFile()) continue;
    geprüft += 1;
    const key = rel.split(/[/\\]/).pop() ?? '';
    if (bekannt.has(key)) continue;
    if (now.getTime() - s.mtimeMs < minAge) continue;
    await rm(p, { force: true });
    entfernt += 1;
  }
  return { geprüft, entfernt };
}

/** Die Bytes eines Anhangs — geprüft gegen Aufgabe UND Arbeitsbereich. */
/**
 * Wie oft aufgeräumt wird.
 *
 * Einmal am Tag: es geht um belegten Platz, nicht um Richtigkeit, und ein
 * Durchgang liest das ganze Verzeichnis. Stündlich wäre Arbeit für nichts.
 */
const SWEEP_MS = 24 * 60 * 60 * 1000;

handle('files.sweep', async (ctx) => {
  const out = await sweepFiles(ctx.pool, { now: ctx.now });
  if (out.entfernt > 0) {
    console.log(`files.sweep: ${out.entfernt} von ${out.geprüft} Dateien waren verwaist`);
  }
  await enqueue(ctx.pool, 'files.sweep', {
    runAt: new Date(ctx.now.getTime() + SWEEP_MS),
    uniqueKey: 'files.sweep',
  });
});

/** Startet den Aufräumer — nur wenn es überhaupt einen Speicher gibt. */
export async function scheduleFileSweep(pool: Pool): Promise<boolean> {
  if (filesDir() === undefined) return false;
  await enqueue(pool, 'files.sweep', {
    // Nicht sofort: beim Start hat der Server anderes zu tun, und ein
    // Durchgang, der eine Stunde später läuft, ist genauso gut.
    runAt: new Date(Date.now() + 5 * 60 * 1000),
    uniqueKey: 'files.sweep',
  });
  return true;
}

/**
 * Die kleine Fassung NACHREICHEN.
 *
 * Als zweiter Aufruf und nicht im selben: der Upload trägt rohe Bytes, und
 * zwei Dateien in einem Körper brauchten ein Format, das sagt, wo die eine
 * aufhört — also einen Parser, den jemand schreiben und pflegen müsste. Zwei
 * Aufrufe kosten eine Verbindung und sind selbsterklärend.
 *
 * Scheitert der zweite, liegt der Anhang trotzdem da — ohne Vorschau, aber
 * vollständig. Das ist der richtige Ausgang: ein Anhang ohne kleine Fassung
 * ist ein Anhang, ein abgelehnter Anhang ist keiner.
 */
export async function attachWeb(
  pool: Pool,
  input: { id: string; taskId: string; workspaceId: string; bytes: Buffer },
): Promise<boolean> {
  const dir = filesDir();
  if (dir === undefined) throw new FilesOff();
  if (input.bytes.length === 0) return false;

  const row = await queryOne<{ web_key: string | null }>(
    pool,
    `SELECT web_key FROM task_files
      WHERE id = $1 AND task_id = $2 AND workspace_id = $3`,
    [input.id, input.taskId, input.workspaceId],
  );
  if (row === undefined) return false;
  // Schon eine da: nicht ersetzen. Ein zweiter Aufruf ist entweder ein
  // Wiederholungsversuch oder ein Versehen, und in beiden Fällen ist die
  // vorhandene richtig.
  if (row.web_key !== null) return true;

  const key = randomUUID().replace(/-/g, '');
  const p = pathFor(dir, key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, input.bytes);

  const out = await pool.query(
    `UPDATE task_files SET web_key = $4, web_bytes = $5
      WHERE id = $1 AND task_id = $2 AND workspace_id = $3 AND web_key IS NULL`,
    [input.id, input.taskId, input.workspaceId, key, input.bytes.length],
  );
  if (out.rowCount === 0) {
    await rm(p, { force: true });
    return false;
  }
  return true;
}

export async function readFileOf(
  pool: Pool,
  input: {
    id: string;
    taskId: string;
    workspaceId: string;
    /**
     * Welche Fassung — das Original oder die kleine.
     *
     * `web` ist eine BITTE und keine Bedingung: gibt es keine kleine Fassung,
     * kommt das Original. Eine Vorschau, die 404 sagt, weil ein Bild zu klein
     * für eine zweite Fassung war, wäre ein Fehler, den die Regel selbst
     * gemacht hat.
     */
    size?: 'web' | undefined;
  },
): Promise<{ file: StoredFile; bytes: Buffer } | undefined> {
  const dir = filesDir();
  if (dir === undefined) throw new FilesOff();
  const row = await queryOne<Row & { storage_key: string }>(
    pool,
    `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at, storage_key, web_key
       FROM task_files WHERE id = $1 AND task_id = $2 AND workspace_id = $3`,
    [input.id, input.taskId, input.workspaceId],
  );
  if (row === undefined) return undefined;
  const webKey = input.size === 'web' && (row.web_key ?? null) !== null ? row.web_key! : null;
  /*
   * Die kleine Fassung zuerst, wenn sie gewünscht und eingetragen ist — und
   * fehlt ihre Datei, das Original. Eine Variante ist abgeleitet: sie kann
   * neu entstehen, das Original nicht. Der Aufräumer hat eine Zeit lang genau
   * diese Dateien gelöscht (siehe `sweepFiles`); wer davon eine Zeile geerbt
   * hat, soll ein Bild sehen und keinen Fehler.
   *
   * Die kleine Fassung ist immer ein JPEG — sie wird als eines gezeichnet. Der
   * gespeicherte Typ gehört dem Original, und ihn hier mitzuschicken hiesse,
   * ein JPEG als PNG auszugeben.
   */
  if (webKey !== null) {
    try {
      return {
        file: { ...view(row), mimeType: 'image/jpeg' },
        bytes: await readFile(pathFor(dir, webKey)),
      };
    } catch {
      /* weiter zum Original */
    }
  }
  try {
    return {
      file: view(row),
      bytes: await readFile(pathFor(dir, row.storage_key)),
    };
  } catch {
    /*
     * Zeile ohne Datei. Das ist kein „gibt es nicht": die Zeile ist da, und wer
     * sie sieht, hat einen Anhang erwartet. Also nicht stillschweigend als 404
     * ausgeben, sondern melden — sonst sucht man den Fehler an der falschen
     * Stelle.
     */
    throw new Error(`die Datei zu ${input.id} fehlt im Speicher`);
  }
}

/** Einen Anhang wegnehmen. Zeile zuerst, dann die Datei. */
export async function removeFile(
  pool: Pool,
  input: { id: string; taskId: string; workspaceId: string },
): Promise<boolean> {
  const dir = filesDir();
  if (dir === undefined) throw new FilesOff();
  const row = await queryOne<{ storage_key: string; web_key: string | null }>(
    pool,
    `DELETE FROM task_files WHERE id = $1 AND task_id = $2 AND workspace_id = $3
     RETURNING storage_key, web_key`,
    [input.id, input.taskId, input.workspaceId],
  );
  if (row === undefined) return false;

  /*
   * UND DAS TITELBILD, FALLS ES DIESE DATEI WAR.
   *
   * GEMELDET mit Bild: „Ich habe vorhin alle Bilder gelöscht, und eins davon
   * war auf der Karte als Titel gesetzt. Das wird noch versucht zu laden."
   *
   * Ein Verweis, der ins Leere zeigt — und die Karte zeigt dann das kaputte
   * Bildzeichen des Browsers, also einen Fehler dort, wo jemand ein Foto
   * erwartet hat.
   *
   * Hier und nicht in der Oberfläche: die Oberfläche kann das Bild verstecken,
   * aber der Verweis bliebe stehen und käme bei jedem Laden wieder. Was nicht
   * mehr existiert, gehört nicht mehr genannt.
   *
   * Der Vergleich geht auf das ENDE des Wegs: gespeichert ist
   * `/api/tasks/<task>/files/<datei>`, und die Datei-Id steht hinten. Ein
   * `LIKE '%'` davor und der Anker am Ende — nicht irgendwo drin, sonst träfe
   * eine Id, die zufällig in einer anderen vorkommt.
   */
  await pool.query(
    `UPDATE tasks SET cover = NULL, updated_at = now()
      WHERE id = $1 AND cover->>'image' LIKE '%/files/' || $2`,
    [input.taskId, input.id],
  );
  /*
   * Die Datei danach: der Anhang ist weg, sobald die Zeile weg ist. Bleibt
   * die Datei liegen, ist das belegter Platz und kein Fehler — besser als eine
   * Zeile, die man nicht löschen kann, weil das Dateisystem streikt.
   *
   * (Ein Aufräumer für verwaiste Dateien fehlt noch. Ich hatte hier zuerst
   * `aufraeumen()` versprochen, das es nicht gibt — ein Kommentar, der auf
   * eine Funktion zeigt, die niemand geschrieben hat, ist eine Lüge im Code.)
   */
  await rm(pathFor(dir, row.storage_key), { force: true });
  // Und die kleine Fassung, falls es eine gab: sie gehört zu dieser Datei und
  // sonst niemandem.
  if (row.web_key !== null) await rm(pathFor(dir, row.web_key), { force: true });
  return true;
}
