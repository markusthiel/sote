/**
 * SOTE — Gruppen.
 *
 * Eine Gruppe ist eine Liste von Leuten, die **eine Rolle tragen kann**. Was
 * sie gibt, gibt sie **dazu**: die wirksame Rolle einer Person ist die
 * Vereinigung der Rechte und das Maximum der Stufen (SONEs ADR-0087).
 *
 * Der Satz steht auch auf dem Bildschirm, und zwar deshalb: wer eine Gruppe
 * anlegt, muss wissen, dass Aufnehmen niemandem etwas nimmt. Sonst prüft er
 * vor jedem Hinzufügen — und das ist genau die Vorsicht, die das Modell
 * vermeiden soll (ADR-0026).
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api.js';

export function Groups({ workspace }: { workspace: string | undefined }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.groups>> | undefined>(undefined);
  const [rollen, setRollen] = useState<{ id: string; name: string }[]>([]);
  const [leute, setLeute] = useState<{ userId: string; displayName: string }[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [neu, setNeu] = useState('');

  const load = useCallback(async () => {
    const [g, r, p] = await Promise.all([
      api.groups(workspace),
      api.roles(workspace),
      api.people(workspace),
    ]);
    setData(g);
    setRollen(r.roles.map((x) => ({ id: x.id, name: x.name })));
    setLeute(p.people.map((x) => ({ userId: x.userId, displayName: x.displayName })));
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

      <section className="set-card">
        <h2>Gruppen</h2>
        <p className="muted">
          Eine Gruppe ist eine Liste von Leuten und kann eine Rolle tragen. Was
          sie gibt, gibt sie <strong>dazu</strong>: wer aufgenommen wird, verliert
          nie etwas, das er ohne die Gruppe dürfte.
        </p>
      </section>

      {data.groups.map((g) => (
        <section className="set-card" key={g.id}>
          <div className="role-head">
            {data.mayManage ? (
              <input
                className="set-input role-name"
                aria-label={`Name der Gruppe ${g.name}`}
                defaultValue={g.name}
                disabled={busy}
                onBlur={(e) => {
                  const wie = e.target.value.trim();
                  if (wie !== '' && wie !== g.name) {
                    void tun(() => api.patchGroup(g.id, { name: wie }, workspace), 'Umbenennen ging nicht.');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = g.name;
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <h2>{g.name}</h2>
            )}
            <span className="role-count">
              {g.members.length === 0
                ? 'niemand darin'
                : g.members.length === 1
                  ? 'eine Person'
                  : `${g.members.length} Personen`}
            </span>
          </div>

          <div className="set-row">
            <span className="set-label">Trägt die Rolle</span>
            <div className="set-value">
              <select
                aria-label={`Rolle der Gruppe ${g.name}`}
                value={g.roleId ?? ''}
                disabled={busy || !data.mayManage}
                onChange={(e) =>
                  void tun(
                    () => api.patchGroup(g.id, { roleId: e.target.value }, workspace),
                    'Ändern ging nicht.',
                  )
                }
              >
                {/* „Keine" ist eine Angabe und kein leeres Feld: eine Gruppe
                    ohne Rolle ordnet nur, und das ist ein Zweck. */}
                <option value="">Keine — sie ordnet nur</option>
                {rollen.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="set-row">
            <span className="set-label">Darin</span>
            <div className="set-value">
              {g.members.map((m) => (
                <div className="found-row" key={m.userId}>
                  <span className="fr-who">
                    <strong>{m.displayName}</strong>
                  </span>
                  {data.mayManage ? (
                    <button
                      type="button"
                      className="btn quiet small"
                      disabled={busy}
                      aria-label={`${m.displayName} aus ${g.name} entfernen`}
                      onClick={() =>
                        void tun(
                          () => api.dropFromGroup(g.id, m.userId, workspace),
                          'Entfernen ging nicht.',
                        )
                      }
                    >
                      Entfernen
                    </button>
                  ) : null}
                </div>
              ))}
              {data.mayManage ? (
                <select
                  aria-label={`Jemanden zu ${g.name} hinzufügen`}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value === '') return;
                    void tun(
                      () => api.addToGroup(g.id, e.target.value, workspace),
                      'Hinzufügen ging nicht.',
                    );
                  }}
                >
                  <option value="">— jemanden hinzufügen —</option>
                  {/* Nur Leute aus dem Arbeitsbereich: eine Gruppe ist eine
                      Ordnung DARIN, und der Server lehnt Fremde ohnehin ab. */}
                  {leute
                    .filter((p) => !g.members.some((m) => m.userId === p.userId))
                    .map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.displayName}
                      </option>
                    ))}
                </select>
              ) : null}
            </div>
          </div>

          {data.mayManage ? (
            <div className="set-row">
              <span className="set-label" />
              <div className="set-value">
                <button
                  type="button"
                  className="btn quiet small"
                  disabled={busy}
                  aria-label={`Gruppe ${g.name} löschen`}
                  onClick={() =>
                    void tun(() => api.deleteGroup(g.id, workspace), 'Löschen ging nicht.')
                  }
                >
                  Diese Gruppe löschen
                </button>
                {/* Anders als bei einer Rolle geht das AUCH mit Leuten darin,
                    und der Satz sagt warum: ihre Rolle gab nur dazu. */}
                <p className="muted small">
                  Das geht auch mit Leuten darin — sie behalten ihre eigene Rolle.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ))}

      {data.mayManage ? (
        <section className="set-card">
          <h2>Eine Gruppe anlegen</h2>
          <div className="pick">
            <input
              className="set-input"
              aria-label="Name der neuen Gruppe"
              placeholder="Vorstand, Umzug, Redaktion …"
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
                  await api.createGroup(neu.trim(), workspace);
                  setNeu('');
                }, 'Anlegen ging nicht.')
              }
            >
              Anlegen
            </button>
          </div>
          <p className="muted small">
            Sie beginnt ohne Rolle und ohne Leute — beides stellst du in ihrer
            Karte ein.
          </p>
        </section>
      ) : null}
    </div>
  );
}
