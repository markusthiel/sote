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

export function loadConfig(): Config {
  return {
    databaseUrl: text('SOTE_DATABASE_URL'),
    port: count('SOTE_PORT', 8080, { min: 1, max: 65535 }),
    sessionDays: count('SOTE_SESSION_DAYS', 30, { min: 1, max: 400 }),
  };
}
