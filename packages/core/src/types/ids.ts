/**
 * SOTE — gebrandete Kennungen.
 *
 * Dasselbe Muster wie in SONE: zur Laufzeit kostenlos, verhindert aber die
 * häufigste Fehlerklasse in einem System mit vielen Id-Arten — eine ProjectId
 * dort zu übergeben, wo eine TaskId hingehört. Erzeugt wird über die
 * `as*`-Helfer, damit jede Umwandlung aus einem rohen String im Diff sichtbar
 * ist.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type LabelId = Brand<string, 'LabelId'>;
export type ShareTokenId = Brand<string, 'ShareTokenId'>;

export const asWorkspaceId = (s: string) => s as WorkspaceId;
export const asUserId = (s: string) => s as UserId;
export const asProjectId = (s: string) => s as ProjectId;
export const asTaskId = (s: string) => s as TaskId;
export const asLabelId = (s: string) => s as LabelId;
export const asShareTokenId = (s: string) => s as ShareTokenId;

/**
 * Wer geschrieben hat, ist eine UserId **oder** ein Gastschlüssel.
 *
 * Diese Unterscheidung steht hier und nicht in einer Spalte, weil sie in SONE
 * dreimal eine ganze Projektionstransaktion mitgerissen hat (ADR-0091,
 * ADR-0092): ein `guest:`-Schlüssel ist keine uuid, und wer ihn in eine
 * uuid-Spalte schreibt, wirft `22P02` mitten in einer Transaktion. Ein Typ, der
 * die beiden Fälle trennt, macht jede Stelle sichtbar, die nur den einen kennt.
 */
export type GuestKey = Brand<string, 'GuestKey'>;
export const GUEST_PREFIX = 'guest:';
export const asGuestKey = (name: string) =>
  `${GUEST_PREFIX}${name}` as GuestKey;

export type Actor =
  | { readonly kind: 'user'; readonly id: UserId }
  | { readonly kind: 'guest'; readonly key: GuestKey };

export const isGuestKey = (s: string): boolean => s.startsWith(GUEST_PREFIX);

/**
 * Fractional index für die Reihenfolge von Geschwistern.
 *
 * Ein lexikographisch sortierbarer String, nie eine Array-Position. Siehe
 * `order/fractionalIndex.ts` — und die Datenbank muss die C-Collation
 * benutzen, sonst sortiert sie diese Schlüssel um.
 */
export type FractionalIndex = Brand<string, 'FractionalIndex'>;
export const asFractionalIndex = (s: string) => s as FractionalIndex;
