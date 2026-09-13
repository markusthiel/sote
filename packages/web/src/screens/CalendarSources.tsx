import { useEffect, useId, useRef, useState } from 'react';
import { colorValue, PALETTE } from '@sote/core';
import { api, ApiError, type CalendarSource, type CalendarSourceFields } from '../api.js';
import { OwnColor } from '../components/OwnColor.js';
import { CalendarWriter } from './CalendarWriter.js';
import { CalendarConnect, ProviderMark, providerName } from './CalendarConnect.js';
import { CalendarAccess } from '../components/CalendarAccess.js';

type Workspace = { id: string; name: string };
type SourceData = Awaited<ReturnType<typeof api.calendarSources>>;

/** Ein Entwurf pro Kalender: Nachladen des Abrufstands überschreibt keine Eingaben. */
function SourceForm({ source, workspaces, onSave }: {
  source: CalendarSource;
  workspaces: readonly Workspace[];
  onSave: (fields: CalendarSourceFields) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(source?.name ?? '');
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
    void onSave({ name: name.trim(), color, showsIn }).then(() => {
      setSaved(true);
    }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Speichern ging nicht.'))
      .finally(() => setBusy(false));
  }}>
    <fieldset className="calendar-source-fields" disabled={busy}>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="set-input" value={name} maxLength={120}
        required onChange={(e) => setName(e.target.value)} placeholder="z. B. Privat" />
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
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</button>
        {saved ? <span role="status">Gespeichert.</span> : null}
      </div>
    </fieldset>
    {error ? <p className="note-error" role="alert">{error}</p> : null}
  </form>;
}

