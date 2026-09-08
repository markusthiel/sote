/**
 * SOTE — Geheimnisse in der Datenbank.
 *
 * Herausgezogen aus `shares.ts`, weil es jetzt **zwei** Aufrufer gibt: Freigaben
 * und Einladungen. Zwei Kopien derselben Verschlüsselung sind zwei Stellen, an
 * denen ein Verfahren gewechselt werden müsste — und eine davon wird vergessen.
 *
 * ## Wo der Schlüssel liegt
 *
 * In der **Umgebung**, nicht in der Datenbank. Läge er neben den Werten, die er
 * schützt, wäre die Verschlüsselung Theater — wer die Tabelle liest, liest den
 * Schlüssel daneben. So ist sagbar, wogegen sie schützt und wogegen nicht:
 *
 * - **Nicht** gegen jemanden mit Datenbank *und* Umgebung. Der hat die Daten
 *   ohnehin.
 * - **Doch** gegen eine Sicherung, einen Auszug, ein Protokoll — die Kopien,
 *   die weiter herumkommen als die laufende Anwendung.
 *
 * ## Der Variablenname bleibt `SOTE_SHARE_KEY`
 *
 * Er stammt von den Freigaben und ist inzwischen zu eng: er schützt auch
 * Einladungstokens. Umbenennen hieße, einen laufenden Server beim nächsten
 * Neustart ohne Schlüssel dastehen zu lassen — und zwei Namen zu lesen (neuer,
 * sonst alter) hieße, dass beide für immer gelesen werden müssen. Also bleibt
 * der Name, und die Enge steht hier.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { OutOfOrder } from './tasks.js';

/** Der Schlüssel fehlt — mit dem Namen der Variable, die ihn liefern würde. */
export class NoKey extends OutOfOrder {
  constructor() {
    super('dafür braucht dieser Server einen Schlüssel: SOTE_SHARE_KEY (32 Bytes, hex oder base64)');
  }
}

function key(): Buffer {
  const raw = process.env['SOTE_SHARE_KEY'] ?? '';
  if (raw === '') throw new NoKey();
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new NoKey();
  return buf;
}

/** Ob dieser Server Geheimnisse ablegen kann — für eine Antwort, die das sagt. */
export function keyPresent(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/*
 * AES-256-GCM, und der Zufallswert steht vorn.
 *
 * GCM und nicht CBC, weil eine veränderte Zeile auffallen soll: ohne
 * Authentifizierung wäre ein zusammengesetzter Geheimtext ein Wert, der
 * entschlüsselt und nicht stimmt — und dann müsste eine Stelle weiter oben
 * entscheiden, was das bedeutet.
 */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

/**
 * Aufmachen — oder `null`.
 *
 * `null` und keine Ausnahme: die Oberfläche soll sagen „diesen Wert können wir
 * nicht mehr anzeigen" und nicht abstürzen. Der Fall, den ein Betreiber
 * wirklich erlebt, ist ein getauschter Schlüssel, und dann muss die Zeile
 * **sichtbar bleiben** — sonst kann man sie auch nicht zurücknehmen, und das
 * ist die Funktion, auf die es ankommt.
 */
export function unseal(sealed: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[0]!, 'base64'));
    d.setAuthTag(Buffer.from(parts[1]!, 'base64'));
    return Buffer.concat([d.update(Buffer.from(parts[2]!, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
