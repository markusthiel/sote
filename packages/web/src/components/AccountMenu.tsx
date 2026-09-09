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
 * antwortet, bringt Leute dazu, dem Menü zu misstrauen (SONEs ADR-0027). Hier
 * stand darum eine Runde lang **keine** Einstellungszeile — den Bildschirm gab
 * es nicht. Jetzt gibt es ihn, und sie steht da.
 *
 * **Zuletzt und abgesetzt** steht das eine, was man nicht durch nochmaliges
 * Drücken zurücknimmt.
 *
 * Arbeitsbereiche, Posteingang und Papierkorb stehen nicht hier: das sind
 * **Orte**, und Orte sind auf der Schiene. Beides wäre ein Gegenstand mit zwei
 * Wegen hinein — der Fehler, über den SONEs Record nachträglich geändert wurde.
 */

import { useEffect, useRef, useState } from 'react';

import { SettingsIcon, SignOutIcon, SlidersIcon } from './icons.js';

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
  onSettings,
  onAdmin,
  onSignOut,
}: {
  displayName: string;
  label?: string | undefined;
  email: string;
  onSettings: () => void;
  /**
   * Die Verwaltung — alles, was fuer jeden auf diesem Server gilt.
   *
   * Im Kontomenue und nicht in der Schiene, wie in SONE: die Schiene ist die
   * Liste der Orte, an denen man arbeitet. Ein Server ist kein Ort, an dem man
   * arbeitet.
   */
  /**
   * Die Verwaltung — **oder gar nicht**.
   *
   * `undefined` heißt: dieser Eintrag fehlt. Ein Eintrag, der auf „das darfst
   * du nicht" führt, bringt Leute dazu, dem Menü zu misstrauen (SONEs
   * ADR-0027: abwesend statt anwesend und verweigernd). Als Möglichkeit im Typ
   * und nicht als Flag daneben: ein `canAdmin`-Boolean wäre eine zweite
   * Angabe, die zu `onAdmin` passen muss.
   */
  onAdmin?: (() => void) | undefined;
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
    <div className="sidebar-footer" ref={box}>
      <button
        ref={knob}
        type="button"
        className="sidebar-account"
        aria-haspopup="menu"
        aria-expanded={open}
        // Nur der Name. Was wartet, wird an der Glocke angesagt, weil es dort
        // liegt — hier auch zu zählen ließe eine Vorleseansage die Zahl an der
        // einen Stelle nennen, die sie nicht öffnen kann (SONEs ADR-0092).
        aria-label={`${displayName} — Konto`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sidebar-avatar" aria-hidden="true">
          {initials}
        </span>
        {label === undefined ? null : <span className="sidebar-account-name">{label}</span>}
      </button>

      {open ? (
        <div className="sidebar-account-menu" role="menu">
          {/* Wer man ist, ohne Knopf: eine Auskunft, die man nicht drücken
              kann, soll auch nicht aussehen wie eine, die man drücken kann. */}
          {/*
            Kein Kopf mit Name und Adresse — SONEs Kontomenü hat keinen. Der
            Name steht am Knopf, die Adresse unter Einstellungen › Profil, und
            ein Menü, das oben wiederholt, was der Knopf schon sagt, ist eine
            Zeile, die man überliest, um zu den Einträgen zu kommen.
          */}
          <button
            type="button"
            role="menuitem"
           
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <SettingsIcon size={15} />
            Deine Einstellungen
          </button>
          {onAdmin === undefined ? null : (
            <button
              type="button"
              role="menuitem"
             
              onClick={() => {
                setOpen(false);
                onAdmin();
              }}
            >
              <SlidersIcon size={15} />
              Verwaltung
            </button>
          )}
          {/* Zuletzt und abgesetzt: das eine hier, was man nicht durch
              nochmaliges Drücken zurücknimmt. */}
          <button type="button" role="menuitem" onClick={onSignOut}>
            <SignOutIcon size={15} />
            Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}
