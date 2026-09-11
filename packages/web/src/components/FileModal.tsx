/**
 * SOTE — einen Anhang ansehen, statt ihn herunterzuladen.
 *
 * GEWÜNSCHT: „Einen Button, um das Bild in einem Modal als Vorschau anzuzeigen.
 * Und das gilt auch für alle anderen Anhänge. PDF, Bilder, Text, so viele wie
 * möglich mit Unterstützung, sie direkt anzuzeigen, anstatt nur herunterzuladen.
 * Und ein direkter Download-Button. Standard anklicken wäre dann eher das
 * Modal."
 *
 * ## Was angezeigt werden kann, und was nicht
 *
 * Bilder und PDF kann der Browser selbst — er braucht nur ein Element, in dem
 * sie stehen dürfen. Text muss geholt werden, weil er als `<iframe>` eine
 * eigene Seite wäre und als `<img>` gar nichts.
 *
 * Alles andere bekommt KEINE Notlösung. Ein Word-Dokument in einem `<iframe>`
 * zeigt in den meisten Browsern eine leere Fläche oder bietet selbst einen
 * Download an — und eine leere Fläche ist eine schlechtere Auskunft als der
 * Satz „das lässt sich hier nicht zeigen".
 *
 * ## Text wird GEHOLT und nicht eingebettet
 *
 * Ein `<iframe src="/api/…">` mit einer Textdatei rendert sie als Dokument —
 * inklusive dessen, was der Browser darin für HTML hält. Die Datei kommt von
 * einem Mitglied dieses Arbeitsbereichs, aber sie liefe unter unserer Adresse,
 * und damit wäre jedes hochgeladene `.txt` mit einem `<script>` darin ein Weg
 * in die Sitzung. Geholt und in ein `<pre>` gelegt ist Text Text.
 *
 * Gedeckelt, weil eine Protokolldatei auch 40 MB haben kann: was darüber liegt,
 * wird abgeschnitten und gesagt.
 */

import { useEffect, useState } from 'react';

/** Wie viel Text höchstens gezeigt wird, bevor abgeschnitten wird. */
const MAX_TEXT = 200_000;

export type FileKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'other';

/**
 * Woran erkannt wird, was etwas ist.
 *
 * Am MIME-Typ und nicht an der Endung: die Endung sagt, wie die Datei hiess,
 * als sie jemand hochgeladen hat, der Typ sagt, was der Server ausliefert —
 * und danach richtet sich der Browser.
 *
 * `application/json`, `text/csv` und Konsorten sind Text, auch wenn ihr Typ
 * nicht mit `text/` anfängt. Ohne die Liste wäre ein hochgeladenes JSON das
 * einzige, was man nicht ansehen kann, obwohl es die lesbarste Datei von allen
 * ist.
 */
export function kindOf(mimeType: string): FileKind {
  const t = mimeType.toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf') return 'pdf';
  /*
   * GEMELDET: „Videos können nicht angezeigt werden … Audio ebenfalls. Dafür
   * bitte Player."
   *
   * Der Browser bringt beide mit — `<video controls>` und `<audio controls>`
   * sind vollständige Abspieler, mit Lautstärke, Fortschritt und Vollbild. Es
   * gab sie hier nur nicht, weil die Liste sie nicht kannte.
   */
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (
    t.startsWith('text/') ||
    t === 'application/json' ||
    t === 'application/xml' ||
    t === 'application/x-yaml'
  ) {
    return 'text';
  }
  return 'other';
}

/**
 * Wie eine Datei GENANNT wird, in einem Wort.
 *
 * SONE schreibt in seiner Dateizeile „archive · 2.9 MB" — die Art zuerst, dann
 * die Größe. Das Wort sagt, was einen erwartet, bevor man klickt, und ist
 * kürzer als jede Endung es erklären könnte.
 *
 * Auf Deutsch, anders als bei SONE: SOTEs Oberfläche spricht Deutsch, und ein
 * einzelnes englisches Wort in einer deutschen Zeile ist keine Angleichung,
 * sondern ein Rest.
 */
export function kindName(mimeType: string): string {
  const art = kindOf(mimeType);
  if (art === 'image') return 'Bild';
  if (art === 'pdf') return 'PDF';
  if (art === 'text') return 'Text';
  if (art === 'video') return 'Video';
  if (art === 'audio') return 'Audio';
  const t = mimeType.toLowerCase();
  if (t.includes('zip') || t.includes('tar') || t.includes('compress')) return 'Archiv';
  return 'Datei';
}

