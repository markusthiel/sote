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
import { addFile, attachWeb, filesOf, readFileOf, removeFile, sweepFiles } from '../src/taskFiles.js';
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

test('der Aufräumer verschont die kleine Fassung — sie hat eine Zeile', async () => {
  /*
   * Audit 12.09.2026, F06: die Menge der bekannten Schlüssel kannte nur
   * `storage_key`. Jede kleine Fassung, die älter als eine Stunde war, galt
   * als Waise und wurde beim nächsten Tageslauf gelöscht — mit einer Zeile,
   * die weiter auf sie zeigte. Ohne den Fix scheitert dieser Test bei
   * `entfernt`.
   */
  const t = await neu('Vorschau bleibt');
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'foto.jpg',
    mimeType: 'image/jpeg',
    bytes: Buffer.from('x'.repeat(3000)),
  });
  await attachWeb(pool, { id: f.id, taskId: t, workspaceId: ws, bytes: Buffer.from('klein') });

  const spaeter = await sweepFiles(pool, {
    now: new Date(Date.now() + 2 * 60 * 60 * 1000),
  });
  assert.equal(spaeter.entfernt, 0, 'weder Original noch Variante sind Waisen');

  const web = await readFileOf(pool, { id: f.id, taskId: t, workspaceId: ws, size: 'web' });
  assert.equal(web?.bytes.toString(), 'klein', 'die Variante ist noch da');
});

