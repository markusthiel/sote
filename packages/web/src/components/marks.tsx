/**
 * SOTE — die Zeichen für das, was an einer Aufgabe hängt.
 *
 * ## Warum eine eigene Datei und nicht `icons.tsx`
 *
 * `icons.tsx` ist **eins zu eins aus SONE kopiert** und soll das bleiben: wenn
 * SONE ein Zeichen ändert, wird die Datei erneut kopiert. Etwas hineinzulegen,
 * das es dort nicht gibt, machte aus einer Kopie eine Gabelung — und die nächste
 * Übernahme müsste jemand von Hand zusammenführen.
 *
 * ## Warum nicht Lucide
 *
 * Weil genau das der Fehler war, der SOTE sekundenlang hängen ließ: 1018 KB
 * Zeichensatz auf jedem Laden. Der Satz wird seither nachgeladen, und zwar nur
 * für die, die wirklich ein Projektzeichen gewählt haben (`ProjectMark.tsx`).
 * Die Aufgabenliste ist der Ort, an dem er wieder auf JEDEM Laden käme — sie ist
 * das Erste, was man sieht.
 *
 * Sieben Pfade wiegen nichts. Ein Zeichensatz für sieben Pfade wiegt ein
 * Megabyte.
 *
 * ## Dieselbe Bauart wie der übernommene Satz
 *
 * 24×24, Strichstärke 1.5, `currentColor`, runde Enden, keine Füllung. Das ist
 * es, was einen Satz wie einen Satz aussehen lässt — ein gefülltes Zeichen
 * zwischen Strichzeichen sieht sofort jeder, auch wer nicht sagen könnte, woran
 * es liegt (SONEs Begründung, und sie gilt hier wörtlich).
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
    // Ohne Ausnahme versteckt: der Text daneben sagt dasselbe, und ein
    // Vorleseprogramm liest sonst jede Zeile zweimal.
    'aria-hidden': true,
    ...props,
  };
}

export function NoteMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

export function ImageMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16.5 15.5 11 9 17.5" />
    </svg>
  );
}

export function FileMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.6-2.6l7.4-7.4" />
    </svg>
  );
}

export function CommentMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M20 14.5a2 2 0 0 1-2 2H8.5L4.5 20V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function SubtaskMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m4 7 1.6 1.6L9 5.2M4 16.4 5.6 18 9 14.6M12.5 7H20M12.5 16.4H20" />
    </svg>
  );
}

export function AssigneeMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1.5A4.5 4.5 0 0 1 9.5 14h5a4.5 4.5 0 0 1 4.5 4.5V20" />
    </svg>
  );
}

export function ReminderMark(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 8-2.5 8h17S18 15 18 9" />
      <path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/**
 * Die Wörter aus `marks_of` (Migration 0027) und was sie zeichnen.
 *
 * Die REIHENFOLGE hier ist die auf dem Bildschirm und nicht die aus der
 * Datenbank (die sortiert alphabetisch, damit sie stabil ist). Gruppiert nach
 * dem, was die Aufgabe *enthält* — Notiz, Bild, Anhang, Kommentar — und danach,
 * was an ihr *hängt*: Teilaufgaben, Zuständige, Erinnerung. Eine alphabetische
 * Reihe wäre eine Reihe nach einem Merkmal, das niemanden interessiert.
 *
 * Ein unbekanntes Wort wird ÜBERGANGEN und nicht ersatzweise gezeichnet: ein
 * Kästchen mit Fragezeichen in jeder Zeile wäre die auffälligste Art, einen
 * neuen Servernamen zu melden, den die Oberfläche noch nicht kennt.
 */
export const MARKS: readonly {
  readonly id: string;
  readonly says: string;
  readonly Icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
}[] = [
  { id: 'note', says: 'hat eine Notiz', Icon: NoteMark },
  { id: 'image', says: 'hat ein Bild', Icon: ImageMark },
  { id: 'file', says: 'hat einen Anhang', Icon: FileMark },
  { id: 'comment', says: 'hat Kommentare', Icon: CommentMark },
  { id: 'subtask', says: 'hat offene Teilaufgaben', Icon: SubtaskMark },
  { id: 'assignee', says: 'jemand ist zuständig', Icon: AssigneeMark },
  { id: 'reminder', says: 'eine Erinnerung steht aus', Icon: ReminderMark },
];
