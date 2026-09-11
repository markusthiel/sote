/**
 * SOTE — wie eine Aufgabe aussieht.
 *
 * GEWÜNSCHT: „Könnte man die noch gestalten? Ein Icon, das dann vor dem Titel
 * angezeigt wird, Textfarbe und Hintergrundfarbe für die Kartenansicht." Und
 * auf die Rückfrage, woher es kommen soll: *„Das würde ich mehrstufig machen:
 * Sie kann vom Projekt kommen oder vom Schlagwort, und darüber hinaus kann sie
 * manuell noch einzeln gefärbt werden."*
 *
 * ## Drei Ebenen, Feld für Feld
 *
 * Projekt, dann Schlagwort, dann die Aufgabe selbst — und **gefüllt statt
 * ersetzt**: wer nur ein Zeichen an die Aufgabe hängt, behält die Farbe seines
 * Projekts. Ein Ersetzen des ganzen Objekts würde eine Angabe zu einem
 * Verzicht auf alle anderen machen. Dieselbe Regel wie bei `resolveLook` für
 * den Arbeitsbereich, und aus demselben Grund.
 *
 * Die Reihenfolge steigt von der ALLGEMEINSTEN zur genauesten Aussage: ein
 * Projekt gilt für hundert Aufgaben, ein Schlagwort für zwanzig, die Aufgabe
 * für sich. Wer genauer wird, überschreibt.
 *
 * ## Warum EINE Farbe und nicht zwei
 *
 * Gewünscht waren Textfarbe und Hintergrundfarbe. Zwei frei wählbare Farben
 * erlauben aber jede Kombination, auch Weiß auf Weiß — und die entsteht nicht
 * aus Bosheit, sondern weil jemand den Hintergrund einer Karte ändert und
 * vergisst, dass er vor drei Wochen die Schrift gesetzt hat.
 *
 * Also EINE Farbe, aus der beides folgt: die Schrift trägt sie, die Karte
 * bekommt sie als leise Tönung. Das Verhältnis rechnet das Stylesheet und
 * nicht der Mensch — und es ist in Hell wie Dunkel richtig, was zwei feste
 * Farben nie sein können.
 *
 * ## Was das NICHT ist
 *
 * Keine zweite Dringlichkeit. Die steht im Kästchen und ist eine Aussage über
 * das Wann; dies ist eine über die ART einer Aufgabe („Telefonat", „Rechnung",
 * „Werkstatt"). Wer Farbe als Dringlichkeit benutzt, bekommt zwei Antworten
 * auf dieselbe Frage — davor kann eine Bauform nicht schützen, aber sie soll
 * es auch nicht nahelegen: darum erbt die Farbe vom PROJEKT und vom
 * SCHLAGWORT, den beiden Dingen, die eine Art beschreiben.
 */

/** Was an einer Aufgabe (oder einer ihrer Ebenen) über das Aussehen steht. */
export interface TaskLook {
  /** Ein Zeichenname wie bei Projekten — `undefined` heißt keines. */
  readonly icon?: string;
  /** Ein Palettenname oder ein `#rrggbb`; dieselben zwei Schreibweisen wie überall. */
  readonly color?: string;
}

/** Liest, was dasteht — und lässt weg, was keinen Sinn ergibt. */
export function readTaskLook(value: unknown): TaskLook {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const icon = typeof raw['icon'] === 'string' && raw['icon'] !== '' ? raw['icon'] : undefined;
  const color = typeof raw['color'] === 'string' && raw['color'] !== '' ? raw['color'] : undefined;
  return {
    ...(icon === undefined ? {} : { icon }),
    ...(color === undefined ? {} : { color }),
  };
}

/**
 * Ob ein Wert als Aussehen angenommen werden darf.
 *
 * Wie beim Titelbild getrennt vom Lesen: `read` fragt „was kann ich zeichnen",
 * dies fragt „darf das herein". Ein Schreibweg, der still filtert, nimmt
 * jemandem die Rückmeldung, dass seine Eingabe nicht angekommen ist.
 */
export function isTaskLook(value: unknown): boolean {
  if (value === null) return true; // So nimmt man es weg.
  if (typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'icon' && key !== 'color') return false;
    if (raw[key] !== undefined && typeof raw[key] !== 'string') return false;
  }
  return true;
}

/**
 * Was gilt: die Aufgabe über das Schlagwort über das Projekt.
 *
 * Feld für Feld, nicht Objekt für Objekt. Ein Zeichen an der Aufgabe nimmt ihr
 * nicht die Farbe ihres Projekts.
 *
 * ## Mehrere Schlagwörter: das ERSTE, das etwas sagt
 *
 * Eine Aufgabe kann „@haus" und „@dringend" tragen, und beide könnten eine
 * Farbe haben. Zu mischen wäre Unsinn (aus rot und blau wird kein drittes
 * Schlagwort), und alle anzuzeigen ginge nicht — es ist eine Farbe.
 *
 * Also das erste in der Reihenfolge, in der sie an der Aufgabe stehen, und die
 * ist alphabetisch und damit stabil. Vorhersagbar ist hier mehr wert als
 * klug: wer die Farbe eines bestimmten Schlagworts sehen will, hängt sie an
 * die Aufgabe.
 */
export function resolveTaskLook(
  own: TaskLook,
  labels: readonly TaskLook[],
  project: TaskLook,
): TaskLook {
  const vomSchlagwort = labels.find((l) => l.color !== undefined || l.icon !== undefined) ?? {};
  const icon = own.icon ?? vomSchlagwort.icon ?? project.icon;
  const color = own.color ?? vomSchlagwort.color ?? project.color;
  return {
    ...(icon === undefined ? {} : { icon }),
    ...(color === undefined ? {} : { color }),
  };
}
