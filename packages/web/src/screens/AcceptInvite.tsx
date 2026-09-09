/**
 * SOTE — eine Einladung einlösen.
 *
 * **Kein Rahmen**, wie beim Gastbildschirm einer Freigabe und aus demselben
 * Grund: es gibt keine anderen Orte, also auch keine Liste davon. Und **vor**
 * der Anmeldeprüfung, denn wer eingeladen ist, hat noch kein Konto.
 *
 * ## Die Adresse steht da und ist nicht änderbar
 *
 * Sie kommt aus der Einladung, nicht aus dem Formular — sonst wäre ein
 * Einladungslink ein Konto auf beliebigen Namen. Sie **anzuzeigen** ist
 * trotzdem richtig: wer einen Link öffnet, will wissen, für wen er gilt.
 */

import { useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';
import { SoteMark } from '../components/Logo.js';

export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .invitation(token)
      .then((out) => setEmail(out.email))
      .catch((e: unknown) => {
        // Ein Satz für alle Fälle, wie im Server: „abgelaufen" gegen
        // „zurückgenommen" wäre eine Auskunft über einen geratenen Token.
        if (e instanceof ApiError && e.status === 404) setGone(true);
        else setNotice('Laden ging nicht.');
      });
  }, [token]);

  if (gone) {
    return (
      <div className="guest">
        <div className="guest-head">
          <SoteMark size={22} />
        </div>
        <div className="guest-body">
          <div className="empty">
            <strong>Diese Einladung gilt nicht mehr.</strong>
            Wer sie geschickt hat, kann eine neue anlegen.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="guest">
      <div className="guest-head">
        <SoteMark size={22} />
      </div>
      <div className="guest-body narrow">
        <h1>Willkommen bei SOTE</h1>
        <p className="sub">
          {email === undefined ? '' : `Diese Einladung gilt für ${email}.`}
        </p>

        {notice === undefined ? null : <p className="note-error">{notice}</p>}

        <div className="settings-row">
          <span className="settings-row-label"><b>Dein Name</b></span>
          <div className="settings-row-value">
            <input
              className="set-input"
              aria-label="Dein Name"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label"><b>Kennwort</b><span>Mindestens acht Zeichen.</span></span>
          <div className="settings-row-value">
            <input
              className="set-input"
              type="password"
              aria-label="Kennwort"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* Die Grenze steht VOR dem Abschicken da. Ein Formular, das erst
                nach dem Klick sagt, was es verlangt, lässt jemanden raten. */}
          </div>
        </div>

        <button
          type="button"
          className="btn"
          disabled={busy || name.trim() === '' || password.length < 8 || email === undefined}
          onClick={() => {
            setBusy(true);
            setNotice(undefined);
            void api
              .acceptInvitation(token, { displayName: name.trim(), password })
              .then(() => onDone())
              .catch((e: unknown) =>
                setNotice(e instanceof ApiError ? e.message : 'Anlegen ging nicht.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Konto anlegen
        </button>
      </div>
    </div>
  );
}
