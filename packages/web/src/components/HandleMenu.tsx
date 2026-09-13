/**
 * SOTE — das Anfasser-Menü.
 *
 * **Nicht optimistisch**, anders als das Abhaken (Blatt 03). Ein Datum, das
 * gesetzt aussieht und nirgends steht, ist schlimmer als eins, das eine halbe
 * Sekunde braucht — und im Unterschied zum Häkchen ist das hier nicht die
 * Handlung, die man fünfzig Mal am Tag macht.
 *
 * Die drei Zeitangaben sind dieselben wie beim Zurückstellen in SONE
 * (ADR-0075), und aus demselben Grund: **der Browser rechnet den Zeitpunkt
 * aus**, weil er die Zeitzone kennt und der Server nicht. Neben jeder steht das
 * Datum, damit niemand nachzählen muss, was „nächster Montag" heißt.
 */

import { useEffect, useRef, useState } from 'react';

import type { TaskPatch, Task } from '../api.js';
import { CalendarOffIcon } from './viewIcons.js';
import { TrashIcon } from './icons.js';
import { whenLabel } from '../dates.js';
import { TaskSchedule } from './TaskSchedule.js';

const PRIORITIES: readonly { level: 1 | 2 | 3 | 4; name: string; color: string }[] = [
  { level: 1, name: 'Dringend', color: 'var(--danger)' },
  { level: 2, name: 'Wichtig', color: 'var(--warning)' },
  { level: 3, name: 'Normal', color: 'var(--accent)' },
  { level: 4, name: 'Später', color: 'var(--line-strong)' },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Reine Funktionen — dieselben drei wie in SONEs Zurückstellen. */
export function whenOptions(now: Date): { label: string; at: Date; allDay: boolean }[] {
  const nine = (d: Date) => {
    const x = startOfDay(d);
    x.setHours(9);
    return x;
  };
  const nextMonday = () => {
    const x = startOfDay(now);
    const shift = (8 - x.getDay()) % 7 || 7;
    return addDays(x, shift);
  };
  return [
    { label: 'heute', at: startOfDay(now), allDay: true },
    { label: 'morgen früh', at: nine(addDays(now, 1)), allDay: false },
    { label: 'nächster Montag', at: nine(nextMonday()), allDay: false },
  ];
}

export function HandleMenu({
  task,
  now,
  busy,
  onPatch,
  onTrash,
  onClose,
}: {
  task: Task;
  now: Date;
  busy: boolean;
  onPatch: (fields: TaskPatch) => void;
  onTrash: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scheduling, setScheduling] = useState(false);

  // Schließen bei Klick daneben und bei Escape — an einer Stelle, damit nicht
  // jedes Popup sein eigenes Verhalten bekommt (SONEs `useDismiss`).
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div className={scheduling ? 'menu task-schedule-menu' : 'menu'} ref={box} role={scheduling ? 'dialog' : 'menu'} aria-label={scheduling ? 'Aufgabe planen' : undefined} aria-busy={busy}>
      {scheduling ? <TaskSchedule task={task} busy={busy} onSave={onPatch} onCancel={() => setScheduling(false)} /> : <>
      <div className="menu-label">Geplant</div>
      <button type="button" className="menu-item" role="menuitem" disabled={busy} onClick={() => setScheduling(true)}>Datum, Uhrzeit und Dauer …</button>
      {whenOptions(now).map((option) => (
        <button
          key={option.label}
          className="menu-item"
          role="menuitem"
          disabled={busy}
          onClick={() =>
            onPatch({
              planned: option.at.toISOString(),
              plannedAllDay: option.allDay,
            })
          }
        >
          {option.label}
          <span className="k">{whenLabel(option.at, option.allDay, now)}</span>
        </button>
      ))}
      {task.planned !== null ? (
        <button
          className="menu-item"
          role="menuitem"
          disabled={busy}
          onClick={() => onPatch({ planned: null })}
        >
          <CalendarOffIcon /> Kein Datum
        </button>
      ) : null}

      <div className="menu-label sep">Priorität</div>
      {PRIORITIES.map((p) => (
        <button
          key={p.level}
          className="menu-item"
          role="menuitem"
          disabled={busy}
          aria-current={task.priority === p.level}
          onClick={() => onPatch({ priority: p.level })}
        >
          <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
          {p.name}
          <span className="k">{p.level}</span>
        </button>
      ))}

      {/* „In den Papierkorb", nicht „Löschen": das Wort soll sagen, dass es
          einen Weg zurück gibt. Endgültig wird erst dort gelöscht. */}
      <div className="menu-label sep" />
      <button
        className="menu-item danger"
        role="menuitem"
        disabled={busy}
        onClick={onTrash}
      >
        {/* Zeichen UND Wort: der Papierkorb ist der einzige Eintrag hier, den
            man nicht durch nochmaliges Wählen zurückholt — und das einzige
            Zeichen in dieser Liste sagt genau das. */}
        <TrashIcon size={15} /> In den Papierkorb
      </button>
      </>}
    </div>
  );
}
