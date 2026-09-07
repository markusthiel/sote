/**
 * SOTE — das Gesicht am Fuß einer Spalte, und das Menü dahinter.
 *
 * Nachgebaut aus SONEs `AccountMenu.tsx`, samt Begründungen — der Rahmen soll
 * in beiden Werkzeugen derselbe sein.
 *
 * Was es vorher gab: einen Knopf mit `onAccount={() => void 0}`. Er sah aus wie
 * ein Bedienelement und war keines, und **abmelden konnte man sich überhaupt
 * nicht** — `api.signOut` stand in der Datei und wurde von nirgendwo gerufen.
 * Eine Anmeldung ohne Abmeldung ist keine halbe Funktion, sondern ein
 * geöffneter Rechner in einem Büro.
 *
 * SONEs Sätze, die hier gelten:
 *
 * **Ein Zeichen statt einer Reihe.** „Four icons in a row asked somebody to
 * learn four symbols for things they use rarely, and the row grew every time
 * the account gained a page. Behind the face there is room for names, which is
 * what these entries are actually distinguished by."
 *
 * **Abwesend statt anwesend und verweigernd.** Ein Eintrag, der „gibt es nicht"
 * antwortet, bringt Leute dazu, dem Menü zu misstrauen (SONEs ADR-0027). Also
 * steht hier noch **keine** Einstellungszeile: den Bildschirm gibt es nicht.
 * Sobald er da ist, kommt sie — und nicht vorher als Versprechen.
 *
 * **Zuletzt und abgesetzt** steht das eine, was man nicht durch nochmaliges
 * Drücken zurücknimmt.
 *
 * Arbeitsbereiche, Posteingang und Papierkorb stehen nicht hier: das sind
 * **Orte**, und Orte sind auf der Schiene. Beides wäre ein Gegenstand mit zwei
 * Wegen hinein — der Fehler, über den SONEs Record nachträglich geändert wurde.
 */

import { useEffect, useRef, useState } from 'react';

import { PersonIcon, SignOutIcon } from './icons.js';

export function AccountMenu({
  displayName,
  /**
   * Ein Wort unter dem Gesicht statt des Namens (SONEs ADR-0074).
   *
   * Die Fußleiste gibt jedem Eintrag ein Sechstel der Telefonbreite, und darin
   * ist ein Name drei Punkte. Jeder andere Eintrag dort ist beschriftet, und
   * ein unbeschriftetes Gesicht neben fünf beschrifteten Zeichen liest sich
   * als Versehen und nicht als Absicht — also gibt die Leiste „Du" mit, und
   * eine Spalte gibt nichts mit und behält den Namen.
   */
  label,
  email,
  onSignOut,
}: {
  displayName: string;
  label?: string | undefined;
  email: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        knob.current?.focus();
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

  const initials = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="account" ref={box}>
      <button
        ref={knob}
        type="button"
        className="account-face"
        aria-haspopup="menu"
        aria-expanded={open}
        // Nur der Name. Was wartet, wird an der Glocke angesagt, weil es dort
        // liegt — hier auch zu zählen ließe eine Vorleseansage die Zahl an der
        // einen Stelle nennen, die sie nicht öffnen kann (SONEs ADR-0092).
        aria-label={`${displayName} — Konto`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="face" aria-hidden="true">
          {initials}
        </span>
        {label === undefined ? null : <span className="account-name">{label}</span>}
      </button>

      {open ? (
        <div className="account-menu" role="menu">
          {/* Wer man ist, ohne Knopf: eine Auskunft, die man nicht drücken
              kann, soll auch nicht aussehen wie eine, die man drücken kann. */}
          <div className="account-who">
            <PersonIcon size={15} />
            <span>
              <strong>{displayName}</strong>
              <span className="account-mail">{email}</span>
            </span>
          </div>
          <button type="button" role="menuitem" className="account-item" onClick={onSignOut}>
            <SignOutIcon size={15} />
            Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}
