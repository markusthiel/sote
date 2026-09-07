/**
 * SOTE — eine Aufgabenzeile.
 *
 * Vier Dinge und nicht mehr: Kästchen, Titel, eine Zeile Beiwerk, rechts wer
 * zuständig ist. Die Priorität sitzt im Kästchen (Blatt 03).
 *
 * Abhaken ist **optimistisch** mit sichtbarem Rücksprung; alles andere wäre
 * eine halbe Sekunde Warten für die häufigste Handlung der Anwendung.
 */

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
  onComplete,
  onOpenMenu,
}: {
  task: Task;
  now: Date;
  pending?: boolean;
  error?: string | undefined;
  projectName?: string | undefined;
  grip?: boolean;
  menu?: import('react').ReactNode;
  onComplete: (task: Task) => void;
  onOpenMenu?: () => void;
}) {
  const done = task.completed !== null;
  const planned = task.planned === null ? null : new Date(task.planned);
  const due = task.due === null ? null : new Date(task.due);

  return (
    <div className="task" data-done={done} data-pending={pending === true}>
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
        <div className="task-title">{task.title}</div>
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
          {task.recurrence !== null ? (
            <span className="rep" title={task.recurrence.says}>
              {task.recurrence.says.replace(/\.$/, '')}
            </span>
          ) : null}
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
