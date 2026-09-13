/**
 * SOTE — der Kalender: Monat, Woche, Tag.
 *
 * GEWÜNSCHT: „Eine Kalenderansicht wäre noch praktisch, generell umschaltbar,
 * Monats-, Wochen-, Tagesansicht. Und Tagesansicht und Wochenansicht mit
 * Liste darunter."
 *
 * ## Ein Ort, keine Anzeigeform
 *
 * Der Kalender steht in der Leiste neben Heute, Demnächst, Irgendwann und
 * Posteingang und zeigt den ganzen Arbeitsbereich. Eine dritte Anzeigeform je
 * Projekt wäre auch möglich gewesen; entschieden wurde der Ort, weil ein
 * Kalender die Frage „was liegt in dieser Woche" beantwortet — und die stellt
 * man selten je Projekt.
 *
 * ## Der Zeitpunkt einer Aufgabe ist ihr Plan, sonst ihre Frist
 *
 * Dieselbe Regel wie in Heute und Demnächst und wie in `/api/span`. Eine
 * Aufgabe ohne beides hat keinen Tag und steht hier nicht.
 *
 * ## Woche und Tag: ein Stundenraster, darüber das Ganztägige
 *
 * Wie Apple oder Google: Aufgaben mit Uhrzeit stehen als Block zur Zeit, die
 * Höhe ist die Dauer (ohne Dauer eine halbe Stunde — sichtbar, aber nicht
 * mehr behauptet als bekannt). Ganztägiges steht in einer Zeile oben, damit es
 * das Raster nicht um Mitternacht klemmt. Darunter die Liste des Fensters,
 * nach Tagen — dieselbe `TaskRow` wie überall, mit Detailspalte.
 *
 * ## Was hier NICHT ist
 *
 * Kein Ziehen zum Umplanen, keine Erfassung durch Klick auf eine Stunde. Beides
 * kommt, wenn der Kalender sich als Ort bewährt hat; erst muss er stehen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError, streamUrl, type Project, type Task } from '../api.js';
import {
  clock,
  isoDate,
  parseIsoDate,
  sameDay,
  SHORT_DAYS,
  spanOf,
  startOfDay,
  step,
  titleOf,
  type CalendarSpan,
} from '../calendar.js';
import { longDate } from '../dates.js';
import { CheckSquareIcon } from '../components/icons.js';
import { TaskRow } from '../components/TaskRow.js';
import { DoneHiddenIcon } from '../components/viewIcons.js';
import { useNudge } from '../hooks/useNudge.js';
import { toggleDone } from '../tasks/toggleDone.js';

/** Höhe einer Stunde im Raster, in rem — die Skala des Stylesheets. */
const HOUR_REM = 3;
/** Ein Block ohne Dauer: eine halbe Stunde, damit man ihn anfassen kann. */
const DEFAULT_MINUTES = 30;

/** Wann und ob ganztägig — die eine Lesart für alle drei Ansichten. */
function whenOf(t: Task): { at: Date; allDay: boolean } | null {
  if (t.planned !== null) return { at: new Date(t.planned), allDay: t.plannedAllDay };
  if (t.due !== null) return { at: new Date(t.due), allDay: t.dueAllDay };
  return null;
}

