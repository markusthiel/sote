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
    <nav className="rail icon-rail" aria-label="Bereiche">
      {/*
        SONEs Schiene: die Marke ist der erste Eintrag (`rail-brand`), die
        Bereiche stehen in einer eigenen Gruppe (`rail-nav`) mit 2px Lücke, das
        Konto am Fuß. Die Kacheln sind 44px (`--sone-tap`) — SOTEs waren 40 —,
        die Zeichen 1.2em, und der gewählte Bereich trägt einen 2px-Akzent am
        Rand über das mittlere Halbe. Gemeldet: „In der schmalen Leiste sind
        die Icons nicht genau so groß wie bei SONE, auch die Abstände stimmen
        nicht ganz."
      */}
      <div className="rail-nav">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className={mode.brand === true ? 'rail-item rail-brand' : 'rail-item'}
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
      </div>
      <span className="rail-spacer" />
      {/* Kein Wort unter dem Gesicht: in einer Spalte ist Platz, und der Name
          steht im Menü. Die Fußleiste gibt „Du" mit — siehe AccountMenu. */}
      {/* SONEs `.rail-account`: dasselbe Bauteil wie im Fuß der Leiste, in der
          Schiene auf das Gesicht verkürzt — der Name fällt weg, das Menü
          öffnet nach rechts statt nach oben. */}
      <div className="rail-account">
        <AccountMenu displayName={displayName} email={email} onSettings={onSettings}
          onAdmin={onAdmin}
          onSignOut={onSignOut} />
      </div>
    </nav>
  );
}
