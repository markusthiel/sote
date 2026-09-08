/**
 * SOTE — der Läufer für Aufträge, die später laufen.
 *
 * Migration 0015 erklärt, warum es eine Tabelle und keinen zweiten Dienst gibt,
 * und nennt die Zusage: **mindestens einmal**. Hier steht, was daraus folgt.
 *
 * ## Ein Bearbeiter muss mehrfaches Laufen aushalten
 *
 * Das ist keine Bitte, sondern die Bedingung, unter der er aufgerufen wird.
 * Stirbt der Prozess zwischen Arbeit und Quittung, läuft der Auftrag wieder —
 * und ein Bearbeiter, der das nicht aushält, verschickt dann zwei Mails oder
 * löscht zweimal.
 *
 * ## Ein unbekannter Name ist ein Fehler
 *
 * Nicht „liegt still liegen". Ein Auftrag, für den es keinen Bearbeiter gibt,
 * ist entweder ein Tippfehler oder ein Rest aus einer alten Fassung, und beides
 * will man **sehen**. Er läuft darum in denselben Fehlerweg wie eine geworfene
 * Ausnahme und landet nach den Versuchen sichtbar unter „Wartung".
 *
 * ## Nichts wird still weggeworfen
 *
 * Nach fünf Versuchen bleibt der Auftrag liegen — mit `attempts = 5`, seinem
 * letzten Fehler und ohne `done_at`. Ein Auftrag, der still verschwindet, ist
 * ein Auftrag, von dem der Betreiber nie erfährt, dass er nötig war.
 */

import type { Pool } from 'pg';

import { queryOne, withTransaction } from './db.js';

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Was ein Bearbeiter bekommt: der Auftrag und ein Weg, Folgeaufträge zu legen. */
export interface JobContext {
  readonly pool: Pool;
  readonly now: Date;
  readonly job: Job;
}

export type Handler = (ctx: JobContext) => Promise<void>;

const handlers = new Map<string, Handler>();

/** Einen Bearbeiter anmelden. Zweimal derselbe Name ist ein Programmierfehler. */
export function handle(kind: string, fn: Handler): void {
  if (handlers.has(kind)) throw new Error(`zwei Bearbeiter für „${kind}"`);
  handlers.set(kind, fn);
}

/** Welche Namen bearbeitet werden — für die Wartungsansicht. */
export const knownKinds = (): string[] => [...handlers.keys()].sort();

/**
 * Einen Auftrag legen.
 *
 * `uniqueKey` ist der Weg, einen wiederkehrenden Auftrag genau einmal in der
 * Schlange zu haben: beim zweiten Legen gewinnt der frühere Zeitpunkt. „Läuft
 * spätestens dann" ist die Zusage, die man bei einem Aufräumauftrag will —
 * „läuft irgendwann später" wäre eine, die sich mit jedem Neustart verschiebt.
 */
