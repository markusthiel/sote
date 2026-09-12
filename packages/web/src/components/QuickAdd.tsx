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
   * Die Zeile — und wer als PILLE im Feld steht, als Konto-Ids.
   *
   * Die Pillen sind keine Wörter in der Zeile: der Server bekommt sie als
   * Ids und rät nicht. Ein getipptes `@name` OHNE Auswahl bleibt in der Zeile
   * und wird wie bisher über den Namen aufgelöst.
   */
  onSubmit: (line: string, assigneeIds: readonly string[]) => void;
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
   * WER ALS PILLE IM FELD STEHT.
   *
   * Markus, zweimal: „Ich habe in dem kleinen Popup den Namen explizit
   * ausgewählt, also dürfte die Zuweisung ja nur eine Möglichkeit gehabt
   * haben." — und dann: „Am besten wäre, wenn eine Pille entstehen würde mit
   * dem Namen. Und wenn man die Pille löscht, dann verschwindet gleich alles.
   * Dann gibt es da keine Probleme mit halben Namen."
   *
   * Vorher schrieb `waehle` den VORNAMEN als Text in die Zeile und warf die Id
   * weg; der Server suchte danach wieder nach dem Wort. Bei zwei Leuten mit
   * demselben Vornamen war die Auswahl umsonst — und „Markus Thiel" liess
   * sich gar nicht schreiben, weil das Leerzeichen das Zeichen beendet.
   *
   * Jetzt ist eine gewählte Person KEIN Wort in der Zeile mehr. Sie steht als
   * Pille mit ganzem Namen vor dem Text, reist als Id hinaus, und geht mit
   * einem Klick oder Rückschritt ganz — nicht buchstabenweise.
   */
  const [pillen, setPillen] = useState<{ id: string; name: string }[]>([]);
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
          // Wer schon als Pille steht, wird nicht nochmal angeboten.
          .filter((p) => !pillen.some((q) => q.id === p.id))
          /* Höchstens sechs: eine Liste, die den halben Bildschirm füllt,
             liest niemand — sie wird überflogen und dann weggetippt. */
          .slice(0, 6);

  /** Das angefangene `@wort` aus der Zeile nehmen und die Person als Pille setzen. */
  function waehle(person: { id: string; name: string }) {
    if (angefangen === undefined) return;
    const bis = cursor ?? line.length;
    /*
     * Das `@` und das Angefangene verschwinden aus dem Text; was bleibt, wird
     * an der Stelle zusammengezogen, ohne doppeltes Leerzeichen. Der Cursor
     * steht danach, wo das `@` stand — man schreibt weiter, als hätte man
     * nie abgebogen.
     */
    const davor = line.slice(0, angefangen.von).replace(/\s+$/, '');
    const danach = line.slice(bis).replace(/^\s+/, '');
    const neu = davor === '' ? danach : danach === '' ? davor : `${davor} ${danach}`;
    setLine(neu);
    // Dieselbe Person zweimal ist eine Person.
    setPillen((alt) => (alt.some((p) => p.id === person.id) ? alt : [...alt, person]));
    setGewaehlt(0);
    const stelle = davor === '' ? 0 : davor.length + 1;
    // Nach dem Zeichnen: vorher steht der alte Wert im Feld.
    requestAnimationFrame(() => {
      feld.current?.focus();
      feld.current?.setSelectionRange(stelle, stelle);
      setCursor(stelle);
    });
  }

  function submit() {
    const value = line.trim();
    // Eine Pille ohne Text ist noch keine Aufgabe: ein Titel fehlt.
    if (value === '' || busy) return;
    onSubmit(
      value,
      pillen.map((p) => p.id),
    );
    // Offen bleiben. Wer eine Aufgabe notiert, notiert oft die nächste.
    setLine('');
    setPillen([]);
  }

  function pilleWeg(id: string) {
    setPillen((alt) => alt.filter((p) => p.id !== id));
    feld.current?.focus();
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
   * `morgen 9 Uhr`, `+projekt` und `!!` je Zeile. Ein Absatz aus einer Mail
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
    for (const z of zeilen) onSubmit(z, []);
    return true;
  }

  return (
    <div className="quick">
      <div className="quick-field">
        <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
          +
        </span>
        {pillen.map((p) => (
          <span key={p.id} className="quick-pill">
            <span aria-hidden="true">@</span>
            {p.name}
            <button
              type="button"
              className="quick-pill-x"
              aria-label={`${p.name} entfernen`}
              // Vor dem Klick, damit das Feld den Fokus nicht erst verliert
              // und die Liste zuklappt.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pilleWeg(p.id)}
            >
              ×
            </button>
          </span>
        ))}
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
            /*
             * Rückschritt am Anfang nimmt die letzte Pille — GANZ. Das ist der
             * Punkt an einer Pille: sie ist ein Ding, kein Wort, und geht als
             * eines. Buchstabenweise gelöschte Namen waren halbe Namen, die
             * der Server dann für jemand anderen hielt.
             */
            if (
              e.key === 'Backspace' &&
              pillen.length > 0 &&
              e.currentTarget.selectionStart === 0 &&
              e.currentTarget.selectionEnd === 0
            ) {
              e.preventDefault();
              pilleWeg(pillen[pillen.length - 1]!.id);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setLine('');
              setPillen([]);
            }
          }}
          /*
           * Der Platzhalter ist ein VERSPRECHEN, und es muss stimmen.
           *
           * Er nannte `+haus` — und über eine Freigabe gilt `+projekt` nicht:
           * dort ist das Projekt gesetzt, sonst wäre die Schnellerfassung ein
           * Weg aus dem eigenen Gegenstand hinaus (Konzept 10e). Im Bild
           * stand also eine Anleitung für etwas, das der Server absichtlich
           * ignoriert — dieselbe Sorte Fehler wie ein Knopf, der nichts tut,
           * nur in Worten.
           */
          placeholder={hint ?? 'Aufgabe hinzufügen — „morgen 9 Uhr +haus !!“'}
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
