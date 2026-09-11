/**
 * SOTE — was ein Schlagwort ist.
 *
 * Bis hierher war es: was auch immer hinter einem `@` stand. Die Tabellen gab
 * es seit Migration 0001, der Schnellerfasser schrieb sie, die Suche filterte
 * darauf — aber niemand hat je entschieden, welche Zeichenkette ein Name sein
 * darf. Das Ergebnis wäre absehbar gewesen: `Haus`, `haus` und `Haus ` als drei
 * Schlagwörter, die aussehen wie eines.
 *
 * ## Ein Wort, kein Satz
 *
 * Ein Schlagwort ist EIN Wort ohne Leerzeichen, und das ist keine
 * Bequemlichkeit des Parsers, sondern die Bedingung dafür, dass es auffindbar
 * bleibt: geschrieben wird es als `@unterwegs`, gesucht wird es als
 * `@unterwegs`, und ein Leerzeichen beendet beide. Ein Schlagwort „zu hause"
 * wäre eines, das man mit derselben Sprache nicht wiederfindet, in der man es
 * angelegt hat — und die Suche würde stattdessen nach `@zu` fragen und `hause`
 * als Wort im Titel lesen.
 *
 * Darum ABGELEHNT und nicht stillschweigend umgeschrieben. Ein Bindestrich
 * statt des Leerzeichens wäre eine Entscheidung, die jemand anders getroffen
 * hat als der, der es getippt hat — und die Zeile sagt hinterher nicht, warum
 * dort etwas anderes steht.
 *
 * ## Gleich ist gleich, ohne Rücksicht auf Groß und Klein
 *
 * `sameLabel` ist der Vergleich, den ALLE Stellen benutzen: die Suche tat es
 * schon (`lower(l.name)`), das Anlegen nicht — `ON CONFLICT (workspace_id,
 * name)` ist ein Vergleich Zeichen für Zeichen. Wer `@Haus` tippte, bekam ein
 * zweites Schlagwort neben `@haus`, und beide sahen in einer Liste gleich aus.
 * Die Schreibweise, die zuerst da war, bleibt stehen; jede spätere Nennung
 * findet sie wieder.
 */

/** So lang, dass jedes echte Wort passt, und kurz genug für eine Zeile. */
export const MAX_LABEL = 40;

/**
 * Ein getippter Name als Schlagwort — oder `undefined`, wenn es keines ist.
 *
 * Nur Rand-Leerzeichen fallen weg. Alles andere bleibt, wie es getippt wurde:
 * Groß- und Kleinschreibung ist die Entscheidung dessen, der es anlegt
 * (`sameLabel` vergleicht ohnehin ohne sie), und Umlaute, Ziffern und
 * Bindestriche sind Teil normaler Wörter.
 *
 * Abgelehnt wird:
 *
 * - Leeres.
 * - Etwas mit Leerzeichen darin — siehe oben.
 * - Etwas, das mit einem der Zeichen der Erfassung beginnt (`#@+!~`): `@@haus`
 *   entstünde aus einem verrutschten Finger, und `@#haus` sähe in der Zeile aus
 *   wie ein Projekt.
 * - Länger als `MAX_LABEL`.
 */
export function normalizeLabel(text: string): string | undefined {
  const name = text.trim();
  if (name === '') return undefined;
  if (/\s/.test(name)) return undefined;
  if (/^[#@+!~]/.test(name)) return undefined;
  if (name.length > MAX_LABEL) return undefined;
  return name;
}

/** Zwei Namen, die dasselbe Schlagwort meinen. */
export function sameLabel(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/**
 * Eine Liste von Namen, entdoppelt — die erste Schreibweise gewinnt.
 *
 * Gebraucht an jeder Stelle, die eine ganze Liste schreibt: `['Haus', 'haus']`
 * ist ein Schlagwort und nicht zwei, und ohne dieses Zusammenfassen wäre die
 * Reihenfolge der beiden Einfügungen die Antwort darauf, welche Schreibweise
 * gilt.
 */
export function uniqueLabels(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = normalizeLabel(raw);
    if (name === undefined) continue;
    if (out.some((have) => sameLabel(have, name))) continue;
    out.push(name);
  }
  return out;
}