export async function enqueue(
  pool: Pool,
  kind: string,
  input: { payload?: Record<string, unknown>; runAt?: Date; uniqueKey?: string } = {},
): Promise<void> {
  await pool.query(
    /*
     * Der Schlüssel gilt nur für OFFENE Aufträge.
     *
     * Meine erste Fassung ließ ihn an der fertigen Zeile stehen und schrieb
     * `WHERE jobs.done_at IS NULL` an das `DO UPDATE`. Ergebnis: der erste
     * Lauf war fertig, der Folgeauftrag stieß auf die fertige Zeile, das
     * Update wurde übersprungen — und **die Wiederholung war still tot**. Im
     * echten Server nachgesehen: eine Zeile, fertig, und nichts danach.
     *
     * Mein Test hat es nicht gefunden, weil er ohne `uniqueKey` einreihte und
     * damit nie in den Konflikt lief. Ein Test, der den Weg nicht geht, prüft
     * ihn nicht.
     *
     * Der Schlüssel antwortet auf **„wartet diese Arbeit schon?"** — und
     * sobald ein Auftrag geholt ist, wartet er nicht mehr, sondern läuft. Er
     * gibt seinen Schlüssel darum beim **Holen** frei (unten in `runOne`) und
     * nicht beim Quittieren.
     *
     * Das ist nicht nur ordentlicher, es ist nötig: ein Bearbeiter, der seinen
     * Nachfolger einreiht, tut das **während seine eigene Zeile noch läuft**.
     * Gab sie den Schlüssel erst beim Quittieren frei, stieß der Nachfolger auf
     * sie, das `DO UPDATE` zog nur ihren eigenen Zeitpunkt vor — und danach war
     * die Zeile fertig und die Schlange leer. Zweimal gefunden: erst im
     * laufenden Server, dann nochmal einen Schritt tiefer.
     *
     * Der Preis, benannt: schlägt ein Auftrag fehl und wartet auf seinen
     * nächsten Versuch, hält er den Schlüssel nicht mehr — dann können zwei
     * Zeilen derselben Arbeit in der Schlange liegen. Das ist tragbar, weil
     * die Zusage des Läufers ohnehin „mindestens einmal" ist und jeder
     * Bearbeiter mehrfaches Laufen aushalten muss.
     */
    `INSERT INTO jobs (kind, payload, run_at, unique_key)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (unique_key) DO UPDATE
       SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at)`,
    [kind, input.payload ?? {}, input.runAt ?? new Date(), input.uniqueKey ?? null],
  );
}

/** Wie lange ein Auftrag als „läuft gerade" gilt, bevor ihn ein anderer nimmt. */
const STUCK_AFTER_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Einen fälligen Auftrag holen und laufen lassen.
 *
 * Gibt zurück, ob es einen gab — der Aufrufer kann dann sofort den nächsten
 * holen, statt auf den nächsten Tick zu warten.
 */
