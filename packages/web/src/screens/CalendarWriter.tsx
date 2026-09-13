import { useEffect, useId, useState } from 'react';
import { calendarAccessLabel } from '../components/CalendarAccess.js';
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
  const [calendars, setCalendars] = useState<{ url: string; name: string; writable: boolean | null }[]>([]);
  const [selected, setSelected] = useState<string[]>(writer?.workspaces ?? []);
  const [mode, setMode] = useState<Writer['mode']>(writer?.mode ?? 'planned');
  const [timezone, setTimezone] = useState(writer?.timezone ?? browserZone());
  const [enabled, setEnabled] = useState(writer?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmConflict, setConfirmConflict] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [provider, setProvider] = useState<'icloud' | 'caldav'>(source.provider === 'icloud' ? 'icloud' : 'caldav');
  const reusable = source.kind === 'caldav';
  const cloud = source.kind === 'google'||source.kind==='microsoft';
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

  if (!writer && !cloud && (source.provider === 'google' || source.provider === 'microsoft')) return <div className="calendar-writer"><h3>Dieser Kalender wird als Abo gelesen</h3><p className="muted">Verbinde diesen Kalender über „Kalender hinzufügen“ mit deinem Google- oder Microsoft-Konto, um Aufgaben zu übertragen. Das bisherige Abo kannst du anschließend entfernen.</p></div>;
  return <div className="calendar-writer">
    <h3>Welche Aufgaben sollen im Kalender erscheinen?</h3>
    <p className="muted small">SOTE → Kalender. Offene Aufgaben erscheinen mit Titel, Zeitpunkt, Dauer und Link zur Aufgabe.</p>
    {cloud?<p className="muted small">Zeitpunkte ohne Dauer erscheinen bei Google und Microsoft als einminütiger Termin.</p>:null}
    <details className="calendar-source-future"><summary>So funktioniert der Abgleich</summary><p className="muted small">Erledigte, gelöschte oder nicht mehr ausgewählte Aufgaben werden aus dem Zielkalender entfernt. Fremde Änderungen werden als Konflikt gemeldet. Änderungen im Kalender werden nicht nach SOTE zurückgeschrieben. Der Abgleich läuft etwa jede Minute.</p></details>
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
        setUrl(''); setUsername(''); setPassword(''); setCalendars([]);
      }, enabled ? 'Zugang geprüft und gespeichert. Der Abgleich wurde angefordert.' : 'Zugang geprüft und gespeichert. Das Schreiben ist pausiert.');
    }}>
      <fieldset className="calendar-source-fields" disabled={busy || !possible}>
        {cloud?<p className="muted small">Der Zugang deines verbundenen Kontos wird verwendet. Eine erneute Kennworteingabe ist nicht nötig.</p>:<details className="calendar-access" open={!writer && !reusable ? true : undefined}>
        <summary>{writer || reusable ? 'Kalenderzugang · gespeichert' : 'Kalenderzugang einrichten'}</summary>
        {reusable ? <p className="muted small">Der private Zugang dieses Kalenders wird verwendet. Du kannst die Felder leer lassen.</p> : null}
        <div className="calendar-source-fields">
        <label htmlFor={`${id}-provider`}>Anbieter</label>
        <select id={`${id}-provider`} className="set-input" value={provider} onChange={(e) => { setProvider(e.target.value as 'icloud' | 'caldav'); setCalendars([]); }}><option value="icloud">iCloud</option><option value="caldav">Nextcloud / anderer CalDAV-Anbieter</option></select>
        <label htmlFor={`${id}-url`}>{provider === 'icloud' ? 'Kalenderadresse' : 'Server- oder Kalenderadresse'}</label>
        <input id={`${id}-url`} type="url" className="set-input" required={!writer && !reusable} autoComplete="off" spellCheck={false}
          placeholder={writer ? 'Gespeichert · leer lassen zum Beibehalten' : 'https://kalender.example/dav/calendars/name/privat/'}
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="muted small">{provider === 'icloud' ? 'Die Kalendersuche ermittelt die private Adresse. Öffentliche webcal-Links erlauben kein Schreiben.' : 'Mit „Kalender suchen“ den gewünschten Kalender ermitteln oder dessen vollständige CalDAV-Adresse eintragen.'}</p>
        <label htmlFor={`${id}-username`}>CalDAV-Benutzername</label>
        <input id={`${id}-username`} className="set-input" required={!writer && !reusable} autoComplete="off"
          placeholder={writer || reusable ? 'Gespeichert · leer lassen zum Beibehalten' : 'Benutzername beim Anbieter'} value={username} onChange={(e) => { setUsername(e.target.value); setCalendars([]); }} />
        <label htmlFor={`${id}-password`}>App-Kennwort</label>
        <input id={`${id}-password`} type="password" className="set-input" required={!writer && !reusable} autoComplete="new-password"
          placeholder={writer ? 'Gespeichert · leer lassen zum Beibehalten' : ''} value={password} onChange={(e) => { setPassword(e.target.value); setCalendars([]); }} />
        {provider === 'icloud' ? <p className="muted small"><a href="https://support.apple.com/de-de/102654" target="_blank" rel="noreferrer">App-Passwort bei Apple erstellen</a></p> : null}
        <button type="button" className="btn small" disabled={!username.trim() || !password.trim() || (provider === 'caldav' && !url.trim())} onClick={() => {
          setCalendars([]);
          void action(async () => {
            const found = await api.discoverCalendars({ provider, url: url.trim(), username: username.trim(), password: password.trim() });
            const writable = found.calendars.filter((c) => c.writable !== false);
            if (!writable.length) throw new ApiError(400, 'no_writable_calendars', 'Keine Kalender mit Schreibrechten gefunden.');
            setCalendars(writable); setUrl(''); setPassword(password.trim());
          }, 'Kalender gefunden. Wähle denselben Kalender wie bei deiner Leseverbindung.');
        }}>Kalender suchen</button>
        {calendars.length > 0 ? <>
          <label htmlFor={`${id}-icloud`}>Zielkalender</label>
          <select id={`${id}-icloud`} className="set-input" required value={calendars.some((calendar) => calendar.url === url) ? url : ''} onChange={(e) => setUrl(e.target.value)}>
            <option value="">Kalender auswählen …</option>
            {calendars.map((calendar) => <option key={calendar.url} value={calendar.url}>{calendar.name} · {calendarAccessLabel(calendar.writable)}</option>)}
          </select>
        </> : null}
        </div></details>}
        <span id={`${id}-workspaces`}>Aufgaben aus diesen Arbeitsbereichen</span>
        <div className="calendar-workspace-grid" role="group" aria-labelledby={`${id}-workspaces`}>
          {workspaces.map((workspace) => <label className="pick" key={workspace.id}>
            <input type="checkbox" checked={selected.includes(workspace.id)} onChange={(e) => {
              setSelected(e.target.checked ? [...selected, workspace.id] : selected.filter((id) => id !== workspace.id));
            }} />{workspace.name}
          </label>)}
        </div>
        <label htmlFor={`${id}-mode`}>Übertragen werden</label>
        <select id={`${id}-mode`} className="set-input" value={mode} onChange={(e) => setMode(e.target.value as Writer['mode'])}>
          <option value="planned">Geplante Aufgaben</option><option value="due">Fristen</option><option value="both">Plan und Frist als getrennte Termine</option>
        </select>
        <details className="calendar-source-future"><summary>Weitere Optionen</summary>
        <label htmlFor={`${id}-timezone`}>Zeitzone für ganztägige Aufgaben</label>
        <input id={`${id}-timezone`} className="set-input" required value={timezone} placeholder="Europe/Berlin" onChange={(e) => setTimezone(e.target.value)} />
        </details>
        <label className="pick calendar-enable"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Aufgaben automatisch übertragen</label>
        <button type="submit" className="btn calendar-primary" disabled={busy || selected.length === 0}>{busy ? 'Prüft …' : 'Einstellungen speichern'}</button>
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
        await api.disconnectCalendarWriter(source.id); setConfirm(false); setPassword(''); setUsername(''); setUrl(''); setCalendars([]);
      }, 'Schreibverbindung getrennt.')}>Ja, trennen</button>
      <button type="button" className="btn quiet small" disabled={busy} onClick={() => setConfirm(false)}>Abbrechen</button>
    </div> : null}
    {notice ? <p className="muted" role="status">{notice}</p> : null}
    {error ? <p className="note-error" role="alert">{error}</p> : null}
  </div>;
}
