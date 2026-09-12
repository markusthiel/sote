/**
 * SOTE — welche Meldungen es gibt und wohin sie gehen.
 *
 * GEWÜNSCHT: „Bei SONE haben wir auch Antworten in Kommentaren,
 * Namensnennungen und Zuweisungen bei den Benachrichtigungen. Können wir das
 * hier auch einbauen und konfigurierbar machen, was per E-Mail benachrichtigt
 * wird, über die Oberfläche oder per App?"
 *
 * ## Drei Kanäle, von denen einer keiner ist
 *
 * Die Oberfläche (der Posteingang) ist immer an. Sie ist kein Kanal, sondern
 * der Ort, an dem eine Meldung ohnehin steht — sie abschaltbar zu machen hiesse,
 * Meldungen zu erzeugen, die niemand je sieht, und dann eine Zahl daneben
 * anzuzeigen, die niemand erklären kann.
 *
 * Wählbar sind **E-Mail** und **App**. Beides kann aus sein; dann steht die
 * Meldung nur im Posteingang, und das ist eine vollständige Antwort.
 *
 * ## Die Vorgaben sind eine ENTSCHEIDUNG, keine Bequemlichkeit
 *
 * Sie stehen hier und nicht als Vorgabewert in der Spalte: eine Vorgabe in der
 * Datenbank müsste beim Anlegen jedes Kontos für jede Art eine Zeile schreiben
 * — und bei jeder neuen Art eine Wanderung über alle Konten.
 *
 * Was gilt, folgt einer Regel: **je persönlicher, desto lauter.**
 *
 * - `assigned` — jemand legt mir etwas hin. Das ist die lauteste Sorte: Mail
 *   UND App. Wer es nicht mitbekommt, hält jemand anderen auf.
 * - `mentioned` — jemand nennt meinen Namen. Ebenso an mich gerichtet, aber es
 *   wartet niemand: App ja, Mail nein.
 * - `replied` — jemand antwortet auf MEINEN Kommentar. Wie oben.
 * - `commented` — jemand schreibt an einer Aufgabe, die mich angeht. Das ist
 *   die häufigste und am wenigsten gerichtete: nur der Posteingang. Sonst wird
 *   die App bei jedem Satz laut, und das ist der Weg, auf dem Leute Meldungen
 *   ganz abschalten.
 * - `reminder` — ich habe es mir selbst vorgenommen. Mail UND App: es ist die
 *   einzige Sorte, die zu einer bestimmten ZEIT ankommen muss.
 */

/** Die Arten, über die gemeldet wird. */
export const NOTE_KINDS = [
  'assigned',
  'mentioned',
  'replied',
  'commented',
  'reminder',
] as const;

export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Channels {
  readonly email: boolean;
  readonly push: boolean;
}

/** Wie eine Art heisst, wenn man sie jemandem zeigt. */
export const NOTE_SAYS: Record<NoteKind, { says: string; hint: string }> = {
  assigned: {
    says: 'Mir zugewiesen',
    hint: 'Jemand legt mir eine Aufgabe hin',
  },
  mentioned: {
    says: 'Mein Name genannt',
    hint: 'Jemand schreibt @mich in einen Kommentar',
  },
  replied: {
    says: 'Antwort auf mich',
    hint: 'Jemand antwortet auf meinen Kommentar',
  },
  commented: {
    says: 'Neuer Kommentar',
    hint: 'An einer Aufgabe, die mich angeht',
  },
  reminder: {
    says: 'Erinnerung',
    hint: 'Was ich mir selbst vorgenommen habe',
  },
};

/** Was gilt, solange niemand etwas eingestellt hat. */
export function channelDefaults(kind: NoteKind): Channels {
  switch (kind) {
    case 'assigned':
    case 'reminder':
      return { email: true, push: true };
    case 'mentioned':
    case 'replied':
      return { email: false, push: true };
    case 'commented':
      return { email: false, push: false };
  }
}

export const isNoteKind = (value: unknown): value is NoteKind =>
  typeof value === 'string' && (NOTE_KINDS as readonly string[]).includes(value);

/**
 * Wer in einem Text genannt wird — mit `@name`.
 *
 * GEMELDET, zweimal: „Wenn ich @Name eingebe, gibt er ein Schlagwort ein
 * anstatt einen User." — und danach: „Dann lass uns das bitte umdrehen, + für
 * Schlagwörter und @ für Personen, das ist gängiger."
 *
 * Ich hatte hier zuerst `@` geschrieben, weil es überall sonst eine Person
 * meint; SOTE las es damals als Schlagwort. Statt meine Nennung anzupassen,
 * ist jetzt die SPRACHE umgedreht — und das ist die bessere Richtung: wer eine
 * Schreibweise aus Gewohnheit falsch errät, errät sie auch im Gebrauch falsch.
 *
 * `@markus` nennt also eine Person, hier wie beim Zuweisen. Ein Zeichen, eine
 * Bedeutung.
 *
 * Gibt die NAMEN zurück, nicht die Konten: wer wirklich gemeint ist, weiss nur
 * der Server, und zwar anhand der Mitglieder dieses Arbeitsbereichs. Ein Name,
 * den es dort nicht gibt, ist dann einfach Text — so wie ein `#projekt`, das
 * es nicht gibt.
 *
 * Vor dem Zeichen muss ein Zeilenanfang oder ein Leerraum stehen: sonst würde
 * eine Mailadresse wie `a@b.de` zu einer Nennung von „b.de".
 */
export function mentionsIn(text: string): string[] {
  const namen = new Set<string>();
  for (const m of text.matchAll(/(^|\s)@([\p{L}\p{N}_.-]{2,60})/gu)) {
    namen.add(m[2]!.replace(/[.]+$/, '').toLowerCase());
  }
  return [...namen];
}
