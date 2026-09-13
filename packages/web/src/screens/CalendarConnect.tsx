import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import { CloudCalendarConnect } from './CloudCalendarConnect.js';
import { CalendarAccess, calendarAccessLabel } from '../components/CalendarAccess.js';

export const calendarProviders = [
  { id: 'icloud', name: 'iCloud', mark: 'iC', detail: 'Privat mit deinem Apple Account verbinden' },
  { id: 'google', name: 'Google Kalender', mark: 'G', detail: 'Mit deinem Google-Konto anmelden' },
  { id: 'microsoft', name: 'Microsoft 365 / Outlook', mark: 'M', detail: 'Mit deinem Microsoft-Konto anmelden' },
  { id: 'nextcloud', name: 'Nextcloud', mark: 'N', detail: 'Mit deinem Server verbinden' },
  { id: 'caldav', name: 'Anderer CalDAV-Anbieter', mark: 'C', detail: 'Mit deinem Kalenderdienst verbinden' },
  { id: 'ics', name: 'Kalenderlink', mark: '↗', detail: 'ICS- oder webcal-Adresse abonnieren' },
] as const;
type Provider = typeof calendarProviders[number]['id'];
export const providerName = (id: string | undefined) => calendarProviders.find((p) => p.id === id)?.name ?? 'Kalenderabo';
export function ProviderMark({ provider }: { provider: string | undefined }) {
  return <span className="calendar-provider-mark" aria-hidden="true" data-provider={provider}>{calendarProviders.find((p) => p.id === provider)?.mark ?? '↗'}</span>;
}

