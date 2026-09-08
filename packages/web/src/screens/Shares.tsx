/**
 * SOTE — was hinausgegeben ist.
 *
 * Der letzte Platzhalter in der Schiene bekommt einen Inhalt. Konzept 10e.
 *
 * ## „Zuletzt benutzt" ist die Spalte, um die es geht
 *
 * Eine Liste von Freigaben ohne diese Angabe ist eine Liste, in der man nicht
 * erkennt, welche man vergessen hat — und die vergessene Freigabe ist der
 * eigentliche Schaden. „Noch nie" ist darum eine eigene Auskunft und kein
 * leeres Feld: ein Link, der nie benutzt wurde, ist ein anderer Fall als einer,
 * der gestern benutzt wurde.
 *
 * ## Der Widerruf steht in jeder Zeile
 *
 * Nicht in einem Menü hinter drei Punkten. Es ist die Funktion, auf die es
 * ankommt, und ein Klick weniger ist hier ein Argument.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Project } from '../api.js';
import { matchesShare, type ShareRow, type SharesView } from './SharesPanel.js';

export function Shares({
  workspace,
  projects,
  preselect,
  view,
  onList,
}: {
  workspace: string | undefined;
  projects: readonly Project[];
  /**
   * Ein Projekt, das schon gewählt ist.
   *
   * Kommt vom Teilen-Knopf im Baum: dort tut man es **am Projekt**, und dann
   * hier noch einmal aus einer Liste zu wählen wäre derselbe Schritt zweimal.
   * Recht und Ablauf bleiben eine Wahl — das ist der Grund, warum der Knopf
   * hierher führt und nicht still einen Link anlegt (Konzept 10e).
   */
  preselect?: string | undefined;
  /**
   * Welche Ansicht das Menü gewählt hat.
   *
   * Die Liste kommt **einmal** und wird hier gefiltert — dieselbe Regel wie
   * beim Posteingang: eine Abfrage je Ansicht wäre eine je Zahl, und die Zahlen
   * kämen aus verschiedenen Augenblicken.
   */
  view: SharesView;
  /**
   * Die geladene Liste nach oben melden.
   *
   * **Ein** Abruf, zwei Leser: das Menü zählt aus derselben Liste, die dieser
   * Bildschirm zeigt. Ein zweiter Abruf in der Hülle wäre genau das, was ich
   * beim Posteingang vermieden habe — zwei Zahlen aus verschiedenen
   * Augenblicken.
   *
   * Nach oben gemeldet und nicht oben geholt, weil das Laden hierher gehört:
   * dieser Bildschirm legt an und widerruft, also weiß nur er, wann die Liste
   * neu zu holen ist.
   */
  onList: (shares: readonly ShareRow[]) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.shares>> | undefined>(undefined);

  /*
   * Was die gewählte Ansicht übrig lässt.
   *
   * Gefiltert hier und nicht im Server: die Liste kommt einmal, und Menü und
   * Bildschirm zählen daraus. Zwei Wege wären zwei Wahrheiten über dieselbe
   * Liste (SONEs `InboxPanel`).
   */
  const gezeigt = (data?.shares ?? []).filter((s) => matchesShare(s, view, new Date()));
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [frisch, setFrisch] = useState<string | undefined>(undefined);

  const listen = projects.filter((p) => p.kind === 'list');
  const [ziel, setZiel] = useState(preselect ?? '');
  const [recht, setRecht] = useState<'read' | 'edit'>('read');
  const [ablauf, setAblauf] = useState('');

  const load = useCallback(async () => {
    const out = await api.shares(workspace);
    setData(out);
    // Ein Abruf, zwei Leser: das Menü zählt aus dieser Liste.
    onList(out.shares);
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

  if (data === undefined) return <div className="settings" aria-busy="true" />;

  if (!data.possible) {
    /*
     * Der Grund steht da, nicht eine leere Liste.
     *
     * Eine Sache, die nicht wirkt und nicht sagt warum, ist der Fehler, den
     * SONE vierzehn Mal hatte (ADR-0112). Hier ist der Grund eine fehlende
     * Variable, und die wird genannt — mitsamt dem Befehl, der sie erzeugt.
     */
    return (
      <div className="settings">
        <section className="set-card">
          <h2>Freigaben</h2>
          <p className="muted">
            Dieser Server hat keinen Schlüssel für Freigaben, also gibt es hier
            keine. Er wird in der Umgebung gesetzt:
          </p>
          <pre className="hint-code">SOTE_SHARE_KEY=$(openssl rand -hex 32)</pre>
          <p className="muted small">
            In der Umgebung und nicht in der Datenbank: läge er neben den Links,
            die er schützt, wäre er keiner.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="set-card">
        <h2>Einen Link anlegen</h2>
        <p className="muted">
          Gilt für <strong>ein Projekt</strong> — nicht für einen Ordner und
          nicht für den Arbeitsbereich. Wer den Link hat, braucht kein Konto.
        </p>

        <div className="set-row">
          <span className="set-label">Projekt</span>
          <div className="set-value">
            <select
              aria-label="Projekt für den Link"
              value={ziel}
              disabled={busy || listen.length === 0}
              onChange={(e) => setZiel(e.target.value)}
            >
              <option value="">— wähle ein Projekt —</option>
              {listen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Recht</span>
          <div className="set-choice" role="radiogroup" aria-label="Recht">
            <button
              type="button"
              role="radio"
              aria-checked={recht === 'read'}
              disabled={busy}
              onClick={() => setRecht('read')}
            >
              Nur lesen
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={recht === 'edit'}
              disabled={busy}
              onClick={() => setRecht('edit')}
            >
              Mitarbeiten
            </button>
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Ablauf</span>
          <div className="set-value">
            <input
              type="date"
              aria-label="Ablauf"
              className="set-input"
              value={ablauf}
              disabled={busy}
              onChange={(e) => setAblauf(e.target.value)}
            />
            {/* Freiwillig, mit einem Vorschlag: eine Pflicht macht Leute
                erfinderisch (ein Jahr), ein Vorschlag macht den Ablauf zur
                Gewohnheit. */}
            <p className="muted small">
              Freiwillig. Ein Ablauf ist die Freigabe, die sich selbst aufräumt.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn"
          disabled={busy || ziel === ''}
          onClick={() =>
            void tun(async () => {
              const out = await api.createShare(
                {
                  projectId: ziel,
                  right: recht,
                  // Bis zum Ende des Tages, nicht bis zu seinem Anfang: wer
                  // „31.12." wählt, meint den 31. mit.
                  ...(ablauf === '' ? {} : { expiresAt: `${ablauf}T23:59:59` }),
                },
                workspace,
              );
              setFrisch(out.share.token);
              setZiel('');
              setAblauf('');
            }, 'Anlegen ging nicht.')
          }
        >
          Link anlegen
        </button>

        {frisch === undefined ? null : (
          <div className="fresh-link">
            <p className="muted small">
              Der Link steht auch unten in der Liste — du musst ihn nicht jetzt
              kopieren.
            </p>
            <code>{linkFor(frisch)}</code>
          </div>
        )}
      </section>

      <section className="set-card">
        <h2>Was hinausgegeben ist</h2>
        {data.shares.length === 0 ? (
          <p className="muted">Nichts. Kein Link führt derzeit von außen hierher.</p>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th>Projekt</th>
                <th>Recht</th>
                <th>Zuletzt benutzt</th>
                <th>Ablauf</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {gezeigt.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.projectName}
                    <div className="share-link">
                      {s.token === null ? (
                        /* Der Schlüssel ist getauscht oder verloren. Die
                           Freigabe bleibt sichtbar, damit man sie widerrufen
                           kann — das ist die Funktion, auf die es ankommt. */
                        <span className="muted small">
                          Mit dem jetzigen Schlüssel nicht anzeigbar.
                        </span>
                      ) : (
                        <code>{linkFor(s.token)}</code>
                      )}
                    </div>
                  </td>
                  <td>{s.right === 'edit' ? 'Mitarbeiten' : 'Nur lesen'}</td>
                  <td>
                    {s.lastUsedAt === null ? (
                      // „Noch nie" ist eine eigene Auskunft und kein leeres
                      // Feld: ein Link, der nie benutzt wurde, ist ein anderer
                      // Fall als einer von gestern.
                      <span className="muted">noch nie</span>
                    ) : (
                      new Date(s.lastUsedAt).toLocaleDateString('de-DE')
                    )}
                  </td>
                  <td>
                    {s.expiresAt === null ? (
                      <span className="muted">ohne</span>
                    ) : (
                      new Date(s.expiresAt).toLocaleDateString('de-DE')
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      aria-label={`Freigabe für ${s.projectName} widerrufen`}
                      onClick={() =>
                        void tun(() => api.revokeShare(s.id, workspace), 'Widerrufen ging nicht.')
                      }
                    >
                      Widerrufen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Widerrufen wirkt sofort und lässt sich nicht zurücknehmen — „widerrufen,
          aber wiederherstellbar" hieße, der Link geht noch.
        </p>
      </section>
    </div>
  );
}

/**
 * Die ganze Adresse, nicht nur der Token.
 *
 * Gebaut aus dem Ort, an dem diese Seite läuft, und nicht aus einer
 * Einstellung: eine konfigurierte Basisadresse, die nicht stimmt, erzeugt
 * Links, die niemand öffnen kann — und sie stimmt genau dann nicht, wenn
 * jemand die Instanz umgezogen und die Einstellung vergessen hat.
 */
const linkFor = (token: string): string => `${window.location.origin}/f/${token}`;
