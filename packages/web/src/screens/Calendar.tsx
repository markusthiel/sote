/**
 * SOTE — der Kalender: Monat, Woche, Tag.
 *
 * GEWÜNSCHT: „Eine Kalenderansicht wäre noch praktisch, generell umschaltbar,
 * Monats-, Wochen-, Tagesansicht. Und Tagesansicht und Wochenansicht mit
 * Liste darunter."
 *
 * ## Ein Hauptpunkt in der Schiene, über alle Arbeitsbereiche
 *
 * Erst stand er in der Leiste eines Arbeitsbereichs. Dann: „Ich dachte, die
 * Kalenderansicht ist jetzt in der schmalen Leiste als neuer Hauptpunkt,
 * übergreifend für alle Workspaces mit Filter … als schneller Einstieg." Ja —
 * „was liegt in meiner Woche" hat keine Bereichsgrenze, wie die Glocke. Der
 * Bereich ist ein Filter in der linken Spalte (`scope`, `null` = alle); bei
 * „Alle" trägt jedes Kärtchen die Marke seines Bereichs, und Öffnen wechselt
 * die Hülle dorthin, während der Kalender bleibt.
 *
 * „Überall" (Heute und Demnächst aus allen Bereichen) ist darin aufgegangen.
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
 * ## Ziehen heisst umplanen
 *
 * Ein Block im Raster lässt sich auf eine andere Stunde und einen anderen Tag
 * ziehen (in Viertelstunden), ein Ganztägiges auf einen anderen Tag, ein
 * Kärtchen im Monat auf einen anderen Tag — die Uhrzeit bleibt. Umgeplant wird
 * der Plan, und wenn es keinen gibt, die Frist: das ist der Zeitpunkt, an dem
 * die Aufgabe im Kalender steht, also der, den man gerade angefasst hat.
 *
 * Mit Zeiger-Ereignissen und nicht mit HTML5-Ziehen, wie die Liste (siehe
 * `useRowDrag`): der Zielort wird aus der Position gerechnet, nicht aus
 * Ablegezonen — eine Stunde ist keine Zone, sondern eine Höhe.
 *
 * ## Klick auf eine leere Stelle heisst erfassen
 *
 * Auf eine Stunde: ein Feld genau dort, die Zeit steht schon. Auf einen Tag im
 * Monat oder in der Ganztags-Zeile: ein Feld für etwas Ganztägiges an dem Tag.
 * Enter legt an, Esc verwirft. Die Zeile geht durch dieselbe Erfassung wie im
 * Schnellerfasser (`+projekt`, `#wort`, `@wer`); den Zeitpunkt setzt der Klick
 * danach ausdrücklich, damit „Zahnarzt 9 Uhr" nicht zwei Zeiten hat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { colorValue } from '@sote/core';

import { api, ApiError, streamUrl, type CalendarSource, type SpanEvent, type Project, type Task } from '../api.js';
import { eventKey, eventOnDay, timedEventsOnDay } from '../calendarEvents.js';
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
import { ArrowUturnIcon, CalendarIcon, CheckSquareIcon, ChevronRightIcon, ColumnsIcon, PageIcon, TableIcon } from '../components/icons.js';
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

type Eintrag = { task: Task & { workspaceId: string }; at: Date; allDay: boolean };

export function Calendar({
  span,
  date,
  scope,
  sources,
  hiddenSources,
  createIn,
  createInName,
  projects,
  now,
  openTask,
  onOpenTask,
  onGo,
  onChanged,
}: {
  span: CalendarSpan;
  date: string;
  /** Ein Arbeitsbereich — oder `null` für alle. */
  scope: string | null;
  sources: readonly CalendarSource[];
  hiddenSources: ReadonlySet<string>;
  /** Wohin eine per Klick erfasste Aufgabe geht. */
  createIn: string | undefined;
  createInName: string;
  projects: readonly Project[];
  now: Date;
  openTask: string | null;
  /** Mit dem Bereich der Aufgabe: über Bereiche hinweg muss die Hülle wissen, wohin. */
  onOpenTask: (id: string | null, workspaceId?: string) => void;
  /** Eine andere Spanne oder ein anderer Tag — der Ort wechselt, also die Adresse. */
  onGo: (span: CalendarSpan, date: Date) => void;
  onChanged: () => void;
}) {
  const anker = useMemo(() => parseIsoDate(date) ?? startOfDay(now), [date, now]);
  const fenster = useMemo(() => spanOf(span, anker), [span, anker]);
  const [tasks, setTasks] = useState<(Task & { workspaceId: string })[] | undefined>(undefined);
  const [events, setEvents] = useState<SpanEvent[]>([]);
  const loadVersion = useRef(0);
  const [bereiche, setBereiche] = useState<
    { id: string; name: string; icon: { icon?: string; iconColor?: string } | null }[]
  >([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [showDone, setShowDone] = useState(false);
  const hoursScroll = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const out = await api.span(fenster.from, fenster.to, scope, showDone);
      if (version !== loadVersion.current) return;
      setTasks(out.tasks);
      setEvents(out.events);
      setBereiche(out.workspaces);
      setNotice(undefined);
    } catch (e) {
      if (version !== loadVersion.current) return;
      setNotice(e instanceof ApiError ? e.message : 'Laden ging nicht.');
    }
  }, [fenster, scope, showDone]);

  useEffect(() => {
    void load();
    return () => { loadVersion.current++; };
  }, [load]);
  /*
   * Die Klingel des Bereichs, in dem man steht — bei „Alle" hört der Kalender
   * damit auf einen von mehreren. Die anderen kommen beim Fokus und beim
   * Blättern nach; ein Strom je Bereich wäre eine Verbindung je Bereich.
   */
  useNudge(streamUrl(createIn), 'tasks', () => void load());

  const bereich = (id: string) => bereiche.find((b) => b.id === id);
  /** Die Marke des Bereichs vor einem Kärtchen — nur bei „Alle" und nur ab zwei. */
  const marke = (id: string) => {
    if (scope !== null || bereiche.length < 2) return null;
    const b = bereich(id);
    if (b === undefined) return null;
    return (
      <span
        className="cal-chip-ws"
        title={b.name}
        aria-label={b.name}
        style={{ background: colorValue(b.icon?.iconColor) ?? 'var(--text-faint)' }}
      >
        {(b.name.trim()[0] ?? '?').toUpperCase()}
      </span>
    );
  };

  /*
   * Beim Betreten von Woche oder Tag auf den Morgen rollen: ein Raster, das bei
   * 0:00 anfängt, zeigt zuerst sechs leere Stunden. Einmal je Fenster, nicht
   * bei jedem Nachladen — wer nach unten gerollt hat, soll nicht zurückgeholt
   * werden, weil jemand anders eine Aufgabe abgehakt hat.
   */
  useEffect(() => {
    if (span === 'month') return;
    const scroll = hoursScroll.current;
    if (scroll) {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      scroll.scrollTop = 7 * HOUR_REM * rem;
    }
  }, [span, date]);

  const nameOf = (id: string | null): string | undefined =>
    id === null ? undefined : projects.find((p) => p.id === id)?.name;

  /** Die Aufgaben je Tag, in der Reihenfolge des Servers (Zeit, Priorität). */
  const jeTag = useMemo(() => {
    const m = new Map<string, Eintrag[]>();
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

  /* ── Ziehen ─────────────────────────────────────────────────────────── */

  /**
   * Was gerade reist: die Aufgabe, ihre Art (Block, Ganztägiges, Kärtchen)
   * und wohin sie gerade zeigt. `ziel` ist `null`, solange der Zeiger nichts
   * Brauchbares unter sich hat.
   */
  const [drag, setDrag] = useState<{
    id: string;
    art: 'timed' | 'allday' | 'month';
    ziel: { day: Date; minutes: number | null } | null;
    /** Ab hier zählt es als Ziehen — vorher ist es ein Klick. */
    bewegt: boolean;
  } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** Ein Klick direkt nach einem Ziehen ist keiner. */
  const gezogen = useRef(false);

  /** Wohin der Zeiger zeigt: der Tag darunter, und im Raster die Viertelstunde. */
  const zielUnter = (x: number, y: number): { day: Date; minutes: number | null } | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const tag = (el as HTMLElement).dataset?.['day'];
      if (tag === undefined) continue;
      const day = parseIsoDate(tag);
      if (day === undefined) return null;
      if ((el as HTMLElement).classList.contains('cal-col')) {
        const rect = el.getBoundingClientRect();
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const stunden = (y - rect.top) / (HOUR_REM * rem);
        const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round((stunden * 60) / 15) * 15));
        return { day, minutes };
      }
      return { day, minutes: null };
    }
    return null;
  };

  const beginne = (e: React.PointerEvent, id: string, art: 'timed' | 'allday' | 'month') => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ id, art, ziel: null, bewegt: false });
  };

  useEffect(() => {
    if (drag === null) return;
    const move = (e: PointerEvent) => {
      const s = start.current;
      if (s === null) return;
      if (!drag.bewegt && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
      setDrag((d) => (d === null ? null : { ...d, bewegt: true, ziel: zielUnter(e.clientX, e.clientY) }));
    };
    const up = () => {
      const d = drag;
      setDrag(null);
      start.current = null;
      if (d === null || !d.bewegt) return;
      gezogen.current = true;
      // Der Klick, der auf das Loslassen folgt, soll nichts öffnen.
      setTimeout(() => (gezogen.current = false), 0);
      if (d.ziel === null) return;
      const eintrag = (tasks ?? []).find((t) => t.id === d.id);
      const w = eintrag === undefined ? null : whenOf(eintrag);
      if (eintrag === undefined || w === null) return;
      // Neuer Zeitpunkt: der Zieltag, und im Raster die Zielzeit — sonst die alte Uhrzeit.
      const neu = new Date(d.ziel.day);
      if (d.art === 'timed' && d.ziel.minutes !== null) {
        neu.setHours(Math.floor(d.ziel.minutes / 60), d.ziel.minutes % 60, 0, 0);
      } else {
        neu.setHours(w.at.getHours(), w.at.getMinutes(), 0, 0);
      }
      if (neu.getTime() === w.at.getTime()) return;
      const felder =
        eintrag.planned !== null
          ? { planned: neu.toISOString(), plannedAllDay: w.allDay }
          : { due: neu.toISOString(), dueAllDay: w.allDay };
      void api.patch(eintrag.id, felder, eintrag.workspaceId).then(
        () => {
          void load();
          onChanged();
        },
        (err: unknown) => setNotice(err instanceof ApiError ? err.message : 'Umplanen ging nicht.'),
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // `zielUnter` und `load` sind stabil genug; `drag` und `tasks` sind die Eingaben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, tasks]);

  /* ── Erfassen ───────────────────────────────────────────────────────── */

  /** Wo gerade getippt wird: Tag und Viertelstunde (oder ganztägig). */
  const [entwurf, setEntwurf] = useState<{ day: Date; minutes: number | null } | null>(null);
  const [entwurfBusy, setEntwurfBusy] = useState(false);

  const anlegen = async (line: string) => {
    if (entwurf === null || line.trim() === '') return;
    setEntwurfBusy(true);
    try {
      const out = await api.createTask(line, createIn, undefined, []);
      const at = new Date(entwurf.day);
      const allDay = entwurf.minutes === null;
      if (!allDay) at.setHours(Math.floor(entwurf.minutes! / 60), entwurf.minutes! % 60, 0, 0);
      // Der Klick sagt, wann — ausdrücklich, nach dem Anlegen. Sonst hätte
      // „Zahnarzt 9 Uhr" zwei Zeiten, und die aus der Zeile gewänne.
      await api.patch(out.task.id, { planned: at.toISOString(), plannedAllDay: allDay }, createIn);
      setEntwurf(null);
      void load();
      onChanged();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Anlegen ging nicht.');
    } finally {
      setEntwurfBusy(false);
    }
  };

  /** Klick auf eine leere Stelle einer Spalte: die Viertelstunde darunter. */
  const klickInSpalte = (e: React.MouseEvent<HTMLDivElement>, tag: Date) => {
    if (gezogen.current || drag !== null) return;
    if ((e.target as HTMLElement).closest('.cal-chip, .cal-draft, .cal-event') !== null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((e.clientY - rect.top) / (HOUR_REM * rem)) * 4) * 15));
    setEntwurf({ day: tag, minutes });
  };

  const entwurfFeld = (allDay: boolean) => (
    <input
      className="cal-draft"
      autoFocus
      disabled={entwurfBusy}
      placeholder={
        (allDay ? 'Neue Aufgabe an diesem Tag' : `Neue Aufgabe um ${clock(entwurfZeit())}`) +
        // Bei „Alle" sagt das Feld, wohin: in den Bereich, in dem man steht.
        (scope === null && bereiche.length > 1 && createInName !== '' ? ` in ${createInName}` : '')
      }
      aria-label="Neue Aufgabe"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void anlegen(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          setEntwurf(null);
        }
      }}
      onBlur={(e) => {
        // Leer verlassen heisst verwerfen; mit Text bleibt es stehen, bis Enter
        // oder Esc entscheidet — ein Klick daneben soll nichts wegwerfen.
        if (e.currentTarget.value.trim() === '') setEntwurf(null);
      }}
    />
  );
  const entwurfZeit = (): Date => {
    const d = new Date(entwurf?.day ?? heute);
    if (entwurf?.minutes != null) d.setHours(Math.floor(entwurf.minutes / 60), entwurf.minutes % 60, 0, 0);
    return d;
  };

  const abhaken = (task: Task & { workspaceId: string }) =>
    void toggleDone(task, task.workspaceId).then(
      () => {
        void load();
        onChanged();
      },
      () => setNotice(task.completed === null ? 'Abhaken ging nicht.' : 'Wieder öffnen ging nicht.'),
    );

  const zeile = (t: Task & { workspaceId: string }) => (
    <TaskRow
      key={t.id}
      task={t}
      now={now}
      // Der Projektname gilt nur im eigenen Bereich; fremde Aufgaben nennen
      // stattdessen ihren Bereich — das ist, was sie unterscheidet.
      projectName={t.workspaceId === createIn ? nameOf(t.projectId) : bereich(t.workspaceId)?.name}
      open={openTask === t.id}
      onOpen={() => onOpenTask(openTask === t.id ? null : t.id, t.workspaceId)}
      onComplete={() => abhaken(t)}
    />
  );

  /** Ein Block im Raster oder ein Kärtchen im Monat: klickbar, führt in die Spalte; ziehbar. */
  const karte = (e: Eintrag, mitZeit: boolean, art: 'timed' | 'allday' | 'month') => (
    <button
      key={e.task.id}
      type="button"
      className="cal-chip"
      data-done={e.task.completed !== null ? 'yes' : undefined}
      data-on={openTask === e.task.id ? 'yes' : undefined}
      data-dragging={drag?.id === e.task.id && drag.bewegt ? 'yes' : undefined}
      title={e.task.title}
      onPointerDown={(ev) => beginne(ev, e.task.id, art)}
      onClick={() => {
        if (gezogen.current) return;
        onOpenTask(openTask === e.task.id ? null : e.task.id, e.task.workspaceId);
      }}
    >
      {marke(e.task.workspaceId)}
      {mitZeit && !e.allDay ? <span className="cal-chip-time">{clock(e.at)}</span> : null}
      <span className="cal-chip-title">{e.task.title}</span>
    </button>
  );

  const visibleEvents = events.filter((e) => !hiddenSources.has(e.feedId));
  const eventsOn = (day: Date) => visibleEvents.filter((e) => eventOnDay(e, day) !== null);
  const eventCard = (e: SpanEvent, day: Date, layout?: { lane: number; lanes: number }) => {
    const source = sources.find((s) => s.id === e.feedId);
    const segment = eventOnDay(e, day)!;
    const time = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const label = e.allDay ? 'ganztägig' : `${time(segment.from)}–${time(segment.to)}`;
    return <div key={eventKey(e)} className={layout ? 'cal-event cal-event-timed' : 'cal-event'}
      title={`${source?.name ?? 'Fremder Kalender'} · ${e.title} · ${label}${e.location ? ` · ${e.location}` : ''}`}
      style={{ ['--eigen' as string]: colorValue(source?.color) ?? 'var(--text-muted)',
        ...(layout ? {
          top: `${segment.from / 60 * HOUR_REM}rem`,
          height: `${Math.min(1440 - segment.from, Math.max(segment.to - segment.from, 15)) / 60 * HOUR_REM}rem`,
          insetInlineStart: `calc(${layout.lane / layout.lanes * 100}% + var(--sone-space-1))`,
          width: `calc(${100 / layout.lanes}% - var(--sone-space-2))`,
        } : {}) }}>
      {!e.allDay ? <span className="cal-chip-time">{label}</span> : null}
      <span className="cal-chip-title">{e.title}</span>
    </div>;
  };

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
        const termine = eventsOn(tag);
        const sichtbareTermine = termine.slice(0, Math.max(0, 3 - sichtbar.length));
        const mehr = eintraege.length - sichtbar.length + termine.length - sichtbareTermine.length;
        return (
          <div
            key={isoDate(tag)}
            className="cal-cell"
            role="gridcell"
            data-day={isoDate(tag)}
            data-other={fremd ? 'yes' : undefined}
            data-today={sameDay(tag, heute) ? 'yes' : undefined}
            data-target={drag?.bewegt && drag.ziel !== null && sameDay(drag.ziel.day, tag) ? 'yes' : undefined}
            onClick={(ev) => {
              if (gezogen.current || drag !== null) return;
              if ((ev.target as HTMLElement).closest('button, .cal-draft, .cal-event') !== null) return;
              setEntwurf({ day: tag, minutes: null });
            }}
          >
            <button
              type="button"
              className="cal-daynum"
              aria-label={longDate(tag)}
              onClick={() => onGo('day', tag)}
            >
              {tag.getDate()}
            </button>
            {sichtbar.map((e) => karte(e, true, 'month'))}
            {sichtbareTermine.map((e) => eventCard(e, tag))}
            {entwurf !== null && entwurf.minutes === null && sameDay(entwurf.day, tag) && span === 'month'
              ? entwurfFeld(true)
              : null}
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
      <div className="cal-schedule" style={{ ['--cal-days' as string]: tage.length }}>
        <div className="cal-grid cal-fixed-head">
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
        </div>
        <div className="cal-grid cal-fixed-allday" role="region" aria-label="Ganztägige Termine" tabIndex={0}>
        {/* Ganztägiges */}
        <div className="cal-gutter cal-gutter-label" aria-hidden="true">
          ganztägig
        </div>
        {tage.map((tag) => (
          <div
            key={`a-${isoDate(tag)}`}
            className="cal-allday"
            data-day={isoDate(tag)}
            data-target={
              drag?.bewegt && drag.art !== 'timed' && drag.ziel !== null && sameDay(drag.ziel.day, tag)
                ? 'yes'
                : undefined
            }
            onClick={(ev) => {
              if (gezogen.current || drag !== null) return;
              if ((ev.target as HTMLElement).closest('button, .cal-draft, .cal-event') !== null) return;
              setEntwurf({ day: tag, minutes: null });
            }}
          >
            {(jeTag.get(isoDate(tag)) ?? []).filter((e) => e.allDay).map((e) => karte(e, false, 'allday'))}
            {eventsOn(tag).filter((e) => e.allDay).map((e) => eventCard(e, tag))}
            {entwurf !== null && entwurf.minutes === null && sameDay(entwurf.day, tag) ? entwurfFeld(true) : null}
          </div>
        ))}
        </div>
        <div ref={hoursScroll} className="cal-grid cal-time-scroll" role="region" aria-label="Stundenkalender" tabIndex={0}>
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
            data-day={isoDate(tag)}
            data-today={sameDay(tag, heute) ? 'yes' : undefined}
            style={{ height: `${24 * HOUR_REM}rem` }}
            onClick={(ev) => klickInSpalte(ev, tag)}
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
            {timedEventsOnDay(visibleEvents, tag).map((entry) => eventCard(entry.event, tag, entry))}
            {(jeTag.get(isoDate(tag)) ?? [])
              .filter((e) => !e.allDay)
              .map((e) => {
                const minuten = e.at.getHours() * 60 + e.at.getMinutes();
                const dauer = Math.max(e.task.duration ?? DEFAULT_MINUTES, 15);
                return (
                  <div
                    key={e.task.id}
                    className="cal-block"
                    style={{
                      top: `${(minuten / 60) * HOUR_REM}rem`,
                      height: `${(Math.min(dauer, 24 * 60 - minuten) / 60) * HOUR_REM}rem`,
                    }}
                  >
                    {karte(e, true, 'timed')}
                  </div>
                );
              })}
            {/* Der Schatten des Ziehens: wo der Block landen würde. */}
            {drag?.bewegt && drag.art === 'timed' && drag.ziel !== null && drag.ziel.minutes !== null && sameDay(drag.ziel.day, tag) ? (
              <div
                className="cal-ghost"
                aria-hidden="true"
                style={{
                  top: `${(drag.ziel.minutes / 60) * HOUR_REM}rem`,
                  height: `${(Math.max((tasks ?? []).find((t) => t.id === drag.id)?.duration ?? DEFAULT_MINUTES, 15) / 60) * HOUR_REM}rem`,
                }}
              >
                {clock(new Date(2000, 0, 1, Math.floor(drag.ziel.minutes / 60), drag.ziel.minutes % 60))}
              </div>
            ) : null}
            {entwurf !== null && entwurf.minutes !== null && sameDay(entwurf.day, tag) ? (
              <div className="cal-block cal-block-draft" style={{ top: `${(entwurf.minutes / 60) * HOUR_REM}rem` }}>
                {entwurfFeld(false)}
              </div>
            ) : null}
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
      </div>
    );
  };

  /** Die Liste des Fensters, nach Tagen — unter Woche und Tag. */
  const liste = () => (
    <div className="cal-list" role="region" aria-label="Aufgabenliste" tabIndex={0}>
      {fenster.days.map((tag) => {
        const eintraege = jeTag.get(isoDate(tag)) ?? [];
        if (eintraege.length === 0 && span === 'week') return null;
        return (
          <section key={`l-${isoDate(tag)}`}>
            {span === 'week' ? <div className="section-label">{longDate(tag)}</div> : null}
            {eintraege.length === 0 ? (
              <div className="empty">
                <strong>Für diesen Tag sind keine Aufgaben geplant.</strong>
              </div>
            ) : (
              eintraege.map((e) => zeile(e.task))
            )}
          </section>
        );
      })}
      {span === 'week' && (tasks?.length ?? 0) === 0 ? (
        <div className="empty">
          <strong>In dieser Woche sind keine Aufgaben geplant.</strong>
        </div>
      ) : null}
    </div>
  );

  const anzahl = tasks?.length ?? 0;
  const timeCalendar = span !== 'month';

  return (
    <>
      <div className="main-head cal-head">
        <h1>{titleOf(span, anker)}</h1>
        <div className="sub">
          {tasks === undefined
            ? 'lädt'
            : anzahl === 0
              ? `${visibleEvents.length} Termine · keine Aufgaben geplant`
              : `${anzahl} ${anzahl === 1 ? 'Aufgabe' : 'Aufgaben'} · ${visibleEvents.length} Termine`}
        </div>
        <div className="head-views" role="group" aria-label="Anzeige">
          <button type="button" className="head-toggle" title="Aktualisieren" aria-label="Aktualisieren" onClick={() => void load()}><ArrowUturnIcon size={18} /></button>
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
          <button type="button" className="head-toggle" title="Zurück" aria-label="Zurück" onClick={() => onGo(span, step(span, anker, -1))}>
            <ChevronRightIcon size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" className="head-toggle" title="Heute" aria-label="Heute" onClick={() => onGo(span, heute)}>
            <CalendarIcon size={18} />
          </button>
          <button type="button" className="head-toggle" title="Weiter" aria-label="Weiter" onClick={() => onGo(span, step(span, anker, 1))}>
            <ChevronRightIcon size={18} />
          </button>
          {(
            [
              ['month', 'Monat', TableIcon],
              ['week', 'Woche', ColumnsIcon],
              ['day', 'Tag', PageIcon],
            ] as const
          ).map(([s, label, Icon]) => (
            <button
              key={s}
              type="button"
              className="head-toggle"
              title={label}
              aria-label={label}
              aria-pressed={span === s}
              onClick={() => onGo(s, anker)}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className={timeCalendar ? 'body cal-body' : 'body'} data-wide="yes" data-dragging={drag?.bewegt ? 'yes' : undefined}>
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}
        {span === 'month' ? monat() : raster()}
        {span === 'month' ? null : <section className="cal-list-panel" aria-label="Aufgaben im Zeitraum"><h2>Aufgaben im Zeitraum</h2>{liste()}</section>}
      </div>
    </>
  );
}
