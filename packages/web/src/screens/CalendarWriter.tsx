import { useEffect, useId, useState } from 'react';
import { api, ApiError, browserZone, type CalendarSource, type CalendarWriter as Writer } from '../api.js';

/** Der Schreibzugang gehört genau einem Kalender. Zugangsdaten werden nie zurückgeliefert. */
export function CalendarWriter({ source, workspaces, possible, reload }: {
  source: CalendarSource; workspaces: readonly { id: string; name: string }[];
  possible: boolean; reload: () => Promise<void>;
}) {
  const writer = source.writing;
  const id = useId();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<string[]>(writer?.workspaces ?? []);
  const [mode, setMode] = useState<Writer['mode']>(writer?.mode ?? 'planned');
  const [timezone, setTimezone] = useState(writer?.timezone ?? browserZone());
  const [enabled, setEnabled] = useState(writer?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmConflict, setConfirmConflict] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const scopeKey = JSON.stringify(writer?.workspaces ?? []);
  useEffect(() => {
    setSelected(JSON.parse(scopeKey) as string[]);
    setMode(writer?.mode ?? 'planned'); setTimezone(writer?.timezone ?? browserZone()); setEnabled(writer?.enabled ?? false);
  }, [scopeKey, writer?.mode, writer?.timezone, writer?.enabled]);

  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true); setNotice(undefined); setError(undefined);
    try { await fn(); setNotice(message); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Der Schreibzugang konnte nicht geändert werden.'); }
    finally { setBusy(false); }
  }

  return <details className="calendar-source-future" open={writer !== undefined && writer !== null ? true : undefined}>
    <summary>Aufgaben in diesen Kalender schreiben</summary>
    <p className="muted small">SOTE überträgt offene Aufgaben aus den gewählten Bereichen als Termine: Titel, Zeitpunkt, Dauer, Beschreibung und Link zur Aufgabe. Der Abgleich läuft etwa jede Minute.</p>
    <p className="muted small">Erledigte oder gelöschte Aufgaben und Einträge, die nicht mehr zur Auswahl passen, werden aus dem Zielkalender entfernt. Fremde Änderungen werden als Konflikt gemeldet. Änderungen im Zielkalender werden nicht nach SOTE zurückgeschrieben.</p>
    {writer ? <p className="muted small">
      {writer.enabled ? 'Schreiben eingeschaltet' : 'Schreiben pausiert'} · {writer.count} Kalenderkopien
      {writer.syncedAt ? ` · Zuletzt abgeglichen: ${new Date(writer.syncedAt).toLocaleString('de-DE')}` : ' · Noch kein vollständiger Abgleich'}
    </p> : null}
    {writer?.lastError ? <p className="note-error" role="alert">{writer.lastError}</p> : null}
    {writer?.conflict ? <div className="pick calendar-source-actions">
      {confirmConflict ? <>
        <span>Den gemeldeten Eintrag mit dem aktuellen SOTE-Stand überschreiben? Gehört die Aufgabe nicht mehr zur Auswahl, wird die Kalenderkopie entfernt.</span>
        <button type="button" className="btn quiet small" disabled={busy || !possible} onClick={() => void action(async () => {
          await api.resolveCalendarWriter(source.id); setConfirmConflict(false);
        }, 'Konflikt freigegeben. Beim nächsten Abgleich wird der SOTE-Stand übernommen.')}>Ja, SOTE-Stand übernehmen</button>
        <button type="button" className="btn quiet small" disabled={busy} onClick={() => setConfirmConflict(false)}>Abbrechen</button>
      </> : <button type="button" className="btn quiet small" disabled={busy || !possible} onClick={() => setConfirmConflict(true)}>Konflikt mit SOTE-Stand auflösen …</button>}
    </div> : null}
    <form className="calendar-source-form" onSubmit={(e) => {
      e.preventDefault();
      void action(async () => {
        await api.saveCalendarWriter(source.id, {
          ...(url.trim() ? { url: url.trim() } : {}), ...(username.trim() ? { username: username.trim() } : {}),
          ...(password ? { password } : {}), workspaces: selected, mode, timezone: timezone.trim(), enabled,
        });
        setUrl(''); setUsername(''); setPassword('');
      }, enabled ? 'Zugang geprüft und gespeichert. Der Abgleich wurde angefordert.' : 'Zugang geprüft und gespeichert. Das Schreiben ist pausiert.');
    }}>
      <fieldset className="calendar-source-fields" disabled={busy || !possible}>
        <label htmlFor={`${id}-url`}>CalDAV-Kalenderadresse</label>
        <input id={`${id}-url`} type="url" className="set-input" required={!writer} autoComplete="off" spellCheck={false}
          placeholder={writer ? 'Gespeichert · leer lassen zum Beibehalten' : 'https://kalender.example/dav/calendars/name/privat/'}
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="muted small">Die vollständige HTTPS-Adresse des gewünschten Kalenderordners mit abschließendem /. Du findest sie in den CalDAV-Einstellungen deines Anbieters. Bei einer Weiterleitung bitte die endgültige Kalenderadresse eintragen.</p>
        <label htmlFor={`${id}-username`}>CalDAV-Benutzername</label>
        <input id={`${id}-username`} className="set-input" required={!writer} autoComplete="off"
          placeholder={writer ? 'Gespeichert · leer lassen zum Beibehalten' : ''} value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor={`${id}-password`}>App-Kennwort</label>
        <input id={`${id}-password`} type="password" className="set-input" required={!writer} autoComplete="new-password"
          placeholder={writer ? 'Gespeichert · leer lassen zum Beibehalten' : ''} value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="muted small">Der Zugang braucht Schreibrechte für diesen Kalender. Adresse und Zugangsdaten werden verschlüsselt gespeichert. Verwende dafür ein eigenes App-Kennwort deines Anbieters.</p>
        <span id={`${id}-workspaces`}>Aufgaben aus diesen Arbeitsbereichen</span>
        <div className="calendar-source-choices" role="group" aria-labelledby={`${id}-workspaces`}>
          {workspaces.map((workspace) => <label className="pick" key={workspace.id}>
            <input type="checkbox" checked={selected.includes(workspace.id)} onChange={(e) => {
              setSelected(e.target.checked ? [...selected, workspace.id] : selected.filter((id) => id !== workspace.id));
            }} />{workspace.name}
          </label>)}
        </div>
        <label htmlFor={`${id}-mode`}>Welche Zeitpunkte?</label>
        <select id={`${id}-mode`} className="set-input" value={mode} onChange={(e) => setMode(e.target.value as Writer['mode'])}>
          <option value="planned">Geplante Aufgaben</option><option value="due">Fristen</option><option value="both">Plan und Frist als getrennte Termine</option>
        </select>
        <label htmlFor={`${id}-timezone`}>Zeitzone für ganztägige Aufgaben</label>
        <input id={`${id}-timezone`} className="set-input" required value={timezone} placeholder="Europe/Berlin" onChange={(e) => setTimezone(e.target.value)} />
        <label className="pick"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Automatisch in diesen Kalender schreiben</label>
        <button type="submit" className="btn" disabled={busy || selected.length === 0}>{busy ? 'Prüft …' : 'Zugang prüfen und speichern'}</button>
      </fieldset>
    </form>
    {writer ? <div className="pick calendar-source-actions">
      <button type="button" className="btn quiet small" disabled={busy || !possible || !writer.enabled}
        onClick={() => void action(() => api.syncCalendarWriter(source.id), 'Abgleich angefordert.')}>Jetzt abgleichen</button>
      {writer.enabled ? <button type="button" className="btn quiet small" disabled={busy}
        onClick={() => void action(() => api.pauseCalendarWriter(source.id), 'Schreiben pausiert. Vorhandene Termine bleiben im Zielkalender.')}>Schreiben pausieren</button> : null}
      <button type="button" className="btn quiet small" disabled={busy} onClick={() => setConfirm(!confirm)}>Verbindung trennen</button>
    </div> : null}
    {confirm ? <div className="pick calendar-source-actions">
      <span>Schreibzugang entfernen? Bereits übertragene Termine bleiben im Zielkalender und werden nicht mehr aktualisiert. Eine neue Verbindung erzeugt neue Kopien.</span>
      <button type="button" className="btn quiet small" disabled={busy} onClick={() => void action(async () => {
        await api.disconnectCalendarWriter(source.id); setConfirm(false); setPassword(''); setUsername(''); setUrl('');
      }, 'Schreibverbindung getrennt.')}>Ja, trennen</button>
      <button type="button" className="btn quiet small" disabled={busy} onClick={() => setConfirm(false)}>Abbrechen</button>
    </div> : null}
    {notice ? <p className="muted" role="status">{notice}</p> : null}
    {error ? <p className="note-error" role="alert">{error}</p> : null}
  </details>;
}
