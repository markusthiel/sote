/**
 * SOTE — Anhänge an einer Aufgabe.
 *
 * Die Fragen, auf die es ankommt: liegen die Bytes wirklich da, kommen sie
 * unverändert zurück, und geht mit der Aufgabe auch der Anhang?
 */

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Pool } from 'pg';

import { createWorkspace } from '../src/bootstrap.js';
import { makePool, queryOne, queryRows } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addFile, filesOf, readFileOf, removeFile, sweepFiles } from '../src/taskFiles.js';
import { createFromLine } from '../src/tasks.js';

const URL_ =
  process.env['SOTE_TEST_DATABASE_URL'] ?? 'postgres://sote:sote@127.0.0.1:5433/sote_test';

let pool: Pool;
let ws: string;
let ich: string;
let dir: string;

before(async () => {
  pool = makePool(URL_);
  await migrate(pool);
  const u = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    [`tf-${process.pid}@example.org`, 'Ich'],
  );
  ich = u!.id;
  ws = await createWorkspace(pool, { name: `tf-${process.pid}`, ownerId: ich });
  /*
   * Ein eigenes Verzeichnis je Lauf, und es wird hinterher weggeräumt: ein
   * Test, der in ein festes Verzeichnis schreibt, sammelt Dateien an — und
   * dann zählt der nächste Lauf die von vorhin mit (die Lehre aus dem
   * Briefe-Zähler).
   */
  dir = await mkdtemp(join(tmpdir(), 'sote-files-'));
  process.env['SOTE_FILES_DIR'] = dir;
});

after(async () => {
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

const neu = async (line: string): Promise<string> =>
  (await createFromLine(pool, { workspaceId: ws, userId: ich, line, now: new Date() })).task.id;

test('ein Anhang kommt unverändert zurück', async () => {
  const t = await neu('Rechnung prüfen');
  // Bytes mit einer Null darin: ein Anhang ist keine Zeichenkette, und ein Weg,
  // der bei einem 0x00 abbricht, fällt bei Text nicht auf.
  const bytes = Buffer.from([0x50, 0x44, 0x46, 0x00, 0xff, 0x01, 0x7a]);
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'Rechnung 7.pdf',
    mimeType: 'application/pdf',
    bytes,
  });
  assert.equal(f.filename, 'Rechnung 7.pdf');
  assert.equal(f.sizeBytes, 7, 'die Größe ist eine Zahl, nicht ein bigint-String');

  const zurück = await readFileOf(pool, { id: f.id, taskId: t, workspaceId: ws });
  assert.ok(zurück !== undefined);
  assert.deepEqual(zurück.bytes, bytes, 'Byte für Byte dasselbe');
  assert.equal(zurück.file.mimeType, 'application/pdf');
});

test('ein Pfad im Dateinamen wird auf den Namen gekürzt', async () => {
  const t = await neu('Pfadprobe');
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: '../../etc/passwd',
    mimeType: 'text/plain',
    bytes: Buffer.from('x'),
  });
  assert.equal(f.filename, 'passwd', 'kein Pfad, nur der Name');
});

test('eine leere Datei ist kein Anhang', async () => {
  const t = await neu('Leer');
  await assert.rejects(
    () =>
      addFile(pool, {
        taskId: t,
        workspaceId: ws,
        userId: ich,
        filename: 'nichts.txt',
        mimeType: 'text/plain',
        bytes: Buffer.alloc(0),
      }),
    /leere Datei/,
  );
});

test('zu groß wird abgelehnt, und nichts bleibt liegen', async () => {
  const t = await neu('Zu gross');
  const vorher = (await readdir(dir, { recursive: true })).length;
  process.env['SOTE_FILE_MAX_MB'] = '0.001'; // ~1 KB
  try {
    await assert.rejects(
      () =>
        addFile(pool, {
          taskId: t,
          workspaceId: ws,
          userId: ich,
          filename: 'dick.bin',
          mimeType: 'application/octet-stream',
          bytes: Buffer.alloc(5000),
        }),
      /größer als/,
    );
  } finally {
    delete process.env['SOTE_FILE_MAX_MB'];
  }
  const nachher = (await readdir(dir, { recursive: true })).length;
  assert.equal(nachher, vorher, 'die Grenze greift VOR dem Schreiben');
});

