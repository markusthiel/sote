/**
 * SOTE — Einstellungen aus der Umgebung.
 *
 * Zahlen werden **nicht** mit blankem `Number(process.env…)` gelesen. In SONE
 * lagen sechs Einstellungen so herum, und keine davon erreichte je den
 * Container (ADR-0111): ein Tippfehler wird zu `NaN`, `NaN` fällt durch jede
 * Schwelle, und niemand erfährt davon. Hier wird geprüft und beim Start
 * geworfen, nicht beim ersten Gebrauch.
 */

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export function text(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw !== undefined && raw !== '') return raw;
  if (fallback !== undefined) return fallback;
  throw new EnvError(`${name} fehlt`);
}

export function count(
  name: string,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new EnvError(`${name}=${JSON.stringify(raw)} ist keine Zahl`);
  }
  if (n < min || n > max) {
    throw new EnvError(`${name}=${n} liegt außerhalb von ${min}…${max}`);
  }
  return n;
}

export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly sessionDays: number;
}

/*
 * Hier stand `reminderMailAfterMinutes`, gelesen aus
 * SOTE_REMINDER_MAIL_AFTER_MINUTES — und **nichts versendete Mail**. Eine
 * Einstellung für eine Sache, die es nicht gibt, ist genau der Fehler, den SONE
 * vierzehn Mal hatte (ADR-0112): der Betreiber füllt etwas aus, es wirkt nicht,
 * und nichts sagt warum. Sie kommt zurück, wenn der Mailweg gebaut ist, und
 * nicht vorher.
 */

/**
 * Die Verbindungsadresse, geprüft bevor `pg` sie sieht.
 *
 * `pg` meldet eine unlesbare Adresse als „Invalid URL“ — zwei Wörter, keine
 * Variable, keine Ursache. In SONE stand genau das bei jedem Neustart im
 * Protokoll eines Containers, der nicht hochkam. Die Ursache war das Kennwort:
 * compose setzt `POSTGRES_PASSWORD` unkodiert in die Adresse ein, und
 * `.env.example` empfahl `openssl rand -base64 32`. Base64 enthält `/`, ein `/`
 * im Benutzerteil beendet den Host, und die Adresse lässt sich nicht mehr
 * lesen — bei etwa jedem zweiten erzeugten Kennwort.
 *
 * Die Vorlage empfiehlt jetzt Hex. Diese Prüfung ist für alle, die schon eine
 * `.env` haben, und sie nennt den Ausweg.
 */
export function databaseUrl(name: string): string {
  const value = text(name);
  try {
    new URL(value);
  } catch {
    throw new EnvError(
      `${name} ist keine gültige Adresse. Im compose-Aufbau entsteht sie aus ` +
        'POSTGRES_PASSWORD, und ein Kennwort mit /, #, %, ? oder Leerzeichen ' +
        '(wie `openssl rand -base64` sie erzeugt) zerstört die Adresse. Ein ' +
        'Kennwort aus `openssl rand -hex 32` verwenden oder die Sonderzeichen ' +
        'prozentkodieren — und daran denken, dass die Datenbank das Kennwort ' +
        'behält, mit dem sie zuerst angelegt wurde.',
    );
  }
  return value;
}

export function loadConfig(): Config {
  return {
    databaseUrl: databaseUrl('SOTE_DATABASE_URL'),
    port: count('SOTE_PORT', 8080, { min: 1, max: 65535 }),
    sessionDays: count('SOTE_SESSION_DAYS', 30, { min: 1, max: 400 }),
  };
}

/**
 * Die Adresse, unter der dieser Server erreichbar ist.
 *
 * HIER und nicht in `invitations.ts`, wo sie herkam: sobald Aufgaben und
 * Kommentare Links in ihre Meldungen schreiben, importieren sie das Modul —
 * und `invitations.ts` zieht die halbe Anwendung nach. Der Kreis brach beim
 * Start mit „Cannot access 'OutOfOrder' before initialization", also an einer
 * Stelle, die mit Einladungen nichts zu tun hat.
 *
 * `env.ts` importiert nichts. Das macht es zum richtigen Ort für eine Angabe,
 * die überall gebraucht wird.
 */
export function baseUrl(): string | undefined {
  const raw = (process.env['SOTE_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
  return raw === '' ? undefined : raw;
}
