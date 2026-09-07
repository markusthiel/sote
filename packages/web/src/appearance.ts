/**
 * SOTE — wie die Oberfläche aussieht.
 *
 * Nachgebaut aus SONEs `useAppearance.ts`, mit derselben Aufteilung — und die
 * ist der ganze Punkt (SONEs ADR-0124):
 *
 * > **Die Größen gehören dem Browser und das Schema nicht.** Eine Textgröße ist
 * > eine Eigenschaft des Bildschirms, vor dem jemand sitzt: was auf dem Telefon
 * > passt, ist auf einem 27-Zoll-Monitor falsch, und ein Abgleich machte die
 * > Einstellung des einen Geräts zum Problem des anderen. Eine Vorliebe für
 * > dunkel ist eine Eigenschaft der **Person** — wer auf dem Rechner dunkel
 * > gewählt hat, will am Telefon nicht hell.
 *
 * ## Die Kopie der Antwort
 *
 * Im Speicher des Browsers liegt **eine Kopie der Antwort, nicht die Antwort**.
 * Das erste Zeichnen passiert, bevor die Sitzung geladen ist, und wer dunkel
 * liest, darf keine halbe Sekunde lang eine weiße Seite sehen. Also wird das
 * zuletzt aufgelöste Schema gemerkt und sofort angewandt; sobald die Sitzung da
 * ist, gilt sie und die Kopie wird nachgezogen.
 *
 * SONEs Satz dazu, der die Reihenfolge erklärt: „an interface that changes
 * colour a second after it appears is worse than one that was the wrong colour
 * to begin with."
 *
 * ## Auf `<html>`, nicht über React
 *
 * Als Attribut am Wurzelelement, damit das **ganze Dokument** antwortet — auch
 * was React nicht besitzt. In SOTE ist das heute wenig; in SONE ist es der
 * Editor, und die Regel ist dieselbe.
 */

import { isScheme, type Scheme } from '@sote/core';
import { useEffect } from 'react';

/** Wo die Kopie liegt. Ein Name, damit sie nicht zweimal woanders steht. */
const REMEMBERED = 'sote.scheme';

/**
 * Was gerade gilt, aus der Kopie.
 *
 * Wird von `main.tsx` aufgerufen, **bevor** React etwas zeichnet. Fällt der
 * Zugriff aus — privater Modus, gesperrter Speicher —, ist die Antwort
 * `system`, und das ist die richtige Rückfallebene: das Gerät weiß immer etwas.
 */
export function rememberedScheme(): Scheme {
  try {
    const saved = window.localStorage.getItem(REMEMBERED);
    return isScheme(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Setzt das Schema auf `<html>` und merkt es.
 *
 * **`data-theme` hat einen Schreiber**, und das war schon SOTEs Regel, bevor es
 * eine Einstellung gab: in SONE lag der Fehler mehrfach darin, dass ein Wert
 * dort gesetzt wurde, wo das System gefragt wird, und dort vergessen, wo die
 * Person steht (ADR-0124, ADR-0135).
 *
 * Also steht das Attribut **immer** — auch bei `system`, wo es aus der
 * Medienabfrage kommt. Meine erste Fassung entfernte es bei `system` und
 * verließ sich auf eine `prefers-color-scheme`-Regel im Stylesheet. Die gibt es
 * hier nicht: SOTEs CSS hängt an `[data-theme="dark"]`. Das hätte jeden, der
 * „wie das Gerät" wählt, ins Helle geschickt, egal was das Gerät sagt.
 *
 * Der Hörer auf die Medienabfrage bleibt darum bestehen und wird bei jedem
 * Wechsel neu ausgewertet — wer nachts den Systemmodus umstellt, soll nicht
 * neu laden müssen.
 */
const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

let chosen: Scheme = 'system';

function paint(): void {
  const dark = chosen === 'dark' || (chosen === 'system' && media?.matches === true);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
}

export function applyScheme(scheme: Scheme): void {
  chosen = scheme;
  paint();
  try {
    window.localStorage.setItem(REMEMBERED, scheme);
  } catch {
    // Ohne Speicher blitzt beim nächsten Laden kurz das falsche Thema auf.
    // Das ist unschön und kein Grund, das Anwenden zu unterlassen.
  }
}

/** Einmal beim Start: die gemerkte Antwort anwenden und am Gerät dranbleiben. */
export function startAppearance(): void {
  applyScheme(rememberedScheme());
  media?.addEventListener('change', paint);
}

/** Wendet an, was die Sitzung sagt — und zieht die Kopie nach. */
export function useScheme(scheme: Scheme | undefined): void {
  useEffect(() => {
    if (scheme === undefined) return;
    applyScheme(scheme);
  }, [scheme]);
}
