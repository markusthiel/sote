/**
 * SOTE — ein PDF lesen, statt es dem Browser zu überlassen.
 *
 * GEMELDET: „Da geht jetzt vermutlich der Browser-Player auf. Das Problem
 * hatten wir auch bei SONE. Auf iPad und iPhone klappt es nicht so gut, weil
 * man mehrere Seiten nicht durchscrollen konnte … Wir hatten dann PDF.js
 * eingebaut und die Optik noch angepasst."
 *
 * Genau dieselbe Erfahrung, und darum dieselbe Antwort: pdf.js zeichnet die
 * Seiten, alles drumherum ist unseres — eine rollende Spalte aus Bildflächen
 * mit einer eigenen Leiste darüber.
 *
 * ## Nicht SONEs Betrachter, sondern sein Verfahren
 *
 * SONEs `pdfViewer.ts` hat 932 Zeilen, weil dort Kommentare, Markierungen und
 * das Brennen einer markierten Kopie darin hängen. Das gibt es in SOTE nicht,
 * und den Apparat dafür mitzunehmen hiesse, Abhängigkeiten auf Dinge zu
 * schleppen, die hier keine Bedeutung haben. Übernommen sind die
 * Entscheidungen, die dort teuer waren:
 *
 * - **Der Motor wird ERST BEIM ÖFFNEN geholt** (`import()` im Rumpf). Ein
 *   halbes Megabyte darf nicht bei jemandem landen, der nie ein PDF öffnet.
 * - **Eine Seite wird gezeichnet, wenn sie in die Nähe kommt**, nicht alle auf
 *   einmal: ein Prospekt mit vierzig Seiten wäre sonst vierzig Bildflächen in
 *   voller Auflösung.
 * - **`devicePixelRatio` gehört in die Rechnung.** Ohne ihn ist jede Seite auf
 *   einem guten Bildschirm unscharf — und Unschärfe sieht nach schlechtem
 *   Scan aus, nicht nach falscher Skalierung.
 *
 * ## Warum überhaupt selbst zeichnen
 *
 * Der eingebaute Betrachter kann auf dem iPad nicht durch mehrere Seiten
 * rollen — das war die Meldung, bei SONE wie hier. Und er bringt seine eigene
 * Leiste mit, in ein Fenster, dessen Aussehen abgestimmt ist.
 */

import { useEffect, useRef, useState } from 'react';

/** Wie weit vor dem Sichtfeld eine Seite schon gezeichnet wird. */
const NEAR = '600px';
const MAX_SCALE = 3;
const MIN_SCALE = 0.5;

