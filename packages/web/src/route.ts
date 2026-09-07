/**
 * SOTE — die Ansicht steht in der URL.
 *
 * **Eine Ansicht ist ein Ort**, also ist sie verlinkbar, teilbar und mit dem
 * Zurück-Knopf erreichbar. In SONE war das der Grund, die Suchabfrage in die
 * URL zu legen statt in den Komponentenzustand: eine Kopie im Zustand ist eine
 * zweite Antwort auf „wo bin ich", und die beiden laufen beim ersten Gebrauch
 * auseinander.
 *
 * Rein und ohne `window`: `parseRoute` bekommt einen String. Ohne das wäre
 * kein Test darüber möglich.
 */

export type Route =
  | { readonly kind: 'today' }
  | { readonly kind: 'upcoming' }
  | { readonly kind: 'someday' }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'mode'; readonly mode: string };

/** Die Ansichten, wie der Server sie nennt. */
export function viewOf(route: Route): 'today' | 'upcoming' | 'someday' | 'project' {
  switch (route.kind) {
    case 'upcoming':
      return 'upcoming';
    case 'someday':
      return 'someday';
    case 'project':
      return 'project';
    default:
      return 'today';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((p) => p !== '');

  if (parts.length === 0) return { kind: 'today' };

  if (parts[0] === 'p' && parts[1] !== undefined) {
    // Eine unbekannte Id ist kein Projekt. Sonst fragt die Oberfläche den
    // Server nach etwas, das sie sich selbst ausgedacht hat.
    return UUID.test(parts[1]) ? { kind: 'project', projectId: parts[1] } : { kind: 'today' };
  }

  switch (parts[0]) {
    case 'heute':
      return { kind: 'today' };
    case 'demnaechst':
      return { kind: 'upcoming' };
    case 'irgendwann':
      return { kind: 'someday' };
    case 'suche':
      return { kind: 'mode', mode: 'search' };
    case 'workspaces':
      return { kind: 'mode', mode: 'workspaces' };
    case 'posteingang':
      return { kind: 'mode', mode: 'inbox' };
    case 'freigaben':
      return { kind: 'mode', mode: 'shares' };
    case 'papierkorb':
      return { kind: 'mode', mode: 'trash' };
    default:
      // Ein unbekannter Pfad ist Heute und nicht ein Fehlerbildschirm: wer
      // einen alten Link öffnet, will nicht wissen, dass er alt ist.
      return { kind: 'today' };
  }
}

export function pathOf(route: Route): string {
  switch (route.kind) {
    case 'today':
      return '/';
    case 'upcoming':
      return '/demnaechst';
    case 'someday':
      return '/irgendwann';
    case 'project':
      return `/p/${route.projectId}`;
    case 'mode':
      return `/${MODE_PATHS[route.mode] ?? ''}`;
  }
}

const MODE_PATHS: Record<string, string> = {
  search: 'suche',
  workspaces: 'workspaces',
  inbox: 'posteingang',
  shares: 'freigaben',
  trash: 'papierkorb',
};

/** Welcher Modus in der Schiene zu dieser Ansicht leuchtet. */
export function modeOfRoute(route: Route): string {
  return route.kind === 'mode' ? route.mode : 'tasks';
}
