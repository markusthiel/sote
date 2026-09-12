/**
 * SOTE — Single-Sign-on über OIDC.
 *
 * ## SSO meldet an, es lädt nicht ein
 *
 * Der Grundsatz, der hier schon gilt (SONEs ADR-0073): **die Instanz lädt
 * ein.** Ein SSO, das Konten von selbst anlegt, bricht das — dann bekommt
 * jeder ein Konto, der im Verzeichnis des Anbieters steht. Also meldet SSO an,
 * wer schon ein Konto hat, und eine **Einladung** lässt sich damit annehmen.
 *
 * ## Nur der Code-Fluss, und keine Prüfung der ID-Token-Signatur
 *
 * Das ist eine Entscheidung und keine Auslassung. Der Autorisierungscode wird
 * **vom Server** gegen ein Token getauscht — eine direkte TLS-Verbindung zum
 * Anbieter, mit dem Client-Geheimnis. Was auf diesem Weg zurückkommt, ist
 * damit schon beglaubigt: es kommt vom Anbieter, weil TLS das sagt, und für
 * uns, weil das Geheimnis das sagt.
 *
 * Eine Signaturprüfung bräuchte JWKS holen, Schlüssel drehen, Algorithmen
 * ausschließen (`alg: none`, `HS256` mit dem öffentlichen Schlüssel als
 * Geheimnis) — lauter Ecken, an denen man es falsch macht. Sie wäre nötig,
 * wenn ein **Browser** das Token mitbrächte; hier tut das niemand.
 *
 * Die Angaben über die Person holen wir darum von `userinfo` und nicht aus dem
 * ID-Token: derselbe beglaubigte Weg, ohne einen zweiten Prüfpfad.
 *
 * ## Wogegen `state` und PKCE schützen
 *
 * `state` gegen eine untergeschobene Antwort: ohne ihn kann jemand ein
 * Anmeldeergebnis in einen fremden Browser schieben. PKCE (`code_verifier`)
 * beweist, dass **derselbe Server** den Code einlöst, der ihn angefordert
 * hat. Beide liegen auf dem **Server**.
 *
 * Und das war eine Zeit lang die halbe Wahrheit. Hier stand: „ein `state`,
 * den der Browser selbst mitbringt, schützt gegen nichts." Gegen eine
 * gefälschte Antwort stimmt das. Aber nichts band den Vorgang an den
 * BROWSER, der ihn begonnen hat — wer `/api/sso/start` aufrief und die
 * Rückkehradresse des Anbieters in einen fremden Browser schob, meldete den
 * Fremden als sich selbst an (Login-CSRF, Audit 12.09.2026, F11). PKCE kann
 * das nicht sehen: es beweist, wer den Code einlöst, nicht, wer die Antwort
 * hält. Darum jetzt ein drittes Geheimnis, das NUR im Browser liegt
 * (`sote_sso`-Keks, zehn Minuten, nur für `/api/sso/`), und sein Hash am
 * Vorgang. Der Callback braucht `state` aus der Adresse UND das Geheimnis
 * aus dem Keks.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

import { queryOne } from './db.js';
import { OutOfOrder } from './tasks.js';

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Wie der Knopf heißt — sonst steht dort „Single-Sign-on", was nichts sagt. */
  label: string;
}