export function PdfViewer({ src, filename }: { src: string; filename: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [seiten, setSeiten] = useState(0);
  const [seite, setSeite] = useState(1);
  /**
   * Was schiefging — als SATZ und nicht als Ja/Nein.
   *
   * GEMELDET, dreimal hintereinander: „PDF lässt sich nicht öffnen." Zweimal
   * habe ich eine Ursache gefunden und behoben, und beide Male war es nicht
   * die richtige — weil meine Meldung keine Auskunft gab, sondern nur eine
   * Feststellung.
   *
   * Ein Fehler, den man nur bei sich selbst sieht, ist für jeden anderen eine
   * Behauptung. Also steht der Grund jetzt da, wo er entsteht: im Fenster, in
   * dem er gemeldet wird.
   */
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    const ziel = box.current;
    if (ziel === null) return undefined;

    let weg = false;
    const aufraeumen: (() => void)[] = [];

    void (async () => {
      try {
        /*
         * Beide Teile dynamisch, und der Arbeiter als URL: pdf.js rechnet in
         * einem eigenen Faden, und ohne ihn steht die Oberfläche still,
         * während eine Seite entsteht.
         *
         * DIE `legacy`-FASSUNG, und das ist kein Vorsichtsmass, sondern eine
         * Messung: die gewöhnliche benutzt `Map.prototype.getOrInsertComputed`
         * — eine Sprachfunktion aus 2025, die es in Firefox und Safari noch
         * nicht gibt und in Chrome erst seit kurzem. Im Browser kam genau das
         * heraus: „TypeError: getOrInsertComputed is not a function", und
         * nach aussen „Dieses PDF liess sich nicht öffnen".
         *
         * `legacy` ist dieselbe Fassung, übersetzt auf älteren Sprachstand.
         * Sie kostet etwas mehr Umfang und ist die einzige, die überall
         * zeichnet.
         */
        const [pdfjs, { default: PdfWorker }] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
        ]);
        if (weg) return;
        /*
         * Der Arbeiter wird VOM BÜNDLER gebaut und selbst gestartet, statt
         * pdf.js eine Adresse zu geben.
         *
         * GEMELDET, mit der Meldung, auf die ich gewartet habe: „Setting up
         * fake worker failed: Failed to fetch dynamically imported module:
         * …/assets/pdf.worker.min-….mjs".
         *
         * Also kam die Datei nicht durch. Der Grund ist die Endung: der
         * Bündler reicht sie über `?url` als `.mjs` durch, und ein Server, der
         * `.mjs` nicht kennt, liefert `application/octet-stream` — womit der
         * Browser den Import ABLEHNT. Ich habe die Endung im Dateiserver
         * ergänzt (Commit davor), und das ist richtig; es hilft aber nur, wenn
         * auch der Server neu gebaut wird, und es bleibt eine Abhängigkeit von
         * einer Tabelle irgendwo anders.
         *
         * `?worker` nimmt sie weg: der Bündler macht daraus ein eigenes Stück
         * mit der Endung `.js` — die jeder Server kennt, auch der alte — und
         * gibt eine Klasse zurück, die den Arbeiter startet. Damit hängt der
         * Betrachter an niemandes Typentabelle mehr.
         *
         * `workerPort` statt `workerSrc`: wir haben den Arbeiter schon, pdf.js
         * soll ihn benutzen und keinen zweiten suchen.
         */
        pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

        /*
         * `withCredentials`: der Anhang liegt hinter der Sitzung, und der
         * Motor holt ihn selbst — ohne das kommt eine 401 zurück und der
         * Betrachter zeigt „ging nicht" für eine Datei, die es gibt.
         */
        const task = pdfjs.getDocument({ url: src, withCredentials: true });
        aufraeumen.push(() => void task.destroy());

        const doc = await task.promise;
        if (weg) return;
        setSeiten(doc.numPages);

        /*
         * Erst die Flächen, dann das Zeichnen.
         *
         * Jede Seite bekommt sofort ihre ENDGÜLTIGE Grösse (aus der Vorschau
         * bei Massstab 1), auch wenn noch nichts darin steht. Sonst wächst die
         * Spalte, während man rollt, und die Stelle, die man gerade liest,
         * wandert weg.
         */
        /*
         * Welche Seiten gerade zu sehen sind — und angezeigt wird die ERSTE.
         *
         * Der erste Wurf schrieb einfach jede Seite hin, die hereinkam. Im
         * Bild stand darum „Seite 2 von 2", während man noch die erste las:
         * beide waren sichtbar, und die zweite kam zuletzt. Wo man IST, ist
         * die oberste sichtbare Seite.
         */
        const sichtbar = new Set<number>();
        const beobachter = new IntersectionObserver(
          (eintraege) => {
            for (const e of eintraege) {
              const nr = Number((e.target as HTMLElement).dataset['page']);
              if (e.isIntersecting) {
                sichtbar.add(nr);
                void zeichne(nr, e.target as HTMLCanvasElement);
              } else {
                sichtbar.delete(nr);
              }
            }
            if (sichtbar.size > 0) setSeite(Math.min(...sichtbar));
          },
          {
            root: ziel,
            /*
             * Zwei Beobachter wären sauberer und sind es nicht wert: DERSELBE
             * Rand entscheidet über „zeichnen" und „hier bin ich". 600 px
             * voraus zu zeichnen ist richtig; 600 px voraus als Standort zu
             * melden wäre es nicht — darum steht der Rand nur unten, wo er
             * dem Zeichnen dient, und oben bei null.
             */
            rootMargin: `0px 0px ${NEAR} 0px`,
          },
        );
        aufraeumen.push(() => beobachter.disconnect());

        const gezeichnet = new Set<number>();
        const zeichne = async (nr: number, leinwand: HTMLCanvasElement) => {
          if (gezeichnet.has(nr) || weg) return;
          gezeichnet.add(nr);
          const page = await doc.getPage(nr);
          if (weg) return;
          const dpr = window.devicePixelRatio || 1;
          const view = page.getViewport({ scale: scale * dpr });
          leinwand.width = Math.floor(view.width);
          leinwand.height = Math.floor(view.height);
          const ctx = leinwand.getContext('2d');
          if (ctx === null) return;
          await page.render({ canvasContext: ctx, viewport: view, canvas: leinwand })
            .promise;
        };

        for (let nr = 1; nr <= doc.numPages; nr += 1) {
          const page = await doc.getPage(nr);
          if (weg) return;
          const view = page.getViewport({ scale });
          const leinwand = document.createElement('canvas');
          leinwand.className = 'pdf-page';
          leinwand.dataset['page'] = String(nr);
          leinwand.style.inlineSize = `${Math.floor(view.width)}px`;
          leinwand.style.blockSize = `${Math.floor(view.height)}px`;
          ziel.append(leinwand);
          beobachter.observe(leinwand);
        }
      } catch (e) {
        if (weg) return;
        /*
         * Auch in die Konsole: die Meldung im Fenster ist für den Menschen
         * davor, der Eintrag in der Konsole für den, der sie weitergibt. Ein
         * abgefangener Fehler, der nirgends landet, ist ein Fehler, den es für
         * die Fehlersuche nicht gibt — und genau daran habe ich zweimal
         * vorbeigesucht.
         */
        console.error('PDF-Betrachter:', e);
        setFehler(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      }
    })();

    return () => {
      weg = true;
      for (const f of aufraeumen) f();
      ziel.replaceChildren();
    };
    // `scale` gehört dazu: eine andere Vergrösserung heisst neu zeichnen, und
    // das ist derselbe Weg wie beim ersten Mal.
  }, [src, scale]);

  if (fehler !== null) {
    return (
      <div className="pdf-fallback">
        {/*
          DER EIGENE BETRACHTER IST NICHT DIE EINZIGE MÖGLICHKEIT.

          Scheitert er, kann der Browser es immer noch selbst — schlechter (auf
          dem iPad rollt er nicht durch mehrere Seiten, das war der Anlass für
          den eigenen), aber besser als nichts. Ein Fehlschlag soll die Datei
          nicht unerreichbar machen.

          Der GRUND steht darüber, klein und in Schmalschrift. Ohne ihn ist
          jede Meldung von aussen „geht nicht", und daran habe ich mich zweimal
          abgearbeitet.
        */}
        <p className="muted small">
          Der eigene Betrachter kam nicht durch — hier die Anzeige des Browsers.
          <br />
          <code className="pdf-why">{fehler}</code>
        </p>
        <object data={src} type="application/pdf">
          <p className="muted small">
            Auch der Browser zeigt es nicht an.{' '}
            <a href={src} download={filename}>
              Herunterladen
            </a>
          </p>
        </object>
      </div>
    );
  }

  return (
    <div className="pdf">
      {/*
        Die eigene Leiste: Seitenstand und Vergrösserung.

        Sie sagt, wo man ist, und das kann der eingebaute Betrachter in einem
        eingebetteten Rahmen nicht — eben das war die Meldung.
      */}
      <div className="pdf-bar">
        <span className="pdf-count">
          Seite {seite} von {seiten === 0 ? '…' : seiten}
        </span>
        <span className="pdf-zoom">
          <button
            type="button"
            className="btn quiet small"
            aria-label="Kleiner"
            disabled={scale <= MIN_SCALE}
            onClick={() => setScale((s) => Math.max(MIN_SCALE, Math.round((s - 0.25) * 100) / 100))}
          >
            −
          </button>
          <span className="pdf-scale">{Math.round(scale * 100)} %</span>
          <button
            type="button"
            className="btn quiet small"
            aria-label="Größer"
            disabled={scale >= MAX_SCALE}
            onClick={() => setScale((s) => Math.min(MAX_SCALE, Math.round((s + 0.25) * 100) / 100))}
          >
            +
          </button>
        </span>
      </div>
      {/* Die Seiten hängen hier drin — vom Motor gezeichnet, nicht von React:
          eine Bildfläche ist kein Baum aus Elementen, und React hätte an ihr
          nichts zu tun ausser sie zu halten. */}
      <div className="pdf-pages" ref={box} />
    </div>
  );
}
