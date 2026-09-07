/**
 * SOTE — die Schiene. Zeichnung eins von zwei.
 *
 * Sie liest `MODES` und zählt keinen Modus selbst auf. Über 800 px sichtbar,
 * darunter per Stylesheet verborgen — nicht per JS-Media-Query, sonst gibt es
 * zwei Antworten auf „welche Breite ist gerade".
 */

import { MODES, type ModeId } from '../modes.js';

export function IconRail({
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
          {mode.id === 'inbox' && inboxCount > 0 ? (
            <span className="badge">{inboxCount}</span>
          ) : null}
        </button>
      ))}
      <span className="rail-spacer" />
      <button className="rail-slot" aria-label="Du" onClick={onAccount}>
        <span className="face" aria-hidden="true">
          {initials}
        </span>
      </button>
    </nav>
  );
}
