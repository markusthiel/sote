/**
 * SOTE — die Zeichen, die ein Projekt tragen kann.
 *
 * Ein **geschlossener Satz**, wie die Farben eine Liste sind und kein Wähler.
 * Die Begründung ist dieselbe wie in SONEs Gestaltungs-Records („Steps, not
 * values"): freie Zeichen erzeugen Zeilen, die sich nicht unterscheiden lassen,
 * und niemand sieht beim Wählen, dass das passiert ist. Zwölf Zeichen deckt,
 * was Leute wirklich meinen — Wohnung, Arbeit, Einkauf, Auto, Reise, Geld,
 * Lernen, Gesundheit, Werkzeug, Garten, Menschen, Wichtiges.
 *
 * Selbst gezeichnet und nicht aus einer Bibliothek: SOTE holt keine Datei von
 * außen (dieselbe Regel wie bei den Schriften, mit einem Test dahinter), und
 * ein Zeichensatz mit tausend Einträgen im Bündel für zwölf davon ist eine
 * Ladezeit für nichts.
 *
 * **Der Name wird nicht geprüft** — nicht hier und nicht im Kern. Was diese
 * Liste nicht kennt, wird als Anfangsbuchstabe gezeichnet, genau wie SONEs
 * `WorkspaceMark`. Eine Fassung, die ein neues Zeichen noch nicht hat, zeigt
 * dann ein „H" statt zu zerbrechen.
 *
 * Alle Pfade sind auf einem 24er Gitter gezeichnet, ohne Füllung, mit
 * `currentColor` — damit die Farbe von außen kommt und ein Zeichen in Hell und
 * Dunkel dasselbe Zeichen ist.
 */

const PATHS: Record<string, string> = {
  wohnung: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  arbeit: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  einkauf: 'M4 7h16l-1.3 12a1 1 0 0 1-1 .9H6.3a1 1 0 0 1-1-.9zM8.5 7a3.5 3.5 0 0 1 7 0',
  auto: 'M4 16v-3.2L6 8h12l2 4.8V16zM3 16h18M7 16v2M17 16v2',
  reise: 'M2 13.5 22 6l-4 8-5.5 1L10 20l-2-4z',
  geld: 'M12 3v18M8.5 7.5h5a2.5 2.5 0 0 1 0 5h-3a2.5 2.5 0 0 0 0 5h5',
  lernen: 'M3 7.5 12 4l9 3.5L12 11zM6 9.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3V9.5',
  gesundheit: 'M12 20s-7-4.4-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.8C19 15.6 12 20 12 20z',
  werkzeug: 'M14.5 3.5a4 4 0 0 0 5 5L21 7v3l-9 9-3-3 9-9zM7 14l3 3-4 4-3-3z',
  garten: 'M12 21V9M12 9a5 5 0 0 1-5-5 5 5 0 0 1 5 5zM12 9a5 5 0 0 0 5-5 5 5 0 0 0-5 5z',
  menschen: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5.5a3.5 3.5 0 0 1 0 6.9M18 14.5c2.1.7 3.5 2.6 3.5 5.5',
  wichtig: 'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L4 9.9l6-.8z',
};

/** Die Namen, in der Reihenfolge, in der sie im Wähler stehen. */
export const ICON_NAMES = Object.keys(PATHS);

export const hasIcon = (name: string | undefined): boolean =>
  name !== undefined && name in PATHS;

/**
 * Ein Zeichen, oder der Anfangsbuchstabe.
 *
 * `aria-hidden`, immer: das Zeichen sagt nichts, was der Name nicht schon
 * sagt, und eine Vorleseansage „Stern, Haus" ist eine Ansage zu viel. Die
 * Zeile selbst trägt die Beschriftung.
 */
export function ProjectMark({
  icon,
  name,
  color,
}: {
  icon: string | undefined;
  name: string;
  color: string | undefined;
}) {
  const path = icon === undefined ? undefined : PATHS[icon];
  return (
    <span
      className="p-mark"
      aria-hidden="true"
      {...(color === undefined ? {} : { style: { color } })}
    >
      {path === undefined ? (
        // Wie SONEs WorkspaceMark: was die Liste nicht kennt, wird der
        // Anfangsbuchstabe. Kein Fragezeichen für einen Namen, der eins hat.
        (name.trim().charAt(0).toUpperCase() || '?')
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" focusable="false">
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