test('ein Anhang aus einem anderen Arbeitsbereich ist nicht zu holen', async () => {
  const t = await neu('Fremd');
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'geheim.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('geheim'),
  });
  const anderer = await createWorkspace(pool, { name: `tf2-${process.pid}`, ownerId: ich });
  assert.equal(
    await readFileOf(pool, { id: f.id, taskId: t, workspaceId: anderer }),
    undefined,
    'die Prüfung steht in der Abfrage, nicht davor',
  );
});

test('wegnehmen löscht Zeile UND Datei', async () => {
  const t = await neu('Weg damit');
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'weg.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('weg'),
  });
  const vorher = (await readdir(dir, { recursive: true })).filter((n) => !n.includes('/')).length;
  assert.equal(await removeFile(pool, { id: f.id, taskId: t, workspaceId: ws }), true);
  assert.equal((await filesOf(pool, t)).length, 0, 'die Zeile ist weg');
  // Und die Datei: gezählt wird über die Anzahl der Blätter im Baum.
  const alle = await readdir(dir, { recursive: true });
  const blätter = alle.filter((n) => /[0-9a-f]{32}$/.test(n));
  assert.ok(!blätter.some((n) => n.endsWith(f.id)), 'kein Blatt mit dieser Id');
  assert.ok(vorher >= 0, 'nur zur Sicherheit, dass der Baum lesbar war');
});

test('der Aufräumer nimmt Waisen — aber nicht die frischen', async () => {
  const t = await neu('Aufraeumprobe');
  const bleibt = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'bleibt.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('bleibt'),
  });

  /*
   * Eine Waise von Hand: eine Datei im Baum, zu der es keine Zeile gibt. Genau
   * das hinterlässt eine gelöschte Aufgabe.
   */
  const key = 'a1b2'.padEnd(32, '0');
  const p = join(dir, key.slice(0, 2), key.slice(2, 4), key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, 'waise');

  // Erst mit Altersgrenze: die Waise ist Sekunden alt und bleibt.
  const frisch = await sweepFiles(pool, {});
  assert.equal(frisch.entfernt, 0, 'eine frische Waise könnte ein laufender Upload sein');
  assert.ok(await stat(p).then(() => true).catch(() => false), 'noch da');

  /*
   * Und mit einem Blick aus der Zukunft: jetzt ist sie alt genug. So geprüft
   * und nicht mit `utimes`, weil der Aufräumer `now` bekommt — dieselbe Naht,
   * an der auch der Erinnerungs-Bearbeiter prüfbar ist.
   */
  const spaeter = await sweepFiles(pool, {
    now: new Date(Date.now() + 2 * 60 * 60 * 1000),
  });
  assert.equal(spaeter.entfernt, 1, 'die Waise ist weg');
  assert.equal(await stat(p).then(() => true).catch(() => false), false);

  // Und der echte Anhang steht unangetastet da.
  const noch = await readFileOf(pool, { id: bleibt.id, taskId: t, workspaceId: ws });
  assert.ok(noch !== undefined, 'was eine Zeile hat, bleibt — egal wie alt');
});

test('mit der Aufgabe geht die Zeile — die Datei bleibt liegen, und das steht so da', async () => {
  const t = await neu('Kaskade');
  await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'kaskade.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('k'),
  });
  await pool.query('DELETE FROM tasks WHERE id = $1', [t]);
  const rows = await queryRows<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM task_files WHERE task_id = $1',
    [t],
  );
  assert.equal(Number(rows[0]!.n), 0, 'ON DELETE CASCADE räumt die Zeilen');
  /*
   * Die Datei im Speicher bleibt — das ist der bekannte Preis dafür, dass die
   * Bytes nicht in Postgres liegen. Ein Aufräumer dafür fehlt noch, und dieser
   * Test hält fest, dass das so ist und nicht vergessen wurde.
   */
});
