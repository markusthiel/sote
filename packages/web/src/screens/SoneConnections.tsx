import { useEffect, useState } from 'react';
type Project = {
    id: string;
    name: string;
    workspaceName: string;
    writable: boolean;
};
type State = {
    admin: boolean;
    clients: {
        id: string;
        name: string;
        baseUrl: string;
        revokedAt: string | null;
    }[];
    grants: {
        id: string;
        name: string;
        writable: boolean;
        expiresAt: string;
    }[];
};
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch('/api/integrations/sone' + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const out = await res.json();
    if (!res.ok)
        throw new Error(out.error?.message ?? 'Verbindung fehlgeschlagen.');
    return out as T;
}
export function SoneConnections() {
    const [data, setData] = useState<State>();
    const [consent, setConsent] = useState<{
        name: string;
        baseUrl: string;
        projects: Project[];
    }>();
    const [selected, setSelected] = useState<string[]>([]), [write, setWrite] = useState(false), [name, setName] = useState('SONE'), [base, setBase] = useState('');
    const [created, setCreated] = useState<{
        id: string;
        secret: string;
    }>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [params] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));
    const load = async () => { setData(await request<State>('')); if (params['client_id'])
        setConsent(await request('/consent?' + new URLSearchParams(params))); };
    useEffect(() => { void load().catch(e => setError(e.message)); }, []);
    async function act(fn: () => Promise<void>) { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Verbindung fehlgeschlagen.');
    }
    finally {
        setBusy(false);
    } }
    return <><header className="main-head"><h1>Verbundene Anwendungen</h1></header><div className="body integration-settings">
  {error ? <p className="note-error" role="alert">{error}</p> : null}
  {consent ? <section className="settings-card"><h2>{consent.name} mit deinem Konto verbinden</h2><p>{consent.baseUrl} darf die ausgewählten Projekte in SONE anzeigen. Deine bestehenden SOTE-Rechte gelten weiterhin. Die Freigabe gilt 30 Tage und ist jederzeit widerrufbar.</p>
   <fieldset disabled={busy}><legend>Erlaubte Projekte</legend>{consent.projects.map(p => <label className="calendar-workspace-choice" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))}/>{p.workspaceName} · {p.name}</label>)}
   <label className="calendar-workspace-choice"><input type="checkbox" checked={write} onChange={e => setWrite(e.target.checked)}/>Aufgaben auch anlegen und bearbeiten</label></fieldset>
   <button className="btn" disabled={busy || !selected.length} onClick={() => void act(async () => { const result = await request<{
            url: string;
        }>('/consent', 'POST', { ...params, projects: selected, writable: write }); window.location.assign(result.url); })}>Auswahl freigeben</button>
   <button className="btn quiet" disabled={busy} onClick={() => { window.location.assign('/einstellungen/verbindungen'); }}>Abbrechen</button>
  </section> : null}
  <section className="settings-card"><h2>Deine Freigaben</h2>{data?.grants.length ? data.grants.map(g => <div className="settings-row" key={g.id}><span>{g.name} · {g.writable ? 'Lesen und Schreiben' : 'Nur Lesen'} · bis {new Date(g.expiresAt).toLocaleDateString('de-DE')}</span><button className="btn quiet" disabled={busy} onClick={() => void act(async () => { await request('/grants/' + g.id, 'DELETE'); await load(); })}>Trennen</button></div>) : <p className="muted">Noch keine Anwendung verbunden. Starte die Verbindung in SONE unter deinen Einstellungen.</p>}</section>
  {data?.admin ? <section className="settings-card"><h2>SONE-Instanzen verwalten</h2><p>Registriere die SONE-Instanz. Anschließend werden Client-ID und Geheimnis dort in den Verbindungseinstellungen hinterlegt.</p>
   {data.clients.map(c => <div className="settings-row" key={c.id}><span>{c.name} · {c.baseUrl}{c.revokedAt ? ' · Getrennt' : ''}</span>{!c.revokedAt ? <button className="btn quiet" disabled={busy} onClick={() => void act(async () => { await request('/clients/' + c.id, 'DELETE'); await load(); })}>Instanz trennen</button> : null}</div>)}
   <form onSubmit={e => { e.preventDefault(); void act(async () => { setCreated(await request('/clients', 'POST', { name, baseUrl: base })); await load(); }); }}><label className="calendar-field">Name<input className="set-input" value={name} onChange={e => setName(e.target.value)} required/></label><label className="calendar-field">SONE-Adresse<input className="set-input" type="url" placeholder="https://notizen.example.org" value={base} onChange={e => setBase(e.target.value)} required/></label><button className="btn" disabled={busy}>Instanz registrieren</button></form>
   {created ? <div role="status"><p>Das Geheimnis wird nur jetzt angezeigt. Übertrage beide Werte in SONE.</p><label className="calendar-field">Client-ID<input className="set-input" readOnly value={created.id}/></label><label className="calendar-field">Client-Geheimnis<input className="set-input" readOnly value={created.secret}/></label></div> : null}
  </section> : null}
 </div></>;
}
