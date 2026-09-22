/**
 * SOTE — die Notiz als Editor.
 *
 * GEWÜNSCHT: „Können wir bei SOTE das Text-Detailfeld als Editor bauen? … damit
 * ich formatieren kann, Links im Text setzen, auch mal ein Bild einfügen. …
 * Textfeld auch gerne gleich höher machen, vielleicht kann man es auch über die
 * Seitenleiste ziehen, so dass es die ganze Höhe nimmt?"
 *
 * Der Editor selbst ist SONEs, Paket `@sote/editor`. Diese Datei ist die
 * Halterung: sie hängt ihn in die Spalte, sagt ihm, was er hochlädt, wen er bei
 * `@` anbietet, und wann gespeichert wird.
 *
 * ## Ein Dokument je Notiz, und kein Sync-Server
 *
 * Der Editor spricht Yjs, nicht nacktes ProseMirror — auch das Rückgängig ist
 * Yjs' eigenes. SOTE hat keine Sync-Schicht und braucht hier auch keine: das
 * `Y.Doc` lebt in diesem Fenster, und gespeichert wird sein Stand. Der Preis ist
 * benannt: zwei gleichzeitig offene Fenster derselben Notiz überschreiben sich
 * gegenseitig, das letzte Speichern gewinnt. Der Gewinn ist, dass das Format
 * schon stimmt, wenn die Live-Bearbeitung einmal kommt — dann wandert nicht die
 * Notiz, sondern nur der Weg, auf dem ihr Stand zum Server kommt.
 *
 * ## Zwei Dinge werden gespeichert
 *
 * Das Dokument (`noteDoc`) ist die Wahrheit, der Klartext (`note`) sein
 * Schatten für Suche, Kartenvorschau, Kalender-Tooltip und ICS-Export. Sie gehen
 * zusammen in einem PATCH raus, weil sie zwei Antworten auf dieselbe Frage sind.
 */

import {
  createEditor,
  docFromPlainText,
  jsonToFragment,
  noteText,
  schema,
  seedEmptyPage,
  insertImageUpload,
  type ImageUploader,
} from '@sote/editor';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import * as Y from 'yjs';

import { ImageIcon, MaximiseIcon, MinimiseIcon } from './icons.tsx';
import { MentionMenu } from './MentionMenu.tsx';
import { SlashMenu } from './SlashMenu.tsx';

/** Wie lange Ruhe herrschen muss, bevor gespeichert wird. */
const RUHE_MS = 2000;

const bytesFrom = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (zeichen) => zeichen.charCodeAt(0));

/**
 * Bytes zu base64, in Häppchen.
 *
 * `String.fromCharCode(...bytes)` auf einmal wirft bei einem längeren Dokument
 * „Maximum call stack size exceeded" — ein Fehler, der erst auftritt, wenn
 * jemand viel geschrieben hat, also genau bei der Notiz, die ihm wichtig ist.
 */
function base64From(bytes: Uint8Array): string {
  let roh = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    roh += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(roh);
}

export interface NoteEditorProps {
  /** Wechselt die Aufgabe, wird der Editor neu gebaut — sonst nie. */
  taskId: string;
  /** Der Klartext von bisher. Nur beim ersten Öffnen ohne Dokument gebraucht. */
  note: string;
  /** Das gespeicherte Dokument, base64. `null` heißt: es gibt noch keines. */
  noteDoc: string | null;
  canWrite: boolean;
  /** Wen `@` anbietet. Leer ist in Ordnung: dann öffnet das Menü nicht. */
  people: readonly { userId: string; displayName: string }[];
  /** Die Bilder, die schon an der Aufgabe hängen — was „Bild einfügen" zeigt. */
  images: readonly { id: string; filename: string }[];
  /** Wo ein Anhang liegt. Fehlt sie, gibt es keine Bilder zum Einfügen. */
  fileHref?: (fileId: string, size?: 'web') => string;
  /**
   * Ein eingefügtes oder gezogenes Bild anhängen.
   *
   * Fehlt beim Gast. Vorhanden heißt: ein Bild im Text ist DERSELBE Anhang, den
   * der Bilder-Reiter zeigt — ein Speicherort, nicht zwei.
   */
  uploadImage?: (file: File) => Promise<{ fileId: string; filename: string }>;
  /** Nach einem Hochladen: die Spalte soll ihre Anhänge neu holen. */
  onFilesChanged?: () => void;
  /** Dokument und Klartext zusammen speichern. */
  onSave: (note: string, noteDoc: string) => void | Promise<void>;
}

