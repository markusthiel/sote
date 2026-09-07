/**
 * SOTE — das erste Konto.
 *
 * Bis hierher ging das nur über `docker compose exec` und einen Skriptpfad, den
 * man nachlesen muss. Das ist umständlich, und Umständlichkeit an der ersten
 * Minute eines Produkts ist die teuerste.
 *
 * **Was hier nicht gebaut wird: eine Maske, die beim ersten Aufruf ein Konto
 * anlegt.** Eine Maske, die das beim ersten Mal kann, kann es auch beim
 * tausendsten, sobald eine Bedingung einmal falsch steht — und dann steht die
 * Kontoerstellung offen im Netz. Der eine Fall, in dem das passiert, ist real:
 * jemand löscht das letzte Konto.
 *
 * Also ein **Einrichtungsschlüssel**: solange es kein Konto gibt, wirft der
 * Server beim Start einen Zufallswert ins Protokoll, und nur wer ihn hat, kann
 * das erste Konto anlegen. Ein Blick in `docker compose logs` statt eines
 * Befehls mit vier Zeilen — und selbst wenn die Bedingung „kein Konto" später
 * wieder wahr wird, fehlt dem Fremden der Schlüssel.
 *
 * Der Schlüssel liegt **im Speicher** und nicht in der Datenbank: er soll einen
 * Neustart nicht überleben. Wer ihn verpasst hat, startet neu und bekommt einen
 * neuen. In der Datenbank wäre er ein Geheimnis in jeder Sicherung (SONEs
 * ADR-0058).
 */

import { randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { setPasswordIn } from './auth.js';
import { queryOne, withTransaction, type PoolClient } from './db.js';
import { OutOfOrder } from './tasks.js';

export class SetupClosed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupClosed';
  }
}

export class BadSetupKey extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadSetupKey';
  }
}

export async function userCount(pool: Pool): Promise<number> {
  const row = await queryOne<{ n: string }>(pool, 'SELECT count(*) AS n FROM users');
  return Number(row?.n ?? 0);
}

export interface NewAccount {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly workspaceName?: string;
}

/**
 * Konto, Arbeitsbereich und die vier Systemrollen.
 *
 * **Eine Stelle**, benutzt vom Skript und vom Einrichtungsbildschirm. Zwei
 * Umsetzungen von „das erste Konto anlegen" wären zwei Rollenlisten, und die
 * eine hätte irgendwann eine Rolle, die die andere nicht hat.
 */
export async function createAccount(pool: Pool, input: NewAccount): Promise<string> {
  return withTransaction(pool, (client) => createAccountIn(client, input));
}

/**
 * Dasselbe auf einer vorhandenen Verbindung.
 *
 * Getrennt, damit die Einrichtung sie **innerhalb** ihres Advisory Locks
 * aufrufen kann. Zwei Umsetzungen wären zwei Rollenlisten.
 */
