/**
 * SOTE — das Titelbild einer Aufgabe.
 *
 * GEWÜNSCHT: „Kann man ein Bild auch als Headerbild für Kanban einstellen? Also
 * bei der Aufgabe. Ein Vollbild, gecroppt, das die Karte einleitet, darunter
 * dann erst die eigentliche Karte."
 *
 * Nachgebaut aus SONEs ADR-0117/0162 (`claude/titelbild-und-erscheinung.md`),
 * und zwar die Form, nicht der Ort: dort steht es über der Überschrift einer
 * Seite, hier über dem Inhalt einer Karte. Die Regeln darunter sind dieselben,
 * und sie sind dort teuer gelernt.
 *
 * ## Warum `jsonb` und nicht `cover_url text`
 *
 * SONE hatte genau diese Textspalte, und sie war der Fehler: zwei der drei
 * Dinge, die ein Titelbild sein kann — eine Farbe, ein Verlauf — sind keine
 * URLs. *„Eine Spalte, die ein Drittel der Antwort halten kann, ist schlimmer
 * als eine, die gar nichts hält."*
 *
 * Also von Anfang an ein Objekt. Eine Farbe ist hier kein Beiwerk: SOTE färbt
 * Projekte, Arbeitsbereiche und die Fertig-Spalte, und eine Karte ohne
 * passendes Bild mit einer Farbe einzuleiten ist dieselbe Sache mit weniger
 * Aufwand.
 *
 * ## „Kein fremdes Bild" steht im WERT, nicht im Auswahlmenü
 *
 * Ein Titelbild wird bei jedem Zeichnen geladen. Eine fremde URL darin ist eine
 * Karte, die jeden Betrachter bei jemand anderem meldet — ein Zählpixel im
 * Titelbild-Kostüm. Darum wird nur der eigene Anhangsweg angenommen, an beiden
 * Enden verankert: `/api/tasks/<uuid>/files/<uuid>`.
 *
 * Ein Auswahlmenü ist nur EIN Weg, wie ein Wert hereinkommt; die Route ist der
 * andere, und sie muss dieselbe Regel tragen.
 *
 * ## Kaputt heißt abgelehnt, nicht geleert
 *
 * `null` ist, wie man ein Titelbild entfernt. Ein fehlerhaftes als „lösch es"
 * zu lesen wäre die schlechteste verfügbare Deutung — SONEs Satz, und er gilt
 * hier genauso.
 */

/** Was ein Titelbild sein kann. */
export interface TaskCover {
  /** Ein eigener Anhang: `/api/tasks/<uuid>/files/<uuid>`. */
  readonly image?: string;
  /** Ein Palettenname oder ein `#rrggbb` — dieselben zwei Schreibweisen wie überall. */
  readonly color?: string;
}

const ANHANG =
  /^\/api\/tasks\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/;

/** Nur der eigene Anhangsweg, an beiden Enden verankert. */
export const isOwnFile = (value: unknown): value is string =>
  typeof value === 'string' && ANHANG.test(value);

/**
 * Liest, was dasteht — und gibt `undefined`, wenn nichts Brauchbares dasteht.
 *
 * `undefined` heißt „kein Titelbild", und das ist die Antwort für eine Aufgabe,
 * die keines hat. Fehlerhafte Werte ABZULEHNEN ist Sache des Schreibwegs (der
 * Server antwortet 422); hier wird gelesen, und eine Aufgabe mit kaputtem
 * Titelbild verliert ihr Titelbild, nie ihren Platz in der Liste.
 */
export function readTaskCover(value: unknown): TaskCover | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;

  const image = isOwnFile(raw['image']) ? raw['image'] : undefined;
  /*
   * Eine Farbe wird hier NICHT gegen die Palette geprüft.
   *
   * Ein Palettenname ist gültig, ein Hex-Wert auch, und was keins von beidem
   * ist, macht `colorValue` zu nichts — dieselbe Kette wie bei Projekten und
   * Arbeitsbereichen. Eine zweite Prüfliste hier wäre eine zweite Antwort auf
   * „welche Farben gibt es".
   */
  const color = typeof raw['color'] === 'string' && raw['color'] !== '' ? raw['color'] : undefined;

  if (image === undefined && color === undefined) return undefined;
  return {
    ...(image === undefined ? {} : { image }),
    ...(color === undefined ? {} : { color }),
  };
}

/**
 * Ob ein Wert als Titelbild angenommen werden darf.
 *
 * Getrennt vom Lesen, weil die beiden verschiedene Fragen beantworten: `read`
 * fragt „was davon kann ich zeichnen", dies fragt „darf das hereinkommen". Ein
 * Schreibweg, der still das Brauchbare herausfiltert, nimmt jemandem die
 * Rückmeldung, dass sein Bild nicht angekommen ist.
 */
export function isTaskCover(value: unknown): boolean {
  if (value === null) return true; // So nimmt man es weg.
  if (typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'image' && key !== 'color') return false;
  }
  if (raw['image'] !== undefined && !isOwnFile(raw['image'])) return false;
  if (raw['color'] !== undefined && typeof raw['color'] !== 'string') return false;
  return raw['image'] !== undefined || raw['color'] !== undefined;
}

/**
 * Welche Arten der Browser im eigenen Fenster zeigen DARF.
 *
 * GEMELDET: „Wenn ich ein PDF hochlade und dann auf Ansehen klicke, geht das
 * Modal auf und dann startet doch wieder der Download."
 *
 * Die Ursache ist eine Kopfzeile: der Server liefert jeden Anhang mit
 * `content-disposition: attachment`, und das heisst „speichern, nicht zeigen".
 * Ein `<img>` kümmert sich nicht darum — darum gingen Bilder —, ein `<object>`
 * mit einem PDF schon.
 *
 * ## Warum nicht einfach `inline` für alles
 *
 * Weil `attachment` dort kein Versehen war, sondern der Grund, aus dem es
 * dasteht: eine hochgeladene HTML-Datei, die der Browser IM Fenster dieser
 * Anwendung öffnet, läuft unter unserer Adresse und kann an die Sitzung. Das
 * gilt für `text/html` und für `image/svg+xml`, das ein Dokument mit Skript
 * sein kann, sobald es nicht in einem `<img>` steckt.
 *
 * Also eine LISTE dessen, was gezeigt werden darf, und nicht eine Liste des
 * Verbotenen: was morgen dazukommt, ist zuerst verboten und wird geprüft,
 * bevor es erlaubt wird. Andersherum wäre jede neue Art erlaubt, bis jemand
 * merkt, dass sie es nicht sein sollte.
 */
export function isInlineSafe(mimeType: string): boolean {
  const t = mimeType.toLowerCase();
  // SVG ausdrücklich nicht: als `<img>` harmlos, als Dokument ein Skriptträger.
  if (t === 'image/svg+xml') return false;
  if (t.startsWith('image/')) return true;
  if (t === 'application/pdf') return true;
  if (t.startsWith('video/')) return true;
  if (t.startsWith('audio/')) return true;
  // Reiner Text ja, HTML nein — und `text/*` allein schliesst HTML ein.
  if (t === 'text/plain' || t === 'text/csv' || t === 'text/markdown') return true;
  return false;
}
