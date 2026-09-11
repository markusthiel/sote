/**
 * SOTE — echte Benachrichtigungen, auch wenn niemand hinsieht.
 *
 * GEWÜNSCHT: „Jetzt fehlt eigentlich nur noch echte Benachrichtigungen. Also
 * wenn ich als App installiere, dass es richtige App-Benachrichtigungen
 * sendet."
 *
 * ## Der Unterschied zur Klingel
 *
 * `nudge.ts` hält eine offene Verbindung zu jeder Seite, die gerade offen ist,
 * und sagt „es hat sich etwas geändert". Das ist die Hälfte, die funktioniert,
 * solange jemand hinsieht. Web-Push ist die andere: der Zustelldienst des
 * Herstellers (Apple, Google, Mozilla) nimmt eine verschlüsselte Meldung
 * entgegen und weckt den Dienstarbeiter im Browser — auch bei geschlossener
 * App.
 *
 * ## Der Schlüssel gehört der INSTANZ
 *
 * Ein VAPID-Paar weist diesen Server beim Zustelldienst aus. Es wird beim
 * ersten Bedarf erzeugt und bleibt: mit einem neuen Schlüssel sind alle
 * Abonnements ungültig, und das merkt niemand — ausser dass keine Meldung mehr
 * ankommt. Darum in der Datenbank (Migration 0036) und nicht in einer
 * Umgebungsvariablen, die beim Umzug fehlen kann.
 *
 * ## Was NICHT in der Meldung steht
 *
 * Der Zustelldienst sieht die verschlüsselte Nutzlast nicht — aber er sieht,
 * DASS jemand eine bekommt, und wie oft. Der Titel einer Aufgabe geht trotzdem
 * mit: eine Benachrichtigung, die nur „SOTE" sagt, zwingt zum Nachsehen und ist
 * damit keine Benachrichtigung, sondern eine Aufforderung. Wer das nicht will,
 * schaltet sie ab — das ist die ehrlichere Wahl als eine, die nichts sagt.
 */

import type { Pool } from 'pg';
import webpush from 'web-push';

import { queryOne, queryRows } from './db.js';

/** Woran ein Zustelldienst erkennt, wen er vor sich hat. */
const KONTAKT = 'mailto:sote@localhost';

export interface PushKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

/**
 * Das Schlüsselpaar dieser Instanz — erzeugt, falls es noch keins gibt.
 *
 * `ON CONFLICT DO NOTHING` und danach lesen: laufen zwei Bearbeiter gleichzeitig
 * los, erzeugen beide ein Paar, aber nur eines wird gespeichert — und beide
 * benutzen danach dasselbe. Ohne das hätte die eine Hälfte der Abonnements
 * einen Schlüssel, den der Server nicht mehr kennt.
 */
export async function pushKeys(pool: Pool): Promise<PushKeys> {
  const da = await queryOne<{ public_key: string; private_key: string }>(
    pool,
    'SELECT public_key, private_key FROM push_keys WHERE id',
  );
  if (da !== undefined) return { publicKey: da.public_key, privateKey: da.private_key };

  const neu = webpush.generateVAPIDKeys();
  await pool.query(
    `INSERT INTO push_keys (id, public_key, private_key) VALUES (true, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [neu.publicKey, neu.privateKey],
  );
  const jetzt = await queryOne<{ public_key: string; private_key: string }>(
    pool,
    'SELECT public_key, private_key FROM push_keys WHERE id',
  );
  return { publicKey: jetzt!.public_key, privateKey: jetzt!.private_key };
}

/**
 * Ein Gerät anmelden — oder sein vorhandenes auffrischen.
 *
 * `ON CONFLICT (endpoint)`: dasselbe Gerät, das sich neu anmeldet, bekommt
 * denselben Endpunkt. Eine zweite Zeile dafür hiesse zwei Meldungen für einen
 * Bildschirm.
 *
 * Und das KONTO wird mitgeschrieben: wechselt jemand an demselben Gerät das
 * Konto, gehört das Abonnement ab da dem neuen. Sonst bekäme der Nachfolger
 * die Erinnerungen des Vorgängers.
 */
export async function subscribePush(
  pool: Pool,
  input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    says?: string | undefined;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, says)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh  = EXCLUDED.p256dh,
           auth    = EXCLUDED.auth,
           says    = COALESCE(EXCLUDED.says, push_subscriptions.says),
           failures = 0`,
    [input.userId, input.endpoint, input.p256dh, input.auth, input.says ?? null],
  );
}

export async function unsubscribePush(pool: Pool, endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

/** Was in einer Meldung steht. */
export interface PushNote {
  readonly title: string;
  readonly body?: string;
  /** Wohin ein Tipp darauf führt — ein Weg auf diesem Server. */
  readonly url?: string;
  /**
   * Womit eine Meldung eine frühere ERSETZT.
   *
   * Zwei Erinnerungen an dieselbe Aufgabe sollen nicht zweimal untereinander
   * stehen. Der Dienstarbeiter benutzt das als `tag`.
   */
  readonly tag?: string;
}

/**
 * An alle Geräte eines Kontos.
 *
 * ## Ein erloschenes Abonnement wird weggeräumt, ein stummes nicht
 *
 * 404 und 410 sind die Antworten, mit denen ein Dienst sagt: dieses Gerät gibt
 * es nicht mehr (App gelöscht, Erlaubnis entzogen). Dann ist Löschen richtig.
 * Alles andere — Netz weg, Dienst überlastet, 500 — wird gezählt und nicht
 * gelöscht: ein gültiges Gerät wegen einer schlechten Minute abzumelden wäre
 * ein Fehler, den niemand bemerkt, bis er eine Erinnerung verpasst.
 *
 * ## Fehler brechen NICHTS ab
 *
 * Diese Funktion wird aus dem Erinnerungs-Versender gerufen, und der schreibt
 * vorher seine Quittung. Eine Meldung, die nicht zugestellt werden kann, darf
 * die Erinnerung nicht zurückrollen — sonst hinge eine Mail an einem
 * Zustelldienst, der gerade nicht erreichbar ist.
 */
export async function pushTo(pool: Pool, userId: string, note: PushNote): Promise<number> {
  const keys = await pushKeys(pool);
  const abos = await queryRows<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    pool,
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );
  if (abos.length === 0) return 0;

  webpush.setVapidDetails(KONTAKT, keys.publicKey, keys.privateKey);

  let zugestellt = 0;
  for (const abo of abos) {
    try {
      await webpush.sendNotification(
        { endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } },
        JSON.stringify(note),
        { TTL: 60 * 60 * 24 },
      );
      zugestellt += 1;
      await pool.query(
        'UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1',
        [abo.id],
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [abo.id]);
      } else {
        await pool.query(
          'UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1',
          [abo.id],
        );
      }
    }
  }
  return zugestellt;
}
