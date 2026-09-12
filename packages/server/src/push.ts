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
import { handle } from './jobs.js';

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

/**
 * Ein Gerät abmelden — das EIGENE.
 *
 * `(user_id, endpoint)` und nicht der Endpunkt allein: wer den Endpunkt eines
 * anderen kennt (er steht im Browser dessen Geräts, nicht in einer Liste, die
 * jemand abrufen kann — aber „kennt" reicht), konnte dessen Gerät abmelden
 * (Audit 12.09.2026, F14). Ein Abonnement gehört einem Konto, und nur das
 * Konto nimmt es weg.
 */
export async function unsubscribePush(pool: Pool, userId: string, endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
    userId,
    endpoint,
  ]);
}

/** Wie viele Geräte ein Konto haben kann. Mehr als das ist ein Fehler oder ein Angriff. */
export const MAX_SUBSCRIPTIONS = 20;

/**
 * Ob eine Adresse als Push-Endpunkt taugt.
 *
 * `https:` und ein Hostname, der kein lokaler oder privater ist. KEINE Liste
 * zugelassener Dienste: Firefox mit eigenem Autopush und UnifiedPush-Nutzer
 * bringen Endpunkte mit, die auf keiner Liste stehen, und ein Produkt zum
 * Selbstbetreiben sperrt die nicht aus. Was hier fern gehalten wird, ist der
 * Server selbst und sein Netz: ein Endpunkt `https://10.0.0.5/…` liesse den
 * Server auf Zuruf HTTPS-Anfragen nach innen schicken (Audit 12.09.2026,
 * F14). Die Nutzlast ist verschlüsselt und die Antwort wird nie gelesen — der
 * Schaden ist klein, aber ein Server, der auf Zuruf irgendwohin ruft, ist
 * trotzdem ein Server, der das nicht sollte.
 */
export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  // Nackte IPv4-Adressen aus privaten und lokalen Bereichen.
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  // IPv6: loopback, link-local, unique-local.
  if (host.startsWith('[') || host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '');
    if (h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return false;
  }
  return true;
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
        // Ein Dienst, der nicht antwortet, hält sonst den ganzen Versand auf
        // (Audit 12.09.2026, F14): zehn Sekunden, dann zählt es als Fehler.
        { TTL: 60 * 60 * 24, timeout: 10_000 },
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

/**
 * Der Bearbeiter für `push.send` — der Auftrag, den `deliver()` legt.
 *
 * Er FEHLTE. `deliver()` legte seit dem ersten Tag Aufträge dieser Art (für
 * Zuweisungen und Kommentare), und kein Modul hat sie je bearbeitet: jeder
 * lief in „kein Bearbeiter", fünf Versuche, dann liegen gelassen. Nur die
 * Aufgabenerinnerungen kamen an, weil `taskReminders.ts` `pushTo` direkt
 * ruft. Gefunden im Audit vom 12.09.2026 (F08) — und vorher schon als „ob
 * Push wirklich rausgeht, ist ungetestet" notiert. Jetzt ist es getestet.
 *
 * Die Nutzlast wird GEPRÜFT und nicht geglaubt: ein Auftrag ohne `userId`
 * oder ohne Titel ist ein Programmierfehler beim Legen, und der soll als
 * Fehler im Auftrag stehen, nicht als leere Meldung auf einem Gerät.
 *
 * Ein Konto ohne Geräte ist KEIN Fehler: `pushTo` liefert 0, der Auftrag ist
 * erledigt. Die Kanalwahl hat `deliver()` schon getroffen.
 */
handle('push.send', async (ctx) => {
  const p = ctx.job.payload;
  const userId = typeof p['userId'] === 'string' ? p['userId'] : '';
  const note = p['note'] as Partial<PushNote> | undefined;
  if (userId === '' || note === undefined || typeof note.title !== 'string' || note.title === '') {
    throw new Error('push.send ohne Konto oder ohne Titel');
  }
  await pushTo(ctx.pool, userId, {
    title: note.title,
    ...(typeof note.body === 'string' ? { body: note.body } : {}),
    ...(typeof note.url === 'string' ? { url: note.url } : {}),
    ...(typeof note.tag === 'string' ? { tag: note.tag } : {}),
  });
});
