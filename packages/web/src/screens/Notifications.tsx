/**
 * SOTE — Benachrichtigungen.
 *
 * ## Die Zahlen stehen neben den Namen
 *
 * SONEs `InboxPanel` sagt, warum, und der Satz ist der Grund für die ganze
 * Bauart:
 *
 * > Every view here is counted from the list already in hand rather than asked
 * > for separately, which is what lets the numbers sit beside the names. **A
 * > menu that says „Mentions" without saying how many is a menu you have to
 * > click to learn anything from.**
 *
 * Also wird **einmal** geholt und daraus gezählt. Eine Abfrage je Ansicht wäre
 * eine je Zahl, und die Zahlen stimmten dann untereinander nicht — sie kämen
 * aus verschiedenen Augenblicken.
 *
 * ## Drei Achsen, in der Reihenfolge, in der man fragt
 *
 * Auch das aus SONE: *ist etwas neu, welche Art ist es, wo ist es passiert.*
 * Die Achse „wo" gibt es, weil eine Glocke über Arbeitsbereiche hinweg gilt und
 * der Kopf der Leiste nicht sagen kann, in welchem man ist — es gibt keine
 * einzige Antwort.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api.js';

type Note = Awaited<ReturnType<typeof api.notifications>>['notifications'][number];

export type NoteView =
  | { of: 'unread' }
  | { of: 'all' }
  | { of: 'kind'; kind: Note['kind'] }
  | { of: 'workspace'; workspaceId: string };

const KIND_SAYS: Record<Note['kind'], string> = {
  assigned: 'Dir zugewiesen',
  commented: 'Kommentiert',
};

/** Passt diese Zeile in diese Ansicht? Eine Stelle, zweimal gebraucht: Liste und Zahl. */
export function matches(n: Note, view: NoteView): boolean {
  switch (view.of) {
    case 'unread':
      return n.readAt === null;
    case 'kind':
      return n.kind === view.kind;
    case 'workspace':
      return n.workspaceId === view.workspaceId;
    default:
      return true;
  }
}

/**
 * Das Menü in der Leiste.
 *
 * Es bekommt die **Liste** und nicht Zahlen: so kann es nicht anders zählen als
 * der Bildschirm daneben.
 */
export function NotificationsPanel({
  notes,
  view,
  onPick,
}: {
  notes: readonly Note[];
  view: NoteView;
  onPick: (v: NoteView) => void;
}) {
  const zahl = (v: NoteView): number => notes.filter((n) => matches(n, v)).length;
  const gleich = (a: NoteView, b: NoteView): boolean =>
    a.of === b.of &&
    (a.of !== 'kind' || (b.of === 'kind' && a.kind === b.kind)) &&
    (a.of !== 'workspace' || (b.of === 'workspace' && a.workspaceId === b.workspaceId));

  const zeile = (v: NoteView, label: string) => {
    const n = zahl(v);
    return (
      <button
        key={`${v.of}-${'kind' in v ? v.kind : 'workspaceId' in v ? v.workspaceId : ''}`}
        type="button"
        className="panel-row"
        aria-current={gleich(v, view)}
        onClick={() => onPick(v)}
      >
        <span>{label}</span>
        {/* Keine Null: eine Zahl über nichts ist Rauschen in einer ruhigen
            Zeile (SONEs ADR-0092) — und „0" neben einem Namen sieht aus wie
            ein Fehler, nicht wie eine Auskunft. */}
        {n > 0 ? <span className="n">{n}</span> : null}
      </button>
    );
  };

  // Die Arbeitsbereiche kommen aus den Zeilen selbst: einer ohne
  // Benachrichtigung ist eine Zeile im Menü, die auf eine leere Liste führt.
  const bereiche = [...new Map(notes.map((n) => [n.workspaceId, n.workspaceName])).entries()];

  return (
    <>
      {zeile({ of: 'unread' }, 'Ungelesen')}
      {zeile({ of: 'all' }, 'Alles')}

      <div className="panel-group">Art</div>
      {(['assigned', 'commented'] as const).map((k) => zeile({ of: 'kind', kind: k }, KIND_SAYS[k]))}

      {bereiche.length > 1 ? (
        <>
          {/* Erst ab zwei: eine Gruppe „Wo" über einer einzigen Zeile ist eine
              Überschrift für eine Sache, die keine Wahl ist (ADR-0072). */}
          <div className="panel-group">Wo</div>
          {bereiche.map(([id, name]) => zeile({ of: 'workspace', workspaceId: id }, name))}
        </>
      ) : null}
    </>
  );
}

