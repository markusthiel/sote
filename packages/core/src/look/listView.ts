/**
 * SOTE — wie dicht eine Liste gezeichnet wird.
 *
 * Gemeldet: „pro Aufgabenliste auch einstellen können, ob nur die Aufgabe oder
 * die Aufgabe + zweite Zeile angezeigt wird. Vielleicht kann man da sogar ein
 * paar Anzeigevarianten machen. Auch im Hinblick, wenn man später Kanban
 * aufbauen möchte."
 *
 * ## Ein Wortschatz und kein Schalter
 *
 * Der letzte Satz entscheidet die Form. Ein Ja-Nein-Schalter („zweite Zeile:
 * an/aus") beantwortet die Frage von heute und ist am Tag der Tafel
 * wegzuräumen — ein Schalter mit zwei Zuständen wird kein Feld mit vier. Also
 * von Anfang an ein Wort, und `board` kommt später dazu, ohne dass hier etwas
 * umgebaut wird.
 *
 * ## Zwei Ebenen, und die Person gewinnt
 *
 * Auf Wunsch: *„Pro Liste und Name wäre mir lieber, jeder sollte die Liste so
 * anzeigen können wie er möchte."* Also gehört die Wahl der PERSON und der
 * Liste zusammen — nicht der Liste allein. Eine geteilte Liste, in der einer
 * auf „schmal" stellt und alle anderen es sehen, wäre dieselbe Vermischung,
 * gegen die ADR-0028 schon einmal argumentiert hat: *mein Dunkelmodus geht
 * dich nichts an, auch während wir dieselbe Seite bearbeiten.*
 *
 * Der Arbeitsbereich gibt eine VORGABE, die für alles gilt, wozu niemand etwas
 * gesagt hat — auch für Heute, Demnächst, Posteingang und Irgendwann, die gar
 * keine Liste sind und darum auch kein Feld haben können. Damit sind es nicht
 * zwei Systeme, sondern eines mit einem Rückfall.
 */

/**
 * Die Formen, in denen eine Liste erscheint.
 *
 * - `full` — Titel und Beiwerkzeile. Was es bisher gab.
 * - `plain` — nur der Titel. Für Listen, die man abarbeitet und nicht liest.
 * - `cards` — mit Luft und dem Anfang der Notiz. Für wenige, dafür dicke
 *   Einträge.
 *
 * `board` fehlt hier noch und ist der Grund für die Form dieser Liste: er wird
 * ein Wort mehr sein und keine zweite Einstellung.
 */
export const LIST_VIEWS = ['full', 'plain', 'cards'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

/**
 * Die Vorgabe, wenn niemand etwas gesagt hat.
 *
 * `full`, weil das der Stand vor dieser Einstellung war: wer nichts ändert,
 * soll nichts ändern sehen.
 */
export const DEFAULT_LIST_VIEW: ListView = 'full';

export const isListView = (value: unknown): value is ListView =>
  typeof value === 'string' && (LIST_VIEWS as readonly string[]).includes(value);

/** Was neben jeder Form steht, wenn man sie wählt. */
export const LIST_VIEW_SAYS: Record<ListView, { name: string; says: string }> = {
  full: { name: 'Voll', says: 'Titel und Beiwerk — Termin, Dauer, Schlagwörter' },
  plain: { name: 'Schmal', says: 'Nur die Titel' },
  cards: { name: 'Karten', says: 'Mit Luft und dem Anfang der Notiz' },
};

/**
 * Welche Form gilt: die der Person für diesen Ort, sonst die des Bereichs.
 *
 * Zwei Ebenen und nicht drei. Eine persönliche Vorgabe „für alle Listen" wäre
 * die dritte, und sie führt zu der Frage, die niemand beantworten kann: gilt
 * meine allgemeine Vorgabe vor der Vorgabe des Bereichs für DIESE Liste? Beide
 * Antworten sind vertretbar, und genau deshalb ist die Einstellung eine zu
 * viel.
 *
 * Unbekanntes zählt als „nichts gesagt" — dieselbe Regel wie überall in
 * `settings.ts`: ein Wort aus einer künftigen Fassung soll die gewöhnliche
 * Antwort bekommen und keine Liste, die sich nicht entscheiden kann.
 */
export function resolveListView(
  mine: unknown,
  workspace: unknown,
): ListView {
  if (isListView(mine)) return mine;
  if (isListView(workspace)) return workspace;
  return DEFAULT_LIST_VIEW;
}

/**
 * Die festen Ansichten, die keine Liste sind.
 *
 * Sie haben keine Zeile in `projects`, also auch keine Id, an der eine Wahl
 * hängen könnte — und trotzdem will man sie einstellen können. Darum tragen
 * sie ein WORT statt einer Id, und die Tabelle hat für beides eine Spalte.
 */
export const LIST_PLACES = ['today', 'upcoming', 'someday', 'inbox'] as const;
export type ListPlace = (typeof LIST_PLACES)[number];

export const isListPlace = (value: unknown): value is ListPlace =>
  typeof value === 'string' && (LIST_PLACES as readonly string[]).includes(value);
