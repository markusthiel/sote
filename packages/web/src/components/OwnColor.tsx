/**
 * SOTE — eine eigene Farbe wählen, überall gleich.
 *
 * GEMELDET: „Ein farbiger Pinsel hatten wir bei SONE. Prüf das mal an allen
 * Bereichen noch und passe es an."
 *
 * Es ist eine **Pipette**, und SONEs Begründung steht dort im Quelltext:
 *
 *   „A pipette rather than another circle. Nine circles say 'one of these'; a
 *    tenth would say the same and mean something else. The pipette says a
 *    colour is picked here, and it carries the chosen one so it still reads as
 *    a swatch."
 *
 * Genau der Fehler, den ich davor gebaut hatte: ein neunter Kreis hinter acht
 * Kreisen. Mein Farbkreis-Verlauf war die halbe Korrektur — er sagte „hier
 * wird gewählt", aber er sagte es in der Sprache der Palette und nicht in der
 * des Werkzeugs.
 *
 * ## Das Feld liegt UNTER dem Zeichen und ist unsichtbar
 *
 * Auch das von SONE: „The input covers the label and is invisible: the
 * platform's own picker opens, which is the part worth keeping, without its
 * chrome deciding the shape."
 *
 * Ein `input[type=color]` sieht in jedem Browser anders aus — als Kästchen, als
 * Kreis, mit Rand, ohne. Sichtbar ist darum unser Zeichen; das Feld deckt es
 * ab und fängt den Klick. Der Farbwähler des Betriebssystems, den jeder kennt,
 * öffnet trotzdem.
 *
 * ## Ein Bauteil und nicht fünf Abschriften
 *
 * Es gibt fünf Stellen: Arbeitsbereich (zweimal), Projektbaum, Akzentfarbe,
 * Fertig-Spalte der Tafel, Aufgabe und Schlagwort. Genau diese Streuung hat
 * dazu geführt, dass die Pipette überhaupt erst an einer Stelle fehlte und
 * danach an allen anders aussah.
 */

import { Pipette } from 'lucide-react';

/** Ob ein Wert eine eigene Farbe ist — also ein Hex-Wert und kein Palettenname. */
export const isOwnColor = (value: string | undefined): value is `#${string}` =>
  value?.startsWith('#') === true;

export function OwnColor({
  value,
  disabled,
  label = 'eigene Farbe',
  onPick,
  onShow,
}: {
  /** Die aktuelle Farbe — ein Palettenname zählt hier als „keine eigene". */
  value: string | undefined;
  disabled?: boolean;
  /** Wofür, für die Vorlesehilfe: „Akzentfarbe: eigene Farbe". */
  label?: string;
  /** Beim Bestätigen: hier wird geschrieben. */
  onPick: (color: string) => void;
  /**
   * Beim Ziehen, falls die Stelle es zeigen will.
   *
   * Ein Farbfeld schickt beim Ziehen laufend `input` und `change` erst beim
   * Bestätigen. Wer jedes Zwischenbild schreibt, hat einen Schreibvorgang je
   * Mausbewegung — darum sind es zwei Ereignisse und nicht eines.
   */
  onShow?: (color: string) => void;
}) {
  const eigen = isOwnColor(value);
  return (
    <label
      className={eigen ? 'block-menu-swatch custom current' : 'block-menu-swatch custom'}
      title={label}
      /*
       * Die Farbe steht am LABEL und nicht am Zeichen.
       *
       * Beide sollen sie tragen: das Zeichen und der Rand. Am Zeichen allein
       * blieb der Rand in der Textfarbe — im Bild ein grauer Ring um eine
       * farbige Pipette, was aussieht, als wäre die Wahl nicht angekommen.
       * `currentColor` im Rand erledigt es, sobald die Farbe hier steht.
       */
      {...(eigen ? { style: { color: value } } : {})}
    >
      {/* Das Zeichen trägt die gewählte Farbe: dann ist es zugleich Werkzeug
          und Anzeige — es sagt „hier wird gewählt" UND „das ist gewählt". */}
      <Pipette size={15} strokeWidth={1.75} aria-hidden="true" />
      <input
        type="color"
        aria-label={label}
        /*
          Nur ein Hex-Wert taugt hier. `colorValue` gäbe für einen Palettennamen
          `var(--sote-palette-…)` zurück, und ein Farbfeld mit einem `var()`
          darin zeigt schwarz — der Übersetzer merkt das nicht, der Browser sagt
          nichts, und man sieht es erst im Bild.
        */
        value={eigen ? value : '#888888'}
        disabled={disabled}
        {...(onShow === undefined
          ? {}
          : { onInput: (e: React.FormEvent<HTMLInputElement>) => onShow(e.currentTarget.value) })}
        onChange={(e) => onPick(e.target.value)}
      />
    </label>
  );
}
