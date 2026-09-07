/**
 * SOTE — der Papierkorb.
 *
 * Zwei Ansichten im Panel, wie jeder Modus: Aufgaben und Projekte. Und der
 * Bildschirm sagt in einer Zeile, was er nicht tut — **nichts leert sich von
 * selbst**, und Abgehaktes liegt hier nicht. Beides sind Fragen, die man sonst
 * ausprobieren müsste.
 *
 * Das Zurückholen ist die einzige Stelle mit einer Wahl: liegt das Projekt
 * einer Aufgabe selbst im Papierkorb, verlangt der Server ein Ziel. Der Eintrag
 * sagt das vorher und zeigt den Wähler gleich mit — eine Ablehnung, die man
 * erst durch Klicken erfährt, ist eine Ablehnung zu spät.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Project, type TrashEntry } from '../api.js';
import { whenLabel } from '../dates.js';

export function Trash({
  workspace,
  projects,
  now,
  onChanged,
}: {
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<'task' | 'project'>('task');
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.listTrash(kind, workspace);
    setEntries(data.entries);
    setLoaded(true);
  }, [kind, workspace]);

  useEffect(() => {
    setLoaded(false);
    void load().catch((e: unknown) => {
      setLoaded(true);
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    });
  }, [load]);

  const table = (entry: TrashEntry) => (entry.kind === 'task' ? 'tasks' : 'projects');

  async function bringBack(entry: TrashEntry) {
    setBusy(true);
    setNotice(undefined);
    try {
      const chosen = targets[entry.id];
      const body =
        entry.projectTrashed
          ? { projectId: chosen === undefined || chosen === '' ? null : chosen }
          : {};
      await api.restore(table(entry), entry.id, body, workspace);
      await load();
      onChanged();
    } catch (e) {
      setNotice(
        e instanceof ApiError && e.code === 'needs_target'
          ? e.message
          : e instanceof ApiError
            ? e.message
            : 'Zurückholen ging nicht.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function forGood(entry: TrashEntry) {
    setBusy(true);
    setNotice(undefined);
    try {
      await api.purge(table(entry), entry.id, workspace);
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Löschen ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="main-head">
        <h1>Papierkorb</h1>
        <div className="sub">
          Bleibt liegen, bis jemand leert — Erledigtes liegt hier nicht
        </div>
      </div>

      <div className="body">
        <div className="tabrow">
          {(
            [
              ['task', 'Aufgaben'],
              ['project', 'Projekte'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="btn small"
              aria-current={kind === id}
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {notice !== undefined ? <p className="note-error">{notice}</p> : null}

        {entries.map((entry) => (
          <div className="trash-entry" key={entry.id}>
            <div className="head">
              <span className="t">{entry.title}</span>
            </div>
            <div className="m">
              <span>
                weggeworfen {whenLabel(new Date(entry.trashedAt), false, now)}
              </span>
              {entry.kind === 'task' && entry.projectName !== null ? (
                <span className={entry.projectTrashed ? 'warn' : undefined}>
                  {entry.projectTrashed
                    ? `Projekt „${entry.projectName}“ liegt selbst im Papierkorb`
                    : entry.projectName}
                </span>
              ) : null}
              {entry.kind === 'project' && entry.carries !== null && entry.carries > 0 ? (
                <span>
                  nimmt {entry.carries}{' '}
                  {entry.carries === 1 ? 'Aufgabe' : 'Aufgaben'} mit
                </span>
              ) : null}
            </div>

            {entry.peek !== null ? (
              <div className="peek">
                <div className="pl">
                  {entry.kind === 'project' ? 'Darin' : 'Notiz'}
                </div>
                {entry.peek}
              </div>
            ) : null}

            <div className="row-actions">
              {entry.projectTrashed ? (
                <>
                  <select
                    className="target"
                    aria-label={`Wohin „${entry.title}“ zurück soll`}
                    value={targets[entry.id] ?? ''}
                    onChange={(e) =>
                      setTargets((t) => ({ ...t, [entry.id]: e.target.value }))
                    }
                  >
                    <option value="">ohne Projekt</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => void bringBack(entry)}
                  >
                    Wiederherstellen nach…
                  </button>
                </>
              ) : (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => void bringBack(entry)}
                >
                  Wiederherstellen
                </button>
              )}
              <button
                className="btn small quiet"
                disabled={busy}
                onClick={() => void forGood(entry)}
              >
                Endgültig löschen
              </button>
            </div>
          </div>
        ))}

        {loaded && entries.length === 0 ? (
          <div className="empty">
            <strong>
              {kind === 'task'
                ? 'Keine weggeworfenen Aufgaben.'
                : 'Keine weggeworfenen Projekte.'}
            </strong>
            Was du wegwirfst, liegt hier, bis du es zurückholst oder endgültig
            löschst.
          </div>
        ) : null}
      </div>
    </>
  );
}