export function Notifications({
  notes,
  view,
  onChanged,
  onOpenTask,
}: {
  notes: readonly Note[];
  view: NoteView;
  onChanged: () => void;
  /**
   * Die Aufgabe öffnen.
   *
   * Als Rückruf und nicht als Adresse: eine offene Aufgabe ist in SOTE ein
   * **Zustand** der Hülle (die Detailspalte), kein Ort. Mein erster Versuch
   * schrieb `window.location.assign('/p/x?t=…')` — eine Adresse, die es nicht
   * gibt, und ein Neuladen obendrein.
   */
  onOpenTask: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const gezeigt = useMemo(() => notes.filter((n) => matches(n, view)), [notes, view]);
  const ungelesen = notes.filter((n) => n.readAt === null).length;

  async function tun(fn: () => Promise<unknown>) {
    setBusy(true);
    setNotice(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Ging nicht.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="main-head">
        <h1>Benachrichtigungen</h1>
        <div className="sub">
          {ungelesen === 0
            ? 'Nichts Neues'
            : `${ungelesen} ${ungelesen === 1 ? 'ungelesen' : 'ungelesen'}`}
        </div>
        {ungelesen > 0 ? (
          <button
            type="button"
            className="head-toggle"
            disabled={busy}
            onClick={() => void tun(() => api.markRead())}
          >
            Alles gelesen
          </button>
        ) : null}
      </div>

      <div className="main-body">
        {notice === undefined ? null : <p className="note-error">{notice}</p>}
        {gezeigt.length === 0 ? (
          <div className="empty">
            <strong>Nichts hier.</strong>
            Benachrichtigungen entstehen, wenn dir jemand eine Aufgabe zuweist
            oder an einer deiner Aufgaben etwas schreibt.
          </div>
        ) : (
          gezeigt.map((n) => (
            <button
              key={n.id}
              type="button"
              className="note-row"
              data-unread={n.readAt === null}
              disabled={busy}
              /*
                Ein Klick öffnet die Aufgabe UND markiert gelesen.
                Zwei Klicks für einen Vorgang wären zwei — und wer eine
                Benachrichtigung öffnet, hat sie gelesen.
              */
              onClick={() =>
                void tun(async () => {
                  if (n.readAt === null) await api.markRead(n.id);
                  onOpenTask(n.taskId);
                })
              }
            >
              <span className="note-what">
                {n.kind === 'assigned'
                  ? `${n.actorName ?? 'Jemand'} hat dir eine Aufgabe gegeben`
                  : `${n.actorName ?? 'Jemand über einen Link'} hat kommentiert`}
              </span>
              <span className="note-task">{n.taskTitle}</span>
              <span className="note-where">
                {n.workspaceName} · {new Date(n.createdAt).toLocaleString('de-DE')}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

/** Holt die Liste — einmal, für Menü und Bildschirm. */
export function useNotifications(): {
  notes: Note[];
  reload: () => void;
} {
  const [notes, setNotes] = useState<Note[]>([]);
  const reload = useCallback(() => {
    void api
      .notifications()
      .then((out) => setNotes(out.notifications))
      .catch(() => setNotes([]));
  }, []);
  useEffect(reload, [reload]);
  return { notes, reload };
}
