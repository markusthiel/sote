/**
 * SOTE — die Modusmenge. **Eine** Liste.
 *
 * SONEs ADR-0072: eine Liste, zwei Zeichnungen. Die Schiene zeichnet sie
 * senkrecht, die Fußleiste quer, und **kein Modus darf aus einer der beiden
 * fallen** — ein Modus, der in einer Zeichnung fehlt, ist ein Modus, den ein
 * Telefon nicht erreicht. Deshalb steht die Liste hier und nicht in einer der
 * beiden Komponenten, und ein Test in `test/modes.test.ts` hält es fest.
 *
 * Das Konto ist **kein** Modus: es ist keine Handlung an einem Ort, sondern
 * gehört zu dir. Es steht abgesetzt und wird von beiden Zeichnungen getrennt
 * behandelt.
 *
 * ## Die Zeichen sind SONEs
 *
 * Hier standen eigene Pfade auf einem 20er Gitter mit Strichbreite 1,6, neben
 * SONEs 24er Gitter mit 1,5. Das ist genau das, was SONEs eigener Kommentar
 * über Zeichensätze sagt: „mixing a filled icon into a line set is visible
 * immediately even to someone who could not say why" — und zwei Sätze mit
 * verschiedenem Gitter mischen sich ebenso sichtbar, nur subtiler.
 *
 * Jetzt kommt jedes Zeichen aus der kopierten `icons.tsx`. Das Signet bleibt
 * SOTEs eigenes: es ist die Marke und nicht Möblierung.
 */

import { BellIcon, CalendarIcon, SearchIcon, ShareIcon, TrashIcon, WorkspacesIcon } from './components/icons.js';
import { SoteMark } from './components/Logo.js';

export type ModeId =
  | 'tasks'
  | 'search'
  /** Der Kalender über alle Arbeitsbereiche — eine Frage an die Person, nicht an den Bereich. */
  | 'calendar'
  | 'workspaces'
  /** Die Glocke. Der Posteingang ist keine Schiene, sondern eine Aufgabenansicht. */
  | 'notifications'
  | 'shares'
  | 'trash';

export interface Mode {
  readonly id: ModeId;
  /**
   * Trägt dieser Bereich eine Zahl?
   *
   * **Am Modus und nicht in der Zeichnung**, und der Wächter in `modes.test.ts`
   * verlangt genau das: `mode.id === 'notifications'` in einer Zeichnung wäre
   * eine zweite Liste, und zwei Listen laufen auseinander. Mein erster Versuch
   * schrieb es genau so hin, und der Wächter hat es gemeldet — er ist dafür
   * gebaut.
   */
  readonly badge?: boolean;
  /**
   * Ist dieser Bereich die Marke?
   *
   * SONEs Schiene zeichnet den ersten Eintrag als `rail-brand` — kräftiger als
   * die anderen, weil er die Anwendung ist und nicht ein Bereich in ihr. Am
   * Modus und nicht in der Zeichnung, aus demselben Grund wie `badge`: der
   * Wächter in `modes.test.ts` hat `mode.id === 'tasks'` gemeldet.
   */
  readonly brand?: boolean;
  readonly label: string;
  readonly icon: import('react').ReactNode;
}

/**
 * Die Größe, in der der Rahmen seine Zeichen trägt.
 *
 * Eine Zahl an einer Stelle: sechs Mal `size={19}` sind sechs Gelegenheiten,
 * eines davon zu vergessen — und ein Zeichen, das einen Punkt größer ist als
 * seine Nachbarn, sieht wie ein Fehler aus, den niemand benennen kann.
 */
const SIZE = 19;

export const MODES: readonly Mode[] = [
  {
    id: 'tasks',
    label: 'Aufgaben',
    icon: <SoteMark size={22} />,
    brand: true,
  },
  {
    id: 'search',
    label: 'Suchen',
    icon: <SearchIcon size={SIZE} />,
  },
  {
    /*
     * Der Kalender steht in der Schiene und nicht in der Leiste eines
     * Arbeitsbereichs: „was liegt in meiner Woche" hat keine Bereichsgrenze,
     * wie die Glocke. Der Bereich ist ein Filter in der linken Spalte.
     * Gewünscht: „als neuer Hauptpunkt übergreifend für alle Workspaces mit
     * Filter … als schneller Einstieg."
     */
    id: 'calendar',
    label: 'Kalender',
    icon: <CalendarIcon size={SIZE} />,
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    icon: <WorkspacesIcon size={SIZE} />,
  },
  {
    /*
     * Die Glocke hieß **Posteingang** und zeigte Aufgaben ohne Projekt.
     *
     * Das sind zwei Fragen, und eine Glocke beantwortet nur die zweite: der
     * Posteingang ist eine **Aufgabenansicht** (was noch nicht einsortiert
     * ist) und steht darum jetzt zwischen „Irgendwann" und den Projekten.
     * Benachrichtigungen sind, was *jemand anderes* getan hat und mich angeht.
     *
     * Gemeldet als „Benachrichtigungen haben noch kein eigenes Menü" — und der
     * Grund, warum es keines gab, war, dass es die Sache nicht gab.
     */
    id: 'notifications',
    label: 'Benachrichtigungen',
    icon: <BellIcon size={SIZE} />,
    badge: true,
  },
  {
    id: 'shares',
    label: 'Freigaben',
    icon: <ShareIcon size={SIZE} />,
  },
  {
    id: 'trash',
    label: 'Papierkorb',
    icon: <TrashIcon size={SIZE} />,
  },
];

export const modeOf = (id: string): Mode =>
  MODES.find((m) => m.id === id) ?? MODES[0]!;
