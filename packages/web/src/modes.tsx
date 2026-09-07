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
 */

import type { ReactNode } from 'react';

import { SoteMark } from './components/Logo.js';

export type ModeId = 'tasks' | 'search' | 'workspaces' | 'inbox' | 'shares' | 'trash';

export interface Mode {
  readonly id: ModeId;
  readonly label: string;
  readonly icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const MODES: readonly Mode[] = [
  {
    id: 'tasks',
    label: 'Aufgaben',
    icon: <SoteMark size={22} />,
  },
  {
    id: 'search',
    label: 'Suchen',
    icon: (
      <svg width="19" height="19" viewBox="0 0 20 20" {...stroke}>
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M12.8 12.8 17 17" />
      </svg>
    ),
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    icon: (
      <svg width="19" height="19" viewBox="0 0 20 20" {...stroke}>
        <rect x="2.5" y="2.5" width="6" height="6" />
        <rect x="11.5" y="2.5" width="6" height="6" />
        <rect x="2.5" y="11.5" width="6" height="6" />
        <rect x="11.5" y="11.5" width="6" height="6" />
      </svg>
    ),
  },
  {
    id: 'inbox',
    label: 'Posteingang',
    icon: (
      <svg width="19" height="19" viewBox="0 0 20 20" {...stroke}>
        <path d="M5 8.5a5 5 0 0 1 10 0v4l1.5 2h-13L5 12.5z" />
        <path d="M8 16.5h4" />
      </svg>
    ),
  },
  {
    id: 'shares',
    label: 'Freigaben',
    icon: (
      <svg width="19" height="19" viewBox="0 0 20 20" {...stroke}>
        <path d="M8 12l4-4" />
        <path d="M7.5 6.5 9 5a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
        <path d="M12.5 13.5 11 15a3.5 3.5 0 0 1-5-5L7.5 8.5" />
      </svg>
    ),
  },
  {
    id: 'trash',
    label: 'Papierkorb',
    icon: (
      <svg width="19" height="19" viewBox="0 0 20 20" {...stroke}>
        <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l1 12h8l1-12" />
      </svg>
    ),
  },
];

export const modeOf = (id: string): Mode =>
  MODES.find((m) => m.id === id) ?? MODES[0]!;
