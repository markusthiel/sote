/**
 * SOTE — vier Spaltenlisten, eine Aufzählung.
 *
 * ## Der Anlass
 *
 * Eine Aufgabe wird an vier Stellen gelesen, und jede zählt ihre Spalten selbst
 * auf: `tasks.ts` (`RETURNING`, also alles Geschriebene), `views.ts` (Heute,
 * Demnächst, Irgendwann, Posteingang, Projekt), `detail.ts` (die Detailspalte)
 * und `search.ts` (die Suche, mit `t.`-Präfix, weil dort verbunden wird).
 *
 * Beim Einbau der Dauer waren das vier Stellen für eine Spalte. Trägt man sie
 * in nur drei ein, entsteht der unangenehmste Fehler dieser Sorte: die Zeile
 * hat in einer Ansicht eine Schätzung und in der nächsten nicht. Das sieht aus
 * wie ein Datenverlust, ist aber ein fehlendes Wort — und man sucht es in der
 * Datenbank, wo es richtig steht.
 *
 * ## Warum ein Skript und nicht ein Test
 *
 * Es gibt einen Test dafür, und er prüft `duration_min`. Er prüft aber genau
 * diese Spalte: die nächste kommt ohne ihn an. Ein Wächter, der die Listen
 * gegeneinander hält, gilt für jede Spalte, die es noch geben wird — und das
 * ist der Unterschied zwischen einem Test für einen Fehler und einem für seine
 * Klasse.
 *
 * ## Warum nicht `SELECT *`
 *
 * Das wäre die andere Lösung, und sie ist schlechter: `*` liefert auch
 * `trashed_at` und `trashed_by` mit, die keine Ansicht braucht, und bei jeder
 * neuen Spalte wächst die Antwort, ohne dass jemand es entschieden hat. Eine
 * genannte Liste ist eine Entscheidung. Vier genannte Listen sind eine
 * Entscheidung und drei Kopien — dafür ist dieser Wächter da.
 */

import { readFileSync } from 'node:fs';

/** Die vier Stellen, und wie die Aufzählung dort heißt. */
const SOURCES = [
  { file: 'packages/server/src/tasks.ts', name: 'RETURNING' },
  { file: 'packages/server/src/views.ts', name: 'COLUMNS' },
  { file: 'packages/server/src/detail.ts', name: 'COLUMNS' },
  { file: 'packages/server/src/search.ts', name: 'COLUMNS' },
];

/**
 * Spalten, die absichtlich nur an EINER Stelle stehen.
 *
 * Die Regel dieses Wächters ist „vier Listen, eine Aufzählung", und sie ist
 * richtig — für Spalten, die eine Zeile beschreiben. `note_doc` beschreibt
 * keine Zeile, sondern trägt das ganze Notiz-Dokument, und eine Tafel mit
 * hundert Karten würde hundert Dokumente übertragen, damit keine davon
 * angezeigt wird. Der Klartext `note` steht weiter in allen vier Listen; das
 * ist, was Listen, Suche und Vorschau lesen.
 *
 * Eine Ausnahme steht hier NAMENTLICH und mit Begründung, damit sie eine
 * Entscheidung bleibt und nicht zu einem Loch wird, durch das die nächste
 * Spalte unbemerkt fällt.
 */
const NUR_DETAIL = new Set(['note_doc']);

const problems = [];

/**
 * Die Namen aus `const NAME = ` … `` `; ``.
 *
 * Das `t.`-Präfix fällt weg: die Suche verbindet Tabellen und muss
 * qualifizieren — verglichen werden die Spalten, nicht die Schreibweise.
 *
 * ÜBERALL im Eintrag und nicht nur am Anfang. Der erste Wurf schnitt nur vorn,
 * und dann sind `labels_of(id) AS labels` und `labels_of(t.id) AS labels` zwei
 * verschiedene Einträge — der Wächter meldete einen Unterschied, den es nicht
 * gab. Aufgefallen bei genau dieser Zeile, also gleich hier notiert: nicht
 * jede Aufzählung besteht aus nackten Spaltennamen.
 */
function columnsOf(file, name) {
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf(`const ${name} = \``);
  if (at === -1) return null;
  const open = text.indexOf('`', at + `const ${name} = `.length);
  const close = text.indexOf('`', open + 1);
  if (close === -1) return null;
  return text
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim().replace(/\bt\./g, ''))
    .filter((s) => s !== '');
}

const lists = [];
for (const { file, name } of SOURCES) {
  const columns = columnsOf(file, name);
  if (columns === null) {
    problems.push(`${file}: kein \`const ${name} = \\\`…\\\`\` gefunden`);
    continue;
  }
  lists.push({ file, columns: columns.filter((c) => !NUR_DETAIL.has(c)) });
}

if (lists.length === SOURCES.length) {
  // Die erste ist der Maßstab, und zwar `RETURNING`: was geschrieben wird, ist
  // die vollständige Menge — eine Ansicht, die weniger liest, liest etwas nicht,
  // das es gibt.
  const [first, ...rest] = lists;
  for (const other of rest) {
    const fehlt = first.columns.filter((c) => !other.columns.includes(c));
    const zuviel = other.columns.filter((c) => !first.columns.includes(c));
    if (fehlt.length > 0) {
      problems.push(
        `${other.file}: fehlt gegenüber ${first.file}: ${fehlt.join(', ')}`,
      );
    }
    if (zuviel.length > 0) {
      problems.push(
        `${other.file}: kennt Spalten, die ${first.file} nicht schreibt: ${zuviel.join(', ')}`,
      );
    }
    // Auch die REIHENFOLGE, und das ist kein Ordnungssinn: die Zeilen kommen als
    // Objekte zurück, aber `queryRows<TaskRow>` glaubt der Reihenfolge nicht —
    // eine abweichende Ordnung ist trotzdem der erste Hinweis darauf, dass eine
    // Liste von Hand nachgepflegt wurde statt kopiert.
    if (
      fehlt.length === 0 &&
      zuviel.length === 0 &&
      other.columns.join(',') !== first.columns.join(',')
    ) {
      problems.push(
        `${other.file}: dieselben Spalten in anderer Reihenfolge als ${first.file}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('check-task-columns: die Spaltenlisten laufen auseinander\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nEine Aufgabe wird an vier Stellen gelesen. Eine Spalte in nur dreien ist',
  );
  console.error(
    'eine Zeile, die in einer Ansicht einen Wert hat und in der nächsten nicht.',
  );
  process.exit(1);
}

console.log(
  `check-task-columns: ${SOURCES.length} Listen, ${lists[0].columns.length} Spalten, einig` +
    (NUR_DETAIL.size > 0 ? ` (ausgenommen: ${[...NUR_DETAIL].join(', ')})` : ''),
);
