/**
 * SOTE — der Kalender-Link.
 *
 * Die Aufgaben mit Datum in deinem Kalenderprogramm, neben allem anderen, was
 * dort steht. Ein Abonnement und keine Datei: eine Datei wäre einmal geladen
 * und nie wieder richtig, und ein Kalender, der nicht nachzieht, ist schlimmer
 * als keiner — er zeigt mit Überzeugung den Stand von letzter Woche.
 *
 * ## Unter „Einstellungen" und nicht unter „Workspace"
 *
 * Der Link ist DEINER: er gilt ohne Anmeldung, du widerrufst ihn allein, und
 * niemand sonst bekommt ihn zu sehen. Damit gehört er dorthin, wo die
 * Einstellungen deine sind — auch wenn das, was er zeigt, ein Arbeitsbereich
 * ist. Welcher, sagt der Satz auf dem Bildschirm.
 *
 * ## Der Satz über das Geheimnis steht auf dem Bildschirm
 *
 * Wer einen Link weitergibt, muss wissen, was er weitergibt. Ein Hinweis in
 * einer Anleitung wäre einer, den man nach dem Weitergeben liest.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';
import type { CalendarDefault } from '@sote/core';
import { CalendarPreferences } from '../components/CalendarPreferences.js';

export function CalendarFeed({
  workspace,
  workspaceName,
  defaultView,
  onDefaultView,
}: {
  workspace: string | undefined;
  workspaceName: string;
  defaultView: CalendarDefault;
  onDefaultView: (value: CalendarDefault) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.calendar>> | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  /** Das Neumachen fragt nach: es macht den alten Link tot. */
  const [fragt, setFragt] = useState(false);

  const load = useCallback(async () => {
    setData(await api.calendar(workspace));
  }, [workspace]);

  useEffect(() => {
    void load().catch(() => setNotice('Laden ging nicht.'));
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

  const preferences = <CalendarPreferences value={defaultView} workspace={workspace} onSaved={onDefaultView} />;
  if (data === undefined) return <div className="settings">{preferences}{notice ? <p className="note-error">{notice}</p> : <p className="muted" role="status">Kalenderabonnement wird geladen …</p>}</div>;

  /*
   * Die Adresse wird HIER zusammengesetzt und nicht am Server.
   *
   * `base` kommt vom Server (aus `SOTE_BASE_URL`), weil nur er weiß, unter
   * welchem Namen er von draußen erreichbar ist — der Browser kennt nur den,
   * über den er gerade gekommen ist, und hinter einem Vorschaltserver ist das
   * nicht derselbe. Fehlt die Angabe, steht hier der Weg ohne Herkunft: besser
   * eine halbe Adresse mit einem Satz dazu als eine erfundene ganze.
   */
  const url =
    data.feed === null || data.feed.token === null
      ? null
      : `${data.base ?? ''}/kalender/${data.feed.token}.ics`;

  return (
    <div className="settings">
      {preferences}
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Kalenderabonnement</h2>
        <p className="muted">
          Die Aufgaben aus <strong>{workspaceName}</strong>, die ein Datum haben,
          als Abonnement für dein Kalenderprogramm. Was eine Dauer hat, wird ein
          Block; was nur einen Zeitpunkt hat, bleibt einer. Eine Frist steht als
          eigener Eintrag daneben.
        </p>
        <p className="muted">
          Erledigtes kommt nicht mit: ein Kalender sagt, was ansteht.
        </p>
      </section>

      {data.possible ? null : (
        <section className="settings-card">
          <p className="muted">
            Dieser Server hat keinen <code>SOTE_SHARE_KEY</code>. Ohne ihn lässt
            sich kein Link ausgeben, der sich später noch anzeigen lässt — und
            ein Knopf, der das verspricht, wäre einer, der nichts tut.
          </p>
        </section>
      )}

      {data.possible ? (
        <section className="settings-card">
          {url === null ? (
            <>
              <p className="muted">
                Noch keinen. Ein Kalenderprogramm kann sich nicht anmelden, also
                trägt die Adresse das Geheimnis — sie ist ein Passwort-Ersatz.
                Gib sie nur weiter, wenn der andere die Aufgaben sehen darf.
              </p>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void tun(() => api.newCalendar(workspace), 'Ging nicht.')}
              >
                Link erzeugen
              </button>
            </>
          ) : (
            <>
              <div className="settings-row">
                <span className="settings-row-label">
                  <b>Deine Adresse</b>
                  <span>
                    Im Kalenderprogramm „Kalender abonnieren“ und diese Adresse
                    einsetzen. Ein Passwort-Ersatz — wer sie hat, sieht die
                    Aufgaben mit Datum.
                  </span>
                </span>
                <div className="settings-row-value">
                  <div className="pick">
                    <input
                      type="text"
                      className="set-input"
                      readOnly
                      value={url}
                      aria-label="Adresse des Kalenders"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="btn quiet small"
                      onClick={() => {
                        /*
                         * Fehlschlag wird GESAGT. Ohne HTTPS gibt es kein
                         * `clipboard`, und ein Knopf, der dann still nichts
                         * tut, lässt jemanden eine leere Zwischenablage
                         * einsetzen.
                         */
                        void navigator.clipboard?.writeText(url).then(
                          () => setKopiert(true),
                          () => setNotice('Kopieren ging nicht — die Adresse steht im Feld.'),
                        );
                      }}
                    >
                      {kopiert ? 'Kopiert' : 'Kopieren'}
                    </button>
                  </div>
                </div>
              </div>

              <p className="muted small">
                {data.feed?.lastUsedAt === null || data.feed?.lastUsedAt === undefined
                  ? 'Noch nicht abgeholt — dein Kalenderprogramm hat sich hier noch nicht gemeldet.'
                  : `Zuletzt abgeholt: ${new Date(data.feed.lastUsedAt).toLocaleString()}.`}
              </p>

              <div className="pick">
                {fragt ? (
                  <>
                    <span className="muted">
                      Der alte Link ist danach tot — Kalender, die ihn benutzen,
                      bekommen nichts mehr. Wirklich?
                    </span>
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      onClick={() => {
                        setFragt(false);
                        setKopiert(false);
                        void tun(() => api.newCalendar(workspace), 'Ging nicht.');
                      }}
                    >
                      Ja, neu machen
                    </button>
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      onClick={() => setFragt(false)}
                    >
                      Nein
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn quiet small"
                    disabled={busy}
                    onClick={() => setFragt(true)}
                  >
                    Neu machen
                  </button>
                )}
                <button
                  type="button"
                  className="btn quiet small"
                  disabled={busy}
                  onClick={() => {
                    setKopiert(false);
                    void tun(() => api.revokeCalendar(workspace), 'Ging nicht.');
                  }}
                >
                  Abschalten
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
