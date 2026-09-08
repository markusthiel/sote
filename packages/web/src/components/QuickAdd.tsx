/**
 * SOTE — die Schnellerfassung.
 *
 * Ein Feld. Enter speichert, **das Feld bleibt offen** für die nächste Zeile.
 * Escape leert es; ein leeres Feld verlässt es.
 *
 * Die Chips zeigen, was der Parser **verstanden** hat, und sie kommen aus
 * `parseQuickAdd` in `@sote/core` — derselben Funktion, die der Server
 * benutzt. Wenn die Oberfläche sie nachbaute, würden Anzeige und Ergebnis beim
 * ersten Sonderfall auseinanderlaufen. Gelesen wird beim Tippen, also braucht
 * es dafür keinen Server: das ist der Unterschied zwischen einem Feld, das
 * sofort antwortet, und einem, das auf eine Runde wartet.
 */

import { parseQuickAdd, describe as describeRecurrence } from '@sote/core';
import { useMemo, useState } from 'react';

import { whenLabel } from '../dates.js';

const PRIORITY_NAMES = ['', 'Dringend', 'Wichtig', 'Normal', 'Später'] as const;

export function QuickAdd({
  now,
  onSubmit,
  busy,
  unknownProject,
  hint,
}: {
  now: Date;
  onSubmit: (line: string) => void;
  busy: boolean;
  unknownProject: string | null;
  /** Ein anderer Platzhalter, wo ein anderes Versprechen gilt. */
  hint?: string;
}) {
  const [line, setLine] = useState('');

  // Rein und ohne Server: das Parsen ist eine Funktion, kein Aufruf.
  const parsed = useMemo(
    () => (line.trim() === '' ? undefined : parseQuickAdd(line, { now })),
    [line, now],
  );

  const chips: { label: string; value: string; unknown?: boolean }[] = [];
  if (parsed !== undefined) {
    if (parsed.planned !== undefined) {
      chips.push({
        label: 'geplant',
        value: whenLabel(
          parsed.planned,
          parsed.planned.getHours() === 0 && parsed.planned.getMinutes() === 0,
          now,
        ),
      });
    }
    if (parsed.due !== undefined) {
      chips.push({ label: 'frist', value: whenLabel(parsed.due, true, now) });
    }
    if (parsed.recurrence !== undefined) {
      chips.push({
        label: 'wiederholt',
        value: describeRecurrence(parsed.recurrence).replace(/\.$/, ''),
      });
    }
    if (parsed.project !== undefined) {
      chips.push({
        label: 'projekt',
        value: parsed.project,
        unknown: unknownProject === parsed.project,
      });
    }
    for (const label of parsed.labels) chips.push({ label: 'schlagwort', value: label });
    for (const who of parsed.assignees) chips.push({ label: 'zugewiesen', value: who });
    if (parsed.priority !== undefined) {
      chips.push({ label: 'priorität', value: PRIORITY_NAMES[parsed.priority]! });
    }
  }

  function submit() {
    const value = line.trim();
    if (value === '' || busy) return;
    onSubmit(value);
    // Offen bleiben. Wer eine Aufgabe notiert, notiert oft die nächste.
    setLine('');
  }

  /**
   * Mehrere Zeilen einfügen: eine Aufgabe je Zeile.
   *
   * **Vorher verschluckte das Feld die Umbrüche.** Ein `<input>` ist einzeilig,
   * also ersetzt der Browser jeden Umbruch durch ein Leerzeichen — aus drei
   * Zeilen wurde eine Aufgabe „zeile 1 zeile 2 zeile 3". Still, und genau so
   * gemeldet.
   *
   * Was schon getippt war, bleibt **stehen**: es wird nicht mit der ersten
   * eingefügten Zeile verschmolzen und nicht weggeworfen. Wer es auch will,
   * drückt danach Enter. Die Alternative — Getipptes und Eingefügtes
   * zusammenkleben — wäre die einzige, bei der etwas verlorengehen kann.
   *
   * Jede Zeile geht durch dieselbe Erfassung wie eine getippte, also gelten
   * `morgen 9 Uhr`, `#projekt` und `!!` je Zeile. Ein Absatz aus einer Mail
   * wird damit zu einer Liste, in der die Termine schon stehen.
   */
  function pasteLines(text: string): boolean {
    const zeilen = text
      .split(/\r?\n/)
      .map((z) => z.trim())
      // Leerzeilen weg: ein Absatz aus einer Mail hat welche, und eine leere
      // Aufgabe ist keine.
      .filter((z) => z !== '');
    if (zeilen.length < 2) return false;
    for (const z of zeilen) onSubmit(z);
    return true;
  }

  return (
    <div className="quick">
      <div className="quick-field">
        <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
          +
        </span>
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onPaste={(e) => {
            // Nur eingreifen, wenn wirklich mehrere Zeilen kommen — bei einer
            // einzelnen soll Einfügen ganz normal einfügen.
            if (busy) return;
            if (pasteLines(e.clipboardData.getData('text'))) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setLine('');
            }
          }}
          /*
           * Der Platzhalter ist ein VERSPRECHEN, und es muss stimmen.
           *
           * Er nannte `#haus` — und über eine Freigabe gilt `#projekt` nicht:
           * dort ist das Projekt gesetzt, sonst wäre die Schnellerfassung ein
           * Weg aus dem eigenen Gegenstand hinaus (Konzept 10e). Im Bild
           * stand also eine Anleitung für etwas, das der Server absichtlich
           * ignoriert — dieselbe Sorte Fehler wie ein Knopf, der nichts tut,
           * nur in Worten.
           */
          placeholder={hint ?? 'Aufgabe hinzufügen — „morgen 9 Uhr #haus !!“'}
          aria-label="Aufgabe hinzufügen"
          enterKeyHint="done"
        />
      </div>

      {chips.length > 0 ? (
        <div className="chips">
          {chips.map((chip) => (
            <span
              key={`${chip.label}:${chip.value}`}
              className="chip"
              data-unknown={chip.unknown === true}
            >
              <span className="lbl">{chip.label}</span>
              {chip.value}
            </span>
          ))}
        </div>
      ) : null}

      {parsed !== undefined ? (
        <div className="quick-foot">
          <span>Enter — anlegen</span>
          <span>Esc — verwerfen</span>
          <span style={{ marginLeft: 'auto' }}>
            {parsed.title === '' ? 'noch kein Titel' : `Titel: „${parsed.title}“`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
