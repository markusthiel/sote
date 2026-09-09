/**
 * SOTE — was eine Rolle gibt.
 *
 * ## Eine Karte je Rolle, keine Zeile
 *
 * SONEs ADR-0119, Punkt 2, nach einer Meldung aus der Benutzung: *„Das könnte
 * optisch aufgeräumter sein. Man kann pro Rolle gerne eine Karte machen."* Der
 * Befund dort:
 *
 * > The list used `.permission-list`, which is a flex row with a label on one
 * > side and controls on the other. Right for a share. Wrong here, because a
 * > role says **two** things — what it does on lists, and what it manages in
 * > the workspace — und dann eine Zahl, und dann ob sie änderbar ist. Vier
 * > Dinge auf einer Zeile brechen um.
 *
 * Also eine Karte, und in ihr die Zweiteilung, die die Form ohnehin hat
 * (ADR-0087): **die Stufe** ist eine Leiter, **die Rechte** sind eine Menge.
 *
 * ## Systemrollen stehen mit dabei
 *
 * Nicht änderbar, aber sichtbar — und der Grund steht dran. Sie zu verbergen
 * hieße, dass jemand `member` sucht und nicht findet, obwohl es das gibt;
 * dieselbe Verwirrung wie bei einem gefilterten Mitglied in der Personensuche
 * (ADR-0119).
 */

import { LIST_LEVELS, RIGHT_SAYS, RIGHTS, type ListLevel, type Right } from '@sote/core';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

const LEVEL_SAYS: Record<ListLevel | 'none', { label: string; hint: string }> = {
  none: { label: 'Keine', hint: 'Sieht die Projekte nicht — das ist ein Gast.' },
  viewer: { label: 'Mitlesen', hint: 'Sieht Aufgaben, ändert nichts.' },
  editor: { label: 'Mitarbeiten', hint: 'Legt an, hakt ab, ändert Titel und Zeitpunkt.' },
  admin: { label: 'Verwalten', hint: 'Dazu Projekte anlegen, umbenennen, wegwerfen.' },
};

