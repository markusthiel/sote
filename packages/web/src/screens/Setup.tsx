/**
 * SOTE — das erste Konto.
 *
 * Erscheint nur, solange es kein Konto gibt. Der Einrichtungsschlüssel steht im
 * Protokoll des Servers (`docker compose logs server`) — nicht, weil das
 * bequem wäre, sondern weil eine Maske ohne Schlüssel offen im Netz stünde,
 * sobald die Bedingung „kein Konto" einmal wieder wahr wird.
 *
 * Der Bildschirm sagt darum als Erstes, **wo der Schlüssel steht**. Eine
 * Eingabe für etwas, das man nicht findet, ist eine Sackgasse mit Feld.
 */

import { useState } from 'react';

import { api, ApiError } from '../api.js';
import { SoteMark } from '../components/Logo.js';

export function Setup({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setup({
        key: key.trim(),
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        ...(workspaceName.trim() === '' ? {} : { workspaceName: workspaceName.trim() }),
      });
      // Der Server hat gleich angemeldet: wer sein Konto gerade angelegt hat,
      // soll nicht als Erstes ein Anmeldeformular sehen.
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'bad_setup_key'
            ? 'Der Schlüssel stimmt nicht. Er steht im Protokoll des Servers und wechselt bei jedem Neustart.'
            : e.message
          : 'Unerwarteter Fehler.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card wide">
        <SoteMark size={40} />
        <h1>Willkommen</h1>
        <p className="claim">
          Diese Instanz hat noch kein Konto. Leg deins an, dann gehört sie dir.
        </p>

        <div className="hint">
          Den Einrichtungsschlüssel hat der Server beim Start ausgegeben:
          <code>docker compose logs server</code>
          Er gilt für dieses eine Konto und wechselt bei jedem Neustart.
        </div>

        <label className="field">
          <span>Einrichtungsschlüssel</span>
          <input
            value={key}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Dein Name</span>
          <input
            value={displayName}
            autoComplete="name"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Kennwort — mindestens acht Zeichen</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Arbeitsbereich — leer heißt „Mein Arbeitsbereich"</span>
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void go();
            }}
          />
        </label>

        <button className="btn primary" onClick={() => void go()} disabled={busy}>
          {busy ? 'Einen Moment…' : 'Konto anlegen und anmelden'}
        </button>
        {error !== undefined ? <p className="note-error">{error}</p> : null}
      </div>
    </div>
  );
}
