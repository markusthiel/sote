/**
 * SOTE — die Detailspalte.
 *
 * Die vierte Spalte, ab 1100 px eine Spalte und darunter ein Drawer — wie
 * SONEs rechtes Panel. Kommentare und Teilaufgaben liegen **in** der Aufgabe,
 * damit Diskussion und Material im Zusammenhang bleiben.
 *
 * Titel und Notiz schreiben beim Verlassen des Feldes und nicht bei jedem
 * Tastendruck: ein Feld, das pro Zeichen eine Runde dreht, ist ein Feld, das
 * bei schlechter Verbindung hakt — und die Notiz ist der eine Ort, an dem
 * jemand länger tippt. Wer Enter drückt, will sofort speichern; wer weiterklickt,
 * hat aufgehört.
 *
 * **Nichts hier ist optimistisch.** Der Grund ist derselbe wie beim
 * Anfasser-Menü (Blatt 03): ein Wert, der gesetzt aussieht und nirgends steht,
 * ist schlimmer als einer, der eine halbe Sekunde braucht. Das Häkchen ist die
 * Ausnahme, weil es die häufigste Handlung ist.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError, type Detail as DetailData, type Project, type Task } from '../api.js';
import { toggleDone } from '../tasks/toggleDone.js';
import { FieldRow, FreeDate } from '../components/FieldRow.js';
import { whenOptions } from '../components/HandleMenu.js';
import { whenLabel } from '../dates.js';

const PRIORITY_NAMES = ['', 'Dringend', 'Wichtig', 'Normal', 'Später'] as const;

export function Detail({
  taskId,
  workspace,
  now,
  onClose,
  onChanged,
}: {
  taskId: string;
  workspace: string | undefined;
  now: Date;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DetailData | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [childLine, setChildLine] = useState('');
  const [commentLine, setCommentLine] = useState('');
  /*
   * Die Projekte für die Klappe.
   *
   * Hier geladen und nicht durchgereicht: die Detailspalte öffnet sich einzeln
   * und selten, und ein Aufruf beim Öffnen ist billiger als ein Zustand, den
   * jeder Bildschirm oberhalb mitschleppen muss, nur damit dieser eine
   * Klappzettel eine Liste hat.
   */
  const [projects, setProjects] = useState<Project[]>([]);
  const noteBox = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.detail(taskId, workspace));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  }, [taskId, workspace]);

  useEffect(() => {
    setData(undefined);
    setNotice(undefined);
    void load();
  }, [load]);

  /*
   * Die Projektliste, einmal beim Öffnen.
   *
   * Ein eigener Effekt und nicht Teil von `load()`: die Liste hängt am
   * Arbeitsbereich und nicht an der Aufgabe, also braucht sie kein Nachladen,
   * wenn nur ein Datum gespeichert wurde. Scheitert sie, bleibt sie leer und
   * die Klappe sagt „noch keine Projekte" — kein Grund, die Aufgabe
   * unbedienbar zu machen.
   */
  useEffect(() => {
    let live = true;
    void api
      .projects(workspace)
      .then((r) => {
        if (live) setProjects(r.projects);
      })
      .catch(() => {
        if (live) setProjects([]);
      });
    return () => {
      live = false;
    };
  }, [workspace]);

  async function save<T>(body: () => Promise<T>) {
    setBusy(true);
    setNotice(undefined);
    try {
      await body();
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Speichern ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) {
    return (
      <aside className="detail" aria-busy="true">
        <div className="detail-head">
          <button className="btn quiet small" onClick={onClose} aria-label="Spalte schließen">
            schließen
          </button>
        </div>
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}
      </aside>
    );
  }

  const task = data.task;
  const openChildren = data.children.filter((c) => c.completed === null).length;

  return (
    <aside className="detail" aria-label="Aufgabe im Detail">
      <div className="detail-head">
        <button className="btn quiet small" onClick={onClose} aria-label="Spalte schließen">
          schließen
        </button>
      </div>

      {/* Der Titel ist ein Feld und kein Text mit Stift daneben: wer ihn
          ändern will, klickt hinein. */}
      <input
        className="detail-title"
        defaultValue={task.title}
        aria-label="Titel"
        disabled={busy}
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next !== '' && next !== task.title) {
            void save(() => api.patch(task.id, { title: next }, workspace));
          } else {
            e.target.value = task.title;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = task.title;
            e.currentTarget.blur();
          }
        }}
      />

      {/*
        Fünf Reihen, die etwas ändern.
        Vorher standen hier fünf `<span>`: anlegen ging, ändern nicht. Ein
        Datum konnte man nur beim Tippen mitgeben und danach nie wieder.
      */}
      <FieldRow
        label="projekt"
        value={data.projectName}
        empty="ohne Projekt"
        disabled={busy}
      >
        {(close) => (
          <>
            {/* Herausnehmen zuerst, weil es die eine Zeile ist, die keinen
                Namen hat und sonst unter zwanzig Projekten verschwindet. */}
            <button
              type="button"
              role="menuitem"
              className="fpop-row"
              disabled={task.projectId === null}
              onClick={() => {
                close();
                void save(() => api.patch(task.id, { projectId: null }, workspace));
              }}
            >
              <span className="empty-value">ohne Projekt</span>
            </button>
            {projects.length === 0 ? (
              <p className="fpop-none">Noch keine Projekte.</p>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="fpop-row"
                  aria-current={p.id === task.projectId}
                  onClick={() => {
                    close();
                    void save(() => api.patch(task.id, { projectId: p.id }, workspace));
                  }}
                >
                  <span
                    className="fpop-dot"
                    aria-hidden="true"
                    style={p.color === null ? undefined : { background: p.color }}
                  />
                  {p.name}
                </button>
              ))
            )}
          </>
        )}
      </FieldRow>

      <FieldRow
        label="geplant"
        value={
          task.planned === null
            ? null
            : whenLabel(new Date(task.planned), task.plannedAllDay, now)
        }
        empty="kein Datum"
        disabled={busy}
      >
        {(close) => (
          <>
            {whenOptions(now).map((o) => (
              <button
                key={o.label}
                type="button"
                role="menuitem"
                className="fpop-row"
                onClick={() => {
                  close();
                  void save(() =>
                    api.patch(
                      task.id,
                      { planned: o.at.toISOString(), plannedAllDay: o.allDay },
                      workspace,
                    ),
                  );
                }}
              >
                {o.label}
                {/* Das Datum nur, wenn es etwas hinzufügt: bei „heute" stand
                    „heute heute" — eine Wiederholung, die man erst liest und
                    dann wegdenkt. Im Bild aufgefallen, nicht im Code. */}
                {whenLabel(o.at, o.allDay, now) === o.label ? null : (
                  <span className="fpop-aside">{whenLabel(o.at, o.allDay, now)}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="fpop-row"
              disabled={task.planned === null}
              onClick={() => {
                close();
                void save(() => api.patch(task.id, { planned: null }, workspace));
              }}
            >
              <span className="empty-value">kein Datum</span>
            </button>
            <FreeDate
              label="anderer Tag"
              onPick={(at) => {
                close();
                void save(() =>
                  api.patch(
                    task.id,
                    { planned: at.toISOString(), plannedAllDay: true },
                    workspace,
                  ),
                );
              }}
            />
          </>
        )}
      </FieldRow>

      {/*
        Die Frist war bisher NIRGENDS setzbar — nicht im Anfasser-Menü, nicht
        hier. Ein Feld, das die Oberfläche zeigt und nie füllen kann, ist eine
        Auskunft über etwas, das es für die Person nicht gibt.

        Ganztägig, immer: eine Frist um 14:37 ist eine Verabredung, keine Frist.
      */}
      <FieldRow
        label="frist"
        value={task.due === null ? null : whenLabel(new Date(task.due), true, now)}
        empty="keine"
        disabled={busy}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="fpop-row"
              disabled={task.due === null}
              onClick={() => {
                close();
                void save(() => api.patch(task.id, { due: null }, workspace));
              }}
            >
              <span className="empty-value">keine Frist</span>
            </button>
            <FreeDate
              label="fällig am"
              onPick={(at) => {
                close();
                void save(() =>
                  api.patch(task.id, { due: at.toISOString(), dueAllDay: true }, workspace),
                );
              }}
            />
          </>
        )}
      </FieldRow>

      {task.recurrence !== null ? (
        <div className="frow">
          <span className="fl">wiederholt</span>
          <span className="fv">{task.recurrence.says}</span>
        </div>
      ) : null}

      <FieldRow
        label="priorität"
        value={PRIORITY_NAMES[task.priority] ?? null}
        empty="ohne"
        disabled={busy}
      >
        {(close) =>
          ([1, 2, 3, 4] as const).map((level) => (
            <button
              key={level}
              type="button"
              role="menuitem"
              className="fpop-row"
              aria-current={level === task.priority}
              onClick={() => {
                close();
                void save(() => api.patch(task.id, { priority: level }, workspace));
              }}
            >
              <span className="fpop-dot" data-priority={level} aria-hidden="true" />
              {PRIORITY_NAMES[level]}
            </button>
          ))
        }
      </FieldRow>

      <div className="frow">
        <span className="fl">zuständig</span>
        <span className="fv">
          {data.assignees.length === 0 ? (
            <span className="empty-value">niemand</span>
          ) : (
            data.assignees
              .map((a) => a.name ?? a.guestKey?.replace(/^guest:/, '') ?? '?')
              .join(', ')
          )}
        </span>
      </div>

      {/* Nur wenn es eine Herkunft gibt. Gespeicherte URL und Titel, damit der
          Rückweg auch ohne SONE funktioniert. */}
      {data.origin !== undefined ? (
        <a className="origin" href={data.origin.url}>
          <span className="ol">entstanden in SONE</span>
          <span className="ot">{data.origin.pageTitle}</span>
        </a>
      ) : null}

      <div className="detail-section">
        <div className="group-label">Notiz</div>
        <textarea
          className="note"
          ref={noteBox}
          defaultValue={task.note}
          rows={4}
          aria-label="Notiz"
          disabled={busy}
          placeholder="Was man wissen muss, um das zu tun."
          onBlur={(e) => {
            if (e.target.value !== task.note) {
              void save(() => api.patch(task.id, { note: e.target.value }, workspace));
            }
          }}
        />
      </div>

      <div className="detail-section">
        <div className="group-label">
          Teilaufgaben
          {data.children.length > 0 ? (
            <span className="n">
              {openChildren} von {data.children.length}
            </span>
          ) : null}
        </div>
        {/*
          Erledigtes rutscht nach unten, hier ohne eigene Überschrift.
          In den Listen trägt das Bündel eine — dort stehen zwanzig Zeilen und
          man braucht die Grenze als Marke. Hier sind es drei, und die
          Beschriftung darüber sagt schon „3 von 5": eine zweite Überschrift in
          einer Spalte von 340 Pixeln wäre mehr Aufbau als Inhalt.

          Sortiert beim Zeichnen und nicht in der Antwort: die Reihenfolge der
          Teilaufgaben gehört ihrem Elternteil (sie lässt sich ziehen), und ein
          zweites Sortierkriterium im Server würde die gezogene Ordnung
          überschreiben, sobald jemand abhakt.
        */}
        {[...data.children]
          .sort((a, b) => Number(a.completed !== null) - Number(b.completed !== null))
          .map((child: Task) => (
          <div className="child" key={child.id} data-done={child.completed !== null}>
            <button
              className="task-box"
              data-priority={child.priority}
              data-done={child.completed !== null}
              aria-label={
                child.completed !== null
                  ? `${child.title} wieder öffnen`
                  : `${child.title} abhaken`
              }
              aria-pressed={child.completed !== null}
              disabled={busy}
              /* In beide Richtungen — die Beschriftung darüber nennt schon
                 zwei Zustände, und `toggleDone` kennt beide. */
              onClick={() => void save(() => toggleDone(child, workspace))}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2 6.5 4.7 9 10 3.2"
                  fill="none"
                  stroke={child.completed !== null ? 'var(--accent-on)' : 'var(--text-muted)'}
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            <span className="ct">{child.title}</span>
            {child.planned !== null ? (
              <span className="when">
                {whenLabel(new Date(child.planned), child.plannedAllDay, now)}
              </span>
            ) : null}
          </div>
        ))}
        <div className="child add">
          <span className="plus" aria-hidden="true">
            +
          </span>
          <input
            value={childLine}
            aria-label="Teilaufgabe hinzufügen"
            placeholder="Teilaufgabe hinzufügen"
            disabled={busy}
            onChange={(e) => setChildLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const value = childLine.trim();
              if (value === '') return;
              setChildLine('');
              void save(() => api.addChild(task.id, value, workspace));
            }}
          />
        </div>
      </div>

      <div className="detail-section">
        <div className="group-label">Gespräch</div>
        {data.comments.map((c) => (
          <div className="cmt" key={c.id}>
            <div className="mt">
              {c.authorName ?? `${c.authorGuest?.replace(/^guest:/, '') ?? '?'} (Gast)`} —{' '}
              {whenLabel(new Date(c.createdAt), false, now)}
            </div>
            <div className="bd">{c.body}</div>
          </div>
        ))}
        <textarea
          className="note"
          rows={2}
          value={commentLine}
          aria-label="Kommentar schreiben"
          placeholder="Schreiben — Enter schickt, Umschalt und Enter macht eine Zeile"
          disabled={busy}
          onChange={(e) => setCommentLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            const value = commentLine.trim();
            if (value === '') return;
            setCommentLine('');
            void save(() => api.addComment(task.id, value, workspace));
          }}
        />
      </div>

      {notice !== undefined ? <p className="note-error">{notice}</p> : null}
    </aside>
  );
}
