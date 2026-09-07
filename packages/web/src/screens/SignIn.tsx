/** SOTE — anmelden. */

import { useState } from 'react';

import { api, ApiError } from '../api.js';
import { SoteMark } from '../components/Logo.js';

export function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(undefined);
    try {
      await api.signIn(email, password);
      onDone();
    } catch (e) {
      // Der Grund kommt vom Server und wird nicht in „ging nicht" übersetzt.
      setError(
        e instanceof ApiError && e.code === 'bad_credentials'
          ? 'E-Mail oder Kennwort stimmt nicht.'
          : e instanceof ApiError
            ? e.message
            : 'Unerwarteter Fehler.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <SoteMark size={40} />
        <h1>SOTE</h1>
        <p className="claim">Aufgaben verwalten. Auf deinem Server.</p>

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void go();
            }}
          />
        </label>
        <label className="field">
          <span>Kennwort</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void go();
            }}
          />
        </label>

        <button className="btn primary" onClick={() => void go()} disabled={busy}>
          {busy ? 'Einen Moment…' : 'Anmelden'}
        </button>
        {error !== undefined ? <p className="note-error">{error}</p> : null}
      </div>
    </div>
  );
}