export async function runOne(
  pool: Pool,
  now: Date,
  /**
   * Nur diese Namen — oder alles.
   *
   * Zwei Gründe, und der erste ist echter Betrieb: wer Mail auf einem eigenen
   * Prozess laufen lassen will (weil ein hängender Mailserver dann nichts
   * anderes aufhält), startet einen Läufer mit `['mail.send']`. Der zweite ist
   * der Test: die Testdateien teilen eine Datenbank, und ohne Geltungsbereich
   * greift jede in die Aufträge der anderen. Das ist mir passiert — der
   * fehlgeschlagene Test lag in einer Datei, die ich nicht angefasst hatte.
   */
  only?: readonly string[],
): Promise<boolean> {
  const job = await withTransaction(pool, async (client) => {
    const row = await queryOne<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      client,
      /*
       * `SKIP LOCKED`, damit zwei Läufer nebeneinander arbeiten können, ohne
       * denselben Auftrag zu greifen — und ohne dass einer wartet.
       *
       * `locked_at` wird mitgeprüft und nicht nur gesetzt: ein Prozess, der
       * mitten in einem Auftrag stirbt, hinterlässt eine gesperrte Zeile, und
       * ohne diese Frist bliebe sie für immer liegen. Fünf Minuten sind lang
       * genug für alles, was hier läuft, und kurz genug, dass ein Neustart die
       * Arbeit nicht über Nacht liegen lässt.
       */
      `SELECT id, kind, payload, attempts FROM jobs
        WHERE done_at IS NULL
          AND run_at <= $1
          AND attempts < $3
          AND (locked_at IS NULL OR locked_at < $2)
          AND ($4::text[] IS NULL OR kind = ANY($4))
        ORDER BY run_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [now, new Date(now.getTime() - STUCK_AFTER_MS), MAX_ATTEMPTS, only ?? null],
    );
    if (row === undefined) return undefined;
    /*
     * Der Versuch wird **vor** der Arbeit gezählt.
     *
     * Danach zu zählen heißt: ein Auftrag, der den Prozess umbringt (Speicher,
     * Endlosschleife), wird beim Neustart erneut geholt, mit derselben Zahl —
     * für immer. Vorher zu zählen kostet höchstens einen Versuch bei einem
     * Absturz und begrenzt den Schaden.
     */
    await client.query(
      // `unique_key = NULL` beim HOLEN: ein Auftrag, der läuft, wartet nicht
      // mehr — und sein Nachfolger muss sich einreihen können, während er noch
      // läuft. `enqueue` begründet es ausführlich.
      `UPDATE jobs SET attempts = attempts + 1, locked_at = $2, unique_key = NULL
        WHERE id = $1`,
      [row.id, now],
    );
    return row;
  });

  if (job === undefined) return false;

  const fn = handlers.get(job.kind);
  try {
    if (fn === undefined) throw new Error(`kein Bearbeiter für „${job.kind}"`);
    await fn({ pool, now, job });
    await pool.query('UPDATE jobs SET done_at = now(), locked_at = NULL WHERE id = $1', [job.id]);
  } catch (e) {
    /*
     * Warten, und zwar länger mit jedem Versuch.
     *
     * 1, 4, 9, 16 Minuten (quadratisch): ein Fehler, der von etwas Äußerem
     * kommt — ein Mailserver, der nicht antwortet —, ist nach einer Minute
     * meist noch da und nach einer Viertelstunde oft weg. Sofort neu zu
     * versuchen wäre eine Schleife, die den Fehler nur schneller wiederholt.
     */
    /*
     * `attempts + 1`, und der Test hat mich darauf gestoßen.
     *
     * `job.attempts` ist der Wert VOR dem Zählen — beim ersten Fehlversuch
     * also 0, und `0 * 0 * 60_000` ist **keine Wartezeit**. Der erste
     * Fehlversuch wäre sofort wiederholt worden, und bei einem Mailserver, der
     * nicht antwortet, heißt das fünf Versuche in einer Sekunde statt über eine
     * halbe Stunde verteilt.
     *
     * Also die Nummer des Versuchs, der gerade fehlschlug: 1, 4, 9, 16 Minuten.
     */
    const versuch = job.attempts + 1;
    const wait = versuch * versuch * 60_000;
    await pool.query(
      `UPDATE jobs SET locked_at = NULL, last_error = $2, run_at = $3 WHERE id = $1`,
      [job.id, String(e instanceof Error ? e.message : e).slice(0, 500), new Date(now.getTime() + wait)],
    );
  }
  return true;
}

/**
 * Der Tick.
 *
 * Arbeitet höchstens `max` Aufträge ab und kehrt zurück. Kein `while (true)`:
 * ein Läufer, der beliebig lange arbeitet, ist ein Läufer, der beim Beenden
 * hängt — und einer, der einen Auftrag nach dem anderen nachschiebt, blockiert
 * die Anfragen des Servers im selben Prozess.
 */
export async function tick(
  pool: Pool,
  now: Date,
  max = 20,
  only?: readonly string[],
): Promise<number> {
  let n = 0;
  while (n < max) {
    if (!(await runOne(pool, now, only))) break;
    n += 1;
  }
  return n;
}

/**
 * Den Läufer im Serverprozess starten.
 *
 * `unref()` auf dem Zeitgeber, damit der Prozess sich beenden kann: ein Timer,
 * der Node am Leben hält, ist ein Server, der auf ein `SIGTERM` nicht mehr
 * aufhört — und das merkt man erst beim ersten Ausrollen.
 */
export function startRunner(
  pool: Pool,
  everyMs = 30_000,
): { stop: () => void } {
  let running = false;
  const timer = setInterval(() => {
    // Kein zweiter Tick, während einer läuft: sonst greifen zwei Ticks
    // nebeneinander und die Zahl der offenen Verbindungen wächst mit der
    // Laufzeit des langsamsten Auftrags.
    if (running) return;
    running = true;
    void tick(pool, new Date())
      .catch((e: unknown) => {
        // Ein Fehler HIER ist nicht der eines Auftrags (die werden gefangen),
        // sondern einer der Datenbank. Er darf den Läufer nicht beenden.
        console.error('Läufer:', e);
      })
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