export function Roles({ workspace }: { workspace: string | undefined }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.roles>> | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [neu, setNeu] = useState('');

  const load = useCallback(async () => {
    setData(await api.roles(workspace));
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
        <h2>Rollen</h2>
        <p className="muted">
          Eine Rolle sagt <strong>zwei</strong> Dinge: was jemand in den Projekten
          darf, und was er im Arbeitsbereich verwaltet. „Nur lesend" ist dann
          keine eigene Sache, sondern Mitlesen ohne Rechte.
        </p>
        {data.mayManage ? null : (
          <p className="muted small">
            Ändern darf, wer Rollen verwaltet. Sehen darfst du sie — sie stehen
            ohnehin in der Liste der Leute.
          </p>
        )}
      </section>

      {data.roles.map((r) => (
        <section className="settings-card role-card" key={r.id}>
          <div className="role-head">
            {r.system || !data.mayManage ? (
              <h2>{r.name}</h2>
            ) : (
              <input
                className="set-input role-name"
                aria-label={`Name der Rolle ${r.name}`}
                defaultValue={r.name}
                disabled={busy}
                onBlur={(e) => {
                  const wie = e.target.value.trim();
                  if (wie !== '' && wie !== r.name) {
                    void tun(() => api.patchRole(r.id, { name: wie }, workspace), 'Umbenennen ging nicht.');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = r.name;
                    e.currentTarget.blur();
                  }
                }}
              />
            )}
            <span className="role-count">
              {/*
                Die Zahl beantwortet „darf ich das löschen" — und genau die
                Frage stellt sich, bevor man es versucht. Sie steht darum neben
                dem Namen und nicht in einer Fußnote.
              */}
              {r.members === 0
                ? 'hält niemand'
                : r.members === 1
                  ? 'hält eine Person'
                  : `halten ${r.members} Personen`}
            </span>
          </div>

          {r.system ? (
            <p className="muted small">
              Eine Systemrolle. Sie zu ändern würde die Bedeutung verschieben,
              auf die sich Bestehendes verlässt — leg eine eigene an.
            </p>
          ) : null}

          <div className="settings-row">
            <span className="settings-row-label"><b>In den Projekten</b><span>{LEVEL_SAYS[r.listLevel ?? 'none'].hint}</span></span>
            <div className="settings-row-value">
              <div className="set-choice" role="radiogroup" aria-label={`Stufe von ${r.name}`}>
                {(['none', ...LIST_LEVELS] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={(r.listLevel ?? 'none') === lvl}
                    disabled={busy || r.system || !data.mayManage}
                    title={LEVEL_SAYS[lvl].hint}
                    onClick={() =>
                      void tun(
                        () =>
                          api.patchRole(
                            r.id,
                            { listLevel: lvl === 'none' ? null : lvl },
                            workspace,
                          ),
                        'Ändern ging nicht.',
                      )
                    }
                  >
                    {LEVEL_SAYS[lvl].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-row-label"><b>Im Arbeitsbereich</b></span>
            <div className="settings-row-value">
              {/*
                Jeder Schalter hier bewacht wirklich etwas — ein Wächter im
                Testlauf verlangt das (ADR-0087: „a settings screen offering a
                switch that gates nothing is worse than not offering it").
                Darum stehen drei und nicht vier: Gruppen gibt es nicht.
              */}
              {RIGHTS.map((right: Right) => (
                <label className="right-row" key={right}>
                  <input
                    type="checkbox"
                    aria-label={`${r.name}: ${RIGHT_SAYS[right]}`}
                    checked={r.rights.includes(right)}
                    disabled={busy || r.system || !data.mayManage}
                    onChange={(e) =>
                      void tun(
                        () =>
                          api.patchRole(
                            r.id,
                            {
                              rights: e.target.checked
                                ? [...r.rights, right]
                                : r.rights.filter((x) => x !== right),
                            },
                            workspace,
                          ),
                        'Ändern ging nicht.',
                      )
                    }
                  />
                  <span>
                    <strong>{right}</strong>
                    <span className="muted small">{RIGHT_SAYS[right]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!r.system && data.mayManage ? (
            <div className="settings-row">
              <span className="settings-row-label" />
              <div className="settings-row-value">
                {r.members > 0 ? (
                  /* Kein Knopf, sondern der Grund: eine Rolle zu löschen, die
                     jemand hält, hieße zu entscheiden, was der dann darf. */
                  <span className="muted small">
                    Zum Löschen zuerst allen, die sie halten, eine andere geben.
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn quiet small"
                    disabled={busy}
                    aria-label={`Rolle ${r.name} löschen`}
                    onClick={() =>
                      void tun(() => api.deleteRole(r.id, workspace), 'Löschen ging nicht.')
                    }
                  >
                    Diese Rolle löschen
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ))}

      {data.mayManage ? (
        <section className="settings-card">
          <h2>Eine Rolle anlegen</h2>
          <div className="settings-row">
            <span className="settings-row-label"><b>Name</b><span>Sie beginnt mit „Mitlesen" und ohne Rechte — was sie gibt, stellst
                du in ihrer Karte ein.</span></span>
            <div className="settings-row-value">
              <div className="pick">
                <input
                  className="set-input"
                  aria-label="Name der neuen Rolle"
                  placeholder="Redaktion, Vorstand, Nur lesend …"
                  value={neu}
                  disabled={busy}
                  onChange={(e) => setNeu(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || neu.trim() === ''}
                  onClick={() =>
                    void tun(async () => {
                      /*
                       * Neu heißt „Mitlesen, keine Rechte".
                       *
                       * Nicht leer und nicht großzügig: eine neue Rolle ohne
                       * Stufe wäre ein Gast, den niemand gemeint hat, und eine
                       * mit Rechten wäre eine Vergabe, die niemand getroffen
                       * hat. Die Karte darunter ist der Ort, an dem man wählt.
                       */
                      await api.createRole(
                        { name: neu.trim(), listLevel: 'viewer', rights: [] },
                        workspace,
                      );
                      setNeu('');
                    }, 'Anlegen ging nicht.')
                  }
                >
                  Anlegen
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
