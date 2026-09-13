/**
 * SOTE — die Fußleiste. Zeichnung zwei von zwei.
 *
 * Dieselbe `MODES`-Liste, quer und mit kurzen Beschriftungen. Selten benötigte
 * Ziele stehen über ihre Metadaten im gemeinsamen Kontomenü.
 */

import { MODES, type ModeId } from '../modes.js';
import { AccountMenu } from './AccountMenu.js';

export function FootBar({
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
    <nav className="footbar" aria-label="Bereiche">
      {MODES.map((mode) => mode.account ? null : (
        <button
          key={mode.id}
          className="foot-slot"
          aria-label={mode.badge && inboxCount > 0 ? `${mode.label} · ${inboxCount} ungelesen` : mode.label}
          title={mode.label}
          {...(mode.id === active ? { 'aria-current': 'page' as const } : {})}
          onClick={() => onPick(mode.id)}
        >
          {mode.icon}
          <span className="t" aria-hidden="true">{mode.shortLabel ?? mode.label}</span>
          {/*
            Die Zahl hängt am Modus (`badge`) und nicht an seinem Namen: ein
            `mode.id === '…'` hier wäre eine zweite Liste neben `MODES`, und
            der Wächter in `modes.test.ts` lehnt das ab.

            Was sie zählt, hat sich geändert: **Ungelesene**, nicht der
            Posteingang. Eine Zahl an einer Glocke sprach von etwas anderem.
          */}
          {mode.badge === true && inboxCount > 0 ? (
            <span className="badge" aria-hidden="true">{inboxCount}</span>
          ) : null}
        </button>
      ))}
      {/* „Du" als Wort unter dem Gesicht: hier hat jeder Eintrag eine
          Beschriftung, und ein unbeschriftetes Gesicht daneben liest sich als
          Versehen (SONEs ADR-0074). */}
      <div className="rail-account foot-account">
        <AccountMenu
          displayName={displayName}
          label="Du"
          email={email}
          active={active}
          onPick={onPick}
          onSettings={onSettings}
          onAdmin={onAdmin}
          onSignOut={onSignOut}
        />
      </div>
    </nav>
  );
}
