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
  /*
   * Die Prüfung hängt jetzt am **Modus** und nicht an einem Namen in der
   * Zeichnung. Vorher verlangte sie wörtlich `mode.id === 'inbox'` — und
   * damit genau das, was der Wächter darüber verbietet: eine zweite Liste in
   * der Zeichnung. Als der Posteingang zu den Aufgaben wanderte und die
   * Glocke Benachrichtigungen wurde, standen die beiden Wächter gegeneinander.
   *
   * Jetzt: genau ein Modus trägt `badge`, und beide Zeichnungen lesen es.
   */
  // Im QUELLTEXT gezählt, weil diese Datei `modes.tsx` als Text liest und
  // nicht importiert — mein erster Versuch schrieb `MODES.filter(…)` und hätte
  // ein Modul gebraucht, das hier nicht da ist.
  const mitBadge = [...MODES_SRC.matchAll(/^\s*badge: true,$/gm)];
  assert.equal(mitBadge.length, 1, 'genau ein Bereich trägt eine Zahl');
  // Und zwar der, hinter dem sie liegen: die Glocke. Geprüft über die Nähe im
  // Text — der Eintrag steht unmittelbar nach seinem `id`.
  const glocke = MODES_SRC.slice(MODES_SRC.indexOf("id: 'notifications'"));
  assert.match(
    glocke.slice(0, glocke.indexOf('},')),
    /badge: true/,
    'die Zahl gehört zur Glocke',
  );
  for (const file of DRAWINGS) {
    const src = read(file);
    assert.match(src, /mode\.badge === true/, `${file} zeigt kein Abzeichen`);
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

/**
 * Kommentare weg, bevor gesucht wird.
 *
 * Zweimal derselbe Fehler von mir: ein Muster schlug an einer Prosa-Zeile an,
 * die den alten Fehler beschreibt. Ein Test, der Prosa prüft, prüft die falsche
 * Sache — und Code, der seine Fehler dokumentiert, wird sonst dafür bestraft.
 */
const ohneKommentare = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('ein Umschalter schaltet in beide Richtungen', () => {
  /*
   * Der vierte Fall desselben Musters, und darum ein eigener Wächter.
   *
   * Gemeldet: „Ich kann übrigens abgehakte Aufgaben nicht wieder eröffnen."
   * Das Kästchen trug `aria-label` mit „wieder öffnen", `aria-pressed={done}`
   * und rief bei jedem Klick `api.complete` — der Server kehrt bei einer
   * erledigten Aufgabe früh zurück, also passierte nichts. Vorher waren es der
   * Kontoknopf, die Schublade und der Workspace-Wechsler.
   *
   * Geprüft wird die **Umkehrung**: wo eine Beschriftung zwei Zustände nennt,
   * muss der Handler beide Richtungen kennen. Gröber als ein Klick, läuft aber
   * bei jedem Commit.
   */
  /*
   * Die zweite Fassung dieses Wächters, und der Grund dafür ist ein fünfter
   * Fall.
   *
   * Die erste prüfte `TaskList.tsx` — und genau daneben riefen die **Suche**
   * und die **Detailspalte** weiter unbedingt `api.complete`. Ein Wächter, der
   * eine Datei prüft, sichert eine Datei; die Entscheidung stand an drei
   * Stellen.
   *
   * Jetzt steht sie an einer (`tasks/toggleDone.ts`), und geprüft wird, dass
   * **niemand sonst** `api.complete` ruft. Das ist die Prüfung, die auch den
   * nächsten Bildschirm erfasst, den es noch nicht gibt.
   */
  assert.match(read('tasks/toggleDone.ts'), /api\.reopen\(/, 'es gibt einen Weg zurück');

  for (const file of ['screens/TaskList.tsx', 'screens/Search.tsx', 'screens/Detail.tsx']) {
    assert.doesNotMatch(
      ohneKommentare(read(file)),
      /api\.complete\(/,
      `${file} hakt selbst ab statt über toggleDone — dann fehlt der Weg zurück`,
    );
  }
});

test('kein Knopf im Rahmen ohne Wirkung', () => {
  /*
   * Der Test, den es nach dem dritten Mal geben muss.
   *
   * Drei Bedienelemente sahen aus wie welche und waren keine: der Kontoknopf
   * (`onAccount={() => void 0}`), die Schublade (ein Flag, das nirgends auf
   * `true` gesetzt wurde) und der Workspace-Wechsler (ein Knopf mit Pfeil und
   * ohne `onClick`). Jedes einzelne fand nur ein Klick im Browser.
   *
   * Geprüft wird darum die **Wirkung an der Quelle**: jeder Knopf in den
   * Rahmenbauteilen trägt ein `onClick`. Das ist gröber als ein Klick, aber es
   * läuft bei jedem Commit — und es hätte alle drei gefunden.
   *
   * Was es nicht findet: ein `onClick`, das auf eine leere Funktion zeigt.
   * Deshalb steht `() => void 0` ausdrücklich als verbotenes Muster dabei.
   */
  for (const file of [
    'components/IconRail.tsx',
    'components/FootBar.tsx',
    'components/AccountMenu.tsx',
    'components/WorkspaceMenu.tsx',
    'components/TopBar.tsx',
  ]) {
    const src = ohneKommentare(read(file));
    const knoepfe = (src.match(/<button/g) ?? []).length;
    const klicks = (src.match(/onClick=/g) ?? []).length;
    assert.ok(
      klicks >= knoepfe,
      `${file}: ${knoepfe} Knöpfe, aber nur ${klicks} onClick`,
    );
    assert.doesNotMatch(
      src,
      /=\{\(\)\s*=>\s*void 0\}/,
      `${file} hat einen Knopf, der nichts tut`,
    );
  }
});