function SourceCard({ source, workspaces, possible, reload, initiallyOpen }: {
  source: CalendarSource; workspaces: readonly Workspace[]; possible: boolean; reload: () => Promise<void>; initiallyOpen: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(initiallyOpen);
  const [tab, setTab] = useState<'display' | 'writing'>('display');
  const sectionId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (initiallyOpen) heading.current?.focus(); }, [initiallyOpen]);
  async function act(remove: boolean) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      if (remove) await api.removeCalendarSource(source.id);
      else {
        await api.refreshCalendarSource(source.id);
        if (source.writing?.enabled) await api.syncCalendarWriter(source.id);
      }
      setConfirm(false);
      if (!remove) setNotice('Aktualisierung angefordert. Der Stand wird automatisch nachgeladen.');
      await reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Ändern ging nicht.'); }
    finally { setBusy(false); }
  }
  const failed = !!(source.lastError || source.writing?.lastError);
  // Ein ICS-Abo kann einen separaten, bereits eingerichteten Schreibzugang besitzen.
  const writable = source.kind === 'ics' || !source.kind ? !!source.writing : source.writable ?? (source.writing ? true : null);
  return <section className="calendar-connection" aria-label={source.name}>
    <div className="calendar-connection-heading"><ProviderMark provider={source.provider} /><div className="calendar-connection-title">
      <h2 ref={heading} tabIndex={-1}><span className="calendar-source-dot" style={{ background: colorValue(source.color) ?? 'var(--text-muted)' }} />{source.name}</h2>
      <p>{providerName(source.provider)} · {source.kind === 'google'||source.kind==='microsoft'?'Konto verbunden':source.kind === 'caldav' ? 'Privater Kalenderzugang' : 'Kalenderabo'}</p>
      <CalendarAccess writable={writable} />
    </div><span className="calendar-status" data-state={failed ? 'error' : source.fetchedAt ? 'ready' : 'pending'}>{failed ? 'Aufmerksamkeit nötig' : source.fetchedAt ? 'Verbunden' : 'Erster Abruf läuft'}</span></div>
    <div className="calendar-connection-summary">
      <div><span>TERMINE LESEN</span><strong>{source.fetchedAt ? 'Automatisch aktiv' : 'Wird vorbereitet'}</strong><small>{source.fetchedAt ? `Zuletzt ${new Date(source.fetchedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Der erste Abruf läuft im Hintergrund.'}</small></div>
      <div><span>AUFGABEN ÜBERTRAGEN</span><strong>{source.writing ? source.writing.enabled ? `Aktiv · ${source.writing.count} Kalenderkopien` : 'Pausiert' : 'Nicht eingerichtet'}</strong><small>{source.writing?.enabled ? 'SOTE → Kalender · etwa jede Minute' : 'Du bestimmst, welche Aufgaben erscheinen.'}</small></div>
      <div><span>SICHTBAR IN</span><strong>{source.showsIn === null ? 'Allen Arbeitsbereichen' : source.showsIn.length === 1 ? workspaces.find((w) => w.id === source.showsIn?.[0])?.name ?? 'Einem Arbeitsbereich' : `${source.showsIn.length} Arbeitsbereichen`}</strong><small>Für dein SOTE-Konto</small></div>
    </div>
    {failed ? <div className="calendar-problem"><strong>{source.writing?.conflict ? 'Änderung im Zielkalender prüfen' : 'Ein Abgleich braucht Aufmerksamkeit'}</strong><details><summary>Fehlerdetails anzeigen</summary><p>{source.lastError ?? source.writing?.lastError}</p></details></div> : null}
    <div className="calendar-connection-actions">
      <button className="btn quiet small" disabled={busy || !possible} onClick={() => void act(false)}>{busy ? 'Wird angefordert …' : 'Jetzt aktualisieren'}</button>
      {!source.writing ? <button className="btn quiet small" onClick={() => { setOpen(true); setTab('writing'); }}>Aufgabenübertragung einrichten →</button> : null}
      <button className="btn small" aria-expanded={open} aria-controls={sectionId} onClick={() => setOpen(!open)}>{open ? 'Einstellungen schließen' : 'Einstellungen'}</button>
    </div>
    <div id={sectionId} hidden={!open} className="calendar-connection-settings">
      <div className="calendar-settings-tabs" role="group" aria-label={`Einstellungen für ${source.name}`}>
        <button className="btn quiet small" aria-pressed={tab === 'display'} onClick={() => setTab('display')}>Darstellung</button>
        <button className="btn quiet small" aria-pressed={tab === 'writing'} onClick={() => setTab('writing')}>Aufgabenübertragung</button>
      </div>
      <div hidden={tab !== 'display'}>
        <SourceForm source={source} workspaces={workspaces} onSave={async (fields) => { await api.patchCalendarSource(source.id, fields); await reload(); }} />
        <button className="btn quiet small calendar-remove" disabled={busy} onClick={() => setConfirm(!confirm)}>Kalender entfernen …</button>
      </div>
      <div hidden={tab !== 'writing'}><CalendarWriter source={source} workspaces={workspaces} possible={possible} reload={reload} /></div>
    </div>
    {confirm ? <div className="pick calendar-source-actions">
      <span>„{source.name}“ samt eingelesenen Terminen aus SOTE entfernen?</span>
      {source.writing ? <span>Das Schreiben endet ebenfalls. Bereits übertragene Termine bleiben im Zielkalender.</span> : null}
      <button className="btn quiet small" disabled={busy} onClick={() => void act(true)}>Ja, entfernen</button>
      <button className="btn quiet small" disabled={busy} onClick={() => setConfirm(false)}>Abbrechen</button>
    </div> : null}
    {notice ? <p role="status" className="muted">{notice}</p> : null}
    {error ? <p role="alert" className="note-error">{error}</p> : null}
  </section>;
}

export function CalendarSources({ data, error, workspaces, reload }: {
  data: SourceData | undefined; error: string | undefined;
  workspaces: readonly Workspace[]; reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(()=>new URLSearchParams(window.location.search).has('calendar_account'));
  const [loginError,setLoginError] = useState(()=>new URLSearchParams(window.location.search).get('calendar_error'));
  const [addedId, setAddedId] = useState<string>();
  return <>
    <div className="main-head"><h1>Kalenderverbindungen</h1></div>
    <div className="calendar-hub">
      {loginError?<p role="alert" className="note-error">{loginError} <button className="btn quiet small" onClick={()=>{setLoginError(null);window.history.replaceState(null,'',window.location.pathname);}}>Schließen</button></p>:null}
      {error ? <p className="note-error" role="alert">{error} <button className="btn quiet small" onClick={() => void reload()}>Erneut laden</button></p> : null}
      {data === undefined ? <p className="muted" role="status">{error ? 'Kalender sind derzeit nicht verfügbar.' : 'Kalender werden geladen …'}</p> : <>
        <section className="calendar-hub-intro">
          <div><span className="calendar-eyebrow">DEIN TAG, AN EINEM ORT</span><h2>Kalender und Aufgaben zusammenbringen</h2><p>Behalte deine Termine im Blick und übertrage ausgewählte Aufgaben in deinen Kalender.</p></div>
          <button className="btn calendar-primary" disabled={!data.possible} onClick={() => setAdding(true)}>{data.feeds.length >= data.max?'Kalenderkonten verwalten':'+ Kalender hinzufügen'}</button>
          {!data.possible ? <p className="note-error">Auf diesem Server fehlt <code>SOTE_SHARE_KEY</code>. Die Administration muss ihn einrichten, bevor Kalender eingebunden oder abgerufen werden können.</p> : null}
        </section>
        {adding && data.possible ? <CalendarConnect onCancel={() => {setAdding(false);window.history.replaceState(null,'',window.location.pathname);}} onConnected={async (id) => { setAddedId(id); await reload(); setAdding(false);window.history.replaceState(null,'',window.location.pathname); }} /> : null}
        <div className="calendar-section-heading"><h2>Deine Kalender <span className="muted">{data.feeds.length}</span></h2><span className="muted small">{data.feeds.length} von {data.max} verbunden</span></div>
        {data.feeds.map((source) => <SourceCard key={source.id} source={source} workspaces={workspaces} possible={data.possible} reload={reload} initiallyOpen={addedId === source.id} />)}
        {!data.feeds.length && !adding ? <p className="calendar-empty">Noch kein Kalender verbunden. Wähle „Kalender hinzufügen“, um deinen Anbieter auszuwählen.</p> : null}
        <p className="calendar-hub-footnote">Termine werden stündlich eingelesen. Aufgaben werden bei aktiver Übertragung etwa jede Minute abgeglichen.</p>
      </>}
    </div>
  </>;
}
