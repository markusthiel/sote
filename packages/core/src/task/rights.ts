/**
 * SOTE — was eine Rolle gibt.
 *
 * Aus SONEs ADR-0087, und die Form ist dort begründet:
 *
 * > **A role is (a default list level, a set of workspace rights).** Not a bag
 * > of rights. Two parts, because the two halves of the question have different
 * > shapes.
 *
 * Die **Stufe** ist eine Leiter und bleibt vergleichbar; die **Rechte** sind
 * eine Menge, weil „darf Leute verwalten" und „darf Einstellungen ändern"
 * nichts miteinander zu tun haben und keine Reihenfolge.
 *
 * „Nur lesend" ist dann eine Rolle mit `viewer` und keinen Rechten — das fällt
 * heraus, statt gebaut zu werden.
 *
 * ## Die Liste ist geschlossen, und jeder Name bewacht etwas
 *
 * Der Satz aus ADR-0087, an dem sich das hier messen muss:
 *
 * > A settings screen offering a switch that gates nothing is worse than not
 * > offering it, because somebody will turn it off and believe something.
 *
 * **In SOTE war das schon der Fall.** Die Einrichtung verteilte
 * `people.manage`, `roles.manage` und `groups.manage` — geprüft wurde nur
 * `roles.manage`, und zwar für *alles*, auch für Leute und Einstellungen. Zwei
 * Namen standen in den Daten und bewachten nichts, und einer bewachte drei
 * Dinge, die er nicht heißt.
 *
 * `groups.manage` fehlte hier eine Zeit lang, weil es keine Gruppen gab, und
 * stand mit dem Versprechen da, im selben Commit zurückzukommen wie die Wege,
 * die es prüfen. Das ist eingehalten (Migration 0014) — vier Rechte, und jedes
 * bewacht etwas.
 *
 * Die Namen sagen, was jemand **tun** darf, und nicht, welchen Bildschirm er
 * sieht: ein Bildschirm kann umziehen.
 */

/** Die Stufe, die eine Rolle auf einem Projekt ohne eigene Regeln gibt. */
export const LIST_LEVELS = ['viewer', 'editor', 'admin'] as const;
export type ListLevel = (typeof LIST_LEVELS)[number];

/**
 * Die Rechte, geschlossen.
 *
 * Ein Eintrag hier ohne eine Prüfung im Server wäre ein Schalter, der nichts
 * tut — und dann glaubt jemand etwas, wenn er ihn ausschaltet.
 */
export const RIGHTS = [
  'people.manage',
  'roles.manage',
  'workspace.settings',
  'groups.manage',
] as const;
export type Right = (typeof RIGHTS)[number];

/** Was jedes Recht erlaubt — der Satz, der neben dem Schalter steht. */
export const RIGHT_SAYS: Record<Right, string> = {
  'people.manage': 'Leute hinzufügen, entfernen und ihre Rolle ändern',
  'roles.manage': 'Rollen anlegen und festlegen, was sie geben',
  'workspace.settings': 'Name, Zeichen, Farben, Schrift und Standard-Seite',
  'groups.manage': 'Gruppen anlegen und festlegen, wer darin ist',
};

export const isRight = (v: unknown): v is Right =>
  typeof v === 'string' && (RIGHTS as readonly string[]).includes(v);

export const isListLevel = (v: unknown): v is ListLevel =>
  typeof v === 'string' && (LIST_LEVELS as readonly string[]).includes(v);

/**
 * Liest, was gespeichert ist — und wirft weg, was die Liste nicht kennt.
 *
 * Ein Recht aus einer künftigen Fassung soll eine ältere nicht zum Absturz
 * bringen, und ein Recht aus einer *vergangenen* (etwa `groups.manage`) soll
 * nicht als Erlaubnis wiederauferstehen. Beides erledigt derselbe Filter.
 */
export function readRights(value: unknown): Right[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isRight))].sort();
}

/**
 * Darf diese Rolle das?
 *
 * **Ein Eigentümer hält jedes Recht** (ADR-0087), und zwar hier und nicht in
 * jeder Abfrage: eine Bedingung, die jeder Aufrufer selbst um `is_owner OR`
 * ergänzen muss, ist eine, die ein Aufrufer vergisst.
 */
export const allows = (
  role: { readonly rights: readonly string[]; readonly isOwner?: boolean },
  right: Right,
): boolean => role.isOwner === true || role.rights.includes(right);