export function FileModal({
  href,
  filename,
  mimeType,
  onClose,
}: {
  href: string;
  filename: string;
  mimeType: string;
  onClose: () => void;
}) {
  const art = kindOf(mimeType);
  /*
   * ZEIGEN statt speichern.
   *
   * Der Server liefert jeden Anhang mit `content-disposition: attachment` —
   * die richtige Vorgabe, denn eine hochgeladene HTML-Datei darf nicht im
   * Fenster dieser Anwendung laufen. `?inline=1` bittet um das Gegenteil und
   * bekommt es nur für Arten, die nichts ausführen können.
   *
   * Ein `<img>` braucht das nicht (es hält sich nicht an diese Kopfzeile) —
   * darum gingen Bilder von Anfang an und ein PDF nicht.
   */
  const zeigen = `${href}${href.includes('?') ? '&' : '?'}inline=1`;
  const [text, setText] = useState<string | undefined>(undefined);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    if (art !== 'text') return undefined;
    let weg = false;
    void fetch(href)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('nicht geladen'))))
      .then((t) => {
        if (!weg) setText(t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n…` : t);
      })
      .catch(() => {
        if (!weg) setFehler(true);
      });
    return () => {
      weg = true;
    };
  }, [href, art]);

  /*
   * Escape schliesst.
   *
   * Am Dokument und nicht am Kasten: der Kasten hat den Blick nicht
   * unbedingt — wer gerade auf das Bild darin geklickt hat, hat ihn auf einem
   * `<img>`, und das nimmt keine Tasten.
   */
  useEffect(() => {
    const auf = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', auf);
    return () => document.removeEventListener('keydown', auf);
  }, [onClose]);

  return (
    /*
     * Der Hintergrund schliesst, der Kasten nicht — darum hält er den Klick
     * auf. Ohne das schlösse jeder Klick im Kasten das Fenster, auch der auf
     * den Herunterladen-Knopf.
     */
    <div className="file-modal" role="dialog" aria-modal="true" aria-label={filename} onClick={onClose}>
      <div className="file-modal-box" onClick={(e) => e.stopPropagation()}>
        <header className="file-modal-head">
          <span className="file-modal-name">{filename}</span>
          {/*
            Herunterladen bleibt ERREICHBAR, auch wenn die Vorschau geht: die
            Vorschau beantwortet „was ist das", der Download „ich brauche es".
            Zwei Fragen, zwei Knöpfe.
          */}
          <a className="btn quiet small" href={href} download={filename}>
            Herunterladen
          </a>
          <button type="button" className="topbar-knob" aria-label="Schließen" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="file-modal-body">
          {art === 'image' ? (
            <img src={href} alt={filename} />
          ) : art === 'video' ? (
            /*
             * Die Abspieler des Browsers, mit allem, was sie mitbringen. Ein
             * eigener wäre mehr Arbeit und weniger Bedienung: Tastatur,
             * Vollbild, Geschwindigkeit und Untertitel sind dort schon drin.
             *
             * `preload="metadata"`: die Länge und das erste Bild reichen zum
             * Öffnen. Ein ganzes Video zu laden, das vielleicht niemand
             * abspielt, ist die teuerste Art, einen Kasten zu füllen.
             */
            <video src={zeigen} controls preload="metadata" />
          ) : art === 'audio' ? (
            <audio src={zeigen} controls preload="metadata" />
          ) : art === 'pdf' ? (
            /*
             * `<object>` und nicht `<iframe>`: es kennt einen Rückfall für den
             * Fall, dass der Browser kein PDF zeichnen kann, und der Rückfall
             * ist hier der einzige ehrliche — ein Link auf die Datei.
             */
            <object data={zeigen} type="application/pdf">
              <p className="muted small">
                Dieser Browser zeigt keine PDF an.{' '}
                <a href={href} download={filename}>
                  Herunterladen
                </a>
              </p>
            </object>
          ) : art === 'text' ? (
            fehler ? (
              <p className="muted small">Der Text ließ sich nicht laden.</p>
            ) : text === undefined ? (
              <p className="muted small">Wird geladen…</p>
            ) : (
              <pre className="file-modal-text">{text}</pre>
            )
          ) : (
            <p className="muted small">
              {/*
                Der Satz sagt, WARUM nicht, und bietet den Weg an, der geht.
                „Vorschau nicht verfügbar" allein liest sich wie ein Fehler.
              */}
              Diese Art Datei lässt sich hier nicht anzeigen — der Browser kann{' '}
              {mimeType} nicht selbst zeichnen.{' '}
              <a href={href} download={filename}>
                Herunterladen
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
