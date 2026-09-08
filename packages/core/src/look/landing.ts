/**
 * SOTE — wo du landest.
 *
 * Aus SONEs Bild und aus ADR-0072, dessen offener Punkt hier zugeht:
 *
 * > **Arriving and pressing the mark are different questions.** Arriving — a
 * > fresh load, a sign-in, a switch of workspace — means the landing setting in
 * > full, including „the page I was last on". Pressing the mark later cannot
 * > mean that, because you are on that page.
 *
 * Genau das war in SOTE noch falsch: die Marke führte immer nach Heute, also
 * tat sie von Heute aus nichts.
 *
 * ## Zwei Ebenen, und die Person gewinnt
 *
 * Anders als beim Aussehen (ADR-0028: der Arbeitsbereich gestaltet, was alle
 * sehen) und aus SONEs eigener Begründung in ADR-0032:
 *
 * > **„Where you land"** is about a workspace, and it belongs to **you**: the
 * > value is one person's choice of where their own session opens. Two members
 * > of a workspace have different answers, so it cannot be a property of the
 * > workspace.
 *
 * Der Arbeitsbereich setzt trotzdem eine Vorgabe — für alle, die selbst nichts
 * gewählt haben. Das ist kein Widerspruch: eine Vorgabe ist ein Vorschlag, und
 * die Wahl der Person schlägt ihn.
 *
 * ## Was SOTE anders macht als SONE, und warum
 *
 * In SONE gilt die persönliche Wahl **je Arbeitsbereich**. Hier gilt sie für
 * die Person, weil die Einstellungen je Person und nicht je Paar (Person,
 * Arbeitsbereich) liegen — eine dritte Ebene dafür einzuführen wäre eine
 * Tabelle für einen Fall, den es bei einem Arbeitsbereich je Konto noch nicht
 * gibt. **Benannt statt versteckt:** sobald jemand in zwei Arbeitsbereichen
 * arbeitet und dort verschieden landen will, ist das die Stelle, die sich
 * ändern muss.
 *
 * Ein **bestimmtes Projekt** ist ohnehin an einen Arbeitsbereich gebunden.
 * Liegt es nicht in dem, den man öffnet, gilt der Rückfall — eine Adresse auf
 * ein Projekt, das es hier nicht gibt, wäre ein Fehler beim Ankommen, und
 * ankommen soll nicht fehlschlagen.
 */

/** Die Orte, an denen eine Sitzung aufgehen kann. */
export const LANDINGS = ['last', 'today', 'inbox', 'project'] as const;
export type LandingKind = (typeof LANDINGS)[number];

export interface Landing {
  readonly kind: LandingKind;
  /** Nur bei `project`, und nur gültig im eigenen Arbeitsbereich. */
  readonly projectId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Liest, was gespeichert ist.
 *
 * `project` **ohne** Id ist keine Angabe: „ein bestimmtes Projekt, aber ich
 * sage nicht welches" ist kein Ort. Es fällt darum ganz heraus, statt zu einem
 * halben Zustand zu werden, den die Oberfläche später auflösen müsste.
 */
export function readLanding(value: unknown): Landing | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !(LANDINGS as readonly string[]).includes(kind)) {
    return undefined;
  }
  if (kind !== 'project') return { kind: kind as LandingKind };
  const id = raw['projectId'];
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  return { kind: 'project', projectId: id };
}

/**
 * Wo diese Person in diesem Arbeitsbereich landet.
 *
 * Person schlägt Arbeitsbereich schlägt `today`. `today` als letzter Rückfall
 * und nicht `last`: beim allerersten Anmelden gibt es kein „zuletzt", und ein
 * Rückfall, der auf einen leeren Speicher zeigt, bräuchte selbst einen
 * Rückfall.
 */
export function resolveLanding(user: Landing | undefined, workspace: Landing | undefined): Landing {
  return user ?? workspace ?? { kind: 'today' };
}
