/**
 * SOTE — die Schiene. Zeichnung eins von zwei.
 *
 * Sie liest `MODES` und zählt keinen Modus selbst auf. Über 800 px sichtbar,
 * darunter per Stylesheet verborgen — nicht per JS-Media-Query, sonst gibt es
 * zwei Antworten auf „welche Breite ist gerade".
 */

import { MODES, type ModeId } from '../modes.js';
import { AccountMenu } from './AccountMenu.js';
import { SidebarIcon } from './icons.js';

export function IconRail({
  active,
  onPick,
  inboxCount,
  displayName,
  email,
  onSettings,
  onSignOut,
  sidebarVisible,
  onToggleSidebar,
}: {
  active: ModeId;
  onPick: (id: ModeId) => void;
  inboxCount: number;
  displayName: string;
  email: string;
  onSettings: () => void;
  onSignOut: () => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <nav className="rail" aria-label="Bereiche">
      {/*
        Der Umschalter für die Leiste, ganz oben und über den Bereichen.
        Er gehört zur Anordnung und nicht zu den Orten — deshalb abgesetzt,
        wie das Konto unten.
      */}
      <button
        className="rail-slot"
        aria-label={sidebarVisible ? 'Leiste ausblenden' : 'Leiste einblenden'}
        aria-pressed={sidebarVisible}
        title={sidebarVisible ? 'Leiste ausblenden' : 'Leiste einblenden'}
        onClick={onToggleSidebar}
      >
        <SidebarIcon size={19} />
      </button>
      <span className="rail-gap" />
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
      {/* Kein Wort unter dem Gesicht: in einer Spalte ist Platz, und der Name
          steht im Menü. Die Fußleiste gibt „Du" mit — siehe AccountMenu. */}
      <AccountMenu displayName={displayName} email={email} onSettings={onSettings}
        onSignOut={onSignOut} />
    </nav>
  );
}
