/**
 * SOTE — Zeichen und Farbe wählen, an einer Stelle.
 *
 * GEWÜNSCHT: „Ein Icon, das dann vor dem Titel angezeigt wird" — und die Farbe
 * dazu, mehrstufig: Projekt, Schlagwort, Aufgabe.
 *
 * ## Warum ein eigenes Bauteil
 *
 * Denselben Wähler braucht es an drei Stellen: an der Aufgabe (Zeichen und
 * Farbe), am Schlagwort (nur Farbe) und — schon vorhanden — am Projekt. Drei
 * Abschriften wären drei Gelegenheiten, die Pipette an einer davon zu
 * vergessen; genau das ist bei den Farbwählern schon einmal passiert und
 * musste nachgezogen werden.
 *
 * Das Projekt bleibt vorerst bei seinem eigenen Wähler im Baum: der steckt in
 * einem Menü mit anderer Geometrie, und ihn hierher zu ziehen wäre ein Umbau
 * an einer Stelle, die funktioniert. Die REGELN sind dieselben und stehen im
 * Kern — das ist die Einigkeit, auf die es ankommt.
 *
 * ## Der ganze Zeichensatz, stückweise
 *
 * `loadIcons` holt ihn erst, wenn jemand ihn braucht (1018 KB), und
 * `useProgressive` zeichnet die Treffer in Stücken — 2080 Knöpfe auf einmal
 * waren gemessen 1690 ms auf einem gedrosselten Gerät. Beides aus dem
 * Projektbaum übernommen, wo es schon gelernt wurde.
 */

import { colorValue, PALETTE } from '@sote/core';
import { useEffect, useMemo, useState } from 'react';

import { useProgressive } from '../hooks/useProgressive.js';
import { iconsFor, IconPreview, loadIcons } from './ProjectMark.js';

export function LookPicker({
  icon,
  color,
  busy,
  withIcon = true,
  onIcon,
  onColor,
}: {
  icon: string | undefined;
  color: string | undefined;
  busy?: boolean;
  /** Ein Schlagwort trägt nur eine Farbe — dort fehlt der Zeichenteil. */
  withIcon?: boolean;
  onIcon: (name: string | null) => void;
  onColor: (color: string | null) => void;
}) {
  const [find, setFind] = useState('');
  const [ready, setReady] = useState(false);
  const [eigen, setEigen] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!withIcon) return;
    void loadIcons().then(() => setReady(true));
  }, [withIcon]);

  const alle = useMemo(() => (ready ? iconsFor(find) : []), [find, ready]);
  const shown = useProgressive(alle);

  return (
    <div className="look-pick">
      <div className="block-menu-swatches">
        {/* „ohne“ zuerst: es ist die eine Wahl, die keine Farbe hat und sonst
            zwischen acht Farben verschwindet. */}
        <button
          type="button"
          className="block-menu-swatch none"
          aria-label="ohne Farbe"
          aria-current={color === undefined}
          disabled={busy}
          onClick={() => onColor(null)}
        />
        {PALETTE.map((name) => (
          <button
            key={name}
            type="button"
            className="block-menu-swatch"
            aria-label={name}
            aria-current={color === name}
            disabled={busy}
            style={{ '--tag-color': colorValue(name) } as React.CSSProperties}
            onClick={() => onColor(name)}
          />
        ))}
        {/*
          Und eine EIGENE Farbe — wie überall sonst, und ausdrücklich gewünscht:
          „Denk daran, wieder eine eigene Farbe wählbar zu machen und nicht nur
          die Standardfarben."

          `onInput` zeigt, `onChange` speichert: ein Farbfeld schickt beim
          Ziehen laufend `input` und `change` erst beim Bestätigen. Ohne die
          Trennung wäre jede Mausbewegung ein Schreibvorgang.
        */}
        <input
          type="color"
          className="own-color"
          aria-label="eigene Farbe"
          value={eigen ?? (color?.startsWith('#') === true ? color : '#888888')}
          disabled={busy}
          onInput={(e) => setEigen(e.currentTarget.value)}
          onChange={(e) => onColor(e.currentTarget.value)}
        />
      </div>

      {!withIcon ? null : (
        <>
          <input
            className="entry-icon-search"
            value={find}
            /* Die Namen kommen aus Lucide und sind englisch. Ein deutsches
               Beispiel im Platzhalter schlüge eine Eingabe vor, die ins Leere
               läuft — dieselbe Falle wie im Projektbaum, dort schon
               getreten. */
            placeholder="Zeichen suchen — phone, car, home"
            aria-label="Zeichen suchen"
            disabled={busy}
            onChange={(e) => setFind(e.target.value)}
          />
          <div className="entry-icon-grid">
            <button
              type="button"
              className="entry-icon"
              aria-label="ohne Zeichen"
              aria-current={icon === undefined}
              disabled={busy}
              onClick={() => onIcon(null)}
            >
              <span aria-hidden="true">–</span>
            </button>
            {shown.map((n) => (
              <button
                key={n}
                type="button"
                className="entry-icon"
                aria-label={n}
                title={n}
                aria-current={icon === n}
                disabled={busy}
                onClick={() => onIcon(n)}
              >
                <IconPreview name={n} />
              </button>
            ))}
          </div>
          {!ready ? <p className="muted small">Zeichen werden geladen…</p> : null}
        </>
      )}
    </div>
  );
}
