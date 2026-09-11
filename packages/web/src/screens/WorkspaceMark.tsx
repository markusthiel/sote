/**
 * SOTE — Name und Zeichen eines Arbeitsbereichs.
 *
 * Nach SONEs Bild: Name, Rolle, dann das Zeichen mit Suchfeld, Symbolfarbe und
 * **Namensfarbe**. Der Arbeitsbereich hat zwei Dinge zu färben, weil sein Name
 * sichtbar ist — anders als eine Projektzeile in der Seitenleiste.
 *
 * ## Der Name speichert beim Verlassen des Feldes
 *
 * Nicht bei jedem Tastendruck: das wären zwanzig Schreibvorgänge für ein Wort,
 * und jeder einzelne benennt den Arbeitsbereich für alle Mitglieder um. Dieselbe
 * Regel wie beim Titel einer Aufgabe (Konzept, Abschnitt 8).
 *
 * ## Die Rolle steht da und ist nicht änderbar
 *
 * Sie kommt aus `/api/me` und war bis vor kurzem als „Eigentümer" fest
 * eingetragen — richtig, solange es ein Konto je Arbeitsbereich gibt, und falsch
 * ab der ersten Einladung. Jetzt kommt sie aus der Antwort. Ändern kann man sie
 * hier nicht: das gehört zu „Leute", und den Bildschirm gibt es nicht.
 */

import { PALETTE } from '@sote/core';
import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api.js';
import { iconsFor, IconPreview, loadIcons, ProjectMark } from '../components/ProjectMark.js';
import { useProgressive } from '../hooks/useProgressive.js';