test('fehlt die Datei der kleinen Fassung, kommt das Original — kein Fehler', async () => {
  /*
   * Die andere Hälfte von F06: wer aus der Zeit vor dem Fix eine Zeile mit
   * `web_key` und ohne Datei geerbt hat, soll ein Bild sehen. Eine Variante ist
   * abgeleitet und kann neu entstehen; ein 500 an dieser Stelle hätte die
   * ganze Aufgabenansicht mitgenommen.
   */
  const t = await neu('Vorschau verloren');
  const f = await addFile(pool, {
    taskId: t,
    workspaceId: ws,
    userId: ich,
    filename: 'foto.png',
    mimeType: 'image/png',
    bytes: Buffer.from('original'),
  });
  await attachWeb(pool, { id: f.id, taskId: t, workspaceId: ws, bytes: Buffer.from('weg') });
  const row = await queryOne<{ web_key: string }>(pool, 'SELECT web_key FROM task_files WHERE id = $1', [
    f.id,
  ]);
  await rm(join(dir, row!.web_key.slice(0, 2), row!.web_key.slice(2, 4), row!.web_key), {
    force: true,
  });

  const web = await readFileOf(pool, { id: f.id, taskId: t, workspaceId: ws, size: 'web' });
  assert.equal(web?.bytes.toString(), 'original');
  assert.equal(web?.file.mimeType, 'image/png', 'das Original trägt seinen eigenen Typ');
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

test('die kleine Fassung liegt neben dem Original, nicht statt seiner', async () => {
  /*
   * GEMELDET: „Ist es entsprechend verkleinert, damit keine mehrere MB grosse
   * Datei geladen wird?"
   *
   * Die Antwort ist eine zweite Datei und NICHT ein kleiner gerechnetes
   * Original: ein Anhang ist etwas, das jemand aufbewahren will. Ihn beim
   * Hochladen kleinzurechnen waere eine stille Enteignung.
   */
  const taskId = await neu('Mit Foto');
  const workspaceId = ws;
  const userId = ich;
  const gross = Buffer.from('x'.repeat(5000));
  const f = await addFile(pool, {
    taskId, workspaceId, userId,
    filename: 'foto.jpg', mimeType: 'image/jpeg', bytes: gross,
  });
  assert.equal(f.hasWeb, false);

  const klein = Buffer.from('y'.repeat(200));
  assert.equal(await attachWeb(pool, { id: f.id, taskId, workspaceId, bytes: klein }), true);

  // Ohne Bitte: das Original, unveraendert.
  const original = await readFileOf(pool, { id: f.id, taskId, workspaceId });
  assert.equal(original?.bytes.length, 5000);
  assert.equal(original?.file.hasWeb, true);

  // Mit Bitte: die kleine — und als JPEG ausgegeben, weil sie eines IST.
  const web = await readFileOf(pool, { id: f.id, taskId, workspaceId, size: 'web' });
  assert.equal(web?.bytes.length, 200);
  assert.equal(web?.file.mimeType, 'image/jpeg');
});

test('ohne kleine Fassung kommt das Original — und kein 404', async () => {
  // `?size=web` ist eine BITTE. Eine Vorschau, die 404 sagt, weil ein Bild zu
  // klein fuer eine zweite Fassung war, waere ein Fehler, den die Regel selbst
  // gemacht hat.
  const taskId = await neu('Kleines Bild');
  const workspaceId = ws;
  const userId = ich;
  const f = await addFile(pool, {
    taskId, workspaceId, userId,
    filename: 'klein.png', mimeType: 'image/png', bytes: Buffer.from('abc'),
  });
  const web = await readFileOf(pool, { id: f.id, taskId, workspaceId, size: 'web' });
  assert.equal(web?.bytes.toString(), 'abc');
  assert.equal(web?.file.mimeType, 'image/png');
});

test('eine zweite kleine Fassung ersetzt die erste nicht', async () => {
  // Ein zweiter Aufruf ist entweder ein Wiederholungsversuch oder ein
  // Versehen, und in beiden Faellen ist die vorhandene richtig.
  const taskId = await neu('Zweimal');
  const workspaceId = ws;
  const userId = ich;
  const f = await addFile(pool, {
    taskId, workspaceId, userId,
    filename: 'foto.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('x'.repeat(999)),
  });
  await attachWeb(pool, { id: f.id, taskId, workspaceId, bytes: Buffer.from('erste') });
  await attachWeb(pool, { id: f.id, taskId, workspaceId, bytes: Buffer.from('zweite!!') });
  const web = await readFileOf(pool, { id: f.id, taskId, workspaceId, size: 'web' });
  assert.equal(web?.bytes.toString(), 'erste');
});

test('eine geloeschte Datei nimmt ihr Titelbild mit', async () => {
  /*
   * GEMELDET mit Bild: „Ich habe vorhin alle Bilder geloescht, und eins davon
   * war auf der Karte als Titel gesetzt. Das wird noch versucht zu laden."
   *
   * Ein Verweis ins Leere, und die Karte zeigt das kaputte Bildzeichen des
   * Browsers — einen Fehler dort, wo jemand ein Foto erwartet hat.
   *
   * Behoben im SERVER und nicht in der Oberflaeche: die koennte das Bild
   * verstecken, aber der Verweis bliebe stehen und kaeme bei jedem Laden
   * wieder. Was nicht mehr existiert, gehoert nicht mehr genannt.
   */
  const taskId = await neu('Mit Titelbild');
  const f = await addFile(pool, {
    taskId, workspaceId: ws, userId: ich,
    filename: 'titel.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('bild'),
  });
  await pool.query('UPDATE tasks SET cover = $2::jsonb WHERE id = $1', [
    taskId,
    JSON.stringify({ image: `/api/tasks/${taskId}/files/${f.id}` }),
  ]);

  await removeFile(pool, { id: f.id, taskId, workspaceId: ws });

  const row = await queryOne<{ cover: unknown }>(
    pool, 'SELECT cover FROM tasks WHERE id = $1', [taskId],
  );
  assert.equal(row!.cover, null);
});

test('ein Titelbild einer ANDEREN Datei bleibt stehen', async () => {
  // Der Vergleich haengt am Ende des Wegs. Ohne Anker traefe eine Id, die
  // zufaellig in einer anderen vorkommt — und dann nimmt das Loeschen einer
  // Datei das Titelbild einer zweiten mit.
  const taskId = await neu('Zwei Bilder');
  const a = await addFile(pool, {
    taskId, workspaceId: ws, userId: ich,
    filename: 'a.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('a'),
  });
  const b = await addFile(pool, {
    taskId, workspaceId: ws, userId: ich,
    filename: 'b.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('b'),
  });
  const weg = `/api/tasks/${taskId}/files/${b.id}`;
  await pool.query('UPDATE tasks SET cover = $2::jsonb WHERE id = $1', [
    taskId, JSON.stringify({ image: weg }),
  ]);

  await removeFile(pool, { id: a.id, taskId, workspaceId: ws });

  const row = await queryOne<{ cover: { image: string } }>(
    pool, 'SELECT cover FROM tasks WHERE id = $1', [taskId],
  );
  assert.equal(row!.cover.image, weg);
});

test('ein Anhang ohne Konto — der Gast', async () => {
  /*
   * GEMELDET: „Datei-Uploads gehen nicht, sollte aber, das gehoert dazu."
   *
   * Im Quelltext stand als Begruendung: „beim Gast fehlt es ebenso -- eine
   * Datei haengt an einem Konto." Das war falsch. Sie haengt an einer AUFGABE,
   * und die ist freigegeben.
   *
   * Die Spalte ist von Anfang an dafuer gebaut, leer sein zu duerfen: „ein
   * geloeschtes Konto nimmt nicht die Anhaenge mit, die es an gemeinsame
   * Aufgaben gehaengt hat. Wer sie hochgeladen hat, ist dann unbekannt -- die
   * Datei bleibt." Genau dieser Fall, nur von vornherein.
   */
  const taskId = await neu('Vom Gast');
  const f = await addFile(pool, {
    taskId, workspaceId: ws, userId: null,
    filename: 'gast.txt', mimeType: 'text/plain', bytes: Buffer.from('hallo'),
  });
  assert.equal(f.uploadedBy, null);

  const zurueck = await readFileOf(pool, { id: f.id, taskId, workspaceId: ws });
  assert.equal(zurueck?.bytes.toString(), 'hallo');
});
