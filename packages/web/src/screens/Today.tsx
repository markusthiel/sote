/**
 * SOTE — Heute.
 *
 * Der Prüfstein für Eigenständigkeit: dieser Bildschirm muss vollständig
 * funktionieren und schön sein, ohne dass ein SONE-Bezug darin vorkommt. Es
 * kommt keiner vor.
 *
 * Zwei Abschnitte, weil „heute zu tun" und „liegengeblieben" zwei Nachrichten
 * sind. Abgehakt verschwindet die Zeile, aber nicht aus der Datenbank — und
 * kehrt eine wiederkehrende Aufgabe zurück, sagt es die Zeile darunter.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Project, type Task } from '../api.js';
import { QuickAdd } from '../components/QuickAdd.js';
import { TaskRow } from '../components/TaskRow.js';
import { longDate } from '../dates.js';

interface Pending {
  readonly id: string;
  readonly error?: string;
}

export function Today({
  workspace,
  projects,
  now,
  onProjectsChanged,
}: {
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onProjectsChanged: () => void;
}) {
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [today, setToday] = useState<Task[]>([]);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [unknownProject, setUnknownProject] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const data = await api.today(workspace);
    setOverdue(data.overdue);
    setToday(data.today);
    setLoaded(true);
  }, [workspace]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const projectName = (id: string | null) =>
    id === null ? undefined : projects.find((p) => p.id === id)?.name;

  async function add(line: string) {
    setBusy(true);
    setNotice(undefined);
    setUnknownProject(null);
    try {
      const out = await api.createTask(line, workspace);
      if (out.unknownProject !== null) {
        setUnknownProject(out.unknownProject);
        setNotice(
          `Das Projekt „${out.unknownProject}“ gibt es hier nicht — die Aufgabe liegt ohne Projekt.`,
        );
      }
      if (out.unknownAssignees.length > 0) {
        setNotice(
          `Unbekannt hier: ${out.unknownAssignees.join(', ')}. Die Aufgabe ist niemandem zugewiesen.`,
        );
      }
      await load();
      onProjectsChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Anlegen ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Abhaken, optimistisch.
   *
   * Die Zeile geht sofort, und bei Fehlschlag kommt sie zurück und sagt warum.
   * Ein Häkchen, das eine halbe Sekunde wartet, macht aus der häufigsten
   * Handlung der Anwendung eine Wartezeit.
   */
  async function toggle(task: Task) {
    setPending((p) => [...p, { id: task.id }]);
    setOverdue((rows) => rows.filter((r) => r.id !== task.id));
    setToday((rows) => rows.filter((r) => r.id !== task.id));
    try {
      const out = await api.complete(task.id, workspace);
      if (out.next !== null) {
        setNotice(`„${out.next.title}“ kommt wieder — nächste Runde steht.`);
      }
      await load();
    } catch (e) {
      const why = e instanceof ApiError ? e.message : 'Abhaken ging nicht.';
      setPending((p) => p.map((x) => (x.id === task.id ? { id: x.id, error: why } : x)));
      // Zurück in die Liste, mit dem Grund an der Zeile.
      setToday((rows) => [task, ...rows]);
      return;
    } finally {
      setPending((p) => p.filter((x) => x.id !== task.id || x.error !== undefined));
    }
  }

  const count = overdue.length + today.length;
  const errorOf = (id: string) => pending.find((p) => p.id === id)?.error;
  const isPending = (id: string) => pending.some((p) => p.id === id);

  return (
    <>
      <div className="main-head">
        <h1>Heute</h1>
        <div className="sub">
          {longDate(now)}
          {loaded
            ? ` — ${count === 0 ? 'nichts offen' : `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`}${
                overdue.length > 0 ? `, ${overdue.length} überfällig` : ''
              }`
            : ''}
        </div>
      </div>

      <div className="body">
        <QuickAdd
          now={now}
          onSubmit={(line) => void add(line)}
          busy={busy}
          unknownProject={unknownProject}
        />
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}

        {overdue.length > 0 ? (
          <>
            <div className="section-label late">
              Überfällig
              <span className="rule" />
            </div>
            {overdue.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                pending={isPending(task.id)}
                error={errorOf(task.id)}
                projectName={projectName(task.projectId)}
                onComplete={(t) => void toggle(t)}
              />
            ))}
          </>
        ) : null}

        {today.length > 0 ? (
          <>
            {overdue.length > 0 ? (
              <div className="section-label">
                Heute
                <span className="rule" />
              </div>
            ) : null}
            {today.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                pending={isPending(task.id)}
                error={errorOf(task.id)}
                projectName={projectName(task.projectId)}
                onComplete={(t) => void toggle(t)}
              />
            ))}
          </>
        ) : null}

        {loaded && count === 0 ? (
          <div className="empty">
            <strong>Für heute ist nichts geplant.</strong>
            Tippe oben eine Zeile — Datum, Projekt und Priorität liest sie mit.
          </div>
        ) : null}
      </div>
    </>
  );
}
