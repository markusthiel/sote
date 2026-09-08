/**
 * SOTE — die Schiene. Zeichnung eins von zwei.
 *
 * Sie liest `MODES` und zählt keinen Modus selbst auf. Über 800 px sichtbar,
 * darunter per Stylesheet verborgen — nicht per JS-Media-Query, sonst gibt es
 * zwei Antworten auf „welche Breite ist gerade".
 */

import { MODES, type ModeId } from '../modes.js';
import { AccountMenu } from './AccountMenu.js';

export function IconRail({
  active,
  onPick,
  inboxCount,
  displayName,
  email,
  onSettings,
  onAdmin,
  onSignOut,
}: {
  active: ModeId;
  onPick: (id: ModeId) => void;
  inboxCount: number;
  displayName: string;
  email: string;
  onSettings: () => void;
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
  return (
    <nav className="rail" aria-label="Bereiche">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className="rail-slot"
          aria-label={mode.label}
          title={mode.label}
          {...(mode.id === active ? { 'aria-current': 'page' as const } : {})}
          onClick={() => onPick(mode.id)}
        >
          {mode.icon}
          {/*
            Die Zahl hängt am Modus (`badge`) und nicht an seinem Namen: ein
            `mode.id === '…'` hier wäre eine zweite Liste neben `MODES`, und
            der Wächter in `modes.test.ts` lehnt das ab.

            Was sie zählt, hat sich geändert: **Ungelesene**, nicht der
            Posteingang. Eine Zahl an einer Glocke sprach von etwas anderem.
          */}
          {mode.badge === true && inboxCount > 0 ? (
            <span className="badge">{inboxCount}</span>
          ) : null}
        </button>
      ))}
      <span className="rail-spacer" />
      {/* Kein Wort unter dem Gesicht: in einer Spalte ist Platz, und der Name
          steht im Menü. Die Fußleiste gibt „Du" mit — siehe AccountMenu. */}
      <AccountMenu displayName={displayName} email={email} onSettings={onSettings}
        onAdmin={onAdmin}
        onSignOut={onSignOut} />
    </nav>
  );
}
