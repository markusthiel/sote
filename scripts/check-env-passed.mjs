/**
 * SOTE — jede Einstellung, die der Server liest, muss ihn erreichen.
 *
 * ## Der Anlass
 *
 * SONEs Lehre, dort mit vierzehn Variablen: **Compose gibt die Umgebung des
 * Rechners nicht weiter.** Was in `.env` steht und in `docker-compose.yml`
 * nicht genannt ist, erreicht den Container nie — der Betreiber füllt etwas
 * aus, es wirkt nicht, und nichts sagt warum (ADR-0112).
 *
 * Der Kommentar dazu stand in dieser `docker-compose.yml`, und ich habe
 * trotzdem **zehn** Variablen gebaut, ohne eine davon einzutragen: Schlüssel,
 * Mailweg, SSO. Ein Grundsatz, an den sich niemand hält, ist ein Grundsatz mit
 * einer Prüfung zu wenig.
 *
 * ## Was geprüft wird
 *
 * **Drei** Stellen, die zusammenpassen müssen — und die dritte hatte ich beim
 * ersten Anlauf vergessen, worauf Markus zu Recht hinwies: `.env.example` ist
 * die Datei, die der Betreiber kopiert. Ein Wächter, der sie nicht kennt,
 * lässt genau die Stelle offen, an der jemand nachsieht.
 *
 * 1. Jede `SOTE_*`, die der Servercode liest, steht in `docker-compose.yml`.
 * 2. Jede, die dort steht, wird auch gelesen — sonst ist es ein Schalter, der
 *    nichts tut, und das ist derselbe Fehler von der anderen Seite.
 * 3. Jede, die dort steht, kommt in `.env.example` vor. Nicht umgekehrt: dort
 *    stehen auch Werte, die nur Compose selbst liest (`SOTE_IMAGE`) — die
 *    erreichen den Server nie und sollen es nicht.
 *
 * Kommentare werden vorher entfernt. Eine Variable, die nur in einer Erklärung
 * vorkommt, ist nicht gesetzt — und ein Test, der Prosa prüft, prüft die
 * falsche Sache (dieselbe Falle wie schon dreimal in diesem Projekt).
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, nicht `.pathname`: unter Windows wird aus `file:///C:/…`
// sonst `/C:/…`, und `join` macht daraus `C:\\C:\\…` (Audit 12.09.2026, F16).
const root = fileURLToPath(new URL('..', import.meta.url));

const ohneKommentare = (text, art) =>
  art === 'yml'
    ? text.replace(/^\s*#.*$/gm, '')
    : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function alleQuellen(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...alleQuellen(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const gelesen = new Set();
for (const f of alleQuellen(join(root, 'packages/server/src'))) {
  const src = ohneKommentare(readFileSync(f, 'utf8'), 'ts');
  for (const m of src.matchAll(/process\.env\[?['"`](SOTE_[A-Z_]+)['"`]\]?/g)) {
    gelesen.add(m[1]);
  }
  // `text('SOTE_…')` und `count('SOTE_…')` aus `env.ts` zählen auch.
  for (const m of src.matchAll(/\b(?:text|count)\(\s*['"`](SOTE_[A-Z_]+)['"`]/g)) {
    gelesen.add(m[1]);
  }
}

const compose = ohneKommentare(readFileSync(join(root, 'docker-compose.yml'), 'utf8'), 'yml');
const genannt = new Set([...compose.matchAll(/^\s{6}(SOTE_[A-Z_]+):/gm)].map((m) => m[1]));

/**
 * Die benannten Ausnahmen — mit Grund, sonst ist eine Ausnahmeliste eine
 * Liste, auf die man Dinge schiebt.
 *
 * - `SOTE_TEST_DATABASE_URL`: nur die Testläufe.
 * - `SOTE_NEW_PASSWORD`: nur das Kennwortskript, das auf dem Rechner läuft.
 * - `SOTE_PORT`: der **Host**-Port in der Portabbildung. Im Container hört der
 *   Server immer auf 8080 — ihn dort auch zu setzen hieße, dass zwei Zahlen
 *   zueinander passen müssen, und beim ersten Ändern passt eine nicht.
 */
const nurLokal = new Set(['SOTE_TEST_DATABASE_URL', 'SOTE_NEW_PASSWORD', 'SOTE_PORT']);

/*
 * `.env.example` mit Kommentaren, aber **absichtlich ohne** die Prüfung auf
 * gesetzte Werte: eine Variable darf dort auskommentiert stehen
 * (`# SOTE_SMTP_SECURE=`), wenn ihre Vorgabe erklärt ist. Was zählt, ist, dass
 * sie **vorkommt** — wer die Datei kopiert, soll von ihr erfahren.
 */
const beispiel = readFileSync(join(root, '.env.example'), 'utf8');
const beschrieben = new Set(
  [...beispiel.matchAll(/(SOTE_[A-Z_]+)\s*=/g)].map((m) => m[1]),
);

const fehlt = [...gelesen].filter((v) => !genannt.has(v) && !nurLokal.has(v)).sort();
/*
 * `SOTE_DATABASE_URL` steht absichtlich nicht in `.env.example`.
 *
 * Compose setzt sie aus `POSTGRES_PASSWORD` zusammen, und der Grund steht dort
 * als Kommentar: eine URL, die das Kennwort enthält, wäre eine zweite Stelle,
 * an der es steht — und die beiden laufen beim ersten Ändern auseinander.
 */
const zusammengesetzt = new Set(['SOTE_DATABASE_URL']);
const unerklaert = [...genannt]
  .filter((v) => !beschrieben.has(v) && !zusammengesetzt.has(v))
  .sort();
const wirkungslos = [...genannt].filter((v) => !gelesen.has(v)).sort();

if (fehlt.length > 0) {
  console.error(
    'check-env-passed: der Server liest diese, docker-compose gibt sie nicht weiter:\n  ' +
      fehlt.join('\n  ') +
      '\n\nCompose gibt die Umgebung des Rechners nicht weiter: was hier fehlt,\n' +
      'erreicht den Container nie, und nichts sagt warum.',
  );
}
if (wirkungslos.length > 0) {
  console.error(
    'check-env-passed: docker-compose nennt diese, der Server liest sie nicht:\n  ' +
      wirkungslos.join('\n  ') +
      '\n\nEine Einstellung fuer etwas, das es nicht gibt, ist eine Frage, die der\n' +
      'Betreiber beantwortet, ohne dass sie wirkt.',
  );
}
if (unerklaert.length > 0) {
  console.error(
    'check-env-passed: docker-compose gibt diese weiter, .env.example nennt sie nicht:\n  ' +
      unerklaert.join('\n  ') +
      '\n\n.env.example ist die Datei, die der Betreiber kopiert. Was dort fehlt,\n' +
      'erfaehrt er nur, wenn er den Code liest.',
  );
}
if (fehlt.length > 0 || wirkungslos.length > 0 || unerklaert.length > 0) process.exit(1);

console.log(
  `check-env-passed: ${genannt.size} Einstellungen weitergegeben und erklaert`,
);
