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

import { COMMON_LEAD_MINUTES, saysLead } from '@sote/core';

import { api, ApiError, type Detail as DetailData, type Project, type Task } from '../api.js';
import { toggleDone } from '../tasks/toggleDone.js';
import { FieldRow, FreeDate } from '../components/FieldRow.js';
import { whenOptions } from '../components/HandleMenu.js';
import { whenLabel } from '../dates.js';

const PRIORITY_NAMES = ['', 'Dringend', 'Wichtig', 'Normal', 'Später'] as const;

/**
 * Die vier Wege, über die diese Spalte mit dem Server spricht.
 *
 * **Als austauschbare Anbindung und nicht als vier Aufrufe von `api`**, weil es
 * zwei Türen zu derselben Ansicht gibt: ein Mitglied ruft `/api/tasks/…`, ein
 * Gast `/api/share/:token/tasks/…`. Gemeldet war der Anlass — „die Seitenleiste
 * mit Aufgabendetails braucht ein geteilter User auch."
 *
 * Die Spalte zweimal zu bauen wäre zweimal derselbe Bildschirm, und der eine
 * hätte irgendwann ein Feld, das der andere nicht hat. Genau dieselbe
 * Begründung wie beim Herausziehen von `createWorkspaceIn`.
 */
export interface DetailIO {
  load: () => Promise<DetailData>;
  patch: (fields: Record<string, unknown>) => Promise<unknown>;
  addChild: (title: string) => Promise<unknown>;
  /** Wer zuständig sein kann. Fehlt beim Gast — er darf die Leute nicht sehen. */
  people?: () => Promise<readonly { userId: string; displayName: string }[]>;
  /**
   * Erinnerungen setzen und wegnehmen. Fehlen beim Gast: eine Erinnerung
   * braucht ein Konto, an das sie geht.
   */
  addReminder?: (body: { minutes: number } | { at: string }) => Promise<unknown>;
  removeReminder?: (reminderId: string) => Promise<unknown>;
  addComment: (body: string) => Promise<unknown>;
}

/** Die Anbindung eines Mitglieds. */
export const memberIO = (taskId: string, workspace: string | undefined): DetailIO => ({
  load: () => api.detail(taskId, workspace),
  /*
   * Wer zuständig sein KANN. Nur die Mitglieder-Anbindung hat das: ein Gast
   * darf die Leute des Arbeitsbereichs nicht sehen, und ein Feld, das ihm eine
   * Namensliste zeigt, wäre eine Auskunft, die er nicht haben soll.
   */
  people: () => api.people(workspace).then((r) => r.people),
  addReminder: (body) => api.addReminder(taskId, body, workspace),
  removeReminder: (rid) => api.removeReminder(taskId, rid, workspace),
  patch: (fields) => api.patch(taskId, fields as never, workspace),
  addChild: (title) => api.addChild(taskId, title, workspace),
  addComment: (body) => api.addComment(taskId, body, workspace),
});

/**
 * Die Anbindung eines Gasts.
 *
 * Derselbe Satz von vier Wegen, andere Adresse — und **kein** Arbeitsbereich:
 * der Token sagt schon, worum es geht. Was der Gast ändern darf, entscheidet
 * der Server (eine Auswahlliste in `shareRoutes`), nicht diese Datei: ein
 * Client, der seine Rechte selbst kennt, ist keine Rechteprüfung.
 */
export const guestIO = (token: string, taskId: string): DetailIO => ({
  load: () => api.shareDetail(token, taskId),
  patch: (fields) => api.sharePatch(token, taskId, fields),
  addChild: (title) => api.shareAddChild(token, taskId, title),
  addComment: (body) => api.shareAddComment(token, taskId, body),
  // Kein `people`: siehe `memberIO`.
});

