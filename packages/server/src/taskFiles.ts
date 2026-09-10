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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { Pool } from 'pg';

import { queryOne, queryRows } from './db.js';

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
}

interface Row {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  uploaded_by: string | null;
  created_at: Date;
}

const view = (r: Row): StoredFile => ({
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
    userId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
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

  const name = input.filename.split(/[/\\]/).pop()?.trim();
  const row = await queryOne<Row>(
    pool,
    `INSERT INTO task_files
       (task_id, workspace_id, filename, mime_type, size_bytes, storage, storage_key, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,'local',$6,$7)
     RETURNING id, filename, mime_type, size_bytes, uploaded_by, created_at`,
    [
      input.taskId,
      input.workspaceId,
      name === undefined || name === '' ? 'Datei' : name,
      input.mimeType,
      input.bytes.length,
      key,
      input.userId,
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

/** Die Bytes eines Anhangs — geprüft gegen Aufgabe UND Arbeitsbereich. */
export async function readFileOf(
  pool: Pool,
  input: { id: string; taskId: string; workspaceId: string },
): Promise<{ file: StoredFile; bytes: Buffer } | undefined> {
  const dir = filesDir();
  if (dir === undefined) throw new FilesOff();
  const row = await queryOne<Row & { storage_key: string }>(
    pool,
    `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at, storage_key
       FROM task_files WHERE id = $1 AND task_id = $2 AND workspace_id = $3`,
    [input.id, input.taskId, input.workspaceId],
  );
  if (row === undefined) return undefined;
  try {
    return { file: view(row), bytes: await readFile(pathFor(dir, row.storage_key)) };
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
  const row = await queryOne<{ storage_key: string }>(
    pool,
    `DELETE FROM task_files WHERE id = $1 AND task_id = $2 AND workspace_id = $3
     RETURNING storage_key`,
    [input.id, input.taskId, input.workspaceId],
  );
  if (row === undefined) return false;
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
  return true;
}
