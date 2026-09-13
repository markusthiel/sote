/**
 * SOTE — ein Feld in der Detailspalte, das man anfassen kann.
 *
 * Der Befund, der das nötig machte: `projekt`, `geplant`, `frist`, `priorität`
 * und `zuständig` standen als fünf `<span>` da. Anlegen ging, ändern nicht —
 * ein Datum konnte man nur beim Tippen mitgeben (`morgen 9 Uhr`), und danach
 * nie wieder. Gefunden nicht durch Nachdenken, sondern durch Anklicken: die
 * Zeilen reagierten auf einen Klick mit nichts.
 *
 * Warum ein eigener Baustein und nicht fünf Mal dieselbe Klappe:
 *
 * **Eine Reihe, die etwas ändert, muss aussehen wie eine.** Eine Zeile, die
 * anfassbar ist und wie eine Auskunft aussieht, findet niemand — das war ja
 * genau der Fehler. Also ein Knopf über die ganze Breite, mit demselben
 * Wechsel-auf-Hover wie die Aufgabenzeilen, und rechts ein Zeichen, das eine
 * Klappe ankündigt.
 *
 * **Der leere Zustand sagt, was fehlt, nicht dass etwas fehlt.** „kein Datum"
 * und nicht „—". Ein Gedankenstrich ist eine Auskunft, die man erst deuten
 * muss.
 *
 * **Die Klappe schließt bei Escape, bei einem Klick nach außen und nach der
 * Wahl.** Und der Fokus geht zurück auf den Knopf, sonst steht er nach dem
 * Schließen am Anfang der Seite.
 *
 * **Nichts hier ist optimistisch** (wie im Anfasser-Menü, Blatt 03 — anders als
 * beim Häkchen): ein Datum, das gesetzt aussieht und nirgends steht, ist
 * schlimmer als eins, das eine halbe Sekunde braucht.
 */

