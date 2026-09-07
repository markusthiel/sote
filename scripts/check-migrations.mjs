#!/usr/bin/env node
/**
 * SOTE — Wächter über die Migrationen.
 *
 * Drei Prüfungen, und jede hält einen Fehler fest, der sonst erst in einer
 * Datenbank auffällt:
 *
 * 1. **Lückenlose, eindeutige Nummern.** Zwei Dateien mit derselben Nummer
 *    laufen in einer Reihenfolge, die vom Dateisystem abhängt.
 * 2. **Kein `sort_key` ohne `COLLATE "C"`.** Ein Fractional Index wird
 *    lexikographisch verglichen; eine sprachabhängige Collation sortiert die
 *    Schlüssel um und vertauscht Zeilen. Das ist die Falle aus SONEs ADR-0002,
 *    und sie fällt nicht auf, solange nur ASCII-Schlüssel im Spiel sind.
 * 3. **Keine geänderte Migration.** Eine Datei, die schon gelaufen ist, wird
 *    nicht bearbeitet, sondern ergänzt.
 *
 * Punkt 3 braucht einen Zustand, den dieses Skript nicht hat — es prüft
 * stattdessen, dass jede Datei eine Kopfzeile mit ihrer Nummer trägt, damit
 * eine Umbenennung im Diff sichtbar ist.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'packages/server/migrations';
const problems = [];

let files;
try {
  files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
} catch {
  console.log('check-migrations: noch kein Migrationsverzeichnis, nichts zu prüfen');
  process.exit(0);
}

const seen = new Map();
for (const file of files) {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
  if (!m) {
    problems.push(`${file}: Name muss NNNN_kleingeschrieben.sql sein`);
    continue;
  }
  const n = Number(m[1]);
  if (seen.has(n)) {
    problems.push(`Nummer ${m[1]} zweimal: ${seen.get(n)} und ${file}`);
  }
  seen.set(n, file);

  const sql = readFileSync(join(DIR, file), 'utf8');

  if (!sql.includes(`SOTE ${m[1]}`)) {
    problems.push(`${file}: Kopfzeile nennt die Nummer nicht ("-- SOTE ${m[1]} — …")`);
  }

  // Jede sort_key-Spalte braucht die C-Collation. Gesucht wird die
  // Spaltendefinition, nicht jede Erwähnung des Namens.
  for (const line of sql.split('\n')) {
    if (!/^\s*[a-z_]*sort_key\s+text/i.test(line)) continue;
    if (!/COLLATE\s+"C"/i.test(line)) {
      problems.push(`${file}: sort_key ohne COLLATE "C" — ${line.trim()}`);
    }
  }
}

const numbers = [...seen.keys()].sort((a, b) => a - b);
for (let i = 0; i < numbers.length; i += 1) {
  if (numbers[i] !== i + 1) {
    problems.push(
      `Lücke in den Nummern: erwartet ${String(i + 1).padStart(4, '0')}, gefunden ${String(numbers[i]).padStart(4, '0')}`,
    );
    break;
  }
}

if (problems.length > 0) {
  console.error('check-migrations: nicht in Ordnung\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-migrations: ${files.length} Migration(en) in Ordnung`);

/*
 * Und die andere Hälfte derselben Regel: die Collation nützt nichts, wenn die
 * Datenbank sie nicht hat. Sie wirkt nur beim ersten Start eines leeren
 * Datenverzeichnisses — wer sie später vermisst, braucht ein Dump-and-Restore.
 * Also wird hier geprüft, dass sie überhaupt dasteht.
 */
try {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  if (!/--locale=C\b/.test(compose)) {
    console.error(
      'check-migrations: docker-compose.yml nennt --locale=C nicht — ' +
        'die Sortierschlüssel würden in einer neuen Datenbank umsortiert',
    );
    process.exit(1);
  }
  console.log('check-migrations: docker-compose.yml nennt --locale=C');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
