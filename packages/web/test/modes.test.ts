/**
 * SOTE — die Regel „eine Liste, zwei Zeichnungen" als Test.
 *
 * SONEs ADR-0072 ist keine Stilfrage: ein Modus, der in einer der beiden
 * Zeichnungen fehlt, ist ein Modus, den ein Telefon nicht erreicht. In SONE ist
 * das zweimal passiert — einmal in der Skizze zu ADR-0069, in der Workspaces
 * und Papierkorb unerreichbar gewesen wären.
 *
 * Geprüft wird der **Quelltext** der beiden Zeichnungen und nicht ihr
 * Rendering: die Frage ist nicht, was heute herauskommt, sondern ob eine der
 * beiden ihre eigene Liste führt. Ein gerenderter Vergleich wäre grün, solange
 * jemand beide Listen gleich lang hält — und genau das hält niemand.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const MODES_SRC = read('modes.tsx');
const DRAWINGS = ['components/IconRail.tsx', 'components/FootBar.tsx'] as const;

/** Die Ids aus der einen Liste, aus dem Quelltext gelesen. */
const ids = [...MODES_SRC.matchAll(/^\s*id: '([a-z]+)',$/gm)].map((m) => m[1]!);

test('die Modusliste hat Einträge und jeder trägt eine Beschriftung', () => {
  assert.ok(ids.length >= 5, `zu wenige Modi gefunden: ${ids.join(', ')}`);
  const labels = [...MODES_SRC.matchAll(/^\s*label: '([^']+)',$/gm)].map((m) => m[1]!);
  assert.equal(labels.length, ids.length, 'jede Id braucht eine Beschriftung');
  assert.equal(new Set(ids).size, ids.length, 'Ids doppelt');
});

test('beide Zeichnungen lesen MODES und führen keine eigene Liste', () => {
  for (const file of DRAWINGS) {
    const src = read(file);
    assert.match(src, /MODES\.map\(/, `${file} zeichnet nicht über MODES.map`);

    // Kein Modus darf im Quelltext einer Zeichnung als Literal auftauchen —
    // so entsteht die zweite Liste, die dann auseinanderläuft. Ausgenommen ist
    // 'inbox': das Abzeichen hängt an genau diesem Modus und muss ihn nennen.
    for (const id of ids) {
      if (id === 'inbox') continue;
      assert.equal(
        src.includes(`'${id}'`),
        false,
        `${file} nennt den Modus '${id}' wörtlich — damit gibt es zwei Listen`,
      );
    }
  }
});

test('das Abzeichen hängt am Modus und steht in beiden Zeichnungen', () => {
  // In SONE saß es auf dem Profilbild — dem einzigen Abzeichen der Anwendung,
  // auf einem Bedienelement, das ein Menü öffnet, in dem die
  // Benachrichtigungen nicht liegen (ADR-0092). Und eine Zahl, die nur eine
  // Zeichnung bekommt, ist ein Abzeichen, das ein Telefon nicht hat.
  assert.ok(ids.includes('inbox'), 'es muss einen Posteingang geben');
  for (const file of DRAWINGS) {
    const src = read(file);
    assert.match(src, /mode\.id === 'inbox'/, `${file} zeigt kein Abzeichen`);
    assert.match(src, /className="badge"/, `${file} zeichnet das Abzeichen nicht`);
  }
});

test('das Konto ist kein Modus', () => {
  // Ein Modus ist ein Ort, an dem man bleibt. Das Konto gehört zu dir und
  // steht abgesetzt (ADR-0072).
  //
  // Geprüft wird jetzt auf `AccountMenu` und nicht mehr auf einen Prop-Namen:
  // die alte Fassung suchte `onAccount`, und der Knopf dahinter hing an einer
  // leeren Funktion. Ein Test, der einen Namen prüft, sagt nichts darüber, ob
  // es die Sache gibt — er war grün, während man sich nicht abmelden konnte.
  assert.equal(ids.includes('account' as never), false);
  for (const file of DRAWINGS) {
    assert.match(read(file), /<AccountMenu/, `${file} hat kein abgesetztes Kontomenü`);
  }
});

test('beide Zeichnungen melden wirklich ab', () => {
  // Die Lehre aus dem, was der vorige Test durchgehen ließ: das Menü muss ein
  // Abmelden bekommen, und die Anwendung muss es mit `api.signOut` verbinden.
  for (const file of DRAWINGS) {
    assert.match(read(file), /onSignOut=\{onSignOut\}/, `${file} reicht das Abmelden nicht durch`);
  }
  assert.match(read('components/AccountMenu.tsx'), /Abmelden/);
  assert.match(read('App.tsx'), /api\s*\n?\s*\.signOut\(\)/, 'App ruft api.signOut nicht');
});

test('jeder Eintrag der Schiene hat eine Beschriftung für Vorleseprogramme', () => {
  // Die Schiene zeigt nur Symbole. Ohne aria-label ist sie eine Reihe
  // namenloser Knöpfe.
  assert.match(read('components/IconRail.tsx'), /aria-label=\{mode\.label\}/);
});
