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
  /**
   * EINE AUFGABE IST EIN ORT.
   *
   * Gebraucht wurde das von der Kalender-Ausgabe: ein Eintrag im Kalender, von
   * dem man nicht zur Aufgabe kommt, ist eine Sackgasse — man liest ihn und
   * sucht dann von Hand in der Anwendung. Also braucht eine Aufgabe eine
   * Adresse, und damit gilt für sie, was für die Suche gilt: verlinkbar,
   * zurückgehen führt zurück, ein Neuladen bleibt dort
   * (`claude/suche-als-ort.md`).
   *
   * Dahinter steht „Heute", weil hinter etwas stehen muss: die Detailspalte
   * ist eine Spalte und kein Bildschirm. Welche Liste das ist, sagt der Link
   * nicht — und das ist richtig, denn eine Aufgabe kann in mehreren stehen.
   */
  | { readonly kind: 'task'; readonly taskId: string }
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
  /**
   * Der Posteingang: was noch keinen Ort hat.
   *
   * Eine Ansicht wie Heute und keine „mode"-Route mehr — er hat einen Inhalt,
   * und die Platzhalterseite hatte keinen.
   */
  | { readonly kind: 'inbox' }
  /**
   * Ein Link auf ein Projekt, ohne Konto (Konzept 10e).
   *
   * Der Token steht in der Adresse und nicht in einem Kopf: ein Link muss sich
   * weitergeben lassen, sonst ist er keiner. Der Preis steht im Konzept — er
   * liegt damit im Verlauf des Browsers und in jedem Protokoll, das Adressen
   * mitschreibt, und darum ist der Widerruf die wichtigste Funktion.
   */
  | { readonly kind: 'share'; readonly token: string }
  /**
   * Was hinausgegeben ist.
   *
   * `projectId` ist eine **Vorwahl** und kein Teil des Ortes: sie kommt vom
   * Teilen-Knopf im Baum und steht darum nicht in der Adresse. Ein Ort, der
   * eine Vorwahl in der Adresse trägt, ist ein Ort, den man versehentlich mit
   * ihr weitergibt.
   */
  | { readonly kind: 'shares'; readonly projectId?: string }
  /** Was jemand anderes getan hat und mich angeht — ohne Arbeitsbereich. */
  | { readonly kind: 'notifications' }
  /** Eine Einladung einlösen — ohne Konto, wie eine Freigabe. */
  | { readonly kind: 'invite'; readonly token: string }
  | { readonly kind: 'workspaces'; readonly section: string }
  /** Alles, was für jeden auf diesem Server gilt. */
  | { readonly kind: 'admin'; readonly section: string };

/** Die Ansichten, wie der Server sie nennt. */
export function viewOf(route: Route): 'today' | 'upcoming' | 'someday' | 'inbox' | 'project' {
  switch (route.kind) {
    case 'upcoming':
      return 'upcoming';
    case 'someday':
      return 'someday';
    case 'project':
      return 'project';
    case 'inbox':
      return 'inbox';
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

  if (parts[0] === 'einladung' && parts[1] !== undefined) {
    return /^[A-Za-z0-9_-]{20,200}$/.test(parts[1])
      ? { kind: 'invite', token: parts[1] }
      : { kind: 'today' };
  }

  if (parts[0] === 'f' && parts[1] !== undefined) {
    // Nur die Zeichen, die ein Token haben kann. Alles andere ist keine
    // Freigabe, und ein Token, das die Oberfläche erst an den Server schickt,
    // um es abgelehnt zu bekommen, ist ein Weg mehr, den es nicht braucht.
    return /^[A-Za-z0-9_-]{20,200}$/.test(parts[1])
      ? { kind: 'share', token: parts[1] }
      : { kind: 'today' };
  }

  if (parts[0] === 'a' && parts[1] !== undefined) {
    // Wie bei den Projekten: eine unbekannte Id ist keine Aufgabe.
    return UUID.test(parts[1]) ? { kind: 'task', taskId: parts[1] } : { kind: 'today' };
  }

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
      return { kind: 'inbox' };
    case 'freigaben':
      return { kind: 'shares' };
    case 'benachrichtigungen':
      return { kind: 'notifications' };
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
    case 'inbox':
      return '/posteingang';
    case 'share':
      return `/f/${route.token}`;
    case 'shares':
      return '/freigaben';
    case 'notifications':
      return '/benachrichtigungen';
    case 'invite':
      return `/einladung/${route.token}`;
    case 'project':
      return `/p/${route.projectId}`;
    case 'task':
      return `/a/${route.taskId}`;
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
  trash: 'papierkorb',
};

/** Welcher Modus in der Schiene zu dieser Ansicht leuchtet. */
export function modeOfRoute(route: Route): string {
  if (route.kind === 'search') return 'search';
  // Die Arbeitsbereiche sind ein Modus in der Schiene und keine „mode"-Route
  // mehr: sie haben einen Inhalt, und die Platzhalterseite hat keinen.
  if (route.kind === 'workspaces') return 'workspaces';
  if (route.kind === 'inbox') return 'inbox';
  if (route.kind === 'shares') return 'shares';
  if (route.kind === 'notifications') return 'notifications';
  // Die Verwaltung ist KEIN Modus. Sie steht nicht in der Schiene, weil sie
  // kein Ort ist, an dem man arbeitet — sie steht im Kontomenue, wie in SONE.
  return route.kind === 'mode' ? route.mode : 'tasks';
}

/**
 * Der ORT einer Route — das, was gleich bleiben muss, damit eine offene
 * Detailspalte noch zu dem gehört, was man sieht.
 *
 * Gemeldet, zweimal: die Spalte blieb offen beim Wechsel zu Benachrichtigungen
 * und beim Wechsel des Arbeitsbereichs — und dann, nach dem ersten Fix: „wenn
 * ich auf die Suche wechsle, bleibt die Seitenleiste offen." Der erste Fix
 * fragte „zeigt der Ort Aufgaben"; die Suche tut das, also blieb sie. Aber
 * eine Aufgabe aus „Heute" hat in der Suche nichts zu suchen. Die richtige
 * Frage ist „ist es noch DERSELBE Ort". Zwei Projekte sind zwei Orte; zwei
 * Suchabfragen sind einer (wer aus einem Treffer eine Aufgabe öffnet und dann
 * weitertippt, soll sie behalten).
 */
export function placeOf(route: Route): string {
  // Kein switch: `route.test.ts` erlaubt jeden Fall höchstens zweimal in
  // dieser Datei (lesen und schreiben), und das ist hier der dritte.
  if (route.kind === 'project') return `project:${route.projectId}`;
  if (route.kind === 'task') return `task:${route.taskId}`;
  return route.kind;
}
