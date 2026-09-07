/**
 * SOTE — die Suche als Ort.
 *
 * Man kommt nicht hierher, um zu suchen: das Feld über dem Baum ist der
 * Eingang, und Tippen bringt einen hierher, mitsamt dem Getippten. Das Symbol
 * in der Schiene heißt darum nicht „Suche starten", sondern ist der Weg
 * **zurück** zu einer Suche.
 *
 * Die Abfrage steht in der URL. Dieses Feld schreibt sie, das Panel schreibt
 * sie, das Feld über dem Baum schreibt sie — und alle drei lesen sie von dort.
 * Kein Bedienelement setzt `projekt:` selbst zusammen; das tut
 * `buildTaskQuery` in `@sote/core`.
 *
 * Der leere Bildschirm **zeigt das Vokabular**. Eine Suche, die belohnt, wer
 * die Dokumentation gelesen hat, gehört nicht in eine Anwendung, deren übrige
 * Bildschirme das nicht tun.
 */

import { buildTaskQuery, parseTaskQuery, type Facet } from '@sote/core';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Project, type Task } from '../api.js';
import { TaskRow } from '../components/TaskRow.js';

const EXAMPLES: readonly { q: string; says: string }[] = [
  { q: 'kabel', says: 'Titel und Notiz, auch halbe Wörter' },
  { q: '#haus', says: 'in einem Projekt' },
  { q: '@unterwegs', says: 'mit einem Schlagwort' },
  { q: '+anna', says: 'jemandem zugewiesen' },
  { q: '!!', says: 'nach Priorität — !!! ist dringend' },
  { q: 'frist:überfällig', says: 'auch heute oder woche' },
  { q: 'ist:erledigt', says: 'Erledigtes, sonst nur Offenes' },
];

export function Search({
  q,
  workspace,
  projects,
  now,
  onQuery,
  openTask,
  onOpenTask,
}: {
  q: string;
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  onQuery: (q: string) => void;
  openTask: string | null;
  onOpenTask: (id: string | null) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [read, setRead] = useState<{ facet: string; value: string }[]>([]);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const parsed = parseTaskQuery(q);
  const nothingAsked =
    parsed.text === '' &&
    parsed.projects.length === 0 &&
    parsed.labels.length === 0 &&
    parsed.assignees.length === 0 &&
    parsed.priorities.length === 0 &&
    parsed.due === undefined;

  const load = useCallback(async () => {
    if (q.trim() === '') {
      setTasks([]);
      setRead([]);
      setLoaded(true);
      return;
    }
    try {
      const out = await api.search(q, workspace);
      setTasks(out.tasks);
      // Die Chips kommen aus der Antwort des Servers, nicht aus einer zweiten
      // Auswertung hier: derselbe Parser, dasselbe Ergebnis.
      setRead(out.read);
      setMore(out.more);
      setLoaded(true);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Suchen ging nicht.');
      setLoaded(true);
    }
  }, [q, workspace]);

  useEffect(() => {
    setLoaded(false);
    setNotice(undefined);
    void load();
  }, [load]);

  /** Ein Bedienelement liest die Abfrage, ändert eine Sache, schreibt zurück. */
  const toggle = (facet: Facet, value: string | undefined, multiple = false) =>
    onQuery(buildTaskQuery(q, facet, value, { multiple }));

  const nameOf = (id: string | null) =>
    id === null ? undefined : projects.find((p) => p.id === id)?.name;

  return (
    <>
      <div className="main-head">
        <h1>Suchen</h1>
        <div className="sub">
          {q.trim() === ''
            ? 'Tippe im Feld links oder hier'
            : loaded
              ? `${tasks.length}${more ? '+' : ''} ${tasks.length === 1 ? 'Treffer' : 'Treffer'}`
              : 'sucht…'}
        </div>
      </div>

      <div className="body">
        <div className="quick">
          <div className="quick-field">
            <svg
              width="15"
              height="15"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              style={{ color: 'var(--text-faint)' }}
            >
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="M12.8 12.8 17 17" />
            </svg>
            <input
              value={q}
              autoFocus
              aria-label="Suchen"
              placeholder="Wonach suchst du?"
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onQuery('');
              }}
            />
            {q !== '' ? (
              <button className="btn quiet small" onClick={() => onQuery('')}>
                leeren
              </button>
            ) : null}
          </div>

          {/* Was gelesen wurde. Ein Klick nimmt es wieder heraus — dieselbe
              Funktion, die es hineingeschrieben hat. */}
          {read.length > 0 ? (
            <div className="chips">
              {read.map((chip) => (
                <button
                  key={`${chip.facet}:${chip.value}`}
                  className="chip removable"
                  aria-label={`${chip.facet} ${chip.value} entfernen`}
                  onClick={() =>
                    toggle(
                      chip.facet as Facet,
                      chip.value,
                      chip.facet === 'schlagwort' ||
                        chip.facet === 'projekt' ||
                        chip.facet === 'zugewiesen' ||
                        chip.facet === 'priorität',
                    )
                  }
                >
                  <span className="lbl">{chip.facet}</span>
                  {chip.value}
                  <span aria-hidden="true" className="x">
                    ×
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {notice !== undefined ? <p className="note-error">{notice}</p> : null}

        {/* Der Status ist eine Leiter mit drei Sprossen und kein Filter unter
            vielen: eine Aufgabe ist offen oder erledigt. */}
        {!nothingAsked ? (
          <div className="tabrow">
            {(
              [
                ['offen', undefined],
                ['erledigt', 'erledigt'],
                ['alles', 'alles'],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                className="btn small"
                aria-current={
                  value === undefined
                    ? parsed.status === 'open'
                    : value === 'erledigt'
                      ? parsed.status === 'done'
                      : parsed.status === 'all'
                }
                onClick={() => toggle('status', value)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            projectName={nameOf(task.projectId)}
            open={openTask === task.id}
            onOpen={() => onOpenTask(openTask === task.id ? null : task.id)}
            onComplete={() => {
              void api.complete(task.id, workspace).then(load, () =>
                setNotice('Abhaken ging nicht.'),
              );
            }}
          />
        ))}

        {more ? (
          <p className="more-hint">
            Es gibt mehr als diese. Engere Abfrage, dann sind es alle.
          </p>
        ) : null}

        {loaded && nothingAsked ? (
          <div className="vocab">
            <div className="group-label">Was hier geht</div>
            {EXAMPLES.map((example) => (
              <button
                key={example.q}
                className="vocab-row"
                onClick={() => onQuery(q === '' ? example.q : `${q} ${example.q}`)}
              >
                <code>{example.q}</code>
                <span>{example.says}</span>
              </button>
            ))}
            <p className="vocab-note">
              Mehreres nebeneinander verengt. Werte mit Leerzeichen in
              Anführungszeichen: <code>projekt:&quot;Umzug Büro&quot;</code>
            </p>
          </div>
        ) : null}

        {loaded && !nothingAsked && tasks.length === 0 ? (
          <div className="empty">
            <strong>Nichts gefunden.</strong>
            Nimm einen Chip heraus, oder such in Erledigtem.
          </div>
        ) : null}
      </div>
    </>
  );
}
