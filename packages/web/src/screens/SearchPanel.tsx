/**
 * SOTE — die Filter der Suche, in der Leiste.
 *
 * ## Warum hier und nicht im Bildschirm
 *
 * SONEs ADR-0069, angewandt und nicht gebogen (`claude/suche-als-ort.md`):
 *
 * > Eine Suche einzugrenzen **ist** Navigation innerhalb dieser Suche.
 *
 * Das ist die Form, die jeder andere Bereich hier hat: das Panel navigiert, der
 * Inhalt zeigt.
 *
 * ## Der Anlass
 *
 * Sechs Facetten gibt es — Projekt, Schlagwort, Zuständiger, Priorität, Status,
 * Frist —, und der einzige Weg zu ihnen war, die Syntax zu **kennen und zu
 * tippen**. Der Bildschirm zeichnet danach Chips, die sagen, was er gelesen
 * hat; das Vokabular ist also im Nachhinein auffindbar und nicht vorher. SONEs
 * Satz dazu trifft SOTE genauso:
 *
 * > Eine Suche, die Leute belohnt, die die Dokumentation gelesen haben — in
 * > einer Anwendung, deren übrige Bildschirme das nicht tun.
 *
 * ## Die Abfrage steht in der Adresse, nicht hier
 *
 * Ein Text, drei Schreiber: das Feld über dem Baum, das Feld im Bildschirm und
 * jedes Bedienelement hier. Eine Kopie im Zustand wäre eine zweite Antwort auf
 * „wonach wird gesucht", und Panel und Feld würden beim ersten Gebrauch
 * auseinanderlaufen.
 *
 * Geschrieben wird mit `buildTaskQuery` aus dem Kern — es **ersetzt oder
 * entfernt** eine Facette und lässt den Freitext samt seiner Reihenfolge in
 * Ruhe. Ein Bedienelement, das die Abfrage neu zusammensetzt, würde beim
 * Klicken den Text umsortieren, und niemand tippt gern in ein Feld, das sich
 * selbst umschreibt.
 */

import { buildTaskQuery, parseTaskQuery } from '@sote/core';

import type { Project } from '../api.js';

/*
 * Die Namen der Stufen.
 *
 * Dieselben wie in der Schnellerfassung — nachgesehen und nicht geraten: dort
 * heißen sie „Dringend, Wichtig, Normal, Später", und zwei Listen mit
 * verschiedenen Wörtern für dieselben Zahlen wären zwei Sprachen in einer
 * Anwendung.
 */
const PRIORITY_NAMES = ['', 'Dringend', 'Wichtig', 'Normal', 'Später'] as const;

export function SearchPanel({
  q,
  projects,
  onQuery,
}: {
  q: string;
  projects: readonly Project[];
  onQuery: (next: string) => void;
}) {
  // Gelesen aus der Abfrage, nicht aus eigenem Zustand: was gesetzt ist, sagt
  // die Abfrage selbst.
  const gelesen = parseTaskQuery(q);

  /** Eine Zeile: gesetzt oder nicht, und ein Klick setzt oder nimmt zurück. */
  const zeile = (
    label: string,
    an: boolean,
    facet: Parameters<typeof buildTaskQuery>[1],
    value: string | undefined,
  ) => (
    <button
      key={`${facet}-${value ?? ''}`}
      type="button"
      className="panel-menu-item"
      aria-pressed={an}
      onClick={() =>
        // Derselbe Klick nimmt zurück: ein Filter, den man nur setzen kann,
        // braucht einen zweiten Weg zum Entfernen — und der wäre die Syntax,
        // die dieses Panel gerade ersetzt.
        onQuery(buildTaskQuery(q, facet, an ? undefined : value))
      }
    >
      <span className="panel-menu-label">{label}</span>
      {an ? (
        <span className="panel-menu-count" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      {/* SONEs Aufbau: eine `.panel-menu-group` je Gruppe, mit `.sidebar-label`
          darin — der Abstand zwischen den Gruppen kommt aus der Gruppe, nicht
          aus der Beschriftung. */}
      <div className="panel-menu-group">
        <div className="sidebar-label">Status</div>
        {zeile('Offen', gelesen.status === 'open', 'status', 'offen')}
        {zeile('Erledigt', gelesen.status === 'done', 'status', 'erledigt')}
      </div>

      <div className="panel-menu-group">
        <div className="sidebar-label">Frist</div>
        {zeile('Überfällig', gelesen.due === 'overdue', 'frist', 'überfällig')}
        {zeile('Heute', gelesen.due === 'today', 'frist', 'heute')}
        {zeile('Diese Woche', gelesen.due === 'week', 'frist', 'woche')}
      </div>

      <div className="panel-menu-group">
      <div className="sidebar-label">Priorität</div>
      {/*
        Vier Stufen, nicht drei: „Später" ist eine davon, und im ersten Anlauf
        fehlte sie hier — ein Filter für eine Stufe, die es gibt, ist keine
        Auswahl, sondern eine Lücke.
      */}
      {[1, 2, 3, 4].map((p) =>
        // `'priorität'` ist der Facettenname im Kern, nicht `'prio'` — das ist
        // eine der getippten Kurzformen, und der Übersetzer hat es gemeldet.
        zeile(
          PRIORITY_NAMES[p] ?? String(p),
          gelesen.priorities.includes(p),
          'priorität',
          String(p),
        ),
      )}
      </div>

      {/*
        Projekte: nur die, die es gibt, und nur wenn es mehr als eines gibt.
        Eine Gruppe „Projekt" über einer einzigen Zeile ist eine Überschrift für
        etwas, das keine Wahl ist.
      */}
      {projects.filter((p) => p.kind === 'list').length > 1 ? (
        <div className="panel-menu-group">
          <div className="sidebar-label">Projekt</div>
          {projects
            .filter((p) => p.kind === 'list')
            .map((p) =>
              zeile(
                p.name,
                // Verglichen ohne Rücksicht auf Groß- und Kleinschreibung: die
                // Abfrage wird getippt, und `#Haus` und `#haus` sind dasselbe
                // Projekt.
                gelesen.projects.some((x) => x.toLowerCase() === p.name.toLowerCase()),
                'projekt',
                p.name,
              ),
            )}
        </div>
      ) : null}

      {/*
        Und ein Weg heraus, wenn etwas gesetzt ist.

        Nicht „Suche leeren": der Freitext bleibt. Wer „Dach" getippt und dann
        drei Filter gesetzt hat, will die Filter weg und nicht das Wort.
      */}
      {gelesen.read.length > 0 ? (
        <button
          type="button"
          className="panel-menu-item quiet"
          onClick={() => onQuery(gelesen.text)}
        >
          <span className="panel-menu-label">Filter zurücknehmen</span>
          <span className="panel-menu-count" aria-hidden="true">
            {gelesen.read.length}
          </span>
        </button>
      ) : null}
    </>
  );
}