/** Anbieter wählen, Zugang herstellen und erst nach Auswahl den Kalender speichern. */
export function CalendarConnect({ onConnected, onCancel }: { onConnected: (id: string) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [provider, setProvider] = useState<Provider | undefined>(()=>{const p=new URLSearchParams(window.location.search).get('calendar_provider');return p==='google'||p==='microsoft'?p:undefined;});
  const [subscription, setSubscription] = useState(false);
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [found, setFound] = useState<{ url: string; name: string; writable: boolean | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const privateAccess = provider === 'icloud' || provider === 'nextcloud' || provider === 'caldav';
  const selected = found.find((c) => c.url === url);
  async function find() {
    setBusy(true); setError(undefined); setFound([]); setUrl('');
    try {
      const result = await api.discoverCalendars({ provider: provider === 'icloud' ? 'icloud' : 'caldav', url: server.trim(), username: username.trim(), password: password.trim() });
      setFound(result.calendars);
      if (result.calendars.length === 1) { setUrl(result.calendars[0]!.url); setName(result.calendars[0]!.name); }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Die Kalender konnten nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  return <section className="calendar-connect" aria-label="Kalender hinzufügen">
    <div className="calendar-section-heading"><div><span className="calendar-eyebrow">NEUE VERBINDUNG</span><h2 ref={heading} tabIndex={-1}>{provider ? providerName(provider) + ' verbinden' : 'Wo liegt dein Kalender?'}</h2></div>
      <button className="btn quiet small" onClick={onCancel} disabled={busy}>Schließen</button></div>
    {!provider ? <div className="calendar-provider-grid">{calendarProviders.map((p) => <button key={p.id} className="calendar-provider-option" onClick={() => { setProvider(p.id); setError(undefined); }}>
      <ProviderMark provider={p.id} /><span><strong>{p.name}</strong><CalendarAccess writable={p.id!=='ics'} /><small>{p.detail}</small></span><span aria-hidden="true">→</span>
    </button>)}</div> : <>
      <button className="btn quiet small" disabled={busy} onClick={() => { setProvider(undefined); setSubscription(false); setFound([]); setUrl(''); setName(''); setPassword(''); setError(undefined); }}>← Anderen Anbieter wählen</button>
      {(provider==='google'||provider==='microsoft')&&!subscription?<><CloudCalendarConnect key={provider} provider={provider} onConnected={onConnected}/><button className="btn quiet small" onClick={()=>setSubscription(true)}>Kalender über einen Abo-Link verbinden · Nur Lesen</button></>:<div className="calendar-connect-body">
        <form className="calendar-source-form" onSubmit={(e) => {
          e.preventDefault();
          if (privateAccess && !selected) { void find(); return; }
          setBusy(true); setError(undefined);
          void api.addCalendarSource({ name: name.trim(), url: url.trim(), color: 'blue',
            ...(privateAccess ? { kind: 'caldav', username: username.trim(), password: password.trim() } : { kind: 'ics' }) })
            .then((source) => onConnected(source.id)).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Verbinden ging nicht.')).finally(() => setBusy(false));
        }}>
          <fieldset className="calendar-source-fields" disabled={busy}>
            {!privateAccess ? <CalendarAccess writable={false} /> : null}
            {privateAccess ? <>
              {provider !== 'icloud' ? <label className="calendar-field">Serveradresse<input className="set-input" type="url" required value={server} placeholder="https://cloud.example.de/remote.php/dav/"
                onChange={(e) => { setServer(e.target.value); setFound([]); setUrl(''); }} /><small className="muted">Dein Server oder die CalDAV-Adresse aus dessen Kalendereinstellungen.</small></label> : null}
              <div className="calendar-field-grid">
                <label className="calendar-field">{provider === 'icloud' ? 'Apple Account' : 'Benutzername'}<input className="set-input" required autoComplete="off" value={username}
                  onChange={(e) => { setUsername(e.target.value); setFound([]); setUrl(''); }} /></label>
                <label className="calendar-field">App-Passwort<input className="set-input" type="password" required autoComplete="new-password" value={password}
                  onChange={(e) => { setPassword(e.target.value); setFound([]); setUrl(''); }} /></label>
              </div>
              {!found.length ? <button className="btn calendar-primary" type="submit">{busy ? 'Kalender werden gesucht …' : 'Kalender suchen'}</button> : <>
                <label className="calendar-field">Kalender auswählen<select className="set-input" required value={url} onChange={(e) => { setUrl(e.target.value); setName(found.find((c) => c.url === e.target.value)?.name ?? ''); }}>
                  <option value="">Bitte auswählen …</option>{found.map((c) => <option key={c.url} value={c.url}>{c.name} · {calendarAccessLabel(c.writable)}</option>)}</select></label>
                {selected ? <CalendarAccess writable={selected.writable} /> : null}
                <p className="calendar-inline-status">{found.length} Kalender gefunden. {selected?.writable ? 'Aufgabenübertragung kann anschließend eingerichtet werden.' : 'Der Kalender wird zunächst nur gelesen.'}</p>
              </>}
            </> : <label className="calendar-field">Kalenderlink<input id={`${id}-url`} className="set-input" type="url" required autoComplete="off" spellCheck={false} value={url} placeholder="https://… oder webcal://…" onChange={(e) => setUrl(e.target.value)} /></label>}
            {!privateAccess || selected ? <>
              <label className="calendar-field">Name in SOTE<input className="set-input" maxLength={120} value={name} placeholder="z. B. Privat oder Team" onChange={(e) => setName(e.target.value)} /></label>
              <button className="btn calendar-primary" type="submit">{busy ? 'Verbindet …' : 'Kalender verbinden'}</button>
            </> : null}
          </fieldset>
          {error ? <p className="note-error" role="alert">{error}</p> : null}
        </form>
        <aside className="calendar-connect-help">
          <h3>{privateAccess ? 'Dein Kalender bleibt privat' : 'Termine in SOTE anzeigen'}</h3>
          <p>{privateAccess ? 'SOTE liest deine Termine über den geschützten Kalenderzugang. Eine öffentliche Freigabe ist dafür nicht nötig.' : 'Der Abo-Link zeigt deine Termine neben den Aufgaben. Änderungen werden regelmäßig eingelesen.'}</p>
          {provider === 'icloud' ? <p>Verwende ein eigenes <a href="https://support.apple.com/de-de/102654" target="_blank" rel="noreferrer">App-Passwort für SOTE</a>.</p> : null}
          {provider === 'nextcloud' ? <p>Das App-Passwort findest du in den persönlichen Sicherheitseinstellungen deiner Nextcloud.</p> : null}
          {provider === 'google' ? <p><a href="https://support.google.com/calendar/answer/37648?hl=de" target="_blank" rel="noreferrer">Anleitung bei Google</a> → Kalendereinstellungen → Kalender integrieren → Privatadresse im iCal-Format.</p> : null}
          {provider === 'microsoft' ? <p><a href="https://support.microsoft.com/en-us/office/share-an-outlook-calendar-as-view-only-with-others-353ed2c1-3ec5-449d-8c73-6931a0adab88" target="_blank" rel="noreferrer">Anleitung bei Microsoft</a> → Geteilte Kalender → Kalender veröffentlichen. Den ICS-Link verwenden.</p> : null}
          <p className="small">{privateAccess ? 'Zugangsdaten werden verschlüsselt gespeichert.' : 'Wer den Abo-Link kennt, kann die freigegebenen Termine lesen. SOTE speichert ihn verschlüsselt.'}</p>
        </aside>
      </div>}
    </>}
    {!provider ? <p className="muted small">Die Angaben zeigen die Möglichkeiten der Anbindung. Geteilte oder abonnierte Kalender können beim Anbieter auf Lesen beschränkt sein. Aufgaben werden erst nach deiner Aktivierung übertragen.</p> : null}
  </section>;
}
