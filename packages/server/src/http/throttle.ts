/**
 * SOTE — eine Drossel für das Kennwortraten.
 *
 * `/api/session` rief für jeden Versuch `signIn()` — also scrypt — ohne
 * Grenze. Wer wollte, konnte Kennwörter durchprobieren und dabei den Prozess
 * mit Hash-Arbeit beschäftigen (Audit 12.09.2026, F12).
 *
 * ## Was gezählt wird: FEHLVERSUCHE, je Konto und je Herkunft
 *
 * Zwei Schlüssel, weil zwei Angriffe: viele Kennwörter auf ein Konto (der
 * Schlüssel ist die Adresse), und ein Kennwort auf viele Konten (der Schlüssel
 * ist die Herkunft). Ein Treffer setzt den Zähler des Kontos zurück — wer sich
 * richtig anmeldet, hat bewiesen, dass er es ist.
 *
 * ## Keine Dauersperre
 *
 * Ein Fenster von fünfzehn Minuten, dann ist der Zähler weg. Eine Sperre, die
 * jemand von aussen auf ein fremdes Konto legen kann, ist selbst ein Angriff
 * (Aussperren per falschem Kennwort) — also klein halten, was sie kostet.
 *
 * ## Im Speicher, nicht in der Datenbank
 *
 * Ein Neustart vergisst die Zähler, und das ist in Ordnung: wer den Server
 * neu starten kann, braucht kein Kennwort zu raten. Mehrere Prozesse hätten
 * je einen Zähler — dann gilt die Grenze je Prozess, und das ist immer noch
 * eine Grenze.
 */

export interface ThrottleOptions {
  /** Fehlversuche, bis gesperrt wird. */
  readonly max: number;
  /** Wie lange ein Fehlversuch zählt, in Millisekunden. */
  readonly windowMs: number;
}

interface Bucket {
  count: number;
  /** Wann der Zähler verfällt. */
  until: number;
}

export class Throttle {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly opts: ThrottleOptions) {}

  /**
   * Ob dieser Schlüssel gerade gesperrt ist — und wenn ja, für wie viele
   * Sekunden noch (für `Retry-After`). `0` heisst: darf.
   */
  blockedFor(key: string, now: number): number {
    const b = this.buckets.get(key);
    if (b === undefined) return 0;
    if (b.until <= now) {
      this.buckets.delete(key);
      return 0;
    }
    return b.count >= this.opts.max ? Math.max(1, Math.ceil((b.until - now) / 1000)) : 0;
  }

  /** Ein Fehlversuch. */
  fail(key: string, now: number): void {
    const b = this.buckets.get(key);
    if (b === undefined || b.until <= now) {
      this.buckets.set(key, { count: 1, until: now + this.opts.windowMs });
      return;
    }
    b.count += 1;
    // Das Fenster wandert mit dem letzten Versuch: wer weiterrät, verlängert
    // seine eigene Sperre.
    b.until = now + this.opts.windowMs;
  }

  /** Ein Treffer: der Zähler ist weg. */
  succeed(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Alte Zähler wegräumen. Wird beim Zählen nebenbei gerufen, damit die Map
   * nicht mit jeder je gesehenen Adresse wächst.
   */
  sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.until <= now) this.buckets.delete(k);
  }

  /** Nur für Tests und die Wartungsansicht. */
  get size(): number {
    return this.buckets.size;
  }
}
