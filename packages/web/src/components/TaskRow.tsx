/**
 * SOTE — eine Aufgabenzeile.
 *
 * Vier Dinge und nicht mehr: Kästchen, Titel, eine Zeile Beiwerk, rechts wer
 * zuständig ist. Die Priorität sitzt im Kästchen (Blatt 03).
 *
 * Abhaken ist **optimistisch** mit sichtbarem Rücksprung; alles andere wäre
 * eine halbe Sekunde Warten für die häufigste Handlung der Anwendung.
 */

import { formatDuration } from '@sote/core';

import type { ListView } from '@sote/core';

import type { Task } from '../api.js';
import { MARKS } from './marks.js';
import { isOverdue, whenLabel } from '../dates.js';

export function TaskRow({
  task,
  now,
  pending,
  error,
  projectName,
  grip,
  menu,
  open,
  onComplete,
  onOpenMenu,
  onOpen,
  onLabel,
  view,
}: {
  task: Task;
  now: Date;
  pending?: boolean;
  error?: string | undefined;
  projectName?: string | undefined;
  grip?: boolean;
  menu?: import('react').ReactNode;
  open?: boolean;
  onComplete: (task: Task) => void;
  onOpenMenu?: () => void;
  onOpen?: () => void;
  /**
   * Ein Klick auf ein Schlagwort — führt in die Suche.
   *
   * KEIN eigener Bildschirm „alle Aufgaben mit @wort": den gibt es schon, er
   * heisst Suche und ist ein Ort mit einer Adresse (`claude/suche-als-ort.md`).
   * Ein zweiter Weg zu derselben Liste wäre einer, den man pflegen muss, damit
   * beide dasselbe zeigen.
   *
   * Fehlt der Rückruf, stehen die Etiketten trotzdem da — nur als Text. Ein
   * Knopf, der nichts tut, ist schlechter als eine Auskunft.
   */
  onLabel?: ((name: string) => void) | undefined;
  /**
   * Wie dicht gezeichnet wird (Migration 0028).
   *
   * Die Zeile entscheidet das NICHT selbst und liest auch keine Einstellung:
   * sie bekommt ein Wort. Sonst hätte jede Stelle, die eine Aufgabenzeile
   * zeichnet — Liste, Suche, später die Tafel —, ihre eigene Auflösung von
   * „was gilt hier", und drei Auflösungen sind drei Gelegenheiten, sich zu
   * unterscheiden.
   *
   * Fehlt es, gilt `full`: das war der Stand, bevor es die Einstellung gab.
   */
  view?: ListView | undefined;
}) {
  const form: ListView = view ?? 'full';
  const done = task.completed !== null;
  const planned = task.planned === null ? null : new Date(task.planned);
  const due = task.due === null ? null : new Date(task.due);

  return (
    <div
      className="task"
      data-view={form}
      data-done={done}
      data-pending={pending === true}
      data-open={open === true}
    >
      {grip === true ? (
        <span
          className="grip"
          aria-hidden="true"
          title="ziehen, oder Alt und Pfeiltaste"
          /* Kein Warten: wer den Anfasser drückt, will ziehen — dort zu rollen
             ist niemandes Absicht (siehe `usePointerDrag`). */
          data-drag-now="yes"
        >
          ⠿
        </span>
      ) : null}
      <button
        className="task-box"
        data-priority={task.priority}
        data-done={done}
        aria-label={done ? `${task.title} wieder öffnen` : `${task.title} abhaken`}
        aria-pressed={done}
        onClick={() => onComplete(task)}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 6.5 4.7 9 10 3.2"
            fill="none"
            stroke={done ? 'var(--accent-on)' : 'var(--text-muted)'}
            strokeWidth="1.8"
          />
        </svg>
      </button>

      <div className="task-mid">
        {/* Der Titel öffnet die Detailspalte. Ein eigener Knopf daneben wäre
            ein zweiter Weg in dieselbe Sache. */}
        {onOpen === undefined ? (
          <div className="task-title">{task.title}</div>
        ) : (
          <button className="task-title as-link" onClick={onOpen} aria-expanded={open === true}>
            {task.title}
          </button>
        )}
        {/*
          Die Beiwerkzeile — in `plain` gar nicht erst gezeichnet.

          NICHT per CSS versteckt: was nicht dasteht, kostet auch kein
          Zeichnen, und eine Liste mit dreihundert Zeilen zeichnet dann
          dreihundert Zeilen weniger. Vor allem aber liest ein Vorleseprogramm
          nichts vor, was `display: none` trägt — aber es läge trotzdem im
          Baum, und die Prüfung „ist die zweite Zeile weg" würde behaupten, sie
          sei da.
        */}
        {form === 'plain' ? null : (
        <div className="task-meta">
          {planned !== null ? (
            <span className={isOverdue(planned, now) ? 'when late' : 'when'}>
              {whenLabel(planned, task.plannedAllDay, now)}
            </span>
          ) : null}
          {due !== null ? (
            <span className={isOverdue(due, now) ? 'due late' : 'due'}>
              fällig {whenLabel(due, true, now)}
            </span>
          ) : null}
          {/* Die Dauer NACH den Zeitpunkten und vor dem Projekt: sie sagt,
              wie lange etwas dauert, nicht wann es ist — und ein „1:30 h"
              zwischen „morgen" und „fällig Freitag" liest sich als drittes
              Datum. */}
          {task.duration !== null ? (
            <span className="span" title="geschätzte Dauer">
              {formatDuration(task.duration)}
            </span>
          ) : null}
          {task.recurrence !== null ? (
            <span className="rep" title={task.recurrence.says}>
              {task.recurrence.says.replace(/\.$/, '')}
            </span>
          ) : null}
          {/* Die Schlagwörter zuletzt in der Beiwerkzeile, vor dem Projekt:
              es können mehrere sein, und was in der Zahl schwankt, gehört
              hinter das, was immer gleich breit ist. */}
          {task.labels.map((name) =>
            onLabel === undefined ? (
              <span key={name} className="tag">
                {name}
              </span>
            ) : (
              <button
                key={name}
                type="button"
                className="tag as-tag"
                title={`Aufgaben mit @${name} suchen`}
                onClick={() => onLabel(name)}
              >
                {name}
              </button>
            ),
          )}
          {/*
            Was an der Aufgabe hängt — Notiz, Bild, Anhang, Kommentar,
            Teilaufgaben, Zuständige, Erinnerung.

            GEMELDET: „in der Aufgabenliste würde ich gerne sehen, was die
            Aufgabe beinhaltet." Die Wiederholung stand schon da, alles andere
            nicht — nicht weil es fehlte, sondern weil es nicht mitkam: es
            liegt in eigenen Tabellen, und die Zeile fragte nur `tasks`.

            ZEICHEN UND KEINE WÖRTER: sieben Wörter in einer Zeile, die von
            Titel und Datum lebt, wären sieben zu viel. Und keine Zahlen daran
            — die Zeile sagt, DASS etwas dran ist; wer wissen will, wie viel,
            öffnet die Aufgabe.

            HINTER den Schlagwörtern und vor dem Projekt, nach derselben Regel
            wie diese: was in der Zahl schwankt, gehört hinter das, was immer
            gleich breit ist — und das Projekt bleibt der Anker am Ende.
          */}
          {task.marks.length === 0 ? null : (
            <span className="marks">
              {MARKS.filter((m) => task.marks.includes(m.id)).map(({ id, says, Icon }) => (
                <span key={id} className="mark" role="img" aria-label={says} title={says}>
                  <Icon />
                </span>
              ))}
            </span>
          )}
          {projectName !== undefined ? (
            <span className="crumb">
              <span className="p-sq" aria-hidden="true" />
              {projectName}
            </span>
          ) : null}
        </div>
        )}
        {/*
          Der Anfang der Notiz — nur in `cards`.

          Zwei Zeilen und dann Schluss (per CSS): eine Karte soll einen
          Eindruck geben, nicht den Text ersetzen. Wer die ganze Notiz will,
          öffnet die Aufgabe — sonst wäre die Liste ein zweiter Ort, an dem
          derselbe Text steht, nur unvollständig.

          Und nur, wenn wirklich etwas drinsteht: ein leeres Kästchen unter
          jedem Titel wäre Luft, die aussieht wie ein Fehler.
        */}
        {form === 'cards' && task.note.trim() !== '' ? (
          <div className="task-note">{task.note.trim()}</div>
        ) : null}
        {error !== undefined ? <div className="task-error">{error}</div> : null}
      </div>

      {onOpenMenu !== undefined ? (
        <div className="task-right">
          <button
            className="dots"
            aria-label={`Menü für ${task.title}`}
            aria-haspopup="menu"
            onClick={onOpenMenu}
          >
            ⋮
          </button>
          {menu}
        </div>
      ) : null}
    </div>
  );
}
