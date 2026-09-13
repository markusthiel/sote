import { useState } from 'react';
import type { CalendarDefault } from '@sote/core';
import { api, ApiError } from '../api.js';

export function CalendarPreferences({ value, workspace, onSaved }: {
  value: CalendarDefault; workspace: string | undefined; onSaved: (value: CalendarDefault) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  return <section className="settings-card">
    <h2>Kalenderansicht</h2>
    <div className="settings-row">
      <label className="settings-row-label" htmlFor="calendar-default"><b id="calendar-default-label">Kalender Standardansicht</b><span id="calendar-default-hint">Gilt beim Öffnen über die Navigation. „Letzte Ansicht“ merkt sich deine Auswahl in diesem Browser.</span></label>
      <div className="settings-row-value"><select id="calendar-default" aria-labelledby="calendar-default-label" aria-describedby="calendar-default-hint" value={value} disabled={busy} onChange={(e) => {
        const choice = e.target.value as CalendarDefault;
        setBusy(true); setNotice(undefined); setError(undefined);
        void api.patchSettings('user', { calendarDefault: choice }, workspace).then((out) => {
          onSaved(out.settings.calendarDefault ?? 'last'); setNotice('Gespeichert.');
        }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Speichern ging nicht.')).finally(() => setBusy(false));
      }}><option value="last">Letzte Ansicht</option><option value="day">Tag</option><option value="week">Woche</option><option value="month">Monat</option></select></div>
    </div>
    {notice ? <p className="muted small" role="status">{notice}</p> : null}
    {error ? <p className="note-error" role="alert">{error}</p> : null}
  </section>;
}
