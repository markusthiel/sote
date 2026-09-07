/**
 * SOTE — die Fußleiste. Zeichnung zwei von zwei.
 *
 * Dieselbe `MODES`-Liste, quer. ADR-0072 ohne Ausnahme: ein Modus, der in einer
 * Zeichnung fehlt, ist ein Modus, den ein Telefon nicht erreicht. Deshalb
 * zeichnet sie **alle** und kürzt nichts weg — die ausgelieferte SONE-Leiste
 * trägt dieselben sieben Einträge mit vollen Beschriftungen.
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
  onSignOut,
}: {
  active: ModeId;
  onPick: (id: ModeId) => void;
  inboxCount: number;
  displayName: string;
  email: string;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="footbar" aria-label="Bereiche">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className="foot-slot"
          {...(mode.id === active ? { 'aria-current': 'page' as const } : {})}
          onClick={() => onPick(mode.id)}
        >
          {mode.icon}
          <span className="t">{mode.label}</span>
          {mode.id === 'inbox' && inboxCount > 0 ? (
            <span className="badge">{inboxCount}</span>
          ) : null}
        </button>
      ))}
      {/* „Du" als Wort unter dem Gesicht: hier hat jeder Eintrag eine
          Beschriftung, und ein unbeschriftetes Gesicht daneben liest sich als
          Versehen (SONEs ADR-0074). */}
      <AccountMenu
        displayName={displayName}
        label="Du"
        email={email}
        onSettings={onSettings}
        onSignOut={onSignOut}
      />
    </nav>
  );
}