export function ssoConfig(): SsoConfig | undefined {
  const issuer = (process.env['SOTE_OIDC_ISSUER'] ?? '').trim().replace(/\/+$/, '');
  const clientId = process.env['SOTE_OIDC_CLIENT_ID'] ?? '';
  const clientSecret = process.env['SOTE_OIDC_CLIENT_SECRET'] ?? '';
  if (issuer === '' || clientId === '' || clientSecret === '') return undefined;
  if (!issuer.startsWith('https://')) {
    /*
     * Kein `http://`, auch nicht „nur im Netz drinnen".
     *
     * Über diese Verbindung geht das Client-Geheimnis und kommen die Angaben
     * über die Person zurück. Eine Ausnahme für Testaufbauten wäre eine
     * Ausnahme, die jemand im Betrieb stehen lässt.
     */
    return undefined;
  }
  return {
    issuer,
    clientId,
    clientSecret,
    label: process.env['SOTE_OIDC_LABEL'] ?? 'Single-Sign-on',
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let discovered: { issuer: string; doc: Discovery } | undefined;

/**
 * Die Adressen des Anbieters, von ihm selbst.
 *
 * Einmal geholt und behalten: sie ändern sich nicht im Betrieb, und ein Abruf
 * je Anmeldung wäre ein fremder Server auf dem Weg zum Anmeldeknopf.
 *
 * Gemerkt **mit dem Aussteller als Schlüssel** — sonst zeigt ein Server nach
 * einer Umkonfiguration noch auf den alten Anbieter, bis jemand neu startet.
 */
export async function discovery(cfg: SsoConfig): Promise<Discovery> {
  if (discovered?.issuer === cfg.issuer) return discovered.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new OutOfOrder(`der Anbieter antwortet nicht (${res.status})`);
  const doc = (await res.json()) as Partial<Discovery>;
  if (
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.userinfo_endpoint !== 'string'
  ) {
    throw new OutOfOrder('der Anbieter nennt nicht alle nötigen Adressen');
  }
  discovered = { issuer: cfg.issuer, doc: doc as Discovery };
  return discovered.doc;
}

/** Nur für Tests: die gemerkten Adressen wegwerfen. */
export function resetDiscovery(): void {
  discovered = undefined;
}

const base64url = (b: Buffer): string => b.toString('base64url');

/**
 * Eine Anmeldung beginnen.
 *
 * Gibt die Adresse zurück, zu der der Browser geschickt wird — und legt den
 * Zwischenzustand ab. Der Pfad danach ist **nur ein Pfad**: eine URL aus der
 * Anfrage wäre eine offene Weiterleitung.
 */
export async function begin(
  pool: Pool,
  cfg: SsoConfig,
  redirectUri: string,
  input: { nextPath?: string; invitationId?: string } = {},
): Promise<{ url: string; browser: string }> {
  const doc = await discovery(cfg);
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  // Das Geheimnis für den Browser — gespeichert wird nur sein Hash, wie beim
  // Sitzungstoken: wer die Tabelle liest, kann damit keinen Vorgang übernehmen.
  const browser = base64url(randomBytes(32));

  const pfad = safeNextPath(input.nextPath);

  await pool.query(
    `INSERT INTO sso_flows (state, code_verifier, next_path, invitation_id, browser_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')`,
    [state, verifier, pfad, input.invitationId ?? null, hashOf(browser)],
  );

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${doc.authorization_endpoint}?${q.toString()}`, browser };
}

const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/**
 * Wohin nach dem Anmelden — NUR ein Pfad auf diesem Server, oder nichts.
 *
 * Die alte Regel war ein Zeichenvorrat: `/` und dann Buchstaben, Ziffern,
 * `/`, `_`, `-`. Sie hielt `https://boese.example` und `//boese.example`
 * fern — am Punkt, nicht am Prinzip. `//attacker` hat keinen Punkt und kam
 * durch, und ein Browser liest `Location: //attacker` als Adresse eines
 * anderen Hosts (Audit 12.09.2026, F11). Jetzt zwei Regeln statt einer: der
 * Zeichenvorrat, UND kein zweiter Schrägstrich am Anfang. Als Funktion, damit
 * der Test die Regel prüft und nicht eine Kopie von ihr.
 */
export function safeNextPath(wanted: string | undefined): string | null {
  if (wanted === undefined) return null;
  if (!/^\/[A-Za-z0-9/_-]{0,100}$/.test(wanted)) return null;
  if (wanted.startsWith('//')) return null;
  return wanted;
}

/**
 * Einen Zwischenzustand einlösen — genau einmal.
 *
 * `DELETE ... RETURNING` und nicht lesen-dann-löschen: zwei Schritte wären ein
 * Fenster, in dem derselbe `state` zweimal gilt, und genau das soll er nicht.
 */
export async function takeFlow(
  pool: Pool,
  state: string,
  now: Date,
  /**
   * Das Geheimnis aus dem Browser-Keks — oder `undefined`, wenn der Browser
   * keinen mitbringt. Ein Vorgang MIT Bindung verlangt es; einer ohne (aus der
   * Minute vor Migration 0040) kommt einmal ohne durch und ist dann weg.
   */
  browser?: string,
): Promise<{ verifier: string; nextPath: string | null; invitationId: string | null } | null> {
  if (state.length < 20 || state.length > 200) return null;
  const row = await queryOne<{
    code_verifier: string;
    next_path: string | null;
    invitation_id: string | null;
    browser_hash: string | null;
  }>(
    pool,
    `DELETE FROM sso_flows
      WHERE state = $1 AND expires_at > $2
      RETURNING code_verifier, next_path, invitation_id, browser_hash`,
    [state, now],
  );
  if (row === undefined) return null;
  /*
   * Erst gelöscht, dann verglichen — absichtlich. Ein Vorgang, dessen Antwort
   * im falschen Browser landet, ist verbrannt: ihn stehen zu lassen hiesse,
   * der richtige Browser könnte ihn noch einlösen, während ein Fremder die
   * Antwort schon gesehen hat.
   */
  if (row.browser_hash !== null) {
    if (browser === undefined) return null;
    const a = Buffer.from(row.browser_hash, 'hex');
    const b = Buffer.from(hashOf(browser), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  }
  return {
    verifier: row.code_verifier,
    nextPath: row.next_path,
    invitationId: row.invitation_id,
  };
}

export interface Whoami {
  subject: string;
  email: string;
  name: string;
}

/**
 * Den Code eintauschen und fragen, wer da ist.
 *
 * Beides **vom Server aus**. Der Browser sieht den Code, aber nie das Token —
 * und das ist der Grund, warum diese Anmeldung überhaupt sicher ist.
 */
export async function whoami(
  cfg: SsoConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<Whoami> {
  const doc = await discovery(cfg);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new OutOfOrder('der Anbieter hat den Code nicht angenommen');
  const token = (await res.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') {
    throw new OutOfOrder('der Anbieter hat kein Token geschickt');
  }

  const info = await fetch(doc.userinfo_endpoint, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!info.ok) throw new OutOfOrder('der Anbieter sagt nicht, wer du bist');
  const who = (await info.json()) as Record<string, unknown>;
  return readWhoami(who);
}

/**
 * Aus der Antwort des Anbieters: wer das ist — oder eine Ablehnung.
 *
 * Getrennt von `whoami`, damit sich die Regel ohne Anbieter prüfen lässt.
 *
 * **`email_verified` muss `true` sein.** Die Adresse ist der Schlüssel, mit
 * dem `findAccount` beim ersten Mal ein bestehendes Konto findet und das
 * Subjekt daran bindet. Ein Anbieter, der Adressen ausgibt, die die Person
 * selbst eingetragen und niemand bestätigt hat, liesse damit jeden ein
 * fremdes Konto beanspruchen (Audit 12.09.2026, F10). OpenID Connect Core
 * §5.1 definiert den Claim genau dafür. Fehlt er, ist das keine Bestätigung —
 * also ebenfalls nein. Wer einen Anbieter hat, der ihn nie liefert, muss den
 * Anbieter erziehen, nicht den Server.
 */
export function readWhoami(who: Record<string, unknown>): Whoami {
  const subject = typeof who['sub'] === 'string' ? who['sub'] : '';
  const email = typeof who['email'] === 'string' ? who['email'].toLowerCase() : '';
  if (who['email_verified'] !== true) {
    throw new OutOfOrder(
      'der Anbieter hat diese Adresse nicht bestätigt — ohne bestätigte Adresse keine Anmeldung',
    );
  }
  if (subject === '' || email === '') {
    /*
     * Ohne Adresse geht es nicht, und das ist kein Mangel dieser Umsetzung: ohne
     * sie kann eine **erste** Anmeldung kein Konto finden, und dann müsste man
     * eines anlegen — genau das, was hier nicht passieren soll.
     */
    throw new OutOfOrder('der Anbieter nennt keine Adresse — ohne die geht es nicht');
  }
  const name =
    typeof who['name'] === 'string' && who['name'] !== ''
      ? who['name']
      : (email.split('@')[0] ?? email);
  return { subject, email, name };
}

/**
 * Wer das ist — oder niemand.
 *
 * Gesucht wird **erst am Subjekt**, dann an der Adresse. Am Subjekt, weil eine
 * Adresse wechselt und ein Subjekt nicht; an der Adresse nur beim ersten Mal,
 * und dann wird das Subjekt gemerkt.
 *
 * `null` heißt: es gibt hier kein Konto. Dann wird **keines angelegt** (siehe
 * Migration 0018), sondern gesagt, was fehlt.
 */
export async function findAccount(pool: Pool, who: Whoami): Promise<string | null> {
  const bekannt = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM users WHERE sso_subject = $1',
    [who.subject],
  );
  if (bekannt !== undefined) return bekannt.id;

  const perAdresse = await queryOne<{ id: string; sso_subject: string | null }>(
    pool,
    'SELECT id, sso_subject FROM users WHERE email = $1',
    [who.email],
  );
  if (perAdresse === undefined) return null;
  if (perAdresse.sso_subject !== null) {
    /*
     * Dieselbe Adresse, ein anderes Subjekt.
     *
     * Das ist kein Anmeldefehler, das ist ein Hinweis: entweder hat der
     * Anbieter die Adresse neu vergeben, oder jemand anderes trägt sie jetzt.
     * Ihn hereinzulassen hieße, ein Konto an den Nächsten weiterzugeben, der
     * eine freigewordene Adresse bekommt.
     */
    throw new OutOfOrder(
      'diese Adresse gehört zu einem Konto mit einer anderen Anmeldung — frag die Verwaltung',
    );
  }
  // Genau einmal: ab jetzt gilt das Subjekt.
  await pool.query('UPDATE users SET sso_subject = $2 WHERE id = $1', [
    perAdresse.id,
    who.subject,
  ]);
  return perAdresse.id;
}

/** Räumt abgelaufene Zwischenzustände weg — aufgerufen beim Beginnen. */
export async function sweepFlows(pool: Pool, now: Date): Promise<void> {
  await pool.query('DELETE FROM sso_flows WHERE expires_at < $1', [now]);
}

/** Zeitgleicher Vergleich, wo ein Vergleich ein Geheimnis berührt. */
export const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
