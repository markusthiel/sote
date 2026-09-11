/**
 * SOTE — Benachrichtigungen auf dem Gerät einschalten.
 *
 * GEWÜNSCHT: „Wenn ich als App installiere, dass es richtige
 * App-Benachrichtigungen sendet."
 *
 * ## Die Erlaubnis wird auf KNOPFDRUCK gefragt, nie von selbst
 *
 * Ein Browser fragt genau einmal. Wer beim ersten Laden gefragt wird, ohne zu
 * wissen wofür, sagt nein — und danach gibt es keinen zweiten Versuch mehr,
 * ausser über die Einstellungen des Browsers, die niemand findet. Also erst
 * der Knopf, dann die Frage.
 *
 * ## Was hier nicht passiert
 *
 * Kein Zwischenspeichern, kein Offline-Betrieb. Der Dienstarbeiter zeigt
 * Meldungen an und führt Tipps darauf ins Ziel; mehr steht nicht darin.
 */

import { api } from '../api.js';

/** Ob dieses Gerät überhaupt kann. */
export const pushMoeglich = (): boolean =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * Der Schlüssel kommt als Text und muss als Bytes weiter.
 *
 * Base64url mit fehlender Polsterung — der Browser erwartet ein
 * `Uint8Array`, und eine Zeichenkette nimmt er wortlos entgegen, um danach
 * `InvalidCharacterError` zu werfen.
 */
function bytes(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const roh = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const feld = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) feld[i] = roh.charCodeAt(i);
  /*
   * Als `ArrayBuffer` und nicht als `Uint8Array`: die Typen des Browsers
   * verlangen hier einen Puffer, und ein `Uint8Array` mit geteiltem Speicher
   * ist für sie etwas anderes. Der Übersetzer hat es gemeldet, der Browser
   * hätte geschwiegen und den Schlüssel falsch gelesen.
   */
  return feld.buffer;
}

/** Wie dieses Gerät in einer Liste heissen soll. */
function geraetName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}

export type PushStand = 'aus' | 'an' | 'verweigert' | 'unmöglich';

export function pushStand(): PushStand {
  if (!pushMoeglich()) return 'unmöglich';
  if (Notification.permission === 'denied') return 'verweigert';
  return Notification.permission === 'granted' ? 'an' : 'aus';
}

/**
 * Einschalten: Arbeiter anmelden, fragen, abonnieren, dem Server sagen.
 *
 * In dieser Reihenfolge, und jede Stufe kann scheitern. Zurück kommt ein Satz,
 * warum — eine Schaltfläche, die nichts tut und nichts sagt, ist das, was man
 * danach nicht mehr anfasst.
 */
export async function pushEin(): Promise<{ ok: boolean; sagt?: string }> {
  if (!pushMoeglich()) {
    return { ok: false, sagt: 'Dieser Browser kann keine Benachrichtigungen.' };
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    /*
     * Auf `ready` warten: direkt nach `register` ist der Arbeiter noch am
     * Installieren, und `pushManager.subscribe` scheitert dann mit einer
     * Meldung, die nichts damit zu tun zu haben scheint.
     */
    await navigator.serviceWorker.ready;

    const erlaubt = await Notification.requestPermission();
    if (erlaubt !== 'granted') {
      return {
        ok: false,
        sagt:
          erlaubt === 'denied'
            ? 'Der Browser lässt keine Benachrichtigungen zu. Das lässt sich nur in seinen eigenen Einstellungen ändern.'
            : 'Ohne Erlaubnis geht es nicht.',
      };
    }

    const { key } = await api.pushKey();
    const abo = await reg.pushManager.subscribe({
      /*
       * `userVisibleOnly` ist Pflicht in Chrome: ein Abonnement, das im
       * Verborgenen etwas tun kann, gibt es dort nicht. Das passt zu dem, was
       * wir bauen — jede Meldung wird auch gezeigt.
       */
      userVisibleOnly: true,
      applicationServerKey: bytes(key),
    });

    const roh = abo.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
    if (roh.endpoint === undefined || roh.keys === undefined) {
      return { ok: false, sagt: 'Das Abonnement kam unvollständig zurück.' };
    }
    await api.pushSubscribe({ endpoint: roh.endpoint, keys: roh.keys, says: geraetName() });
    return { ok: true };
  } catch (e) {
    return { ok: false, sagt: e instanceof Error ? e.message : 'Ging nicht.' };
  }
}

/**
 * Ausschalten: beim Server abmelden UND beim Browser.
 *
 * Beides, und in dieser Reihenfolge: bliebe das Abonnement beim Browser
 * bestehen, käme die nächste Meldung trotzdem an, wenn jemand am Server die
 * Zeile wiederherstellt. Und bliebe die Zeile stehen, schickte der Server ins
 * Leere, bis der Dienst ihn korrigiert.
 */
export async function pushAus(): Promise<void> {
  if (!pushMoeglich()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = await reg?.pushManager.getSubscription();
  if (abo !== null && abo !== undefined) {
    await api.pushUnsubscribe(abo.endpoint).catch(() => undefined);
    await abo.unsubscribe().catch(() => undefined);
  }
}
