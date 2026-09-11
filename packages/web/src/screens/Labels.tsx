/**
 * SOTE — die Schlagwörter eines Arbeitsbereichs.
 *
 * Vergeben werden sie an der Aufgabe. Hier steht, was danach kommt: nachsehen,
 * was es gibt, einen Tippfehler richtigstellen, ein totes wegräumen.
 *
 * ## Warum das ein Ort sein muss und keine Klappe
 *
 * Ohne ihn wären „echte Schlagwörter" nur halb wahr: ein Vokabular, das nur
 * wachsen kann, sammelt `unterwegs` und `unterweg`, und nichts davon lässt sich
 * einsammeln. Die Suche findet dann zwei Listen, wo eine gemeint war.
 *
 * ## Unter „Workspace" und nicht unter „Verwaltung"
 *
 * Die Aufteilung ist SONEs und steht in `Settings.tsx`: *die Einstellungen sind
 * deine, ein Arbeitsbereich gehört allen darin, die Verwaltung gilt für jeden
 * auf dem Server.* Ein Schlagwort gehört dem Arbeitsbereich — wie sein Name und
 * seine Farben. Und darum auch kein fünftes Recht dafür: `workspace.settings`
 * ist genau die Frage, die hier zu stellen ist.
 *
 * ## Keine Farbe
 *
 * Die Spalte `color` steht seit Migration 0001 in der Tabelle und bleibt leer.
 * Das ist Absicht: in der Zeile trägt die FARBE schon eine Bedeutung, nämlich
 * die Priorität. Acht bunte Etiketten daneben wären acht Farben, die um
 * dieselbe Aufmerksamkeit streiten, und die eine, die etwas heißt, ginge darin
 * unter. Ein Einstellknopf, der etwas einfärbt, das man nicht einfärbt, wäre
 * der Schalter, der nichts tut.
 */

import { colorValue } from '@sote/core';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { LookPicker } from '../components/LookPicker.js';

import { api, ApiError } from '../api.js';

