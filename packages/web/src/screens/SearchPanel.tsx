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

import type { ReactNode } from 'react';

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
  /*
   * Eine Pille, nicht eine Zeile — SONEs `search-facet-tag`.
   *
   * Gemeldet: „Da könnten die Möglichkeiten in der linken Leiste etwas schöner
   * aufgebaut sein. Da steht nach wie vor einfach Text untereinander. Status
   * hat ja nur 2 Möglichkeiten, kann man da nicht nebeneinander 2 schöne
   * Buttons setzen … damit es klarere Bereiche gibt und man nicht erst alles
   * lesen muss."
   *
   * Zutreffend, und mein Fehler war die Wahl des Bauteils: `panel-menu-item`
   * ist eine Zeile für einen ORT, an den man geht. Ein Filter ist keiner — er
   * ist ein Schalter, der an oder aus ist. Neun gleich aussehende Zeilen
   * untereinander muss man lesen; neun Pillen in drei Gruppen sieht man.
   *
   * `aria-pressed` und keine Klasse: *„the state is ‚this filter is on', which
   * the browser and a screen reader both already know how to say from
   * aria-pressed"* (SONE).
   */
  const pille = (
    label: string,
    an: boolean,
    facet: Parameters<typeof buildTaskQuery>[1],
    value: string | undefined,
  ) => (
    <button
      key={`${facet}-${value ?? ''}`}
      type="button"
      className="search-facet-tag"
      aria-pressed={an}
      onClick={() => onQuery(buildTaskQuery(q, facet, an ? undefined : value))}
    >
      {label}
    </button>
  );

  /* Eine Gruppe: Beschriftung, darunter die Pillen nebeneinander. */
  const gruppe = (label: string, kinder: ReactNode) => (
    <div className="search-facet">
      <div className="sidebar-label">{label}</div>
      <div className="search-facet-tags">{kinder}</div>
    </div>
  );

  return (
    <>
      {/*
        Drei Gruppen, jede eine Reihe Pillen — SONEs `search-facet`. Die
        Beschriftung sagt, worum es geht; die Pillen sagen, was man wählen kann,
        und beides sieht man auf einen Blick statt es zu lesen.
      */}
      {gruppe(
        'Status',
        <>
          {pille('Offen', gelesen.status === 'open', 'status', 'offen')}
          {pille('Erledigt', gelesen.status === 'done', 'status', 'erledigt')}
        </>,
      )}

      {gruppe(
        'Frist',
        <>
          {pille('Überfällig', gelesen.due === 'overdue', 'frist', 'überfällig')}
          {pille('Heute', gelesen.due === 'today', 'frist', 'heute')}
          {pille('Diese Woche', gelesen.due === 'week', 'frist', 'woche')}
        </>,
      )}

      {gruppe(
        'Priorität',
        /*
          Vier Stufen, nicht drei: „Später" ist eine davon, und im ersten Anlauf
          fehlte sie hier. `'priorität'` ist der Facettenname im Kern, nicht
          `'prio'` — das ist eine der getippten Kurzformen.
        */
        [1, 2, 3, 4].map((p) =>
          pille(
            PRIORITY_NAMES[p] ?? String(p),
            gelesen.priorities.includes(p),
            'priorität',
            String(p),
          ),
        ),
      )}

      {/*
        Projekte: nur die, die es gibt, und nur wenn es mehr als eines gibt.
        Eine Gruppe „Projekt" über einer einzigen Pille ist eine Überschrift für
        etwas, das keine Wahl ist.
      */}
      {projects.filter((p) => p.kind === 'list').length > 1
        ? gruppe(
            'Projekt',
            projects
              .filter((p) => p.kind === 'list')
              .map((p) =>
                pille(
                  p.name,
                  // Verglichen ohne Rücksicht auf Groß- und Kleinschreibung:
                  // die Abfrage wird getippt, und `+Haus` und `+haus` sind
                  // dasselbe Projekt.
                  gelesen.projects.some((x) => x.toLowerCase() === p.name.toLowerCase()),
                  'projekt',
                  p.name,
                ),
              ),
          )
        : null}

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
