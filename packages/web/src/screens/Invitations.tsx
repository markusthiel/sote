/**
 * SOTE — Einladungen.
 *
 * **Die Instanz lädt ein** (SONEs ADR-0073). Wer schon ein Konto hat, wird
 * unter „Leute" in einen Arbeitsbereich geholt — dieser Bildschirm ist für die
 * andere Frage: wer auf diesem Server überhaupt eines bekommt.
 *
 * ## Es gibt kein Feld für eine URL
 *
 * Das ist keine Auslassung, sondern die Entscheidung (ADR-0126): der Browser
 * schickt eine **Adresse**, der Server baut den Link selbst. Eine Route, die
 * eine übergebene URL verschickt, wäre ein kleiner offener Verteiler mit dem
 * Namen dieser Instanz auf dem Umschlag — und sie hätte ausgesehen wie der
 * naheliegende Weg, weil dieser Bildschirm den Link ohnehin anzeigt.
 *
 * ## Der Link steht trotzdem da
 *
 * Auch wenn eine Mail hinausging. Zwei Gründe: eine Mail kann im Spam landen,
 * und ohne Mailserver ist Weitergeben von Hand der einzige Weg — der Vorgang
 * ist eine Sache, die Mail eine andere.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

export function Invitations() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.invitations>> | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    setData(await api.invitations());
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) =>
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.'),
    );
  }, [load]);

  async function tun(fn: () => Promise<unknown>, wenn: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : wenn);
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) {
    return (
      <div className="settings">
        {notice === undefined ? <div aria-busy="true" /> : <p className="note-error">{notice}</p>}
      </div>
    );
  }

  const linkFor = (token: string): string =>
    `${data.base ?? window.location.origin}/einladung/${token}`;

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Einladen</h2>
        <p className="muted">
          Ein neues Konto auf diesem Server. Wer schon eines hat, kommt unter{' '}
          <em>Leute</em> in einen Arbeitsbereich — zwei Fragen, zwei Orte.
        </p>
        {data.mails ? null : (
          /*
           * Der Grund steht da, nicht eine stille Nichtwirkung (ADR-0112) — und
           * er nennt beide Variablen, weil eine allein nicht genügt.
           */
          <p className="muted small">
            Dieser Server verschickt <strong>keine Mail</strong>: dafür fehlen{' '}
            <code>SOTE_SMTP_HOST</code>, <code>SOTE_MAIL_FROM</code> und{' '}
            <code>SOTE_BASE_URL</code>. Einladen geht trotzdem — den Link gibst du
            dann selbst weiter.
          </p>
        )}
        <div className="pick">
          <input
            className="set-input"
            type="email"
            aria-label="E-Mail-Adresse einladen"
            placeholder="name@beispiel.de"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || email.trim() === ''}
            onClick={() =>
              void tun(async () => {
                // Nur die Adresse. Es gibt hier keinen Parameter, in dem eine
                // URL stehen könnte — siehe der Kopf dieser Datei.
                await api.invite(email.trim());
                setEmail('');
              }, 'Einladen ging nicht.')
            }
          >
            Einladen
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>Offene Einladungen</h2>
        {data.invitations.length === 0 ? (
          <p className="muted">Keine.</p>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th>Adresse</th>
                <th>Gilt bis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.invitations.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.email}
                    <div className="share-link">
                      {i.acceptedAt !== null ? (
                        <span className="muted small">
                          eingelöst am {new Date(i.acceptedAt).toLocaleDateString('de-DE')}
                        </span>
                      ) : i.token === null ? (
                        // Schlüssel getauscht: die Einladung bleibt sichtbar,
                        // damit man sie zurücknehmen kann.
                        <span className="muted small">
                          Mit dem jetzigen Schlüssel nicht anzeigbar.
                        </span>
                      ) : (
                        <code>{linkFor(i.token)}</code>
                      )}
                    </div>
                  </td>
                  <td>{new Date(i.expiresAt).toLocaleDateString('de-DE')}</td>
                  <td>
                    {i.acceptedAt === null ? (
                      <button
                        type="button"
                        className="btn quiet small"
                        disabled={busy}
                        aria-label={`Einladung für ${i.email} zurücknehmen`}
                        onClick={() =>
                          void tun(
                            () => api.revokeInvitation(i.id),
                            'Zurücknehmen ging nicht.',
                          )
                        }
                      >
                        Zurücknehmen
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
