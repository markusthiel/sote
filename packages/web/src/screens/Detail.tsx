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

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { COMMON_LEAD_MINUTES, formatDuration, sameLabel, saysLead } from '@sote/core';

import { api, ApiError, type Detail as DetailData, type Project, type Task } from '../api.js';
import { toggleDone } from '../tasks/toggleDone.js';
import { FieldRow, FreeDate, FreeDuration, FreeLabel } from '../components/FieldRow.js';
import {
  CheckSquareIcon,
  DownloadIcon,
  ImageIcon,
  PageIcon,
  VideoIcon,
  MessageIcon,
  PaperclipIcon,
  SlidersIcon,
  TextIcon,
  UsersIcon,
  type IconProps,
} from '../components/icons.js';
import { AudioIcon, EyeIcon } from '../components/viewIcons.js';
import { FileModal, kindName, kindOf, type FileKind } from '../components/FileModal.js';
import { useDetailTab } from '../hooks/useDetailTab.js';
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
  /** Anhänge. Fehlen beim Gast: eine Datei hängt an einem Konto. */
  addFile?: (file: File) => Promise<unknown>;
  removeFile?: (fileId: string) => Promise<unknown>;
  fileHref?: (fileId: string) => string;
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
  addFile: (file) => api.addFile(taskId, file, workspace),
  removeFile: (fid) => api.removeFile(taskId, fid, workspace),
  fileHref: (fid) => api.fileHref(taskId, fid, workspace),
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

/**
 * Eine Größe, wie man sie sagt.
 *
 * Kein „1048576 Bytes": eine Zahl, die man erst umrechnet, ist eine Zahl, die
 * man nicht liest. Basis 1024, weil das die Zahl ist, die Betriebssysteme
 * anzeigen — eine andere Rechnung hier hiesse, dass dieselbe Datei bei uns
 * anders groß ist als im Dateimanager.
 */
function kilobytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Die Reiter der Detailspalte, in ihrer Reihenfolge.
 *
 * Erst, was die Aufgabe IST (Eigenschaften, Notiz), dann was zu ihr GEHÖRT
 * (Teilaufgaben, Anhänge, Bilder), dann das Gespräch darüber, zuletzt die
 * Leute. Dieselbe Ordnung wie in SONEs Panel, und aus demselben Grund: die
 * Sachen des Gegenstands vor den Sachen der Menschen.
 */
/**
 * Welches Zeichen für welche Art Datei.
 *
 * GEMELDET: „Die Icons werden noch nicht angepasst hinten." Video und Ton
 * bekamen dasselbe Blatt wie ein Archiv — und ein Zeichen, das dasselbe sagt
 * wie das Wort daneben, ist kein Beiwerk: man sieht es zuerst.
 *
 * Als Karte und nicht als Kette von Fragen: wer dem Wortschatz eine Art
 * hinzufügt, soll hier eine fehlende Zeile finden.
 */
const ART_ICONS: Record<FileKind, ReactElement> = {
  image: <ImageIcon size={15} />,
  video: <VideoIcon size={15} />,
  audio: <AudioIcon />,
  pdf: <PageIcon size={15} />,
  text: <TextIcon size={15} />,
  other: <PageIcon size={15} />,
};

const TABS = [
  'felder',
  'notiz',
  'kinder',
  'dateien',
  'bilder',
  'gespraech',
  'leute',
] as const;
type DetailTab = (typeof TABS)[number];

/**
 * Ein Zeichen und ein Name je Reiter.
 *
 * Zeichen statt Wörter auf der Leiste, weil sieben Wörter in eine 340 px
 * schmale Spalte nicht passen — und die Leiste wird eher länger. Der Name geht
 * nicht verloren: er ist die Beschriftung für den Vorleser, der Text beim
 * Zeigen, und die Überschrift unter der Leiste sagt ihn noch einmal, für den,
 * der schon gewählt hat.
 *
 * Alle sieben Zeichen stammen aus dem aus SONE übernommenen Satz — dort tragen
 * sechs davon dieselbe Bedeutung wie hier.
 */
