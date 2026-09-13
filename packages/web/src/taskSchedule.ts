import { formatDuration, parseDuration } from '@sote/core';
import type { Task, TaskPatch } from './api.js';
import { isoDate, parseIsoDate } from './calendar.js';

export interface ScheduleDraft { date: string; time: string; allDay: boolean; duration: string }
export const DURATION_CHOICES = [
  { minutes: 15, label: '15 Minuten' }, { minutes: 30, label: '30 Minuten' },
  { minutes: 60, label: '1 Stunde' }, { minutes: 120, label: '2 Stunden' },
] as const;

export function scheduleDraft(task: Pick<Task, 'planned' | 'plannedAllDay' | 'duration'>): ScheduleDraft {
  const at = task.planned ? new Date(task.planned) : null;
  return {
    date: at ? isoDate(at) : '',
    time: at && !task.plannedAllDay ? `${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}` : '09:00',
    allDay: at ? task.plannedAllDay : true,
    duration: task.duration === null ? '' : formatDuration(task.duration),
  };
}

/** Datum und Uhrzeit sind örtliche Angaben, erst der fertige Zeitpunkt wird UTC. */
export function schedulePatch(draft: ScheduleDraft): { patch: TaskPatch; error?: never } | { error: string; patch?: never } {
  const duration = draft.duration.trim() === '' ? null : parseDuration(draft.duration);
  if (duration === undefined) return { error: 'Gib eine Dauer ein, z. B. 45 min oder 1:30 h (höchstens 7 Tage).' };
  if (draft.date === '') {
    if (!draft.allDay) return { error: 'Wähle ein Datum für die Uhrzeit.' };
    return { patch: { planned: null, plannedAllDay: true, duration } };
  }
  const at = parseIsoDate(draft.date);
  if (!at) return { error: 'Wähle ein gültiges Datum.' };
  if (!draft.allDay) {
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(draft.time);
    if (!time) return { error: 'Gib eine gültige Uhrzeit ein.' };
    at.setHours(Number(time[1]), Number(time[2]), 0, 0);
    if (isoDate(at) !== draft.date || at.getHours() !== Number(time[1]) || at.getMinutes() !== Number(time[2])) {
      return { error: 'Diese Uhrzeit gibt es an diesem Tag wegen der Zeitumstellung nicht.' };
    }
  }
  return { patch: { planned: at.toISOString(), plannedAllDay: draft.allDay, duration } };
}
