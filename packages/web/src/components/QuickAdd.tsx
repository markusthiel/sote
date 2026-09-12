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

import { formatDuration, parseQuickAdd, describe as describeRecurrence } from '@sote/core';

import { browserZone } from '../api.js';
import { useMemo, useRef, useState } from 'react';

import { whenLabel } from '../dates.js';

const PRIORITY_NAMES = ['', 'Dringend', 'Wichtig', 'Normal', 'Später'] as const;

export function QuickAdd({
  now,
  onSubmit,
  busy,
  unknownProject,
  hint,
  people,
}: {
  now: Date;
  /**
   * Die Zeile — und wen das Popup hinter `@` AUSGEWÄHLT hat, als Ids.
   *
   * `chosen` ist der Schlüssel des Tokens (kleingeschrieben, ohne `@`) auf die
   * Konto-Id. Fehlt ein Token darin, hat jemand den Namen getippt statt
   * gewählt, und der Server löst ihn wie bisher über den Namen auf.
   */
  onSubmit: (line: string, chosen: Readonly<Record<string, string>>) => void;
  busy: boolean;
  unknownProject: string | null;
  /** Ein anderer Platzhalter, wo ein anderes Versprechen gilt. */
  hint?: string;
  /**
   * Wer hier mitarbeitet — für die Auswahl hinter `@`.
   *
   * GEWÜNSCHT: „Beim Zuweisen eines Users über @ sollte es ein Dropdown geben,
   * um den User auszuwählen. Das ist intuitiver — so schreibt man was rein und
   * weiss gar nicht, ob es korrekt war."
   *
   * Fehlt die Liste (in einer Freigabe gibt es keine), tippt man wie bisher.
   * Ein Feld, das ohne Vorschläge NICHT mehr funktioniert, wäre eine
   * Verschlechterung mit Beiwerk.
   */
  people?: readonly { id: string; name: string }[];
}) {
  const [line, setLine] = useState('');
  /** Wo der Cursor steht — `null` heisst: die Auswahl ist zu. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [gewaehlt, setGewaehlt] = useState(0);
  /**
   * WEN DAS POPUP EINGESETZT HAT — Token → Konto-Id.
   *
   * Markus: „Ich habe in dem kleinen Popup den Namen explizit ausgewählt,
   * also dürfte die Zuweisung ja nur eine Möglichkeit gehabt haben." Hatte
   * sie nicht: `waehle` schrieb nur den Vornamen in die Zeile und warf die Id
   * weg, und der Server suchte danach wieder nach dem Wort. Bei zwei Leuten
   * mit demselben Vornamen war die Auswahl damit umsonst — die Meldung „passt
   * auf mehrere Leute" kam über eine Person, auf die man gerade geklickt hat.
   *
   * Eine Auswahl ist eine Entscheidung. Sie wird hier behalten und geht mit
   * der Zeile hinaus; der Server nimmt die Id, wenn das Token noch dasteht.
   */
  const [ausgewaehlt, setAusgewaehlt] = useState<Record<string, string>>({});
  const feld = useRef<HTMLInputElement | null>(null);

  /*
   * Rein und ohne Server: das Parsen ist eine Funktion, kein Aufruf.
   *
   * MIT DER ZONE DES BROWSERS, und das war der gemeldete Fehler: „In dieser
   * kleinen Vorschau unter dem Text erscheint dann die falsche Uhrzeit, da
   * steht 11 Uhr anstatt 9 Uhr. Eingetragen wird es korrekt."
   *
   * Genau so: der Server bekommt die Zone an jeder Anfrage mit und rechnet
   * richtig; die Vorschau rief dieselbe Funktion OHNE sie auf und las „9 Uhr"
   * darum als UTC — angezeigt wurde die örtliche Entsprechung, also 11:00.
   *
   * Dieselbe Sorte Fehler stand hier schon einmal, und der Kommentar an
   * `zoneOfBrowser` beschreibt sie wörtlich: „morgen 9 Uhr eingetippt, morgen
   * 11:00 angezeigt". Behoben wurde damals der Weg zum Server — die Vorschau
   * blieb übrig, weil sie denselben Weg nicht nimmt.
   */
  const parsed = useMemo(
    () => (line.trim() === '' ? undefined : parseQuickAdd(line, { now, zone: browserZone() })),
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
    if (parsed.duration !== undefined) {
      chips.push({ label: 'dauer', value: formatDuration(parsed.duration) });
    }
    if (parsed.priority !== undefined) {
      chips.push({ label: 'priorität', value: PRIORITY_NAMES[parsed.priority]! });
    }
  }

  /*
   * WELCHER NAME GERADE GETIPPT WIRD.
   *
   * Gelesen wird der Text VOR dem Cursor: wer mitten in einer Zeile ein `@`
   * ergänzt, meint diese Stelle und nicht das Ende. Darum die Cursorposition
   * und nicht der ganze Wert.
   *
   * `undefined` heisst „kein Name im Gange" — und dann ist die Liste zu. Ein
   * Vorschlagsfeld, das offen bleibt, während man längst weiterschreibt, ist
   * ein Fenster vor der eigenen Zeile.
   */
  const angefangen = ((): { von: number; wort: string } | undefined => {
    if (people === undefined || people.length === 0) return undefined;
    const bis = cursor ?? line.length;
    const m = /(^|\s)@([^\s@#+!~]*)$/.exec(line.slice(0, bis));
    if (m === null) return undefined;
    return { von: bis - m[2]!.length - 1, wort: m[2]!.toLowerCase() };
  })();

  const treffer =
    angefangen === undefined
      ? []
      : people!
          .filter((p) => p.name.toLowerCase().includes(angefangen.wort))
          /* Höchstens sechs: eine Liste, die den halben Bildschirm füllt,
             liest niemand — sie wird überflogen und dann weggetippt. */
          .slice(0, 6);

  /** Den angefangenen Namen durch den gewählten ersetzen — und die Id behalten. */
  function waehle(person: { id: string; name: string }) {
    if (angefangen === undefined) return;
    const bis = cursor ?? line.length;
    /*
     * Ein Leerzeichen dahinter, und der Cursor davor: nach einer Auswahl
     * schreibt man weiter, nicht mitten im Namen. Namen mit Leerzeichen
     * bekommen keine Anführungszeichen — in der Zeile steht der Vorname, aber
     * WER gemeint ist, steht in `ausgewaehlt` und reist als Id mit.
     */
    const kurz = person.name.split(/\s+/)[0]!;
    const neu = `${line.slice(0, angefangen.von)}@${kurz} ${line.slice(bis)}`;
    setLine(neu);
    setAusgewaehlt((alt) => ({ ...alt, [kurz.toLowerCase()]: person.id }));
    setGewaehlt(0);
    const stelle = angefangen.von + kurz.length + 2;
    // Nach dem Zeichnen: vorher steht der alte Wert im Feld.
    requestAnimationFrame(() => {
      feld.current?.focus();
      feld.current?.setSelectionRange(stelle, stelle);
      setCursor(stelle);
    });
  }

  function submit() {
    const value = line.trim();
    if (value === '' || busy) return;
    /*
     * Nur, was noch in der Zeile steht. Wer nach der Auswahl das Wort
     * überschrieben oder gelöscht hat, hat die Entscheidung zurückgenommen —
     * eine Id für ein Token, das es nicht mehr gibt, wäre eine Zuweisung, die
     * niemand sieht.
     */
    const chosen: Record<string, string> = {};
    for (const name of parsed?.assignees ?? []) {
      const id = ausgewaehlt[name.toLowerCase()];
      if (id !== undefined) chosen[name.toLowerCase()] = id;
    }
    onSubmit(value, chosen);
    // Offen bleiben. Wer eine Aufgabe notiert, notiert oft die nächste.
    setLine('');
    setAusgewaehlt({});
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
    for (const z of zeilen) onSubmit(z, {});
    return true;
  }

  return (
    <div className="quick">
      <div className="quick-field">
        <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
          +
        </span>
        <input
          ref={feld}
          value={line}
          onChange={(e) => {
            setLine(e.target.value);
            setCursor(e.target.selectionStart);
            setGewaehlt(0);
          }}
          onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
          onClick={(e) => setCursor(e.currentTarget.selectionStart)}
          onBlur={() => {
            /* Beim Verlassen zu — aber erst nach dem Klick, sonst ist die
               Liste weg, bevor die Wahl ankommt. */
            setTimeout(() => setCursor(null), 120);
          }}
          onPaste={(e) => {
            // Nur eingreifen, wenn wirklich mehrere Zeilen kommen — bei einer
            // einzelnen soll Einfügen ganz normal einfügen.
            if (busy) return;
            if (pasteLines(e.clipboardData.getData('text'))) e.preventDefault();
          }}
          onKeyDown={(e) => {
            /*
             * SOLANGE DIE LISTE OFFEN IST, GEHÖREN IHR DIE TASTEN.
             *
             * Enter wählt dann aus, statt die Aufgabe anzulegen — sonst legt
             * ein Druck auf Enter eine Aufgabe mit halbem Namen an, und genau
             * das war die Meldung: „man weiss gar nicht, ob es korrekt war".
             *
             * Escape schliesst nur die Liste und leert nicht die Zeile: zwei
             * Wirkungen auf einer Taste, und die kleinere zuerst.
             */
            if (treffer.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setGewaehlt((i) => (i + 1) % treffer.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setGewaehlt((i) => (i - 1 + treffer.length) % treffer.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                waehle(treffer[gewaehlt] ?? treffer[0]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setCursor(null);
                return;
              }
            }
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

      {/*
        Die Auswahl steht UNTER dem Feld und über den Merkmalen: sie gehört zu
        dem, was gerade getippt wird, und die Merkmale beschreiben, was schon
        dasteht.
      */}
      {treffer.length > 0 ? (
        <ul className="quick-people" role="listbox" aria-label="Wer ist gemeint">
          {treffer.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === gewaehlt}
                className="quick-person"
                data-on={i === gewaehlt ? 'yes' : undefined}
                onMouseEnter={() => setGewaehlt(i)}
                onClick={() => waehle(p)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

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
