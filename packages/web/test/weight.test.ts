/**
 * SOTE — was beim Start über die Leitung geht.
 *
 * Gemeldet: „sote hängt teilweise sekunden." Gemessen: 1018 KB Zeichensatz auf
 * **jedem** Laden, um in der Seitenleiste eine Handvoll Symbole zu zeichnen.
 *
 * Dieser Test hält das Ergebnis fest, nicht die Absicht. Ein Kommentar über
 * „nur bei Bedarf laden" ist beim nächsten `import` von oben still wieder
 * falsch; ein Test über den Dateiinhalt ist es nicht.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

test('der Zeichensatz wird nachgeladen und nicht eingebunden', () => {
  const mark = read('components/ProjectMark.tsx');
  // Ein dynamischer Import — daraus baut Rollup einen eigenen Brocken ohne
  // Vorladen.
  assert.match(mark, /import\('lucide-react'\)/);
  // Und KEIN Import von oben. `import type` ist erlaubt: Typen kosten nichts,
  // sie stehen nach dem Übersetzen nicht mehr da.
  assert.doesNotMatch(
    mark,
    /^import (?!type )[^\n]*from 'lucide-react'/m,
    'lucide steht wieder oben in der Datei — dann liegt es im Startbündel',
  );
});

test('niemand sonst bindet den Satz ein', () => {
  // Ein einziger `import ... from 'lucide-react'` irgendwo zieht ihn zurück
  // ins Startbündel, und dann ist die ganze Rechnung wieder hinfällig.
  for (const file of [
    'App.tsx',
    'modes.tsx',
    'components/ProjectTree.tsx',
    'components/IconRail.tsx',
    'components/FootBar.tsx',
    'components/AccountMenu.tsx',
    'screens/Settings.tsx',
  ]) {
    assert.doesNotMatch(read(file), /from 'lucide-react'/, `${file} bindet lucide ein`);
  }
});

test('der Rahmen zeichnet aus dem eigenen Satz, nicht aus lucide', () => {
  // Zwei Sätze, zwei Zwecke (aus SONE übernommen): icons.tsx ist der Rahmen,
  // lucide ist die Wahl der Person. Der Rahmen muss ohne Nachladen dastehen.
  // Geprüft wird der IMPORT, nicht das Wort: der Kopf der Datei erklärt die
  // Trennung zu lucide und muss das auch dürfen. Meine erste Fassung suchte
  // /lucide/i und schlug an einem Kommentar an — ein Test, der Prosa prüft,
  // prüft die falsche Sache.
  const icons = read('components/icons.tsx');
  assert.doesNotMatch(icons, /from 'lucide-react'|import\('lucide-react'\)/, 'der Rahmensatz darf nichts nachladen');
  assert.match(read('modes.tsx'), /from '\.\/components\/icons\.js'/);
});