export function Labels({ workspace }: { workspace: string | undefined }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.labels>> | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** Welches gerade umbenannt wird, und worauf. */
  const [edit, setEdit] = useState<{ id: string; text: string } | undefined>(undefined);
  /**
   * Welches beim Löschen NACHFRAGT.
   *
   * Zwei Klicks und kein Papierkorb: ein Schlagwort ist ein Wort, das man in
   * einer Sekunde wieder hintippt — ein Papierkorb für Wörter wäre ein Ort, an
   * dem niemand nachsieht. Aber es verschwindet von allen Aufgaben, und das
   * steht in der Frage.
   */
  const [fragt, setFragt] = useState<string | undefined>(undefined);
  /** Welches Schlagwort gerade gefärbt wird. */
  const [faerbt, setFaerbt] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setData(await api.labels(workspace));
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

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Schlagwörter</h2>
        <p className="muted">
          Sie entstehen beim Vergeben — <code>@unterwegs</code> in der
          Schnellerfassung oder im Feld an einer Aufgabe. Hier lassen sie sich
          richtigstellen und wegräumen.
        </p>
        {data.mayManage ? null : (
          <p className="muted">
            Ändern darf, wer die Einstellungen dieses Arbeitsbereichs ändern darf.
          </p>
        )}
      </section>

      {data.labels.length === 0 ? (
        <section className="settings-card">
          <p className="muted">
            Noch keine. Schreib <code>@wort</code> in eine Aufgabe, dann steht
            hier eines.
          </p>
        </section>
      ) : null}

      {data.labels.map((l) => (
        <section className="settings-card" key={l.id}>
          {edit?.id === l.id ? (
            <div className="role-head">
              <input
                type="text"
                value={edit.text}
                className="set-input"
                aria-label={`${l.name} umbenennen`}
                autoFocus
                onChange={(e) => setEdit({ id: l.id, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEdit(undefined);
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const name = edit.text;
                  void tun(async () => {
                    const out = await api.renameLabel(l.id, name, workspace);
                    setEdit(undefined);
                    /*
                     * Das Verschmelzen wird GESAGT und nicht stillschweigend
                     * getan. Wer `unterweg` auf `unterwegs` ändert, meint
                     * genau das — aber danach ist ein Schlagwort weniger da,
                     * und wer das nicht liest, sucht später danach.
                     */
                    if (out.merged) {
                      setNotice(
                        `„${l.name}“ ist mit „${out.name}“ zusammengelegt — die Aufgaben hängen jetzt an einem.`,
                      );
                    }
                  }, 'Umbenennen ging nicht.');
                }}
              />
              <button type="button" className="btn quiet small" disabled={busy} onClick={() => setEdit(undefined)}>
                Abbrechen
              </button>
            </div>
          ) : (
            <div className="role-head">
              <strong>
                {/*
                  Das Schlagwort in SEINER Farbe.

                  Gewünscht: die Farbe einer Aufgabe „kann vom Projekt kommen
                  oder vom Schlagwort". Dann soll man hier sehen, welche das
                  ist — eine Farbe, die nur an den Aufgaben erscheint und nicht
                  an ihrer Quelle, ist eine, die man raten muss.
                */}
                <span
                  className="tag"
                  data-eigen={l.color === null ? undefined : 'yes'}
                  style={
                    l.color === null
                      ? undefined
                      : ({ '--eigen': colorValue(l.color) } as CSSProperties)
                  }
                >
                  {l.name}
                </span>
              </strong>
              <span className="muted">
                {l.tasks === 0
                  ? 'an keiner Aufgabe'
                  : `an ${l.tasks} ${l.tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`}
              </span>
              {data.mayManage ? (
                <>
                  <button
                    type="button"
                    className="btn quiet small"
                    disabled={busy}
                    onClick={() => setEdit({ id: l.id, text: l.name })}
                  >
                    Umbenennen
                  </button>
                  <button
                    type="button"
                    className="btn quiet small"
                    disabled={busy}
                    aria-expanded={faerbt === l.id}
                    onClick={() => setFaerbt(faerbt === l.id ? undefined : l.id)}
                  >
                    Farbe
                  </button>
                  {fragt === l.id ? (
                    <>
                      <span className="muted">
                        {l.tasks === 0
                          ? 'Wirklich?'
                          : `Verschwindet von ${l.tasks} ${l.tasks === 1 ? 'Aufgabe' : 'Aufgaben'}. Wirklich?`}
                      </span>
                      <button
                        type="button"
                        className="btn quiet small"
                        disabled={busy}
                        onClick={() => {
                          setFragt(undefined);
                          void tun(
                            () => api.removeLabel(l.id, workspace),
                            'Wegräumen ging nicht.',
                          );
                        }}
                      >
                        Ja, wegräumen
                      </button>
                      <button type="button" className="btn quiet small" disabled={busy} onClick={() => setFragt(undefined)}>
                        Nein
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn quiet small" disabled={busy} onClick={() => setFragt(l.id)}>
                      Wegräumen
                    </button>
                  )}
                </>
              ) : null}
            </div>
          )}
          {/*
            Der Wähler steht UNTER der Zeile und nicht in einem Aufsatz: er
            bringt eine Reihe Farbfelder mit, und ein Aufsatz über einer Liste
            verdeckt die Schlagwörter, deren Farben man gerade vergleicht.
          */}
          {faerbt === l.id && data.mayManage ? (
            <LookPicker
              withIcon={false}
              icon={undefined}
              color={l.color ?? undefined}
              busy={busy}
              onIcon={() => undefined}
              onColor={(farbe) =>
                void tun(async () => {
                  await api.colorLabel(l.id, farbe, workspace);
                  setFaerbt(undefined);
                }, 'Färben ging nicht.')
              }
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
