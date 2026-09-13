import { useId, useLayoutEffect, useRef, useState } from 'react';
import { formatDuration, parseDuration } from '@sote/core';
import type { Task, TaskPatch } from '../api.js';
import { DURATION_CHOICES, scheduleDraft, schedulePatch } from '../taskSchedule.js';

/** Ein Entwurf: Datum, Uhrzeit und Dauer werden zusammen übernommen. */
export function TaskSchedule({ task, busy, onSave, onCancel }: {
  task: Pick<Task, 'planned' | 'plannedAllDay' | 'duration'>; busy: boolean;
  onSave: (patch: TaskPatch) => void; onCancel: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => scheduleDraft(task));
  const [error, setError] = useState<string>();
  const setDate = (date: string) => { setError(undefined); setDraft((current) => ({ ...current, date })); };
  const setTime = (time: string) => { setError(undefined); setDraft((current) => ({ ...current, time })); };
  useLayoutEffect(() => {
    const popup = form.current?.closest<HTMLElement>('[role="dialog"]');
    if (!popup) return;
    const fit = () => popup.style.setProperty('--schedule-room', `${Math.max(80, window.innerHeight - popup.getBoundingClientRect().top - 12)}px`);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true); popup.style.removeProperty('--schedule-room'); };
  }, []);
  const result = schedulePatch(draft);
  const end = result.patch?.planned && !draft.allDay && result.patch.duration
    ? new Date(new Date(result.patch.planned).getTime() + result.patch.duration * 60_000) : null;
  return <form ref={form} className="task-schedule" aria-label="Datum, Uhrzeit und Dauer" onSubmit={(e) => {
    e.preventDefault();
    if (result.error) { setError(result.error); return; }
    if (result.patch) onSave(result.patch);
  }}>
    <fieldset disabled={busy}>
      <label htmlFor={`${id}-date`}>Datum</label>
      <input id={`${id}-date`} type="date" className="set-input" value={draft.date} onInput={(e) => setDate(e.currentTarget.value)} onChange={(e) => setDate(e.target.value)} />
      <label className="pick"><input type="checkbox" checked={draft.allDay} onChange={(e) => { setError(undefined); setDraft({ ...draft, allDay: e.target.checked }); }} />Ganztägig</label>
      {!draft.allDay ? <><label htmlFor={`${id}-time`}>Uhrzeit</label><input id={`${id}-time`} type="time" step="60" required className="set-input" value={draft.time} onInput={(e) => setTime(e.currentTarget.value)} onChange={(e) => setTime(e.target.value)} /></> : null}
      <span id={`${id}-duration-label`}>Dauer</span>
      <div className="task-duration-choices" role="group" aria-labelledby={`${id}-duration-label`}>
        {DURATION_CHOICES.map(({ minutes, label }) => <button key={minutes} type="button" className="btn quiet small" aria-pressed={parseDuration(draft.duration) === minutes} onClick={() => { setError(undefined); setDraft({ ...draft, duration: formatDuration(minutes) }); }}>{label}</button>)}
      </div>
      <label htmlFor={`${id}-duration`}>Eigene Dauer</label>
      <input id={`${id}-duration`} className="set-input" value={draft.duration} placeholder="z. B. 45 min oder 1:30 h" onChange={(e) => { setError(undefined); setDraft({ ...draft, duration: e.target.value }); }} />
      <button type="button" className="btn quiet small" aria-pressed={draft.duration.trim() === ''} onClick={() => { setError(undefined); setDraft({ ...draft, duration: '' }); }}>Ohne Dauer</button>
      {draft.allDay ? <p className="muted small">Bei ganztägigen Aufgaben bleibt die Dauer eine Aufwandsschätzung. Im Kalender stehen sie oben bei den Ganztagsterminen.</p> : end ? <p className="muted small">Endet am {end.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.</p> : null}
      <div className="task-schedule-actions"><button type="submit" className="btn">{busy ? 'Speichert …' : 'Übernehmen'}</button><button type="button" className="btn quiet" onClick={onCancel}>Abbrechen</button></div>
    </fieldset>
    {error ? <p role="alert" className="note-error">{error}</p> : null}
  </form>;
}
