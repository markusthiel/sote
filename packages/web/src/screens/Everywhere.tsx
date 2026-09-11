/**
 * SOTE — Heute und Demnächst über alle Arbeitsbereiche.
 *
 * GEFRAGT: „Macht es Sinn, noch eine übergeordnete Home-Seite zu bauen oder ein
 * Dashboard, das die Übersichten aus allen Workspaces zusammenführt? Von der
 * aus man sozusagen in allen Workspaces arbeiten kann?" — bei mindestens drei
 * Bereichen ja.
 *
 * ## Eine Liste und keine Kacheln
 *
 * Ein Dashboard mit Zahlen sagt, WO etwas liegt. Das weiss man danach immer
 * noch nicht, was zu tun ist — und wäre damit eine schlechtere Ausgabe des
 * Bereichswählers, den es schon gibt. Zahlen auf einer Übersichtsseite werden
 * ausserdem zu Anzeigen, die man wegzusehen lernt.
 *
 * Also dieselbe Liste wie in einem Bereich, nur mit der MARKE des Bereichs an
 * jeder Zeile. Abhaken geht hier, öffnen auch.
 *
 * ## Was hier NICHT geht, und warum
 *
 * **Erfassen.** „morgen 9 Uhr #haus" — in welchem Bereich? `#haus` kann es
 * zweimal geben. Ein Bereichswähler neben dem Feld wäre die Antwort, und damit
 * wäre der Vorteil dieser Seite wieder weg: sie soll die Frage „wo?"
 * abnehmen, nicht stellen.
 *
 * **Ziehen.** Die Hand-Reihenfolge gilt je Bereich; zwei Schlüssel aus
 * verschiedenen Bereichen nebeneinander ergäben eine Ordnung, die niemand
 * gezogen hat. Dafür stehen die Termine hier wieder in Uhrzeit-Reihenfolge —
 * was in der einzelnen Liste aufgegeben werden musste, DAMIT man dort ziehen
 * kann.
 *
 * Beides ist eine Einschränkung mit Grund, und beide stehen als Satz auf der
 * Seite: eine Fähigkeit, die fehlt, ohne dass jemand es sagt, liest sich als
 * Fehler.
 */

import { formatDuration } from '@sote/core';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Task } from '../api.js';
import { ProjectMark } from '../components/ProjectMark.js';
import { whenLabel } from '../dates.js';

type Ort = 'today' | 'upcoming';

const ORTE: { id: Ort; says: string }[] = [
  { id: 'today', says: 'Heute' },
  { id: 'upcoming', says: 'Demnächst' },
];

export function Everywhere({
  onOpen,
  onChanged,
}: {
  /** Eine Aufgabe öffnen — mitsamt ihrem Bereich, denn der wechselt dabei. */
  onOpen: (workspace: string, taskId: string) => void;
  onChanged: () => void;
}) {
  const [ort, setOrt] = useState<Ort>('today');
  const [tasks, setTasks] = useState<(Task & { workspaceId: string })[]>([]);
  const [spaces, setSpaces] = useState<{ id: string; name: string; icon?: unknown }[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const now = new Date();

  const load = useCallback(async () => {
    try {
      const out = await api.across(ort);
      setTasks(out.tasks);
      setSpaces(out.workspaces);
      setNotice(undefined);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  }, [ort]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Abhaken MIT dem Bereich der Aufgabe.
   *
   * Jede Zeile trägt ihren eigenen, und die Route verlangt ihn — das ist keine
   * Umständlichkeit, sondern die Rechteprüfung: der Server soll nicht aus der
   * Aufgabe schliessen, wo sie liegt, sondern prüfen, ob man dort sein darf.
   */
  const haken = async (t: Task & { workspaceId: string }) => {
    setBusy(true);
    try {
      if (t.completed === null) await api.complete(t.id, t.workspaceId);
      else await api.reopen(t.id, t.workspaceId);
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Abhaken ging nicht.');
    } finally {
      setBusy(false);
    }
  };

  const nameVon = (id: string) => spaces.find((w) => w.id === id)?.name ?? '';

  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Überall</h1>
        <p className="muted small">
          {ORTE.find((o) => o.id === ort)?.says} aus allen Arbeitsbereichen. Hier
          wird abgehakt und geöffnet; angelegt und sortiert wird im Bereich —
          eine Zeile ohne Bereich wüsste nicht, wohin sie gehört.
        </p>
      </div>

      <div className="settings-row">
        <span className="settings-row-label"><b>Ort</b></span>
        <div className="set-choice" role="radiogroup" aria-label="Ort">
          {ORTE.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={ort === o.id}
              disabled={busy}
              onClick={() => setOrt(o.id)}
            >
              {o.says}
            </button>
          ))}
        </div>
      </div>

      {notice !== undefined ? <p className="note-error">{notice}</p> : null}

      {tasks.length === 0 ? (
        <p className="muted small">
          {ort === 'today'
            ? 'Heute ist nirgends etwas offen.'
            : 'Demnächst steht nirgends etwas an.'}
        </p>
      ) : (
        <div className="across">
          {tasks.map((t) => (
            <div className="across-row" key={t.id}>
              <button
                type="button"
                className="task-box"
                data-priority={t.priority}
                aria-label={`„${t.title}“ abhaken`}
                disabled={busy}
                onClick={() => void haken(t)}
              />
              <button
                type="button"
                className="across-title as-link"
                onClick={() => onOpen(t.workspaceId, t.id)}
              >
                {t.title}
              </button>
              <span className="across-meta">
                {t.planned !== null
                  ? whenLabel(new Date(t.planned), t.plannedAllDay, now)
                  : t.due !== null
                    ? whenLabel(new Date(t.due), true, now)
                    : ''}
                {t.duration !== null ? ` · ${formatDuration(t.duration)}` : ''}
              </span>
              {/* Die Marke des Bereichs — das eine, was diese Zeile von einer
                  gewöhnlichen unterscheidet, und der Grund, aus dem es die
                  Seite gibt. */}
              <span className="across-space">
                <ProjectMark
                  icon={undefined}
                  kind="list"
                  name={nameVon(t.workspaceId)}
                  color={undefined}
                />
                {nameVon(t.workspaceId)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
