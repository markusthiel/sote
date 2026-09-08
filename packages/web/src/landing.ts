/**
 * SOTE — aus einer Landeeinstellung eine Adresse machen.
 *
 * ADR-0072 trennt zwei Fragen, die vorher eine waren:
 *
 * > **Arriving and pressing the mark are different questions.** Arriving — a
 * > fresh load, a sign-in, a switch of workspace — means the landing setting in
 * > full, including „the page I was last on". Pressing the mark later cannot
 * > mean that, because you are on that page.
 *
 * In SOTE führte die Marke immer nach Heute, also tat sie von Heute aus
 * **nichts** — der sechste Fall des Musters, das schon Kontoknopf, Schublade,
 * Wechsler und das Kästchen an drei Stellen betraf. Hier stehen darum beide
 * Antworten, und die Namen sagen, welche welche ist.
 */

import type { Landing } from '@sote/core';

import type { Route } from './route.js';

const KEY = 'sote.lastRoute';

/** Merkt, wo jemand war — für `last`. Im Browser, wie alles Örtliche. */
export function rememberRoute(path: string): void {
  try {
    // Einstellungen und Verwaltung werden NICHT gemerkt: „wo du zuletzt warst"
    // meint die Arbeit und nicht den Weg dorthin. Wer beim Anmelden in seinen
    // Farbeinstellungen landet, weil er dort zuletzt etwas gerichtet hat, ist
    // an einem Ort, den er nicht gesucht hat.
    if (/^\/(einstellungen|verwaltung|workspaces)/.test(path)) return;
    localStorage.setItem(KEY, path);
  } catch {
    // Kein Speicher: dann gibt es kein „zuletzt", und `landingRoute` fällt
    // zurück. Eine Ausnahme hier würde das Ankommen verhindern.
  }
}

function lastPath(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Beim **Ankommen**: die Einstellung in voller Länge.
 *
 * `projects` wird gebraucht, um ein gespeichertes Projekt zu prüfen: liegt es
 * nicht in diesem Arbeitsbereich, gilt der Rückfall. Eine Adresse auf ein
 * Projekt, das es hier nicht gibt, wäre ein Fehler beim Ankommen — und
 * ankommen soll nicht fehlschlagen.
 */
export function landingRoute(
  landing: Landing,
  projects: readonly { id: string; kind: string }[],
): Route {
  switch (landing.kind) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'project': {
      const da = projects.some((p) => p.id === landing.projectId && p.kind === 'list');
      return da && landing.projectId !== undefined
        ? { kind: 'project', projectId: landing.projectId }
        : { kind: 'today' };
    }
    case 'last': {
      const path = lastPath();
      return path === null ? { kind: 'today' } : parseRemembered(path);
    }
    default:
      return { kind: 'today' };
  }
}

/**
 * Beim **Drücken der Marke**: irgendwohin, aber nicht hierher.
 *
 * „Wo du zuletzt warst" kann das nicht heißen, weil man dort steht. Also: die
 * Landeseite, und wenn man schon dort ist, das erste Projekt — damit die Marke
 * **immer** etwas tut. Gibt es kein Projekt, bleibt Heute; ein Knopf, der in
 * einem leeren Arbeitsbereich nichts tut, ist ehrlicher als einer, der eine
 * Adresse erfindet.
 */
export function markRoute(
  landing: Landing,
  projects: readonly { id: string; kind: string }[],
  here: Route,
): Route {
  const ziel = landing.kind === 'last' ? { kind: 'today' as const } : landingRoute(landing, projects);
  const schonDa =
    ziel.kind === here.kind &&
    (ziel.kind !== 'project' || (here.kind === 'project' && here.projectId === ziel.projectId));
  if (!schonDa) return ziel;
  const erstes = projects.find((p) => p.kind === 'list');
  if (erstes === undefined) return { kind: 'today' };
  if (here.kind === 'project' && here.projectId === erstes.id) return { kind: 'today' };
  return { kind: 'project', projectId: erstes.id };
}

/** Nur die Wege, an denen man arbeitet — der Rest ist kein „zuletzt". */
function parseRemembered(path: string): Route {
  if (path === '/demnaechst') return { kind: 'upcoming' };
  if (path === '/irgendwann') return { kind: 'someday' };
  if (path === '/posteingang') return { kind: 'inbox' };
  const p = /^\/p\/([0-9a-f-]{36})$/.exec(path);
  if (p !== null) return { kind: 'project', projectId: p[1]! };
  return { kind: 'today' };
}