const TAB_SAYS: Record<DetailTab, { says: string; Icon: (props: IconProps) => ReactElement }> = {
  felder: { says: 'Eigenschaften', Icon: SlidersIcon },
  notiz: { says: 'Notiz', Icon: TextIcon },
  kinder: { says: 'Teilaufgaben', Icon: CheckSquareIcon },
  dateien: { says: 'Anhänge', Icon: PaperclipIcon },
  bilder: { says: 'Bilder', Icon: ImageIcon },
  gespraech: { says: 'Gespräch', Icon: MessageIcon },
  leute: { says: 'Zuständig', Icon: UsersIcon },
};

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
  /**
   * Die Spalte schliessen.
   *
   * GEMELDET: „Was mir fehlt, ist der Schliessen-Knopf fuer die Seitenleiste
   * der Details. Da muss ich sonst explizit die Aufgabe abwaehlen, was zum
   * Suchen fuehrt."
   *
   * Er stand einmal hier, wanderte dann nach draussen in die Kopfleiste (links
   * neben der Spalte, wie in SONE) — und wurde von MIR unerreichbar gemacht:
   * seit die Detailspalte ueber dem Inhalt liegt statt neben ihm, liegt der
   * Knopf unter ihr. Sichtbar war er nur, solange die Spalte Platz wegnahm.
   *
   * Jetzt wieder hier, und diesmal bleibt er: solange die Spalte ueberlagert,
   * ist „aussen" der falsche Ort — dort muesste der Knopf ueber dem Inhalt
   * schweben, und das ist schlechter als eine Zeile Hoehe. Die kostet er
   * ausserdem nicht mehr; er sitzt in der Zeile des Titels.
   */
  onClose: () => void;
  onChanged: () => void;
}) {
  const anbindung = io ?? memberIO(taskId, workspace);
  const darfSchreiben = canWrite !== false;
  const [data, setData] = useState<DetailData | undefined>(undefined);
  /**
   * Welcher Anhang gerade angesehen wird.
   *
   * Die Id und nicht die Datei: die Liste wird neu geladen (nach dem Abhaken,
   * nach einem Umbenennen), und ein festgehaltenes Objekt wäre danach ein Bild
   * von gestern. Die Id findet die Datei jedes Mal neu.
   */
  const [ansehen, setAnsehen] = useState<string | null>(null);
  /** Welches Dateimenü offen ist — eines nach dem anderen. */
  const [fileMenu, setFileMenu] = useState<string | null>(null);
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
  /*
   * VOR dem frühen `return`, und das ist kein Formalismus.
   *
   * GEMELDET: „Wenn ich das Seitenmenü öffnen will, indem ich eine Aufgabe
   * anklicke, wird die ganze Seite weiß und alles ist weg."
   *
   * Dieser Aufruf stand weiter unten — hinter `if (data === undefined)
   * return …`. Beim ersten Zeichnen (noch nichts geladen) lief er also nicht,
   * beim zweiten (Daten da) schon: elf Hooks, dann zwölf. React bricht dann
   * die ganze Wurzel ab, und übrig bleibt eine weiße Seite.
   *
   * Die Regel dahinter: Hooks müssen in JEDEM Durchlauf in derselben
   * Reihenfolge laufen. Ein `return` dazwischen ist eine Verzweigung wie jede
   * andere.
   */
  const [tab, setTab] = useDetailTab(TABS, 'felder');

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
        {/* Kein Schließen-Knopf mehr hier drin: er sitzt aussen in der
            Kopfleiste, links neben der Spalte. */}
        {notice !== undefined ? <p className="note-error">{notice}</p> : null}
      </aside>
    );
  }

  const task = data.task;
  const openChildren = data.children.filter((c) => c.completed === null).length;
  /*
   * ── Die Spalte ist ein Reiter-Panel ──────────────────────────────────────
   *
   * GEWÜNSCHT: „Die Seitenspalte einer Aufgabe wird langsam voll. Ich würde
   * den Öffnen- bzw. Schließen-Button nach aussen verlegen wie bei SONE. …
   * Dann sollten wir in die Spalte ein Menü bringen, ebenfalls wie SONE. Dort
   * dann die Spalte rein organisieren. … Also Grundsatz kopieren von SONE,
   * anpassen an die Logik von SOTE."
   *
   * SONEs Begründung für die Form, wörtlich: *„a narrow column that changes
   * what it shows is far better than several competing panels, because only
   * one of them is ever wanted at a time."* Genau der Fall hier — wer
   * Kommentare liest, stellt gerade keine Erinnerung ein.
   *
   * ANGEPASST, NICHT ABGESCHRIEBEN. SONE hat neun Reiter, weil es neun Sachen
   * gibt; SOTE hat sieben, weil es sieben gibt. Was es hier NICHT gibt, steht
   * auch nicht da:
   *
   * - kein „Verlauf": eine Aufgabe hat keine Fassungen. Ein leerer Reiter mit
   *   einer Uhr wäre ein Versprechen ohne Deckung (ADR-0027).
   * - kein „Links": SOTE kennt nur die HERKUNFT (eine Aufgabe aus SONE), und
   *   die ist eine Zeile und kein Reiter — sie steht bei den Eigenschaften.
   * - kein „Gliederung": eine Aufgabe hat keine Überschriften.
   *
   * Die Reihenfolge folgt SONEs: erst, was die Aufgabe IST (Eigenschaften,
   * Notiz), dann was zu ihr GEHÖRT (Teilaufgaben, Anhänge, Bilder), dann das
   * Gespräch darüber, und zuletzt die Leute.
   */
  /*
   * Bilder von den übrigen Anhängen getrennt — nach dem Typ, den der Server
   * mitschickt. Dieselbe Unterscheidung, die schon die Zeichen in der Zeile
   * treffen (`marks_of`, Migration 0027): ein Bild an einer Aufgabe ist
   * meistens der Inhalt und nicht eine Beilage.
   */
  const bilder = data.files.filter((f) => f.mimeType.startsWith('image/'));

  return (
    <aside className="detail" aria-label="Aufgabe im Detail">
      {/*
        Der Titel steht ÜBER den Reitern und nicht in einem davon.

        Er ist nicht eine Auskunft über die Aufgabe, er IST sie — wer den
        Reiter wechselt, soll nicht vergessen, worüber er gerade etwas
        einstellt. Dasselbe Verhältnis wie in SONE zwischen dem Dokument und
        seiner Spalte.

        Der Schließen-Knopf steht wieder AUSSEN, in der Kopfleiste — mit SONEs
        Zeichen, unmittelbar vor der Leiste. Dass er hier einmal stand, war
        eine Korrektur an der richtigen Beobachtung („er liegt unter der
        Spalte") mit dem falschen Mittel: die Spalte rückt jetzt die
        Kopfleiste, statt den Knopf zu verschlucken.
      */}
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

      <div className="detail-tabs" role="tablist" aria-label="Bereiche der Aufgabe">
        {TABS.map((name) => {
          const { says, Icon } = TAB_SAYS[name];
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className="detail-tab"
              /* Der Name, für den Vorleser und für den Zeiger. Ein Zeichen
                 ohne beides ist ein Symbol, das man durch Drücken lernt. */
              aria-label={says}
              title={says}
              onClick={() => setTab(name)}
            >
              <Icon />
            </button>
          );
        })}
      </div>

      {/* Welcher Reiter offen ist, in Worten. Die Leiste sagt es in Zeichen;
          hier liest man es nach. */}
      <p className="detail-tab-title">{TAB_SAYS[tab].says}</p>

      <div className="detail-body" role="tabpanel" key={tab}>
        {tab === 'felder' ? (
          <>
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
              Die Dauer — eine Schätzung, kein gemessener Wert.

              Vier schnelle Angaben und ein freies Feld, dieselbe Form wie beim
              Datum: 15 Minuten, eine halbe, eine ganze, zwei Stunden deckt das
              Meiste, „2:45" deckt es nicht.

              „ohne" nimmt sie weg und steht ZULETZT — wie überall hier ist das
              Wegnehmen das eine, was man nicht durch nochmaliges Wählen zurückholt.
            */}
            <FieldRow
              label="dauer"
              value={task.duration === null ? null : formatDuration(task.duration)}
              empty="nicht geschätzt"
              disabled={busy}
            >
              {(close) => (
                <>
                  {[15, 30, 60, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      role="menuitem"
                      className="fpop-row"
                      aria-current={minutes === task.duration}
                      onClick={() => {
                        close();
                        void save(() => anbindung.patch({ duration: minutes }));
                      }}
                    >
                      {formatDuration(minutes)}
                    </button>
                  ))}
                  {task.duration === null ? null : (
                    <button
                      type="button"
                      role="menuitem"
                      className="fpop-row"
                      onClick={() => {
                        close();
                        void save(() => anbindung.patch({ duration: null }));
                      }}
                    >
                      ohne Schätzung
                    </button>
                  )}
                  <FreeDuration
                    label="oder genau"
                    onPick={(minutes) => {
                      close();
                      void save(() => anbindung.patch({ duration: minutes }));
                    }}
                  />
                </>
              )}
            </FieldRow>

            {/*
              Schlagwörter — jetzt ECHTE.

              Die Tabellen stehen seit Migration 0001, der Schnellerfasser schrieb
              `@wort` seit damals, die Suche filterte darauf. Zu sehen waren sie
              nirgends und zu ändern gar nicht: wieder die Sorte Lücke, die auch
              Wiederholung und Zuständige hatten — es fehlte der Weg von der
              Oberfläche dorthin.

              Der VORRAT steht oben (was es hier schon gibt, angehaktes zuerst
              erkennbar), das freie Feld unten. Ohne den Vorrat wäre es ein leeres
              Textfeld, und wer nicht sieht, was es gibt, legt beim dritten Mal
              `unterweg` an.
            */}
            <FieldRow
              label="schlagwörter"
              value={task.labels.length === 0 ? null : task.labels.join(', ')}
              empty="keine"
              disabled={busy || !darfSchreiben}
            >
              {(close) => (
                <>
                  {data.known.length === 0 ? (
                    <div className="fpop-empty">
                      Noch keine — schreib eines ins Feld, dann gibt es eines.
                    </div>
                  ) : (
                    data.known.map((name) => {
                      const dran = task.labels.some((have) => sameLabel(have, name));
                      return (
                        <button
                          key={name}
                          type="button"
                          role="menuitemcheckbox"
                          className="fpop-row"
                          aria-checked={dran}
                          onClick={() => {
                            /*
                             * Umschalten und nicht setzen: das Feld schickt die
                             * VOLLSTÄNDIGE Liste (`labels` ist ein Ersetzen), also
                             * wird sie hier gebaut. Ein Zu- und ein Abgangsweg wären
                             * zwei Routen für eine Frage.
                             *
                             * Offen bleiben (`close` wird nicht gerufen): wer eines
                             * anhakt, hakt oft zwei an. Beim Datum ist es umgekehrt,
                             * weil es dort nur eines geben kann.
                             */
                            const next = dran
                              ? task.labels.filter((have) => !sameLabel(have, name))
                              : [...task.labels, name];
                            void save(() => anbindung.patch({ labels: next }));
                          }}
                        >
                          <span className="fpop-check" aria-hidden="true">
                            {dran ? '✓' : ''}
                          </span>
                          {name}
                        </button>
                      );
                    })
                  )}
                  <FreeLabel
                    label="oder ein neues"
                    known={task.labels}
                    onPick={(name) => {
                      close();
                      void save(() => anbindung.patch({ labels: [...task.labels, name] }));
                    }}
                  />
                </>
              )}
            </FieldRow>

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
                  {/*
                    Und eine feste Uhrzeit — die absolute Form, die der Server von
                    Anfang an konnte und die Oberfläche nicht anbot. Für alles, was
                    nicht am Termin hängt: „ruf am 24.12. um 18 Uhr an", auch wenn
                    die Aufgabe selbst ungeplant ist.

                    `datetime-local` und nicht zwei Felder: Datum und Uhrzeit sind
                    hier EINE Angabe, und zwei Felder wären zwei Zustände, die
                    zueinander passen müssen. Der Wert ist Ortszeit ohne Zone —
                    `new Date(wert)` liest ihn in der Zone des Browsers, und das ist
                    genau die, in der man ihn getippt hat.
                  */}
                  <input
                    type="datetime-local"
                    className="rem-at"
                    aria-label="Erinnerung zu einer festen Zeit"
                    disabled={busy}
                    onChange={(e) => {
                      const wert = e.currentTarget.value;
                      if (wert === '') return;
                      const at = new Date(wert);
                      if (Number.isNaN(at.getTime())) return;
                      // Das Feld leeren, sonst steht die gesetzte Zeit darin und
                      // sieht aus wie eine Auswahl, die noch offen ist.
                      e.currentTarget.value = '';
                      void save(() => anbindung.addReminder!({ at: at.toISOString() }));
                    }}
                  />
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

            {/* Nur wenn es eine Herkunft gibt. Gespeicherte URL und Titel, damit der
                Rückweg auch ohne SONE funktioniert. */}
            {data.origin !== undefined ? (
              <a className="origin" href={data.origin.url}>
                <span className="ol">entstanden in SONE</span>
                <span className="ot">{data.origin.pageTitle}</span>
              </a>
            ) : null}
          </>
        ) : null}

        {tab === 'notiz' ? (
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
        ) : null}

        {tab === 'kinder' ? (
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
              {/*
                KEINE TEILAUFGABE AN EINER TEILAUFGABE.

                GEMELDET: „Die Seitenleiste lässt mich auch bei Unteraufgaben
                Unteraufgaben hinzufügen. Das klappt dann zwar nicht, sollte
                aber hier ausgegraut werden oder so."

                Es gibt eine Ebene (Migration 0028 und die Prüfung in `move`),
                und der Server hat das auch abgelehnt — nur eben erst NACH dem
                Tippen. Ein Feld, das eine Zeile entgegennimmt und sie dann
                verwirft, ist schlechter als eines, das gar nichts verspricht.

                GESPERRT und nicht weggelassen, und hier ist das der
                Unterschied: bei „Teilen" an einem Ordner gibt es die Sache
                nicht, hier gibt es sie — nur eine Ebene höher. Ein sichtbar
                gesperrtes Feld mit einem Satz daneben beantwortet die Frage
                „warum geht das hier nicht", ein fehlendes lässt sie offen.
                Dieselbe Überlegung wie an den Pfeilen im Projektmenü.
              */}
              {/*
                Ist das hier selbst eine Teilaufgabe? Dann gibt es darunter
                keine weitere Ebene — die Regel steht im Server (`move` weist
                es ab), und die Oberfläche soll sie zeigen, statt sie
                herausfinden zu lassen.
              */}
              {!darfSchreiben ? null : data.task.parentId !== null ? (
                <p className="child-hint">
                  Teilaufgaben gibt es eine Ebene tief. Diese Aufgabe ist selbst
                  eine — für mehr Tiefe sind die Ordner da.
                </p>
              ) : (
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
        ) : null}

        {tab === 'dateien' ? (
          <>
            {/*
              Anhänge — eine Liste, wie die Erinnerungen.
        
              Das Feld ist ein `label` mit einem versteckten `input type=file`, wie
              beim Profilbild: ein `input[type=file]` sieht in jedem Browser anders
              aus, ein `label` sieht aus wie unsere Knöpfe.

              Nur wenn die Anbindung es kann: ohne `SOTE_FILES_DIR` antwortet der
              Server 501, und ein Feld, das darauf läuft, wäre eines, das nichts tut.
              Beim Gast fehlt es ebenso — eine Datei hängt an einem Konto.
            */}
            {anbindung.addFile === undefined ? null : (
              <div className="frow frow-stack">
                <span className="fl">anhänge</span>
                <div className="rem-list">
                  {data.files.length === 0 ? (
                    <span className="empty-value">keine</span>
                  ) : (
                    data.files.map((f) => (
                      /*
                        SONES DATEIZEILE, wörtlich übernommen.

                        GEMELDET mit Bild: „Hier die Optik, die SONE verwendet."
                        Und davor schon: „Wenn es nicht besser geht, dann lieber
                        doch keine Pille."

                        Meine Karte war der zweite Versuch am selben Problem und
                        auch nicht der richtige: sie gab dem Namen die ganze
                        Breite, kostete dafür aber drei Zeilen je Anhang. SONEs
                        Antwort ist eine ZEILE — Klammer, Name, und rechts die
                        Art mit der Grösse in Schmalschrift.

                        Das ist dieselbe Lehre wie bei den Knöpfen im Listenkopf:
                        die Form gibt es schon, und sie nachzubauen hiesse, eine
                        zweite Sprache für dieselbe Sache zu erfinden. Die Klassen
                        heissen darum wie dort — `.file-line`, `.file-name`,
                        `.file-meta`.
                      */
                      <div className="file-line" key={f.id}>
                        <PaperclipIcon size={14} />
                        {/*
                          Der Name ÖFFNET die Vorschau: „Standard anklicken wäre
                          dann eher das Modal." SONE tut dasselbe und begründet
                          es genauso — wer auf einen Namen klickt, will sehen,
                          was es ist, nicht eine Kopie im Download-Ordner.
                        */}
                        <button
                          type="button"
                          className="file-name"
                          title={`${f.filename} ansehen`}
                          onClick={() => setAnsehen(f.id)}
                        >
                          {f.filename}
                        </button>
                        <span className="file-meta">
                          {kindName(f.mimeType)} · {kilobytes(f.sizeBytes)}
                        </span>
                        {/*
                          EIN Menü statt dreier Knöpfe, und der Grund steht bei
                          SONE: „A row of display buttons with a download link
                          beside it was two kinds of thing in one place — what
                          should this look like and what should happen now —
                          reading as one row, and growing every time something
                          was added."
                        */}
                        <div className="file-menu">
                          {/*
                            EIN EIGENER KNOPF und keine drei Punkte.

                            GEMELDET mit Bild: „Hinten ein schöner
                            alleinstehender Button. Das ist die Idee: Da machen
                            wir einen Button hin, der ein Menü öffnet."

                            Die drei Punkte sind SOTEs Zeichen für „hier gibt es
                            ein Menü" und stehen an jeder Aufgabenzeile. Hier
                            ist es aber auch der Knopf, der die DATEI meint —
                            also trägt er ihr Zeichen, und das sagt nebenbei,
                            was für eine es ist. Ein Punktemenü daneben wäre ein
                            Zeichen weniger und ein Rätsel mehr.
                          */}
                          <button
                            type="button"
                            className="file-menu-trigger"
                            aria-label={`Menü für ${f.filename}`}
                            aria-haspopup="menu"
                            aria-expanded={fileMenu === f.id}
                            onClick={() => setFileMenu(fileMenu === f.id ? null : f.id)}
                          >
                            {/*
                              DAS ZEICHEN SAGT DIE ART.

                              GEMELDET: „Die Icons werden noch nicht angepasst
                              hinten." Richtig — der Knopf trug für alles ein
                              Blatt, obwohl die Art daneben schon als Wort
                              dasteht. Ein Zeichen, das dasselbe sagt wie das
                              Wort, ist kein Beiwerk: man sieht es zuerst.

                              Als Karte und nicht als Kette von Fragen: wer dem
                              Wortschatz eine Art hinzufügt, soll hier eine
                              fehlende Zeile finden.
                            */}
                            {ART_ICONS[kindOf(f.mimeType)]}
                          </button>
                          {fileMenu === f.id ? (
                            <div className="menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="menu-item"
                                onClick={() => {
                                  setFileMenu(null);
                                  setAnsehen(f.id);
                                }}
                              >
                                Ansehen
                              </button>
                              <a
                                role="menuitem"
                                className="menu-item"
                                href={anbindung.fileHref?.(f.id) ?? '#'}
                                download={f.filename}
                                onClick={() => setFileMenu(null)}
                              >
                                Herunterladen
                              </a>
                              {anbindung.removeFile === undefined ? null : (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="menu-item danger"
                                  disabled={busy}
                                  onClick={() => {
                                    setFileMenu(null);
                                    void save(() => anbindung.removeFile!(f.id));
                                  }}
                                >
                                  Wegnehmen
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <label className={busy ? 'btn quiet small as-label' : 'btn quiet small as-label'}>
                  Datei anhängen
                  <input
                    type="file"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      if (file === undefined) return;
                      // Das Feld leeren: sonst löst dieselbe Datei beim zweiten Mal
                      // kein `change` aus, und es sieht aus, als täte der Knopf
                      // nichts.
                      e.currentTarget.value = '';
                      void save(() => anbindung.addFile!(file));
                    }}
                  />
                </label>
              </div>
            )}
          </>
        ) : null}

        {tab === 'bilder' ? (
          <div className="detail-section">
            {/*
              Bilder als BILDER und nicht als Dateinamen.
              Ein Anhang „IMG_4711.jpg" sagt nichts; das Bild sagt alles. Die
              Liste daneben (Reiter „Anhänge") zeigt dieselben Dateien als
              Namen — dort geht es ums Herunterladen, hier ums Wiedererkennen.
            */}
            {bilder.length === 0 ? (
              <p className="muted small">
                Noch keine Bilder. Häng eines unter „Anhänge" an.
              </p>
            ) : (
              <div className="detail-images">
                {bilder.map((f) => {
                  const href = anbindung.fileHref?.(f.id) ?? '';
                  /*
                   * DER WEG OHNE FRAGEZEICHEN.
                   *
                   * GEMELDET: „Beim Klick auf den Button kommt: ein Titelbild
                   * ist ein eigener Anhang oder eine Farbe — eine fremde
                   * Adresse nicht."
                   *
                   * Mein Fehler, und ein lehrreicher: `fileHref` hängt
                   * `?workspace=…` an, weil jede Abfrage sagen muss, in welchem
                   * Bereich sie steht. Die Prüfung im Kern ist an BEIDEN Enden
                   * verankert — und genau das hat sie getan: die Adresse endete
                   * nicht nach der Datei-Id, also war sie keine eigene.
                   *
                   * Die Prüfung hatte recht. Gespeichert gehört der WEG, nicht
                   * der Abruf: in welchem Arbeitsbereich jemand gerade steht,
                   * ist eine Eigenschaft der Anfrage und keine des Bildes. Wer
                   * die Karte zeichnet, hängt den Bereich wieder an.
                   */
                  const pfad = `/api/tasks/${taskId}/files/${f.id}`;
                  const istTitel = task.cover?.image === pfad;
                  return (
                    <div key={f.id} className="detail-image-wrap">
                      {/*
                        Der Klick auf das Bild ÖFFNET ES, statt die Datei
                        aufzurufen — gewünscht: „Standard anklicken wäre dann
                        eher das Modal." Ein Knopf und kein Link, weil das Ziel
                        keine Adresse ist.
                      */}
                      <button
                        type="button"
                        className="detail-image"
                        title={`${f.filename} ansehen`}
                        onClick={() => setAnsehen(f.id)}
                      >
                        <img src={href} alt={f.filename} />
                      </button>
                      {/*
                        DER WEG ZUM TITELBILD führt über das Bild selbst.

                        Gewünscht: „Kann man ein Bild auch als Headerbild für
                        Kanban einstellen? Also bei der Aufgabe."

                        Hier und nicht in einem eigenen Feld: die Auswahl ist
                        „DIESES Bild", und man trifft sie, indem man auf das
                        Bild sieht. Ein Feld „Titelbild" mit einer Liste von
                        Dateinamen wäre dieselbe Wahl, nur blind.

                        Derselbe Knopf nimmt es auch wieder weg — ein zweiter
                        daneben wäre einer für den Fall, den es nur gibt, wenn
                        der erste schon gedrückt wurde.
                      */}
                      {/*
                        ZEICHEN STATT WÖRTER, wie oben im Listenkopf.

                        Gewünscht: „Auch hier hätte ich gerne ein Icon anstatt
                        Text für das Titelbild." Zwei Knöpfe nebeneinander, und
                        einer davon trug einen ganzen Satz, dessen Länge sich
                        auch noch mit dem Zustand änderte.

                        Die Wörter gehen nicht verloren: `title` und
                        `aria-label` tragen sie, wie überall in diesem Projekt.
                      */}
                      <span className="detail-image-tools">
                        {!darfSchreiben || href === '' ? null : (
                          <button
                            type="button"
                            className="detail-image-tool"
                            aria-pressed={istTitel}
                            disabled={busy}
                            title={istTitel ? 'Kein Titelbild mehr' : 'Als Titelbild'}
                            aria-label={istTitel ? 'Kein Titelbild mehr' : 'Als Titelbild'}
                            onClick={() =>
                              void save(() =>
                                anbindung.patch({ cover: istTitel ? null : { image: pfad } }),
                              )
                            }
                          >
                            <ImageIcon size={15} />
                          </button>
                        )}
                        <a
                          className="detail-image-tool"
                          href={href || '#'}
                          download={f.filename}
                          title="Herunterladen"
                          aria-label={`${f.filename} herunterladen`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DownloadIcon size={15} />
                        </a>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'gespraech' ? (
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
        ) : null}

        {tab === 'leute' ? (
          <>
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
          </>
        ) : null}
      </div>

      {notice !== undefined ? <p className="note-error">{notice}</p> : null}

      {/*
        Die Vorschau — EIN Fenster für alle Anhänge, nicht eines je Reiter.

        Sie steht hier unten und nicht im Reiter: ein Bild wird im Reiter
        „Bilder" geöffnet und dieselbe Datei im Reiter „Anhänge", und zwei
        Fenster für denselben Zweck wären zwei Orte, an denen man den falschen
        ändert.

        Die Datei wird über die Id GESUCHT und nicht festgehalten: die Liste
        lädt neu, und ein festgehaltenes Objekt wäre danach ein Bild von
        gestern.
      */}
      {(() => {
        if (ansehen === null) return null;
        const f = data.files.find((x) => x.id === ansehen);
        if (f === undefined) return null;
        return (
          <FileModal
            href={anbindung.fileHref?.(f.id) ?? ''}
            filename={f.filename}
            mimeType={f.mimeType}
            onClose={() => setAnsehen(null)}
          />
        );
      })()}
    </aside>
  );
}
