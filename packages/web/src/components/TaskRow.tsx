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

import type { Task } from '../api.js';
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
}) {
  const done = task.completed !== null;
  const planned = task.planned === null ? null : new Date(task.planned);
  const due = task.due === null ? null : new Date(task.due);

  return (
    <div
      className="task"
      data-done={done}
      data-pending={pending === true}
      data-open={open === true}
    >
      {grip === true ? (
        <span className="grip" aria-hidden="true" title="ziehen, oder Alt und Pfeiltaste">
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
          {projectName !== undefined ? (
            <span className="crumb">
              <span className="p-sq" aria-hidden="true" />
              {projectName}
            </span>
          ) : null}
        </div>
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
