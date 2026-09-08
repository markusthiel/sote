/**
 * SOTE — wer hier mitarbeitet.
 *
 * ## Ein Suchfeld, kein Adressfeld (ADR-0119)
 *
 * SONEs ADR-0073 entschied das Gegenteil, ADR-0119 hat es zurückgenommen, und
 * die Meldung dazu war: *„Nur beim Eingeben der Email ist es nicht intuitiv ob
 * es auch wirklich geklappt hat und ob es die richtige Person ist."*
 *
 * Genau das kann ein Suchfeld beantworten und ein Adressfeld nicht: **ist das
 * die richtige Person** — vor dem Klick, nicht danach.
 *
 * ## Wer schon hier ist, steht mit in den Treffern
 *
 * Und ist markiert, statt herausgefiltert zu werden. Verborgen liest er sich
 * als „gibt es nicht", und das ist dieselbe Verwirrung von der anderen Seite.
 *
 * ## Was hier nicht steht
 *
 * **Einladungen.** Ein Konto anzulegen ist Sache der Instanz (ADR-0073), und
 * eine Einladung braucht den Mailweg, den SOTE nicht hat. Ein Feld dafür wäre
 * ein Feld, das nichts tut — der Fehler, den SONE vierzehn Mal hatte
 * (ADR-0112). Es steht als Satz da, damit niemand danach sucht.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

type Antwort = Awaited<ReturnType<typeof api.people>>;
type Treffer = Awaited<ReturnType<typeof api.findPeople>>['found'];

export function People({ workspace, you }: { workspace: string | undefined; you: string }) {
  const [data, setData] = useState<Antwort | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [suche, setSuche] = useState('');
  const [treffer, setTreffer] = useState<Treffer>([]);

  const load = useCallback(async () => {
    setData(await api.people(workspace));
  }, [workspace]);

  useEffect(() => {
    void load().catch(() => setNotice('Laden ging nicht.'));
  }, [load]);

  useEffect(() => {
    /*
     * Unter zwei Zeichen wird gar nicht gefragt.
     *
     * Der Server hält die Grenze auch (dort gehört sie hin), aber sie hier
     * ebenfalls zu ziehen erspart eine Anfrage je Tastendruck — und eine
     * Anfrage, die immer `[]` beantwortet, ist eine Anfrage, die man nicht
     * stellt.
     */
    if (suche.trim().length < 2) {
      setTreffer([]);
      return undefined;
    }
    // Kurz warten: sonst ist jeder Tastendruck eine Anfrage, und die Antworten
    // kommen in beliebiger Reihenfolge zurück.
    const t = setTimeout(() => {
      void api
        .findPeople(suche, workspace)
        .then((out) => setTreffer(out.found))
        .catch(() => setTreffer([]));
    }, 220);
    return () => clearTimeout(t);
  }, [suche, workspace]);

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

  const rolleFuerNeue = data.roles[0]?.id;

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      {data.mayManage ? (
        <section className="set-card">
          <h2>Jemanden hinzufügen</h2>
          <p className="muted">
            Wer schon ein Konto auf diesem Server hat. Ein Konto <em>anzulegen</em>{' '}
            ist Sache der Verwaltung — und eine Einladung per Mail gibt es noch
            nicht, weil dieser Server keinen Mailweg hat.
          </p>
          <div className="set-row">
            <span className="set-label">Suchen</span>
            <div className="set-value">
              <input
                className="set-input"
                aria-label="Person suchen"
                placeholder="Name oder E-Mail — ab zwei Zeichen"
                value={suche}
                disabled={busy}
                onChange={(e) => setSuche(e.target.value)}
              />
              {suche.trim().length >= 2 && treffer.length === 0 ? (
                <p className="muted small">Niemand mit diesem Namen oder dieser Adresse.</p>
              ) : null}
              {treffer.map((p) => (
                <div className="found-row" key={p.userId}>
                  <span className="fr-who">
                    <strong>{p.displayName}</strong>
                    <span className="muted small">{p.email}</span>
                  </span>
                  {p.alreadyMember ? (
                    /* Mitgeliefert und markiert, nicht gefiltert: verborgen
                       liest er sich als „gibt es nicht". */
                    <span className="muted small">ist schon hier</span>
                  ) : (
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy || rolleFuerNeue === undefined}
                      onClick={() =>
                        void tun(async () => {
                          await api.addPerson(
                            { userId: p.userId, roleId: rolleFuerNeue! },
                            workspace,
                          );
                          setSuche('');
                        }, 'Hinzufügen ging nicht.')
                      }
                    >
                      Hinzufügen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="set-card">
        <h2>Wer hier ist</h2>
        <table className="ws-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rolle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.userId}>
                <td>
                  {p.displayName}
                  {p.userId === you ? <span className="ws-here"> · das bist du</span> : null}
                  <div className="muted small">{p.email}</div>
                </td>
                <td>
                  {p.isOwner ? (
                    /*
                     * Eigentümerschaft ist eine Spalte und kein Recht (SONEs
                     * ADR-0102), also steht sie hier als Wort und nicht als
                     * Auswahl. Sie über das Rollenfeld ändern zu können wäre
                     * ein zweiter Weg zu einer anderen Sache.
                     */
                    'Eigentümer'
                  ) : data.mayManage ? (
                    <select
                      aria-label={`Rolle von ${p.displayName}`}
                      value={p.roleId ?? ''}
                      disabled={busy}
                      onChange={(e) =>
                        void tun(
                          () => api.setRole(p.userId, e.target.value, workspace),
                          'Rolle ändern ging nicht.',
                        )
                      }
                    >
                      {data.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (p.roleName ?? '—')
                  )}
                </td>
                <td>
                  {data.mayManage && !p.isOwner ? (
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      aria-label={`${p.displayName} entfernen`}
                      onClick={() =>
                        void tun(
                          () => api.removePerson(p.userId, workspace),
                          'Entfernen ging nicht.',
                        )
                      }
                    >
                      Entfernen
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.mayManage ? null : (
          <p className="muted small">
            Wer hier mitarbeitet, darfst du sehen. Ändern darf es, wer den
            Arbeitsbereich verwaltet.
          </p>
        )}
      </section>
    </div>
  );
}