export function Detail({
  taskId,
  workspace,
  io,
  canWrite,
  me,
  now,
  onClose,
  onChanged,
}: {
  taskId: string;
  workspace: string | undefined;
  /**
   * Wie diese Spalte mit dem Server spricht.
   *
   * Ohne Angabe die Anbindung eines Mitglieds — damit die vorhandenen Aufrufer
   * unverändert bleiben und der Gast der einzige ist, der etwas mitgibt.
   */
  io?: DetailIO;
  /**
   * Darf hier geschrieben werden?
   *
   * `false` heißt: die Felder sind **abwesend**, nicht deaktiviert. Gefunden am
   * Lese-Link: die Spalte bot Notiz und Kommentar an, der Server lehnte mit 403
   * ab — ein Knopf, der aussieht wie einer und nichts tut, war in diesem
   * Projekt schon sechs Mal der Fehler.
   *
   * Ein Mitglied hat immer Schreibrecht (die Rechteprüfung sitzt am
   * Arbeitsbereich), darum ist die Vorgabe `true` und nur der Gast gibt etwas
   * mit.
   */
  canWrite?: boolean;
  /** Die eigene Konto-Id. Fehlt beim Gast — er hat keine. */
  me?: string;
  now: Date;
  onClose: () => void;
  onChanged: () => void;
}) {
  const anbindung = io ?? memberIO(taskId, workspace);
  const darfSchreiben = canWrite !== false;
  const [data, setData] = useState<DetailData | undefined>(undefined);
  /*
   * Die Leute des Arbeitsbereichs, einmal geholt.
   *
   * Nicht in `load()`: die Detailantwort beschreibt EINE Aufgabe, und wer im
   * Arbeitsbereich ist, ändert sich nicht mit ihr. Ein zweiter Abruf hier ist
   * billiger als ein Feld, das an jeder Aufgabe dieselbe Liste mitschleppt.
   */
  const [people, setPeople] = useState<readonly { userId: string; displayName: string }[]>([]);
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
      setData(await anbindung.load());
      if (anbindung.people !== undefined && people.length === 0) {
        // Ein Fehlschlag hier nimmt die Aufgabe nicht mit: ohne Liste bleibt
        // das Feld lesbar, nur nicht wählbar.
        try {
          setPeople(await anbindung.people());
        } catch {
          /* dann eben nicht */
        }
      }
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
            void save(() => anbindung.patch({ title: next }));
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
                void save(() => anbindung.patch({ projectId: null }));
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
                    void save(() => anbindung.patch({ projectId: p.id }));
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
                    anbindung.patch({
                      planned: o.at.toISOString(),
                      plannedAllDay: o.allDay,
                    }),
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
                void save(() => anbindung.patch({ planned: null }));
              }}
            >
              <span className="empty-value">kein Datum</span>
            </button>
            <FreeDate
              label="anderer Tag"
              onPick={(at) => {
                close();
                void save(() =>
                  anbindung.patch({ planned: at.toISOString(), plannedAllDay: true }),
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
                void save(() => anbindung.patch({ due: null }));
              }}
            >
              <span className="empty-value">keine Frist</span>
            </button>
            <FreeDate
              label="fällig am"
              onPick={(at) => {
                close();
                void save(() =>
                  anbindung.patch({ due: at.toISOString(), dueAllDay: true }),
                );
              }}
            />
          </>
        )}
      </FieldRow>

      {/*
        Wiederholt — jetzt ÄNDERBAR, und immer da.
        
        Die Zeile erschien nur, WENN es eine Wiederholung gab: setzen konnte man
        sie danach nirgends, denn `TaskPatch` hatte kein Feld dafür. Der Kern
        konnte die ganze Zeit echte RRULEs samt INTERVAL, BYDAY und COUNT — es
        fehlte der Weg dorthin.

        Angeboten wird eine kurze Liste und nicht ein Regel-Baukasten: „jeden
        Montag" tippt man im Schnellerfasser genauer, als ein Menü es anbieten
        kann. Hier steht, was man an einer bestehenden Aufgabe braucht — das
        Übliche, und der Weg zurück.
      */}
      {/*
        Erinnerungen — mehrere, und jede gehört einer Person.
        
        Darum KEIN FieldRow mit einer Auswahl: das Bauteil wählt eine Sache aus
        (Projekt, Priorität, Wiederholung). Hier steht eine Liste, an die man
        etwas anhängt. Der Knopf öffnet die üblichen Vorläufe; jede gesetzte
        Erinnerung steht als Zeile darunter, mit ihrem Weg zurück.

        Nur wo es einen Mailweg gibt: `addReminder` fehlt beim Gast, und die
        Liste bleibt dann eine Anzeige. Ein Feld, das nichts verschicken kann,
        wäre ein Versprechen ohne Deckung.
      */}
      {anbindung.addReminder === undefined ? null : (
        <div className="frow frow-stack">
          <span className="fl">erinnern</span>
          <div className="rem-list">
            {data.reminders.length === 0 ? (
              <span className="empty-value">keine</span>
            ) : (
              data.reminders.map((r) => (
                <span className="rem" key={r.id} data-sent={r.sentAt !== null}>
                  {r.says}
                  {/* Wessen sie ist, steht dran — sonst nimmt man eine fremde
                      für die eigene und wundert sich, dass nichts kommt. */}
                  {r.userId === me ? null : <span className="rem-who">für jemand anderen</span>}
                  {r.sentAt === null ? null : <span className="rem-who">verschickt</span>}
                  {r.userId === me && anbindung.removeReminder !== undefined ? (
                    <button
                      type="button"
                      className="rem-off"
                      aria-label={`Erinnerung „${r.says}" wegnehmen`}
                      disabled={busy}
                      onClick={() => {
                        void save(() => anbindung.removeReminder!(r.id));
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))
            )}
          </div>
          <div className="rem-add">
            {COMMON_LEAD_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className="btn quiet small"
                disabled={busy || data.reminders.some((r) => r.userId === me && r.says === saysLead(m))}
                onClick={() => {
                  void save(() => anbindung.addReminder!({ minutes: m }));
                }}
              >
                {saysLead(m)}
              </button>
            ))}
          </div>
          {/*
            Und der ehrliche Satz, wenn die Aufgabe keinen Termin hat: ein
            Vorlauf ohne Termin klingelt nicht, und das gehört gesagt statt
            stillschweigend hingenommen — der Kern gibt dafür `dueAt: null`.
          */}
          {task.planned === null && data.reminders.some((r) => r.dueAt === null) ? (
            <p className="muted small">
              Ohne geplanten Zeitpunkt klingelt ein Vorlauf nicht. Sobald die
              Aufgabe einen Termin hat, gilt er.
            </p>
          ) : null}
        </div>
      )}

      <FieldRow
        label="wiederholt"
        value={task.recurrence?.says.replace(/\.$/, '') ?? null}
        empty="einmalig"
        disabled={busy || !darfSchreiben}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="fpop-row"
              disabled={task.recurrence === null}
              onClick={() => {
                close();
                void save(() => anbindung.patch({ recurrence: null }));
              }}
            >
              <span className="empty-value">einmalig</span>
            </button>
            {(
              [
                ['täglich', { rrule: 'FREQ=DAILY' }],
                ['wöchentlich', { rrule: 'FREQ=WEEKLY' }],
                ['alle zwei Wochen', { rrule: 'FREQ=WEEKLY;INTERVAL=2' }],
                ['monatlich', { rrule: 'FREQ=MONTHLY' }],
                ['jährlich', { rrule: 'FREQ=YEARLY' }],
                /*
                 * Und die zweite Form, die es in SOTE gibt und in vielen
                 * Programmen nicht: gezählt wird vom ABHAKEN, nicht vom Plan.
                 * Für alles, was „alle drei Tage, nachdem ich es gemacht habe"
                 * ist — putzen, gießen, nachfragen.
                 */
                ['3 Tage nach Erledigung', { n: 3, unit: 'day' }],
                ['1 Woche nach Erledigung', { n: 1, unit: 'week' }],
              ] as const
            ).map(([says, rec]) => (
              <button
                key={says}
                type="button"
                role="menuitem"
                className="fpop-row"
                onClick={() => {
                  close();
                  void save(() => anbindung.patch({ recurrence: rec }));
                }}
              >
                {says}
              </button>
            ))}
          </>
        )}
      </FieldRow>

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
                void save(() => anbindung.patch({ priority: level }));
              }}
            >
              <span className="fpop-dot" data-priority={level} aria-hidden="true" />
              {PRIORITY_NAMES[level]}
            </button>
          ))
        }
      </FieldRow>

      {/*
        Zuständig — jetzt ÄNDERBAR.
        
        Es stand als Text da, während die Tabelle, das Recht, die
        Benachrichtigung und die Anzeige fertig waren: geschrieben wurde nur
        beim Anlegen über `+name` im Schnellerfasser. Ein Feld, das die
        Oberfläche zeigt und nicht bedienen lässt, ist ein halbes Versprechen.

        Gäste stehen in der Liste, sind aber nicht wählbar: sie haben kein
        Konto, und `task_assignees` verlangt eines. Darum werden sie angezeigt
        und beim Schreiben nicht mitgeschickt — sonst würde ein Klick auf eine
        Person den Gast stillschweigend entfernen.
      */}
      <FieldRow
        label="zuständig"
        value={
          data.assignees.length === 0
            ? null
            : data.assignees.map((a) => a.name ?? a.guestKey?.replace(/^guest:/, '') ?? '?').join(', ')
        }
        empty="niemand"
        /*
         * `darfSchreiben`, nicht `canWrite`.
         *
         * `canWrite` ist die PROP (`boolean | undefined`); `darfSchreiben` ist
         * das daraus gerechnete `canWrite !== false`. Bei einem Mitglied kommt
         * die Prop nicht mit, also war `!canWrite` immer wahr und das Feld
         * immer gesperrt. Gefunden, weil das Prüfskript `disabled: true`
         * gemeldet hat — im Bild sieht ein gesperrtes Feld aus wie ein
         * ruhiges.
         */
        disabled={busy || !darfSchreiben}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="fpop-row"
              disabled={data.assignees.filter((a) => a.userId !== null).length === 0}
              onClick={() => {
                close();
                void save(() => anbindung.patch({ assignees: [] }));
              }}
            >
              <span className="empty-value">niemand</span>
            </button>
            {people.map((p) => {
              const drin = data.assignees.some((a) => a.userId === p.userId);
              return (
                <button
                  key={p.userId}
                  type="button"
                  role="menuitem"
                  className="fpop-row"
                  aria-current={drin}
                  onClick={() => {
                    close();
                    /*
                     * Die ganze Liste, nicht ein Zu- oder Abgang: der Server
                     * nimmt sie vollständig, und derselbe Klick nimmt zurück.
                     */
                    const jetzt = data.assignees
                      .filter((a) => a.userId !== null)
                      .map((a) => a.userId as string);
                    void save(() =>
                      anbindung.patch({
                        assignees: drin
                          ? jetzt.filter((id) => id !== p.userId)
                          : [...jetzt, p.userId],
                      }),
                    );
                  }}
                >
                  {p.displayName}
                </button>
              );
            })}
          </>
        )}
      </FieldRow>

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
        {!darfSchreiben ? (
          // Lesbar bleibt sie: eine Notiz ist Inhalt, und ein Lese-Link soll
          // Inhalt sehen. Nur das Feld, in das man tippt, fehlt.
          task.note === '' ? (
            <p className="muted small">Keine Notiz.</p>
          ) : (
            <p className="note-read">{task.note}</p>
          )
        ) : (
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
              void save(() => anbindung.patch({ note: e.target.value }));
            }
          }}
        />
        )}
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
        {!darfSchreiben ? null : (
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
              void save(() => anbindung.addChild(value));
            }}
          />
        </div>
        )}
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
        {!darfSchreiben ? null : (
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
            void save(() => anbindung.addComment(value));
          }}
        />
        )}
        {darfSchreiben || data.comments.length > 0 ? null : (
          <p className="muted small">Noch kein Gespräch.</p>
        )}
      </div>

      {notice !== undefined ? <p className="note-error">{notice}</p> : null}
    </aside>
  );
}
