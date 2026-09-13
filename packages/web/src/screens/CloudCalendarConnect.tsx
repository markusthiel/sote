import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';

/** Kontoanmeldung und Kalenderauswahl sind getrennt: Anmelden aktiviert kein Schreiben. */
export function CloudCalendarConnect({provider,onConnected}:{provider:'google'|'microsoft';onConnected:(id:string)=>Promise<void>}) {
  const [data,setData]=useState<Awaited<ReturnType<typeof api.calendarAccounts>>>();
  const [account,setAccount]=useState('');
  const [calendars,setCalendars]=useState<{id:string;name:string;writable:boolean}[]>([]);
  const [calendar,setCalendar]=useState('');
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string>();
  const [confirm,setConfirm]=useState(false);
  const title=provider==='google'?'Google':'Microsoft 365 / Outlook';
  const accounts=data?.accounts.filter(a=>a.provider===provider)??[];
  const selected=accounts.find(a=>a.id===account);
  const available=data?.providers[provider];
  const message=(e:unknown)=>e instanceof ApiError?e.message:'Der Kalenderzugang konnte nicht geladen werden.';
  async function load() {
    setError(undefined);
    try {const result=await api.calendarAccounts();setData(result);
      const returned=new URLSearchParams(window.location.search).get('calendar_account');
      setAccount(result.accounts.find(a=>a.provider===provider&&a.id===returned)?.id??result.accounts.find(a=>a.provider===provider)?.id??'');
    }catch(e){setError(message(e));}
  }
  useEffect(()=>{void load();},[provider]);
  useEffect(()=>{
    setCalendars([]);setCalendar('');setName('');setConfirm(false);
    if(!account){setLoading(false);return;}
    let active=true;setLoading(true);setError(undefined);
    void api.cloudCalendars(account).then(r=>{if(active){setCalendars(r.calendars);if(r.calendars.length===1){setCalendar(r.calendars[0]!.id);setName(r.calendars[0]!.name);}}})
      .catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[account]);
  async function login(){setBusy(true);setError(undefined);try{const result=await api.authorizeCalendarAccount(provider);window.location.assign(result.url);}catch(e){setError(message(e));setBusy(false);}}
  return <div className="calendar-connect-body">
    <div className="calendar-source-fields">
      {!data&&!error?<p role="status" className="muted">Konten werden geladen …</p>:null}
      {accounts.length?<>
        <label className="calendar-field">Verbundenes Konto<select className="set-input" value={account} disabled={busy} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        {selected?.lastError?<p className="note-error">{selected.lastError}</p>:null}
        <div className="pick calendar-source-actions"><button type="button" className="btn quiet small" disabled={busy||!available?.ready} onClick={()=>void login()}>Konto erneut oder weiteres Konto anmelden</button><button type="button" className="btn quiet small" disabled={busy} onClick={()=>setConfirm(!confirm)}>Konto trennen …</button></div>
        {confirm?<div className="calendar-access"><p>Zugang zu „{selected?.label}“ aus SOTE entfernen? Entferne zuerst die zugehörigen Kalender aus der Übersicht. Termine beim Anbieter bleiben erhalten.</p><button className="btn small" disabled={busy} onClick={()=>{
          setBusy(true);void api.removeCalendarAccount(account).then(()=>load()).catch(e=>setError(message(e))).finally(()=>{setBusy(false);setConfirm(false);});
        }}>Ja, Konto trennen</button><button className="btn quiet small" onClick={()=>setConfirm(false)}>Abbrechen</button></div>:null}
      </>:<button className="btn calendar-primary" disabled={busy||!available?.ready} onClick={()=>void login()}>Mit {title} anmelden</button>}
      {available&&!available.ready?<div className="calendar-access"><p>Die Kalender-App muss auf diesem SOTE-Server einmalig eingerichtet werden.</p><details><summary>Einrichtung für die Administration</summary><p>Eine Web-App beim Anbieter registrieren und Client-ID sowie Client-Geheimnis in den Stack-Einstellungen hinterlegen. Danach den Stack aktualisieren.</p><p>Rücksprungadresse: <code>{available.callback??'Zuerst SOTE_BASE_URL setzen'}</code></p><p><a href={provider==='google'?'https://console.cloud.google.com/apis/credentials':'https://entra.microsoft.com/'} target="_blank" rel="noreferrer">App-Registrierung bei {title} öffnen</a></p></details></div>:null}
      {loading?<p role="status" className="muted">Kalender werden geladen …</p>:null}
      {account&&!loading&&calendars.length>0?<form className="calendar-source-form" onSubmit={e=>{
        e.preventDefault();setBusy(true);setError(undefined);void api.connectCloudCalendar(account,{calendarId:calendar,name:name.trim()}).then(r=>onConnected(r.id)).catch(e=>setError(message(e))).finally(()=>setBusy(false));
      }}><fieldset className="calendar-source-fields" disabled={busy}>
        <label className="calendar-field">Kalender auswählen<select className="set-input" required value={calendar} onChange={e=>{setCalendar(e.target.value);setName(calendars.find(c=>c.id===e.target.value)?.name??'');}}><option value="">Bitte auswählen …</option>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}{c.writable?'':' · nur lesen'}</option>)}</select></label>
        <label className="calendar-field">Name in SOTE<input className="set-input" maxLength={120} value={name} onChange={e=>setName(e.target.value)} /></label>
        <button className="btn calendar-primary" disabled={!calendar} type="submit">{busy?'Verbindet …':'Kalender verbinden'}</button>
      </fieldset></form>:null}
      {account&&!loading&&!calendars.length&&!error?<p className="muted">Keine zugänglichen Kalender gefunden.</p>:null}
      {error?<p role="alert" className="note-error">{error} {!data?<button className="btn quiet small" onClick={()=>void load()}>Erneut laden</button>:null}</p>:null}
    </div>
    <aside className="calendar-connect-help"><h3>Dein Konto, deine Kalender</h3><p>Du meldest dich direkt bei {title} an und erlaubst SOTE den Kalenderzugriff. Dein Kontopasswort bleibt beim Anbieter.</p><p>Verbinde die Kalender, die in SOTE erscheinen sollen. Die Aufgabenübertragung aktivierst du anschließend je Kalender in den Einstellungen.</p><p className="small">Die Freigabe wird verschlüsselt gespeichert und automatisch erneuert. Erneutes Anmelden desselben Kontos erhält deine bestehenden Verbindungen.</p></aside>
  </div>;
}
