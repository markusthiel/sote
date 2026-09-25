/** SOTE — anmelden. */

import { useState } from 'react';

import { api, ApiError } from '../api.js';
import { SoteLockup } from '../components/Logo.js';

export function SignIn({
  onDone,
  sso,
}: {
  onDone: () => void;
  /** `null` heißt: dieser Server hat kein Single-Sign-on, also gibt es keinen Knopf. */
  sso?: { label: string } | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const ssoFehler = new URLSearchParams(window.location.search).get('sso');

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
        <div className="signin-marke">
          <SoteLockup size={32} />
          <p className="claim">Aufgaben verwalten. Auf deinem Server.</p>
        </div>

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

        {sso === null || sso === undefined ? null : (
          <>
            <div className="or">oder</div>
            {/*
              Ein Link und kein Knopf mit `fetch`: der Browser muss WIRKLICH
              zum Anbieter gehen, und ein `fetch` würde die Weiterleitung im
              Hintergrund verfolgen und die Antwort wegwerfen. Was hier
              gebraucht wird, ist ein Ortswechsel.
            */}
            <a className="btn" href="/api/sso/start">
              Mit {sso.label} anmelden
            </a>
          </>
        )}
        {/*
          Der Grund, wenn eine SSO-Anmeldung schiefging.
          Er steht in der Adresse, weil der Rückweg eine Weiterleitung ist und
          keine Antwort, in die man etwas legen könnte — und ohne ihn landet
          jemand wieder auf dieser Maske und weiß nicht, warum.
        */}
        {ssoFehler === null ? null : <p className="note-error">{ssoFehler}</p>}
      </div>
    </div>
  );
}