export async function createAccountIn(
  client: PoolClient,
  input: NewAccount,
): Promise<string> {
  const email = input.email.trim();
  const displayName = input.displayName.trim();
  const workspaceName = (input.workspaceName ?? '').trim() || 'Mein Arbeitsbereich';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OutOfOrder('das sieht nicht wie eine E-Mail-Adresse aus');
  }
  if (displayName === '') throw new OutOfOrder('ein Name fehlt');
  if (input.password.length < 8) {
    throw new OutOfOrder('das Kennwort ist kürzer als acht Zeichen');
  }

  const existing = await queryOne<{ id: string }>(
    client,
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (existing !== undefined) {
    // Kein stilles Überschreiben: ein Weg, der ein Kennwort ersetzt, ohne es zu
    // sagen, ist ein Weg, mit dem man jemanden aussperrt.
    throw new OutOfOrder(`${email} gibt es schon`);
  }

  const user = await queryOne<{ id: string }>(
    client,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [email, displayName],
  );
  if (user === undefined) throw new Error('INSERT ohne Zeile');

  const workspace = await queryOne<{ id: string }>(
    client,
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [workspaceName],
  );
  if (workspace === undefined) throw new Error('INSERT ohne Zeile');

  // Die vier Systemrollen aus SONE, gleiche Bedeutung: `list_level = NULL`
  // heißt wirklich nichts — wer eine Rolle ohne Stufe bekommt, ist Gast
  // (ADR-0110).
  const roles: [name: string, level: string | null, rights: string[]][] = [
    ['owner', 'admin', ['people.manage', 'roles.manage', 'groups.manage']],
    ['admin', 'admin', ['people.manage', 'roles.manage', 'groups.manage']],
    ['member', 'editor', []],
    ['guest', null, []],
  ];
  let ownerRole: string | undefined;
  for (const [name, level, rights] of roles) {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO roles (workspace_id, name, list_level, rights)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [workspace.id, name, level, rights],
    );
    if (name === 'owner') ownerRole = row?.id;
  }
  if (ownerRole === undefined) throw new Error('owner-Rolle fehlt');

  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
     VALUES ($1,$2,$3,true)`,
    [workspace.id, user.id, ownerRole],
  );

  // In derselben Transaktion: ein Konto ohne Kennwort ist ein Konto, in das
  // niemand kommt, und ein halb angelegtes Konto ist ein Fall, den man nur von
  // Hand aufräumt.
  await setPasswordIn(client, user.id, input.password);
  return user.id;
}

/**
 * Der Einrichtungsschlüssel dieses Prozesses.
 *
 * `null`, sobald das erste Konto steht — und der Server prüft **zusätzlich** bei
 * jeder Anfrage, dass es wirklich kein Konto gibt. Zwei Bedingungen, weil ein
 * Schlüssel im Speicher nichts darüber weiß, was eine zweite Instanz oder ein
 * Skript in der Zwischenzeit getan hat.
 */
export class SetupKey {
  private key: string | null = null;

  /** Erzeugt einen Schlüssel, falls noch kein Konto existiert. */
  async openIfEmpty(pool: Pool): Promise<string | null> {
    if ((await userCount(pool)) > 0) {
      this.key = null;
      return null;
    }
    this.key = randomBytes(24).toString('base64url');
    return this.key;
  }

  get open(): boolean {
    return this.key !== null;
  }

  /** Prüft den Schlüssel in konstanter Zeit gegen Länge und Inhalt. */
  matches(given: string): boolean {
    const mine = this.key;
    if (mine === null || given.length !== mine.length) return false;
    let diff = 0;
    for (let i = 0; i < mine.length; i += 1) {
      diff |= mine.charCodeAt(i) ^ given.charCodeAt(i);
    }
    return diff === 0;
  }

  close(): void {
    this.key = null;
  }
}

/**
 * Das erste Konto über den Einrichtungsbildschirm.
 *
 * Beide Bedingungen werden geprüft, und in dieser Reihenfolge: erst „gibt es
 * überhaupt kein Konto", dann der Schlüssel. Umgekehrt würde eine falsche
 * Eingabe verraten, dass die Einrichtung noch offen ist.
 */
export async function setupFirstAccount(
  pool: Pool,
  gate: SetupKey,
  token: string,
  input: NewAccount,
): Promise<string> {
  /*
   * Serialisiert, und das habe ich von SONE gelernt statt selbst gemerkt.
   *
   * SONEs `bootstrapInstance` nimmt ein `pg_advisory_xact_lock` mit dem
   * Kommentar „Serialise concurrent first-run attempts". Meine erste Fassung
   * hier hatte das nicht: zwei gleichzeitige Anfragen mit **demselben**
   * Schlüssel und **verschiedenen** Adressen sehen beide „kein Konto", beide
   * finden den Schlüssel gültig, und beide legen an. Danach hat die Instanz
   * zwei Eigentümer, von denen einer nicht eingeplant war.
   *
   * Die Prüfung auf „gibt es schon ein Konto" muss darum **innerhalb** des
   * Locks stehen und nicht davor.
   */
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sote:setup'))");

    const row = await queryOne<{ n: string }>(client, 'SELECT count(*) AS n FROM users');
    if (Number(row?.n ?? 0) > 0) {
      gate.close();
      throw new SetupClosed('es gibt schon ein Konto — die Einrichtung ist vorbei');
    }
    if (!gate.matches(token)) {
      throw new BadSetupKey('der Einrichtungsschlüssel stimmt nicht');
    }

    const id = await createAccountIn(client, input);
    // Einmal und nie wieder: der Schlüssel ist mit dem ersten Konto verbraucht.
    gate.close();
    return id;
  });
}
