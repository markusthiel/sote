/**
 * SOTE — was in einem Ordner liegt.
 *
 * GEMELDET: „Aufgaben-hinzufügen-Feld ist auch bei Ordnern sichtbar, das geht
 * ja nicht. Da bitte ausblenden und eine Ansicht hinzufügen, was unter diesem
 * Ordner liegt. Wie bei SONE, da haben wir dann Karten, die Unterordner oder
 * Unterseiten anzeigen und verlinken."
 *
 * ## Ein Ordner ordnet, ein Projekt hält
 *
 * Das steht so im Konzept (10d) und in Migration 0009 — ein Ordner ist die
 * Gliederung, kein Ort für Aufgaben. Das Erfassungsfeld dort anzubieten war
 * genau die Sorte Versprechen, die dieses Projekt sonst vermeidet: ein
 * Bedienelement, das eine Sache anbietet, die es nicht gibt.
 *
 * Und was stattdessen? Ein leerer Bildschirm mit „hier ist nichts" wäre die
 * falsche Antwort, denn hier ist etwas: die Zweige darunter. Sie standen
 * bisher nur in der Seitenleiste — und wer einen Ordner öffnet, hat sie gerade
 * dort angeklickt und sieht dann eine leere Fläche.
 *
 * ## Karten und keine Liste
 *
 * Eine Liste sähe aus wie eine Aufgabenliste und wäre keine — dasselbe
 * Missverständnis, nur andersherum. Karten sagen „das sind Orte, keine
 * Vorgänge", und sie tragen, was man zum Wählen braucht: Zeichen, Name, und
 * wie viel dort offen ist.
 *
 * ## Echte Links
 *
 * Wie im Baum: `a href` und kein Knopf. Ein Ziel mit einer Adresse gehört in
 * ein `a` — dann gehen Mittelklick und „in neuem Tab öffnen", und die
 * Statuszeile zeigt, wohin es führt.
 */

import { colorValue } from '@sote/core';

import type { Project } from '../api.js';
import { ProjectMark } from '../components/ProjectMark.js';
import { pathOf } from '../route.js';

export function FolderView({
  folder,
  projects,
  onOpen,
}: {
  folder: Project;
  /** Alle Projekte des Bereichs — die Kinder werden hier herausgesucht. */
  projects: readonly Project[];
  onOpen: (id: string) => void;
}) {
  /*
   * In der Reihenfolge des Baums, nicht alphabetisch.
   *
   * Wer die Zweige in der Leiste sortiert hat, hat damit eine Reihenfolge
   * gewählt — eine zweite hier wäre eine zweite Antwort auf dieselbe Frage,
   * und beim ersten Ziehen liefen sie auseinander.
   */
  const kinder = projects
    .filter((p) => p.parentId === folder.id)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  if (kinder.length === 0) {
    return (
      <div className="empty">
        <strong>Dieser Ordner ist leer.</strong>
        {/*
          Der Satz sagt, was hier hineingehört, und nicht nur, dass nichts da
          ist. „Leer" allein lässt offen, ob man hier Aufgaben erwarten dürfte.
        */}
        Ein Ordner ordnet, ein Projekt hält die Aufgaben. Leg über das Menü am
        Ordner ein Projekt oder einen Unterordner an.
      </div>
    );
  }

  return (
    <div className="folder-grid">
      {kinder.map((kind) => (
        <a
          key={kind.id}
          className="folder-card"
          href={pathOf({ kind: 'project', projectId: kind.id })}
          draggable={false}
          onClick={(e) => {
            // Die Zusatztasten bleiben dem Browser — wer einen zweiten Tab
            // will, soll ihn bekommen.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onOpen(kind.id);
          }}
        >
          <ProjectMark
            icon={kind.icon?.icon}
            /* Ohne gewähltes Zeichen unterscheidet die Vorgabe die Arten —
               dieselbe Regel wie im Baum, damit eine Karte und ihre Zeile in
               der Leiste dasselbe zeigen. */
            kind={kind.kind}
            /* Durch `colorValue`: ein Palettenname ist keine CSS-Farbe, und
               roh im `style` wäre er ein Wort, das der Browser ignoriert. */
            color={colorValue(kind.icon?.iconColor ?? kind.color)}
            name={kind.name}
          />
          <span className="folder-card-name">{kind.name}</span>
          {/*
            `null` und nicht 0: eine Zahl über nichts ist Rauschen. Der Server
            liefert es schon so, hier wird es nur nicht erfunden.
          */}
          {kind.open === null ? null : (
            <span className="folder-card-count">{kind.open} offen</span>
          )}
        </a>
      ))}
    </div>
  );
}