export function WorkspaceMark({
  name,
  owner,
  icon,
  workspace,
  onChanged,
}: {
  name: string;
  owner: boolean;
  icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
  workspace: string | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [find, setFind] = useState('');
  /*
   * Die laufende eigene Farbe, je Feld.
   *
   * Nur zum Anzeigen, während man im Farbfeld zieht: der gespeicherte Wert
   * kommt aus `icon`, und ein Feld, das seinen eigenen Zwischenstand nicht
   * kennt, springt beim Ziehen zurück.
   */
  const [eigen, setEigen] = useState<{ iconColor?: string; titleColor?: string }>({});
  const [ready, setReady] = useState(false);

  // Der Zeichensatz kommt, wenn dieser Bildschirm offen ist — nicht beim Laden
  // der Anwendung (siehe `ProjectMark.tsx`).
  useEffect(() => {
    void loadIcons().then(() => setReady(true));
  }, []);
  const alle = useMemo(() => (ready ? iconsFor(find) : []), [find, ready]);
  /*
   * Der ganze Satz, aber stückweise gezeichnet.
   *
   * 2080 Knöpfe auf einmal waren gemessen 1690 ms auf einem gedrosselten
   * Gerät. Weggelassen wird nichts — `useProgressive` erklärt, warum die
   * Antwort auf die Langsamkeit nicht wieder eine Vorauswahl sein durfte.
   */
  const shown = useProgressive(alle);

  async function save(body: Parameters<typeof api.patchWorkspace>[0]) {
    setBusy(true);
    setNotice(undefined);
    try {
      await api.patchWorkspace(body, workspace);
      onChanged();
    } catch (e) {
      setNotice(
        e instanceof ApiError
          ? e.code === 'not_allowed'
            ? 'Das darfst du hier nicht ändern.'
            : e.message
          : 'Speichern ging nicht.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** Ändert ein Feld des Zeichens und lässt die anderen stehen. */
  const setMark = (change: {
    icon?: string | null;
    iconColor?: string | null;
    titleColor?: string | null;
  }) => {
    const next: Record<string, string> = { ...(icon ?? {}) } as Record<string, string>;
    for (const [key, value] of Object.entries(change)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    void save({ icon: Object.keys(next).length === 0 ? null : next });
  };

  const swatches = (
    which: 'iconColor' | 'titleColor',
    label: string,
    current: string | undefined,
  ) => (
    <div className="settings-row">
      <span className="settings-row-label"><b>{label}</b></span>
      <div className="set-choice" role="radiogroup" aria-label={label}>
        <button
          type="button"
          role="radio"
          aria-checked={current === undefined}
          disabled={busy}
          onClick={() => setMark({ [which]: null })}
        >
          Wie entworfen
        </button>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            className="block-menu-swatch"
            aria-label={`${label}: ${c}`}
            aria-checked={current === c}
            disabled={busy}
            style={{ background: `var(--sote-palette-${c})` }}
            onClick={() => setMark({ [which]: c })}
          />
        ))}
        {/*
          Und eine EIGENE Farbe — wie SONEs Pipette neben der Palette.

          Gemeldet: „Bei den Farben ist auch das Vorbild SONE. Da kann ich zb
          auch eine eigene Farbe definieren." Der Kern konnte es die ganze Zeit:
          `ChosenColor = PaletteName | \`#${string}\`` und `colorValue` gibt für
          einen Hex-Wert den Wert selbst zurück. Nur die Oberfläche bot es nicht
          an — eine Möglichkeit, die im Kern steht und nirgends anklickbar ist,
          gibt es für niemanden.

          `onInput` und nicht `onChange`: ein Farbfeld schickt beim Ziehen
          laufend `input`, und `change` erst beim Schließen — mit `change`
          allein sieht man die Wirkung nicht, während man wählt. Der Wert geht
          erst mit dem Loslassen (`onBlur`) an den Server, sonst wäre jedes
          Zwischenbild ein Schreibvorgang.
        */}
        <input
          type="color"
          className="own-color"
          title="eigene Farbe"
          data-set={
            (eigen[which] ?? (current?.startsWith('#') === true ? current : undefined)) ===
            undefined
              ? 'no'
              : 'yes'
          }
          aria-label={`${label}: eigene Farbe`}
          /*
            Nur ein Hex-Wert taugt hier. `colorValue` gäbe für einen
            Palettennamen `var(--sote-palette-…)` zurück, und ein Farbfeld mit
            einem `var()` darin zeigt schwarz — der Übersetzer merkt das nicht,
            der Browser sagt nichts, und man sieht es erst im Bild.
          */
          value={eigen[which] ?? (current?.startsWith('#') === true ? current : '#888888')}
          disabled={busy}
          /*
            `onInput` zeigt, `onChange` speichert.
            
            Ein Farbfeld schickt beim Ziehen laufend `input` und `change` erst
            beim Bestätigen — so sieht man die Farbe, während man wählt, und
            geschrieben wird einmal. Vorher stand hier `onBlur` mit
            `e.currentTarget`, und das ist nach dem Ereignis `null`: der Test
            meldete „Cannot read properties of null (reading 'value')".
          */
          onInput={(e) => {
            /*
             * Den Wert ZUERST lesen, dann den Zustand ändern.
             *
             * `setEigen((v) => … e.currentTarget.value …)` sah richtig aus und
             * war es nicht: die Aktualisierungsfunktion läuft SPÄTER, und dann
             * ist `currentTarget` schon `null`. Der Browser meldete „Cannot
             * read properties of null (reading 'value')" — sichtbar nur, weil
             * das Prüfskript auf `pageerror` hört; die Farbe wurde trotzdem
             * gesetzt, also hätte man es im Bild nicht gemerkt.
             */
            const wert = e.currentTarget.value;
            setEigen((v) => ({ ...v, [which]: wert }));
          }}
          onChange={(e) => setMark({ [which]: e.currentTarget.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Name und Zeichen</h2>

        <div className="settings-row">
          <span className="settings-row-label"><b>Name</b><span>Überall, wo dieser Workspace auftaucht.</span></span>
          <div className="settings-row-value">
            <input
              className="set-input"
              aria-label="Name des Workspace"
              defaultValue={name}
              disabled={busy}
              /* Beim Verlassen des Feldes, nicht bei jedem Tastendruck: das
                 wären zwanzig Umbenennungen für ein Wort, und jede einzelne
                 gilt für alle Mitglieder. */
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== '' && next !== name) void save({ name: next });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = name;
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row-label"><b>Deine Rolle</b><span>Was du hier darfst. Rollen setzt man unter „Leute".</span></span>
          <div className="settings-row-value">
            {owner ? 'Eigentümer' : 'Mitglied'}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>Zeichen</h2>
        <div className="settings-row">
          <span className="settings-row-label"><b>Vorschau</b></span>
          <div className="settings-row-value ws-preview">
            <ProjectMark
              icon={icon?.icon}
              kind="folder"
              name={name}
              color={
                icon?.iconColor === undefined
                  ? undefined
                  : `var(--sote-palette-${icon.iconColor})`
              }
            />
            <strong
              style={
                icon?.titleColor === undefined
                  ? undefined
                  : { color: `var(--sote-palette-${icon.titleColor})` }
              }
            >
              {name}
            </strong>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-row-label"><b>Symbol</b></span>
          <div className="settings-row-value">
            <input
              className="entry-icon-search"
              value={find}
              placeholder="Zeichen suchen — home, briefcase, star"
              aria-label="Zeichen suchen"
              onChange={(e) => setFind(e.target.value)}
            />
            <div className="entry-icon-grid">
              <button
                className="entry-icon"
                aria-label="ohne Zeichen"
                aria-current={icon?.icon === undefined}
                disabled={busy}
                onClick={() => setMark({ icon: null })}
              >
                <span aria-hidden="true">–</span>
              </button>
              {shown.map((n) => (
                <button
                  key={n}
                  className="entry-icon"
                  aria-label={n}
                  title={n}
                  aria-current={icon?.icon === n}
                  disabled={busy}
                  onClick={() => setMark({ icon: n })}
                >
                  <IconPreview name={n} />
                </button>
              ))}
            </div>
            {shown.length > 0 ? null : (
              <p className="entry-menu-empty">
                {ready ? 'Kein Zeichen mit diesem Namen.' : 'Zeichen werden geladen…'}
              </p>
            )}
          </div>
        </div>

        {swatches('iconColor', 'Symbolfarbe', icon?.iconColor)}
        {/* Zwei Farben, weil es zwei Dinge sind: das Zeichen und der Name.
            Bei einem Projekt gibt es die zweite nicht — dessen Name steht in
            einer Zeile, die keinen eigenen Titel hat. */}
        {swatches('titleColor', 'Namensfarbe', icon?.titleColor)}
      </section>
    </div>
  );
}
