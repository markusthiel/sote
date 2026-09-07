/**
 * SOTE — die Fußleiste. Zeichnung zwei von zwei.
 *
 * Dieselbe `MODES`-Liste, quer. ADR-0072 ohne Ausnahme: ein Modus, der in einer
 * Zeichnung fehlt, ist ein Modus, den ein Telefon nicht erreicht. Deshalb
 * zeichnet sie **alle** und kürzt nichts weg — die ausgelieferte SONE-Leiste
 * trägt dieselben sieben Einträge mit vollen Beschriftungen.
 */

import { MODES, type ModeId } from '../modes.js';

export function FootBar({
  active,
  onPick,
  inboxCount,
  initials,
  onAccount,
}: {
  active: ModeId;
  onPick: (id: ModeId) => void;
  inboxCount: number;
  initials: string;
  onAccount: () => void;
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
      <button className="foot-slot" onClick={onAccount} aria-label="Du">
        <span className="face" aria-hidden="true">
          {initials}
        </span>
        <span className="t">Du</span>
      </button>
    </nav>
  );
}