export function Calendar({
  span,
  date,
  workspace,
  projects,
  now,
  openTask,
  onOpenTask,
  onGo,
  onChanged,
}: {
  span: CalendarSpan;
  date: string;
  workspace: string | undefined;
  projects: readonly Project[];
  now: Date;
  openTask: string | null;
  onOpenTask: (id: string | null) => void;
  /** Eine andere Spanne oder ein anderer Tag — der Ort wechselt, also die Adresse. */
  onGo: (span: CalendarSpan, date: Date) => void;
  onChanged: () => void;
}) {
  const anker = useMemo(() => parseIsoDate(date) ?? startOfDay(now), [date, now]);
  const fenster = useMemo(() => spanOf(span, anker), [span, anker]);
  const [tasks, setTasks] = useState<Task[] | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const out = await api.span(fenster.from, fenster.to, workspace, showDone);
      setTasks(out.tasks);
      setNotice(undefined);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  }, [fenster, workspace, showDone]);

  useEffect(() => {
    void load();
  }, [load]);
  useNudge(streamUrl(workspace), 'tasks', () => void load());

  /*
   * Beim Betreten von Woche oder Tag auf den Morgen rollen: ein Raster, das bei
   * 0:00 anfängt, zeigt zuerst sechs leere Stunden. Einmal je Fenster, nicht
   * bei jedem Nachladen — wer nach unten gerollt hat, soll nicht zurückgeholt
   * werden, weil jemand anders eine Aufgabe abgehakt hat.
   */
  useEffect(() => {
    if (span === 'month') return;
    const ziel = document.querySelector<HTMLElement>('.cal-line[data-hour="7"]');
    ziel?.scrollIntoView({ block: 'start' });
  }, [span, date]);

  const nameOf = (id: string | null): string | undefined =>
    id === null ? undefined : projects.find((p) => p.id === id)?.name;

  /** Die Aufgaben je Tag, in der Reihenfolge des Servers (Zeit, Priorität). */
  const jeTag = useMemo(() => {
    const m = new Map<string, { task: Task; at: Date; allDay: boolean }[]>();
    for (const t of tasks ?? []) {
      const w = whenOf(t);
      if (w === null) continue;
      const key = isoDate(w.at);
      const liste = m.get(key) ?? [];
      liste.push({ task: t, ...w });
      m.set(key, liste);
    }
    return m;
  }, [tasks]);

  const heute = startOfDay(now);

  const abhaken = (task: Task) =>
    void toggleDone(task, workspace).then(
      () => {
        void load();
        onChanged();
      },
      () => setNotice(task.completed === null ? 'Abhaken ging nicht.' : 'Wieder öffnen ging nicht.'),
    );

  const zeile = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      now={now}
      projectName={nameOf(t.projectId)}
      open={openTask === t.id}
      onOpen={() => onOpenTask(openTask === t.id ? null : t.id)}
      onComplete={() => abhaken(t)}
    />
  );

  /** Ein Block im Raster oder ein Kärtchen im Monat: klickbar, führt in die Spalte. */
  const karte = (e: { task: Task; at: Date; allDay: boolean }, mitZeit: boolean) => (
    <button
      key={e.task.id}
      type="button"
      className="cal-chip"
      data-done={e.task.completed !== null ? 'yes' : undefined}
      data-on={openTask === e.task.id ? 'yes' : undefined}
      title={e.task.title}
      onClick={() => onOpenTask(openTask === e.task.id ? null : e.task.id)}
    >
      {mitZeit && !e.allDay ? <span className="cal-chip-time">{clock(e.at)}</span> : null}
      <span className="cal-chip-title">{e.task.title}</span>
    </button>
  );

  const monat = () => (
    <div className="cal-month" role="grid" aria-label={titleOf('month', anker)}>
      {SHORT_DAYS.map((d) => (
        <div key={d} className="cal-dow" role="columnheader">
          {d}
        </div>
      ))}
      {fenster.days.map((tag) => {
        const eintraege = jeTag.get(isoDate(tag)) ?? [];
        const fremd = tag.getMonth() !== anker.getMonth();
        const sichtbar = eintraege.slice(0, 3);
        const mehr = eintraege.length - sichtbar.length;
        return (
          <div
            key={isoDate(tag)}
            className="cal-cell"
            role="gridcell"
            data-other={fremd ? 'yes' : undefined}
            data-today={sameDay(tag, heute) ? 'yes' : undefined}
          >
            <button
              type="button"
              className="cal-daynum"
              aria-label={longDate(tag)}
              onClick={() => onGo('day', tag)}
            >
              {tag.getDate()}
            </button>
            {sichtbar.map((e) => karte(e, true))}
            {mehr > 0 ? (
              <button type="button" className="cal-more" onClick={() => onGo('day', tag)}>
                +{mehr} weitere
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const raster = () => {
    const tage = fenster.days;
    return (
      <div className="cal-grid" data-days={tage.length} style={{ ['--cal-days' as string]: tage.length }}>
        {/* Kopf: die Tage */}
        <div className="cal-gutter" aria-hidden="true" />
        {tage.map((tag) => (
          <button
            key={`h-${isoDate(tag)}`}
            type="button"
            className="cal-dayhead"
            data-today={sameDay(tag, heute) ? 'yes' : undefined}
            onClick={() => onGo('day', tag)}
            aria-label={longDate(tag)}
          >
            <span className="cal-dayhead-dow">{SHORT_DAYS[(tag.getDay() + 6) % 7]}</span>
            <span className="cal-dayhead-num">{tag.getDate()}</span>
          </button>
        ))}
        {/* Ganztägiges */}
        <div className="cal-gutter cal-gutter-label" aria-hidden="true">
          ganztägig
        </div>
        {tage.map((tag) => (
          <div key={`a-${isoDate(tag)}`} className="cal-allday">
            {(jeTag.get(isoDate(tag)) ?? []).filter((e) => e.allDay).map((e) => karte(e, false))}
          </div>
        ))}
        {/* Die Stunden */}
        <div className="cal-hours" style={{ height: `${24 * HOUR_REM}rem` }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal-hour" style={{ top: `${h * HOUR_REM}rem` }}>
              {h === 0 ? '' : `${h}:00`}
            </div>
          ))}
        </div>
        {tage.map((tag) => (
          <div
            key={`c-${isoDate(tag)}`}
            className="cal-col"
            data-today={sameDay(tag, heute) ? 'yes' : undefined}
            style={{ height: `${24 * HOUR_REM}rem` }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="cal-line"
                data-hour={h}
                style={{ top: `${h * HOUR_REM}rem` }}
                aria-hidden="true"
              />
            ))}
            {(jeTag.get(isoDate(tag)) ?? [])
              .filter((e) => !e.allDay)
              .map((e) => {
                const minuten = e.at.getHours() * 60 + e.at.getMinutes();
                const dauer = Math.max(e.task.duration ?? DEFAULT_MINUTES, 20);
                return (
                  <div
                    key={e.task.id}
                    className="cal-block"
                    style={{
                      top: `${(minuten / 60) * HOUR_REM}rem`,
                      height: `${(Math.min(dauer, 24 * 60 - minuten) / 60) * HOUR_REM}rem`,
                    }}
                  >
                    {karte(e, true)}
                  </div>
                );
              })}
            {sameDay(tag, heute) ? (
              <div
                className="cal-now"
                aria-hidden="true"
                style={{ top: `${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_REM}rem` }}
              />
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  /** Die Liste des Fensters, nach Tagen — unter Woche und Tag. */
  const liste = () => (
    <div className="cal-list">
      {fenster.days.map((tag) => {
        const eintraege = jeTag.get(isoDate(tag)) ?? [];
        if (eintraege.length === 0 && span === 'week') return null;
        return (
          <section key={`l-${isoDate(tag)}`}>
            {span === 'week' ? <div className="section-label">{longDate(tag)}</div> : null}
            {eintraege.length === 0 ? (
              <div className="empty">
                <strong>Für diesen Tag ist nichts geplant.</strong>
              </div>
            ) : (
              eintraege.map((e) => zeile(e.task))
            )}
          </section>
        );
      })}
      {span === 'week' && (tasks?.length ?? 0) === 0 ? (
        <div className="empty">
          <strong>In dieser Woche ist nichts geplant.</strong>
        </div>
      ) : null}
    </div>
  );

  const anzahl = tasks?.length ?? 0;

  return (
    <>
      <div className="main-head">
        <h1>{titleOf(span, anker)}</h1>
        <div className="sub">
          {tasks === undefined
            ? 'lädt'
            : anzahl === 0
              ? 'nichts geplant'
              : `${anzahl} ${anzahl === 1 ? 'Aufgabe' : 'Aufgaben'}`}
        </div>
        <div className="head-views" role="group" aria-label="Anzeige">
          <button
            type="button"
            className="head-toggle"
            aria-pressed={showDone}
            title={showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
            aria-label={showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? <CheckSquareIcon size={16} /> : <DoneHiddenIcon />}
          </button>
          <button type="button" className="head-toggle" aria-label="Zurück" onClick={() => onGo(span, step(span, anker, -1))}>
            ‹
          </button>
          <button type="button" className="head-toggle wide" onClick={() => onGo(span, heute)}>
            Heute
          </button>
          <button type="button" className="head-toggle" aria-label="Weiter" onClick={() => onGo(span, step(span, anker, 1))}>
            ›
          </button>
          {(
            [
              ['month', 'Monat'],
              ['week', 'Woche'],
              ['day', 'Tag'],
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              className="head-toggle wide"
              aria-pressed={span === s}
              onClick={() => onGo(s, anker)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="body" data-wide="yes">
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}
        {span === 'month' ? monat() : raster()}
        {span === 'month' ? null : liste()}
      </div>
    </>
  );
}
