/**
 * SOTE — Zeichen für die Anzeigeformen.
 *
 * GEMELDET: „Die Buttons oben rechts sind hässlich. Da kann man sicher auch
 * Icon-Buttons draus machen. … Erstmal in der ganzen Liste prüfen, die wir
 * sowieso nutzen."
 *
 * Geprüft, und zwei der vier gibt es schon in dem aus SONE übernommenen Satz:
 *
 * - `ColumnsIcon` — senkrechte Bahnen, wörtlich „for a board view". Die Tafel.
 * - `CheckSquareIcon` — das Kästchen mit Haken. Für „Erledigte einblenden",
 *   mit einem Strich darüber, wenn sie ausgeblendet sind; der Vorschlag kam
 *   genau so und ist gut: was durchgestrichen ist, ist nicht da.
 * - `ListIcon` — Punkte mit Zeilen. Die schmale Form.
 *
 * Für die beiden übrigen gibt es nichts Passendes, und sie kommen darum hier
 * her statt in `icons.tsx`: die Datei ist eins zu eins aus SONE kopiert und
 * soll das bleiben. Etwas hineinzulegen, das es dort nicht gibt, machte aus
 * einer Kopie eine Gabelung — dieselbe Überlegung wie bei `marks.tsx`.
 *
 * Dieselbe Bauart wie der übernommene Satz: 24×24, Strichstärke 1.5,
 * `currentColor`, runde Enden, keine Füllung.
 */

import type { ReactElement, SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    width: '1em',
    height: '1em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  };
}

/**
 * Voll: je Eintrag eine Zeile und eine kürzere darunter.
 *
 * Das ist genau der Unterschied zur schmalen Form, und er ist im Zeichen zu
 * sehen — eine zweite, kürzere Linie ist die Beiwerkzeile.
 */
export function ViewFullIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h16M4 9h9M4 15h16M4 18.5h9" />
    </svg>
  );
}

/**
 * Karten: zwei gestapelte Kästen mit Luft dazwischen.
 *
 * Kästen und nicht Linien, weil genau das der Unterschied ist: eine Karte hat
 * einen eigenen Grund und einen Rand.
 */
export function ViewCardsIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="17" height="7" rx="1.5" />
    </svg>
  );
}

/**
 * Erledigte ausgeblendet: das Kästchen mit Haken, durchgestrichen.
 *
 * Der Strich läuft über das ganze Zeichen und nicht nur über den Haken: was
 * durchgestrichen ist, ist nicht da — und gemeint ist, dass die erledigten
 * ZEILEN fehlen, nicht dass der Haken fehlt.
 */
export function DoneHiddenIcon(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="m8 12.2 2.8 2.8L16.5 9.3" />
      <path d="M3 21 21 3" />
    </svg>
  );
}