import { normalizeLabel, parseDuration, sameLabel } from '@sote/core';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function FieldRow({
  label,
  value,
  empty,
  children,
  disabled,
  popupRole = 'menu',
}: {
  label: string;
  /** Der gesetzte Wert, oder `null` für „nichts gesetzt". */
  value: string | null;
  /** Was dann steht — „kein Datum", nicht „—". */
  empty: string;
  /** Die Klappe. Bekommt ein `close`, damit die Wahl sie schließen kann. */
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  popupRole?: 'menu' | 'dialog';
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLButtonElement | null>(null);
  const id = useId();

  const close = () => {
    setOpen(false);
    // Zurück auf den Knopf: sonst steht der Fokus nach dem Schließen am
    // Anfang der Seite, und wer mit der Tastatur arbeitet, hat den Platz
    // verloren.
    knob.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="frow" ref={box} data-open={open}>
      <span className="fl" id={`${id}-l`}>
        {label}
      </span>
      <button
        type="button"
        className="fv fv-button"
        ref={knob}
        // Die Beschriftung nennt Feld UND Wert. „ändern" allein sagt einer
        // Vorleseansage nicht, was sich ändert.
        aria-label={`${label}: ${value ?? empty} — ändern`}
        aria-expanded={open}
        aria-haspopup={popupRole}
        disabled={disabled === true}
        onClick={() => setOpen((o) => !o)}
      >
        {value === null ? <span className="empty-value">{empty}</span> : value}
        <span className="fv-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="fpop" role={popupRole} aria-labelledby={`${id}-l`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Eine freie Dauer.
 *
 * Neben den schnellen Angaben, aus demselben Grund wie beim Datum: „15 min" und
 * „1 h" deckt das Meiste, „2:45" deckt es nicht.
 *
 * EIN TEXTFELD UND KEIN ZAHLENFELD MIT EINHEITENWAHL. Zwei Bedienelemente für
 * eine Angabe sind zwei Handgriffe, und die Frage „Stunden oder Minuten" stellt
 * sich nur, weil das Feld sie stellt. Wer „90" tippt, meint neunzig Minuten;
 * wer „1,5h" tippt, meint dasselbe — und `parseDuration` im Kern weiß das,
 * einmal für alle drei Stellen, die eine Dauer lesen.
 *
 * Übernommen wird erst mit Enter und nicht bei jedem Zeichen: „1h30" ist
 * unterwegs zweimal eine gültige Dauer („1", dann „1h"), und ein Feld, das
 * jeden Zwischenstand speichert, schreibt drei Werte für eine Eingabe.
 *
 * Was nicht gelesen werden kann, sagt das FELD und nicht der Server: die
 * Ablehnung steht neben der Eingabe, in der Sprache, in der sie getippt wurde.
 */
export function FreeDuration({
  onPick,
  label,
}: {
  onPick: (minutes: number) => void;
  label: string;
}) {
  const [text, setText] = useState('');
  const bad = text.trim() !== '' && parseDuration(text) === undefined;
  return (
    <div className="fpop-date">
      <label>
        <span>{label}</span>
        <input
          type="text"
          inputMode="text"
          value={text}
          placeholder="90, 2h, 1:30"
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const minutes = parseDuration(text);
            if (minutes === undefined) return;
            onPick(minutes);
          }}
        />
      </label>
      {bad ? <div className="fpop-note">so kann ich das nicht lesen</div> : null}
    </div>
  );
}

/**
 * Ein neues Schlagwort.
 *
 * Dasselbe Muster wie beim freien Datum und der freien Dauer: der Vorrat deckt
 * das Meiste, aber das erste Mal deckt er nie — und ohne dieses Feld gäbe es
 * keinen Weg, das erste anzulegen.
 *
 * ABGELEHNT WIRD HIER UND NICHT AM SERVER. Ein Leerzeichen macht aus einem
 * Schlagwort eines, das man mit `@` nicht wiederfindet; das sagt das Feld,
 * bevor jemand Enter drückt, und in der Sprache, in der es getippt wurde.
 * `normalizeLabel` ist dieselbe Funktion, die der Server benutzt — es gibt
 * genau eine Antwort auf „ist das ein Name".
 */
export function FreeLabel({
  onPick,
  label,
  known,
}: {
  onPick: (name: string) => void;
  label: string;
  /** Was an dieser Aufgabe schon dranhängt — doppelt anhängen wäre nichts. */
  known: readonly string[];
}) {
  const [text, setText] = useState('');
  const name = normalizeLabel(text);
  const bad = text.trim() !== '' && name === undefined;
  const schon = name !== undefined && known.some((have) => sameLabel(have, name));
  return (
    <div className="fpop-date">
      <label>
        <span>{label}</span>
        <input
          type="text"
          value={text}
          placeholder="unterwegs"
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (name === undefined || schon) return;
            onPick(name);
            setText('');
          }}
        />
      </label>
      {bad ? (
        <div className="fpop-note">ein Wort ohne Leerzeichen — damit `#` es wiederfindet</div>
      ) : schon ? (
        <div className="fpop-note">hängt schon dran</div>
      ) : null}
    </div>
  );
}

/**
 * Ein freies Datum.
 *
 * Neben den drei schnellen Angaben, nicht statt ihnen: „heute" und „nächster
 * Montag" deckt das Meiste, aber „der 14. Oktober" deckt es nicht, und dafür
 * gab es bisher keinen Weg.
 *
 * `type="date"` und nicht ein eigener Kalender — der eingebaute kennt die
 * Sprache, die Woche und die Tastatur der Person, und ein selbstgebauter müsste
 * das alles nachbilden, um am Ende schlechter zu sein.
 *
 * Der Wert kommt als **lokaler** Tag heraus. `new Date('2026-10-14')` wäre
 * Mitternacht UTC und in Berlin der 14. um 02:00 — also wird von Hand gebaut,
 * wie das Anfasser-Menü es auch tut.
 */
export function FreeDate({
  onPick,
  label,
}: {
  onPick: (at: Date) => void;
  label: string;
}) {
  const [text, setText] = useState('');
  return (
    <div className="fpop-date">
      <label>
        <span>{label}</span>
        <input
          type="date"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
            if (m === null) return;
            onPick(
              new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
            );
          }}
        />
      </label>
    </div>
  );
}
