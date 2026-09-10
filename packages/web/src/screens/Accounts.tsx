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

        {/* SONEs `admin-list`: links wer, rechts die Schalter und der
            Handgriff. Eine Tabelle behauptet vergleichbare Spalten — ein
            Häkchen, eine Zahl und ein Knopf sind keine. */}
        <div className="admin-list">
          {data.accounts.map((a) => (
            <div className="admin-row" key={a.id}>
              <div className="admin-row-main">
                <span className="admin-name">
                  {a.displayName}
                  {a.id === data.you ? <span className="ws-here"> · das bist du</span> : null}
                </span>
                {/* Die Zahl der Arbeitsbereiche steht jetzt IM Beiwerk statt in
                    einer eigenen Spalte: sie erklärt, warum Löschen geht oder
                    nicht, und gehört damit neben die Adresse. */}
                <span className="admin-meta">
                  {a.email}
                  {a.workspaces === 0
                    ? ' · in keinem Arbeitsbereich'
                    : ` · ${a.workspaces} Arbeitsbereich${a.workspaces === 1 ? '' : 'e'}`}
                </span>
              </div>
              <div className="admin-row-actions">
                <label className="admin-flag">
                  <input
                    type="checkbox"
                    aria-label={`${a.displayName} verwaltet die Instanz`}
                    checked={a.isAdmin}
                    disabled={busy || (a.isAdmin && admins <= 1)}
                    onChange={(e) =>
                      void tun(() => api.setAdmin(a.id, e.target.checked), 'Ändern ging nicht.')
                    }
                  />
                  verwaltet
                  {a.isAdmin && admins <= 1 ? (
                    <span className="muted small">· der letzte</span>
                  ) : null}
                </label>
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
              </div>
            </div>
          ))}
        </div>

        <p className="muted small">
          {/* Stand hier: „…eine Einladung per Mail gibt es noch nicht, weil
              dieser Server keinen Mailweg hat." Derselbe Satz wie in People,
              und derselbe Fund: er ist seit a1d2f54 falsch. Zweimal derselbe
              veraltete Satz an zwei Orten — beim ersten Mal habe ich nur die
              eine Stelle berichtigt, statt nach der Formulierung zu suchen. */}
          Neue Konten entstehen beim Anmelden oder über eine{' '}
          <em>Einladung</em> — siehe „Einladungen".
        </p>
      </section>
    </div>
  );
}
