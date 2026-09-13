import { useEffect, useId, useState } from 'react';
import { colorValue, PALETTE } from '@sote/core';
import { api, ApiError, type CalendarSource, type CalendarSourceFields } from '../api.js';
import { OwnColor } from '../components/OwnColor.js';
import { CalendarWriter } from './CalendarWriter.js';

type Workspace = { id: string; name: string };
type SourceData = Awaited<ReturnType<typeof api.calendarSources>>;

/** Ein Entwurf pro Kalender: Nachladen des Abrufstands überschreibt keine Eingaben. */
function SourceForm({ source, workspaces, onSave }: {
  source?: CalendarSource;
  workspaces: readonly Workspace[];
  onSave: (fields: CalendarSourceFields & { url: string }) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(source?.name ?? '');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(source?.color ?? 'blue');
  const [showsIn, setShowsIn] = useState<string[] | null>(source?.showsIn ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const selection = JSON.stringify(source?.showsIn ?? null);
  useEffect(() => {
    setName(source?.name ?? '');
    setColor(source?.color ?? 'blue');
    setShowsIn(JSON.parse(selection) as string[] | null);
  }, [source?.name, source?.color, selection]);

  return <form className="calendar-source-form" onChange={() => setSaved(false)} onSubmit={(e) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    void onSave({ name: name.trim(), color, showsIn, url: url.trim() }).then(() => {
      setSaved(true);
      if (source === undefined) { setName(''); setUrl(''); }
    }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Speichern ging nicht.'))
      .finally(() => setBusy(false));
  }}>
    <fieldset className="calendar-source-fields" disabled={busy}>
      <label htmlFor={`${id}-name`}>Name{source === undefined ? ' (optional)' : ''}</label>
      <input id={`${id}-name`} className="set-input" value={name} maxLength={120}
        required={source !== undefined} onChange={(e) => setName(e.target.value)} placeholder="z. B. Privat" />
      {source === undefined ? <>
        <label htmlFor={`${id}-url`}>ICS-Adresse</label>
        <input id={`${id}-url`} className="set-input" type="url" required autoComplete="off" spellCheck={false}
          placeholder="https://… oder webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </> : null}
      <span id={`${id}-color`}>Farbe</span>
      <div className="calendar-source-colors" role="group" aria-labelledby={`${id}-color`}>
        {PALETTE.map((c) => <button key={c} type="button" className="block-menu-swatch"
          aria-label={`Farbe: ${c}`} aria-pressed={color === c} style={{ background: colorValue(c) }}
          onClick={() => { setColor(c); setSaved(false); }} />)}
        <OwnColor value={color} label="Kalenderfarbe: eigene Farbe" onPick={setColor} />
        <input className="set-input" aria-label="Farbe als Hex-Wert" placeholder="#2563eb"
          pattern="#[0-9a-fA-F]{6}" value={color.startsWith('#') ? color : ''}
          onChange={(e) => setColor(e.target.value)} />
      </div>
      <label htmlFor={`${id}-scope`}>Erscheint in</label>
      <select id={`${id}-scope`} className="set-input" value={showsIn === null ? 'all' : 'selection'}
        onChange={(e) => setShowsIn(e.target.value === 'all' ? null : workspaces.map((w) => w.id))}>
        <option value="all">Allen Arbeitsbereichen</option>
        <option value="selection">Ausgewählten Arbeitsbereichen</option>
      </select>
      {showsIn !== null ? <div className="calendar-source-choices">
        {workspaces.map((w) => <label key={w.id} className="pick">
          <input type="checkbox" checked={showsIn.includes(w.id)} onChange={(e) => {
            setShowsIn(e.target.checked ? [...showsIn, w.id] : showsIn.filter((v) => v !== w.id));
          }} />{w.name}
        </label>)}
        <p className="muted small">In der Kalenderansicht „Alle Arbeitsbereiche“ erscheint er immer.</p>
      </div> : null}
      <div className="pick">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Speichert …' : source ? 'Speichern' : 'Kalender einbinden'}</button>
        {saved ? <span role="status">{source ? 'Gespeichert.' : 'Eingebunden. Der erste Abruf läuft im Hintergrund.'}</span> : null}
      </div>
    </fieldset>
    {error ? <p className="note-error" role="alert">{error}</p> : null}
  </form>;
}

function SourceCard({ source, workspaces, possible, reload }: {
  source: CalendarSource; workspaces: readonly Workspace[]; possible: boolean; reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  async function act(remove: boolean) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      if (remove) await api.removeCalendarSource(source.id);
      else await api.refreshCalendarSource(source.id);
      setConfirm(false);
      if (!remove) setNotice('Abruf angefordert. Der Stand wird automatisch nachgeladen.');
      await reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Ändern ging nicht.'); }
    finally { setBusy(false); }
  }
  return <section className="settings-card" aria-label={source.name}>
    <h2><span className="calendar-source-dot" style={{ background: colorValue(source.color) ?? 'var(--text-muted)' }} /> {source.name}</h2>
    <SourceForm source={source} workspaces={workspaces} onSave={async ({ url: _url, ...fields }) => {
      await api.patchCalendarSource(source.id, fields); await reload();
    }} />
    <p className="muted small">{source.fetchedAt === null ? 'Noch kein erfolgreicher Abruf.' : `Zuletzt gelesen: ${new Date(source.fetchedAt).toLocaleString('de-DE')}`}</p>
    {source.lastError ? <p className="note-error">Abruf fehlgeschlagen: {source.lastError}. Bereits gelesene Termine bleiben erhalten.</p> : null}
    <div className="pick calendar-source-actions">
      <button className="btn quiet small" disabled={busy || !possible} onClick={() => void act(false)}>Jetzt lesen</button>
      <button className="btn quiet small" disabled={busy} onClick={() => setConfirm(!confirm)}>Entfernen</button>
    </div>
    {confirm ? <div className="pick calendar-source-actions">
      <span>„{source.name}“ samt eingelesenen Terminen aus SOTE entfernen?</span>
      {source.writing ? <span>Das Schreiben endet ebenfalls. Bereits übertragene Termine bleiben im Zielkalender.</span> : null}
      <button className="btn quiet small" disabled={busy} onClick={() => void act(true)}>Ja, entfernen</button>
      <button className="btn quiet small" disabled={busy} onClick={() => setConfirm(false)}>Abbrechen</button>
    </div> : null}
    {notice ? <p role="status" className="muted">{notice}</p> : null}
    {error ? <p role="alert" className="note-error">{error}</p> : null}
    <CalendarWriter source={source} workspaces={workspaces} possible={possible} reload={reload} />
  </section>;
}

export function CalendarSources({ data, error, workspaces, reload }: {
  data: SourceData | undefined; error: string | undefined;
  workspaces: readonly Workspace[]; reload: () => Promise<void>;
}) {
  return <>
    <div className="main-head"><h1>Kalender einbinden</h1></div>
    <div className="settings">
      {error ? <p className="note-error" role="alert">{error} <button className="btn quiet small" onClick={() => void reload()}>Erneut laden</button></p> : null}
      {data === undefined ? <p className="muted" role="status">{error ? 'Kalender sind derzeit nicht verfügbar.' : 'Kalender werden geladen …'}</p> : <>
        <section className="settings-card">
          <p className="muted">Deine eingebundenen Kalender gelten für dein Konto. Du bestimmst je Kalender, in welchen Arbeitsbereichen er erscheint. Termine werden stündlich gelesen.</p>
          <p className="muted">{data.feeds.length} von {data.max} Kalendern eingebunden.</p>
          {!data.possible ? <p className="note-error">Auf diesem Server fehlt <code>SOTE_SHARE_KEY</code>. Die Administration muss ihn einrichten, bevor Kalender eingebunden oder abgerufen werden können.</p> : null}
        </section>
        {data.feeds.map((source) => <SourceCard key={source.id} source={source} workspaces={workspaces} possible={data.possible} reload={reload} />)}
        {data.possible && data.feeds.length < data.max ? <section className="settings-card">
          <h2>Weiteren Kalender einbinden</h2>
          <SourceForm workspaces={workspaces} onSave={async (fields) => { await api.addCalendarSource(fields); await reload(); }} />
          <details className="calendar-source-future">
            <summary>Wo finde ich die ICS-Adresse?</summary>
            <ul className="muted">
              <li>Google Kalender: Einstellungen des Kalenders → Kalender integrieren → Privatadresse im iCal-Format. <a href="https://support.google.com/calendar/answer/37648?hl=de" target="_blank" rel="noreferrer">Google-Hilfe</a></li>
              <li>Outlook im Web: Einstellungen → Kalender → Geteilte Kalender → Kalender veröffentlichen; den ICS-Link kopieren. <a href="https://support.microsoft.com/en-us/office/share-an-outlook-calendar-as-view-only-with-others-353ed2c1-3ec5-449d-8c73-6931a0adab88" target="_blank" rel="noreferrer">Microsoft-Hilfe</a></li>
              <li>iCloud: Beim Kalender „Öffentlicher Kalender“ aktivieren und den Link kopieren. <a href="https://support.apple.com/en-euro/guide/icloud/mm6b1a9479/icloud" target="_blank" rel="noreferrer">Apple-Hilfe</a></li>
            </ul>
            <p className="muted">Wer diese Adresse kennt, kann die freigegebenen Termine lesen. SOTE speichert sie verschlüsselt und zeigt sie danach nicht erneut an.</p>
          </details>
        </section> : data.feeds.length >= data.max ? <p className="muted">Die Höchstzahl ist erreicht. Entferne einen Kalender, um einen anderen einzubinden.</p> : null}
      </>}
    </div>
  </>;
}