export function NoteEditor(props: NoteEditorProps): ReactElement {
  const { taskId, canWrite } = props;
  const halter = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  /** Hochgezählt bei jeder Transaktion, damit die Menüs neu lesen. */
  const [stand, setStand] = useState(0);
  const [ganzeHoehe, setGanzeHoehe] = useState(() => {
    try {
      return localStorage.getItem(HOEHE_SCHLUESSEL) === 'voll';
    } catch {
      // Privates Fenster, gesperrter Speicher: dann eben die Vorgabe.
      return false;
    }
  });
  const [bildwahl, setBildwahl] = useState(false);

  /*
   * Die Eigenschaften über einen Ref.
   *
   * Der Editor wird EINMAL gebaut (siehe unten), die Leute und die Anhänge
   * kommen danach und ändern sich weiter. Ein Abschluss über den ersten Wert
   * böte für den Rest der Sitzung die Liste an, die beim Öffnen galt — SONEs
   * ADR-0052 hat dasselbe Loch schon einmal gestopft.
   */
  const aktuell = useRef(props);
  aktuell.current = props;

  const offen = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Speichern — jetzt.
   *
   * Nicht nur beim Verlassen des Feldes: ein Editor, den man zwanzig Minuten
   * füllt, darf seine Arbeit nicht am Tab-Schließen hängen haben. Also nach
   * zwei Sekunden Ruhe, beim Verlassen und beim Abbau.
   */
  const speichern = (v: EditorView, ydoc: Y.Doc): void => {
    if (offen.current !== null) {
      clearTimeout(offen.current);
      offen.current = null;
    }
    void aktuell.current.onSave(
      noteText(v.state.doc),
      base64From(Y.encodeStateAsUpdate(ydoc)),
    );
  };

  useEffect(() => {
    const ziel = halter.current;
    if (ziel === null) return;

    const ydoc = new Y.Doc();
    if (props.noteDoc !== null) {
      try {
        Y.applyUpdate(ydoc, bytesFrom(props.noteDoc));
      } catch {
        // Ein unlesbares Dokument ist kein Grund, die Notiz zu verlieren: unten
        // steht dann der Klartext, und der ist gespeichert.
      }
    }
    const fragment = ydoc.getXmlFragment('notiz');

    /*
     * Die Wanderung der alten Notiz — hier und nicht in einem Massenlauf.
     *
     * Wer eine Aufgabe nie öffnet, behält sie unverändert; und wer sie öffnet,
     * sieht seinen Text als Absätze und nicht ein leeres Feld über einer Notiz,
     * die es noch gibt. Gespeichert wird die Wanderung erst mit der ersten
     * Änderung — Öffnen allein schreibt nichts.
     */
    if (fragment.length === 0) {
      if (props.note.trim() !== '') jsonToFragment(docFromPlainText(props.note), fragment);
      else seedEmptyPage(fragment);
    }

    const hochladen: ImageUploader | undefined =
      aktuell.current.uploadImage === undefined
        ? undefined
        : async (datei: File) => {
            const { fileId, filename } = await aktuell.current.uploadImage!(datei);
            aktuell.current.onFilesChanged?.();
            return { url: aktuell.current.fileHref?.(fileId) ?? '', filename };
          };

    const erzeugt = createEditor(ziel, {
      fragment,
      editable: () => aktuell.current.canWrite,
      onChange: () => {
        if (offen.current !== null) clearTimeout(offen.current);
        offen.current = setTimeout(() => speichern(erzeugt, ydoc), RUHE_MS);
      },
      onStateChange: () => setStand((n) => n + 1),
      ...(hochladen ? { uploadImage: hochladen } : {}),
      localiseSlashItem: (item) => ({
        ...item,
        ...(SLASH_DEUTSCH[item.id] ?? {}),
        keywords: [...item.keywords, ...(SLASH_DEUTSCH[item.id]?.keywords ?? [])],
      }),
    });
    setView(erzeugt);

    /*
     * Beim Verlassen speichern, aber nicht bei jedem Klick INNERHALB.
     *
     * `focusout` feuert auch, wenn der Fokus in ein Menü dieses Editors geht.
     * Darum die Frage nach dem neuen Ziel: liegt es noch in der Notiz, ist
     * nichts verlassen worden.
     */
    const raus = (e: FocusEvent): void => {
      const nach = e.relatedTarget;
      if (nach instanceof Node && ziel.contains(nach)) return;
      speichern(erzeugt, ydoc);
    };
    ziel.addEventListener('focusout', raus);
    /* Und wenn der Tab weggeht: dasselbe, ohne auf die Ruhe zu warten. */
    const versteckt = (): void => {
      if (document.visibilityState === 'hidden') speichern(erzeugt, ydoc);
    };
    document.addEventListener('visibilitychange', versteckt);

    return () => {
      ziel.removeEventListener('focusout', raus);
      document.removeEventListener('visibilitychange', versteckt);
      if (offen.current !== null) {
        // Ausstehende Arbeit geht noch raus. Ein Abbau ist der Wechsel auf eine
        // andere Aufgabe, und der darf die letzten Sätze nicht verschlucken.
        speichern(erzeugt, ydoc);
      }
      erzeugt.destroy();
      ydoc.destroy();
      setView(null);
    };
    // Bewusst NUR an der Aufgabe: ein Nachladen im Hintergrund (`useNudge`)
    // darf den Editor nicht neu bauen, während jemand darin schreibt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    try {
      localStorage.setItem(HOEHE_SCHLUESSEL, ganzeHoehe ? 'voll' : 'normal');
    } catch {
      /* dann wird sie eben nicht gemerkt */
    }
  }, [ganzeHoehe]);

  const bilder = props.images;

  /** Ein schon angehängtes Bild an die Schreibmarke setzen. */
  const einsetzen = (fileId: string, filename: string): void => {
    setBildwahl(false);
    const url = props.fileHref?.(fileId);
    const typ = schema.nodes['image'];
    if (view === null || url === undefined || typ === undefined) return;
    const tr = view.state.tr.replaceSelectionWith(typ.create({ url, alt: filename }));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  return (
    <div className="note-editor" data-full={ganzeHoehe ? 'true' : 'false'}>
      {canWrite ? (
        <div className="note-tools">
          <button
            type="button"
            className="note-tool"
            onClick={() => setBildwahl((offen) => !offen)}
            disabled={bilder.length === 0}
            title={
              bilder.length === 0
                ? 'Noch kein Bild an dieser Aufgabe — im Reiter Bilder eines anhängen'
                : 'Ein angehängtes Bild in den Text setzen'
            }
            aria-expanded={bildwahl}
          >
            <ImageIcon size={14} /> Bild einfügen
          </button>
          <button
            type="button"
            className="note-tool"
            onClick={() => setGanzeHoehe((voll) => !voll)}
            title={ganzeHoehe ? 'Wieder mitwachsen lassen' : 'Die ganze Spalte nehmen'}
            aria-pressed={ganzeHoehe}
          >
            {ganzeHoehe ? <MinimiseIcon size={14} /> : <MaximiseIcon size={14} />}
            {ganzeHoehe ? 'Kleiner' : 'Volle Höhe'}
          </button>
        </div>
      ) : null}

      {bildwahl ? (
        <div className="note-images" role="listbox" aria-label="Angehängte Bilder">
          {bilder.map((bild) => (
            <button
              type="button"
              key={bild.id}
              className="note-image-choice"
              role="option"
              aria-selected="false"
              onClick={() => einsetzen(bild.id, bild.filename)}
            >
              <img src={props.fileHref?.(bild.id, 'web')} alt="" />
              <span>{bild.filename}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Der Editor hängt sich hier hinein. Kein `key` an der Aufgabe: das
          Abräumen macht der Effekt, und React darf dieses Element nicht unter
          ProseMirror wegtauschen. */}
      <div className="note-surface" ref={halter} />

      {view !== null && canWrite ? (
        <>
          <SlashMenu
            view={view}
            revision={stand}
            onPickImage={() => {
              if (bilder.length > 0) setBildwahl(true);
              else waehleDatei(view, aktuell.current);
            }}
          />
          <MentionMenu view={view} revision={stand} people={props.people} />
        </>
      ) : null}
    </div>
  );
}

const HOEHE_SCHLUESSEL = 'sote.noteFullHeight';

/**
 * Ein Bild vom Gerät holen, wenn noch keines an der Aufgabe hängt.
 *
 * Der Wähler wird hier gebaut und nicht als verstecktes `<input>` in den Baum
 * gestellt: ein Element, das mit dem Menü verschwindet, hört seinen eigenen
 * change-Ereignis nicht mehr — in SONE war genau das „der Wähler geht auf, man
 * wählt ein Bild, und nichts passiert".
 */
function waehleDatei(view: EditorView, props: NoteEditorProps): void {
  if (props.uploadImage === undefined) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const datei = input.files?.[0];
    if (datei === undefined) return;
    insertImageUpload(view, datei, async (f) => {
      const { fileId, filename } = await props.uploadImage!(f);
      props.onFilesChanged?.();
      return { url: props.fileHref?.(fileId) ?? '', filename };
    });
  });
  input.click();
}

/**
 * Die Einträge des `/`-Menüs auf Deutsch.
 *
 * Der Satz kommt aus dem Editor-Paket auf Englisch — es ist SONEs, und SONE
 * spricht mehrere Sprachen. SOTE spricht eine. Die englischen Schlagwörter
 * bleiben zusätzlich stehen: „h1", „ul" und „todo" tippt man in jeder Sprache.
 */
const SLASH_DEUTSCH: Record<string, { title: string; hint: string; keywords: string[] }> = {
  paragraph: { title: 'Text', hint: 'Ein gewöhnlicher Absatz', keywords: ['text', 'absatz'] },
  'heading-1': { title: 'Überschrift 1', hint: 'Die größte', keywords: ['überschrift', 'titel'] },
  'heading-2': { title: 'Überschrift 2', hint: 'Die mittlere', keywords: ['überschrift', 'titel'] },
  'heading-3': { title: 'Überschrift 3', hint: 'Die kleinste', keywords: ['überschrift', 'titel'] },
  bulletList: { title: 'Aufzählung', hint: 'Punkte ohne Reihenfolge', keywords: ['liste', 'punkte'] },
  numberedList: { title: 'Nummerierte Liste', hint: 'Schritte der Reihe nach', keywords: ['liste', 'nummern'] },
  todo: { title: 'Kästchen', hint: 'Zum Abhaken im Text', keywords: ['aufgabe', 'haken', 'checkliste'] },
  toggle: { title: 'Klappe', hint: 'Zugeklappt, bis jemand hineinsieht', keywords: ['klappe', 'ausklappen'] },
  quote: { title: 'Zitat', hint: 'Fremde Worte, abgesetzt', keywords: ['zitat'] },
  callout: { title: 'Hinweis', hint: 'Ein Kasten, der auffällt', keywords: ['hinweis', 'kasten'] },
  code: { title: 'Code', hint: 'Feste Breite, keine Auszeichnung', keywords: ['code', 'quelltext'] },
  image: { title: 'Bild', hint: 'Angehängt oder vom Gerät', keywords: ['bild', 'foto'] },
  table: { title: 'Tabelle', hint: 'Zeilen und Spalten', keywords: ['tabelle'] },
  divider: { title: 'Trenner', hint: 'Ein Strich zwischen zwei Teilen', keywords: ['trenner', 'linie'] },
  'callout-note': { title: 'Hinweis', hint: 'Neutral, einfach abgesetzt', keywords: ['hinweis'] },
  'callout-info': { title: 'Info', hint: 'Zur Kenntnis', keywords: ['info'] },
  'callout-tip': { title: 'Tipp', hint: 'Macht es leichter', keywords: ['tipp'] },
  'callout-warning': { title: 'Warnung', hint: 'Vorsicht damit', keywords: ['warnung', 'achtung'] },
  'callout-error': { title: 'Fehler', hint: 'Das ist schiefgegangen', keywords: ['fehler'] },
  'callout-alarm': { title: 'Alarm', hint: 'Dringend', keywords: ['alarm', 'dringend'] },
  'callout-exclaim': { title: 'Ausruf', hint: 'Nicht zu übersehen', keywords: ['ausruf', 'wichtig'] },
  'callout-question': { title: 'Frage', hint: 'Offen, zu beantworten', keywords: ['frage'] },
  'callout-success': { title: 'Erledigt', hint: 'Hat geklappt', keywords: ['erledigt', 'geschafft'] },
  'callout-memo': { title: 'Merkzettel', hint: 'Eine Randnotiz', keywords: ['merkzettel', 'notiz'] },
  'callout-example': { title: 'Beispiel', hint: 'So sieht es in echt aus', keywords: ['beispiel'] },
  'callout-quote': { title: 'Zitatkasten', hint: 'Ein Zitat als Kasten', keywords: ['zitat'] },
};
