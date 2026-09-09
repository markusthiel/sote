/**
 * SOTE — wer auf diesem Server existiert.
 *
 * Die Instanzseite von „Leute": dort steht, wer in **diesem Arbeitsbereich**
 * mitarbeitet, hier, wer es auf dem Server überhaupt gibt (SONEs ADR-0073).
 *
 * ## Kein Suchfeld mit Grenze
 *
 * Bei „Leute" gibt es eines, damit ein Arbeitsbereichseigentümer nicht das
 * Instanzverzeichnis liest. Wer diesen Bildschirm sieht, **verwaltet** die
 * Instanz — für den ist die Liste das Verzeichnis, und sie zu erschweren wäre
 * eine Hürde ohne Gewinn.
 *
 * ## Zwei Zahlen, und beide sind Fragen
 *
 * „In wie vielen Arbeitsbereichen" beantwortet *ist dieses Konto in Gebrauch* —
 * und das ist die Frage, die sich stellt, bevor man es löscht. Sie steht darum
 * neben dem Löschknopf und nicht in einer Fußnote.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

export function Accounts() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.accounts>> | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(await api.accounts());
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

  const admins = data.accounts.filter((a) => a.isAdmin).length;

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Konten</h2>
        <p className="muted">
          Wer auf diesem Server ein Konto hat. Wer in einem <em>Arbeitsbereich</em>{' '}
          mitarbeitet, steht dort unter „Leute" — zwei Fragen, zwei Orte.
        </p>

        <table className="ws-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Verwaltet</th>
              <th>Arbeitsbereiche</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.displayName}
                  {a.id === data.you ? <span className="ws-here"> · das bist du</span> : null}
                  <div className="muted small">{a.email}</div>
                </td>
                <td>
                  <label className="admin-flag">
                    <input
                      type="checkbox"
                      aria-label={`${a.displayName} verwaltet die Instanz`}
                      checked={a.isAdmin}
                      /*
                       * Der letzte Administrator kann sein Recht nicht
                       * abgeben, und der Kasten sagt es VORHER: der Server
                       * lehnt es ohnehin ab, aber ein Kasten, den man
                       * anklicken kann und der dann eine Meldung bringt, ist
                       * ein Kasten, der etwas verspricht.
                       */
                      disabled={busy || (a.isAdmin && admins <= 1)}
                      onChange={(e) =>
                        void tun(
                          () => api.setAdmin(a.id, e.target.checked),
                          'Ändern ging nicht.',
                        )
                      }
                    />
                    {a.isAdmin && admins <= 1 ? (
                      <span className="muted small">der letzte</span>
                    ) : null}
                  </label>
                </td>
                <td>
                  {a.workspaces === 0 ? (
                    <span className="muted">in keinem</span>
                  ) : (
                    a.workspaces
                  )}
                </td>
                <td>
                  {/*
                    Löschen gibt es nur, wo es gehen kann.
                    Ein Konto, das noch mitarbeitet, lehnt der Server ab — und
                    ein Knopf, der auf eine Ablehnung führt, ist ein Knopf, der
                    etwas verspricht (ADR-0027: abwesend statt anwesend und
                    verweigernd). Der Satz sagt stattdessen, was zu tun ist.
                  */}
                  {a.workspaces > 0 ? (
                    <span className="muted small">erst aus den Arbeitsbereichen nehmen</span>
                  ) : a.isAdmin && admins <= 1 ? (
                    <span className="muted small">der letzte Administrator</span>
                  ) : (
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      aria-label={`${a.displayName} löschen`}
                      onClick={() =>
                        void tun(() => api.deleteAccount(a.id), 'Löschen ging nicht.')
                      }
                    >
                      Löschen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="muted small">
          Neue Konten entstehen beim Anmelden — eine Einladung per Mail gibt es
          noch nicht, weil dieser Server keinen Mailweg hat.
        </p>
      </section>
    </div>
  );
}
