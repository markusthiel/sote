/**
 * SOTE — Wartung: was dieser Server von selbst tut.
 *
 * Der Grund für diesen Bildschirm steht im Läufer (Migration 0015): **nichts
 * wird still weggeworfen** — ein Auftrag, der fünfmal fehlschlug, bleibt mit
 * seinem letzten Fehler liegen. Diese Zusage hilft nur, wenn es irgendwo zu
 * sehen ist. Ein Läufer, dessen Aufträge liegen bleiben, ist sonst eine
 * Anwendung, die still weniger tut als versprochen.
 *
 * Was hier NICHT steht: ein Knopf „jetzt laufen lassen". Er wäre leicht zu
 * bauen und würde die falsche Frage beantworten — wenn ein Auftrag klemmt, ist
 * der Fehler das Interessante und nicht ein weiterer Versuch, der ihn
 * wiederholt. Sobald es einen Fall gibt, in dem manuelles Anstoßen hilft, kommt
 * der Knopf mit diesem Fall.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

export function Maintenance() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.maintenance>> | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setData(await api.maintenance());
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) =>
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.'),
    );
  }, [load]);

  if (data === undefined) {
    return (
      <div className="settings">
        {notice === undefined ? <div aria-busy="true" /> : <p className="note-error">{notice}</p>}
      </div>
    );
  }

  const liegen = data.open.filter((j) => j.givenUp);

  return (
    <div className="settings">
      <section className="settings-card">
        <h2>Was von selbst läuft</h2>
        <p className="muted">
          Aufträge laufen im Serverprozess, alle halbe Minute wird nachgesehen.
          Die Zusage ist <strong>mindestens einmal</strong> — ein Auftrag kann
          zweimal laufen, und jeder ist so gebaut, dass das nichts schadet.
        </p>
        <div className="settings-row">
          <span className="settings-row-label"><b>Bearbeiter</b></span>
          <div className="settings-row-value">
            {data.kinds.length === 0 ? (
              <span className="muted">keine</span>
            ) : (
              <code>{data.kinds.join(', ')}</code>
            )}
            <p className="muted small">
              Der Papierkorb leert sich nach {data.trashDays} Tagen — gerechnet
              vom Wegwerfen, nicht vom Anlegen.
            </p>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label"><b>Erledigt</b></span>
          <div className="settings-row-value">
            {data.done.count} Aufträge
            {data.done.last === null
              ? ''
              : `, zuletzt am ${new Date(data.done.last).toLocaleString('de-DE')}`}
          </div>
        </div>
      </section>

      {liegen.length > 0 ? (
        <section className="settings-card danger">
          <h2>Liegen geblieben</h2>
          <p className="muted">
            Diese Aufträge sind fünfmal fehlgeschlagen und laufen nicht mehr von
            selbst. Sie stehen hier, statt zu verschwinden.
          </p>
          <table className="ws-table">
            <thead>
              <tr>
                <th>Auftrag</th>
                <th>Versuche</th>
                <th>Letzter Fehler</th>
              </tr>
            </thead>
            <tbody>
              {liegen.map((j, i) => (
                <tr key={`${j.kind}-${i}`}>
                  <td>
                    <code>{j.kind}</code>
                  </td>
                  <td>{j.attempts}</td>
                  <td className="small">{j.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="settings-card">
        <h2>In der Schlange</h2>
        {data.open.length === 0 ? (
          <p className="muted">Nichts. Alles abgearbeitet.</p>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th>Auftrag</th>
                <th>Frühestens</th>
                <th>Versuche</th>
              </tr>
            </thead>
            <tbody>
              {data.open.map((j, i) => (
                <tr key={`${j.kind}-${i}`}>
                  <td>
                    <code>{j.kind}</code>
                  </td>
                  <td>{new Date(j.runAt).toLocaleString('de-DE')}</td>
                  <td>
                    {j.attempts}
                    {j.lastError === null ? null : (
                      <div className="muted small">{j.lastError}</div>
                    )}
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
