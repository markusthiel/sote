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
  /**
   * Die Suche trägt ihre Abfrage **in der URL**.
   *
   * Ein String, drei Schreiber: das Feld über dem Baum, das Feld im Bildschirm
   * und jedes Bedienelement im Panel. Eine Kopie im Komponentenzustand wäre
   * eine zweite Antwort auf „wonach wird gesucht", und die beiden laufen beim
   * ersten Gebrauch auseinander (SONE, `claude/suche-als-ort.md`).
   */
  | { readonly kind: 'search'; readonly q: string }
  | { readonly kind: 'mode'; readonly mode: string }
  /**
   * Einstellungen sind ein **Ort**, keine Klappe.
   *
   * Also eine Adresse: man kann sie verlinken, zurückgehen führt zurück, und
   * ein Neuladen bleibt dort. Ein Dialog kann das alles nicht (SONEs ADR-0027).
   */
  | { readonly kind: 'settings'; readonly section: string }
  /**
   * Die Arbeitsbereiche, und was an diesem einen einzustellen ist.
   *
   * Ein eigener Ort und keine Rubrik in den Einstellungen — so liegt es in
   * SONE, und die Aufteilung ist begründet: die Einstellungen sind **deine**,
   * ein Arbeitsbereich gehört **allen** darin. Wer sein Dunkelgrau sucht und
   * dabei über die Farben eines Teams stolpert, hat den falschen Bereich
   * gefunden.
   */
  | { readonly kind: 'workspaces'; readonly section: string }
  /** Alles, was für jeden auf diesem Server gilt. */
  | { readonly kind: 'admin'; readonly section: string };

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

export function parseRoute(pathname: string, queryString = ''): Route {
  const parts = pathname.split('/').filter((p) => p !== '');

  if (parts[0] === 'suche') {
    return { kind: 'search', q: new URLSearchParams(queryString).get('q') ?? '' };
  }

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
    case 'posteingang':
      return { kind: 'mode', mode: 'inbox' };
    case 'freigaben':
      return { kind: 'mode', mode: 'shares' };
    case 'papierkorb':
      return { kind: 'mode', mode: 'trash' };
    case 'einstellungen':
      // Ohne Abschnitt der erste. Ein Bildschirm, der auf eine leere Auswahl
      // zeigt, ist ein Bildschirm, den man erst bedienen muss, um etwas zu
      // sehen.
      return { kind: 'settings', section: parts[1] ?? 'profil' };
    case 'workspaces':
      return { kind: 'workspaces', section: parts[1] ?? 'alle' };
    case 'verwaltung':
      return { kind: 'admin', section: parts[1] ?? 'instanz' };
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
    case 'search':
      return route.q === '' ? '/suche' : `/suche?q=${encodeURIComponent(route.q)}`;
    case 'settings':
      return `/einstellungen/${route.section}`;
    case 'workspaces':
      return `/workspaces/${route.section}`;
    case 'admin':
      return `/verwaltung/${route.section}`;
    case 'mode':
      return `/${MODE_PATHS[route.mode] ?? ''}`;
  }
}

const MODE_PATHS: Record<string, string> = {
  search: 'suche',
  inbox: 'posteingang',
  shares: 'freigaben',
  trash: 'papierkorb',
};

/** Welcher Modus in der Schiene zu dieser Ansicht leuchtet. */
export function modeOfRoute(route: Route): string {
  if (route.kind === 'search') return 'search';
  // Die Arbeitsbereiche sind ein Modus in der Schiene und keine „mode"-Route
  // mehr: sie haben einen Inhalt, und die Platzhalterseite hat keinen.
  if (route.kind === 'workspaces') return 'workspaces';
  // Die Verwaltung ist KEIN Modus. Sie steht nicht in der Schiene, weil sie
  // kein Ort ist, an dem man arbeitet — sie steht im Kontomenue, wie in SONE.
  return route.kind === 'mode' ? route.mode : 'tasks';
}
