/**
 * SOTE — die Bearbeiter.
 *
 * Eine Datei, damit man sehen kann, **was dieser Server von selbst tut**. Ein
 * Läufer mit über die Bäume verstreuten Bearbeitern ist ein Läufer, dessen
 * Umfang niemand kennt — dieselbe Überlegung wie bei `shareRoutes.ts`.
 *
 * ## Der Papierkorb leert sich nach dreißig Tagen
 *
 * Das ist der erste Bearbeiter, und er ist mit Absicht kein Mailweg: ein Läufer
 * ohne Auftrag wäre selbst „etwas, das nichts tut" (ADR-0112), und ein erster
 * Auftrag, der Mail braucht, hätte den Läufer an eine zweite ungebaute Sache
 * gehängt.
 *
 * Dreißig Tage stehen als Zahl hier und nicht als Einstellung. Der Grund ist
 * derselbe wie überall in diesem Projekt: eine Einstellung für etwas, das
 * niemand verlangt hat, ist eine Frage, die der Betreiber beantworten muss,
 * ohne sie gestellt zu haben. Sobald jemand eine andere Frist will, wird es
 * eine Einstellung — mit einem Bildschirm, der sie erklärt.
 */

import type { Pool } from 'pg';

import { enqueue, handle, type JobContext } from './jobs.js';

/** Wie lange etwas im Papierkorb liegt, bevor es wirklich weg ist. */
export const TRASH_DAYS = 30;

/**
 * Was hier gelöscht wird, ist **endgültig** weg.
 *
 * Darum zwei Vorsichten, die beide keine Bequemlichkeit sind:
 *
 * 1. Es wird **nach `trashed_at` gefragt**, nie nach einem Alter der Zeile:
 *    eine alte Aufgabe, die gestern weggeworfen wurde, hat noch dreißig Tage.
 * 2. Aufgaben **vor** Projekten. Ein gelöschtes Projekt nimmt seine Aufgaben
 *    per Fremdschlüssel mit; liefe es zuerst, verschwänden Aufgaben, deren
 *    eigene Frist noch läuft — jemand holt ein Projekt aus dem Korb und findet
 *    es leer.
 */
async function purgeTrash({ pool, now }: JobContext): Promise<void> {
  const grenze = new Date(now.getTime() - TRASH_DAYS * 86_400_000);

  /*
   * Mehrfaches Laufen hält das aus (die Zusage des Läufers, Migration 0015):
   * ein `DELETE`, das nichts mehr findet, löscht nichts. Das ist der Grund,
   * warum dieser Bearbeiter überhaupt so einfach sein darf.
   */
  await pool.query('DELETE FROM tasks WHERE trashed_at IS NOT NULL AND trashed_at < $1', [grenze]);
  await pool.query(
    // Nur Projekte, unter denen nichts mehr hängt, dessen Frist noch läuft.
    // Sonst nimmt der Fremdschlüssel eine Aufgabe mit, die noch zurückgeholt
    // werden könnte.
    `DELETE FROM projects
      WHERE trashed_at IS NOT NULL AND trashed_at < $1
        AND NOT EXISTS (
              SELECT 1 FROM tasks t
               WHERE t.project_id = projects.id
                 AND (t.trashed_at IS NULL OR t.trashed_at >= $1)
            )
        AND NOT EXISTS (
              SELECT 1 FROM projects c
               WHERE c.parent_id = projects.id
                 AND (c.trashed_at IS NULL OR c.trashed_at >= $1)
            )`,
    [grenze],
  );

  // Der nächste Tick. Die Wiederholung liegt im Auftrag selbst und nicht in
  // einem Zeitplan daneben: so gibt es genau einen Ort, an dem steht, wie oft
  // etwas läuft.
  await enqueue(pool, 'trash.purge', {
    runAt: new Date(now.getTime() + 6 * 3_600_000),
    uniqueKey: 'trash.purge',
  });
}

handle('trash.purge', purgeTrash);

/**
 * Beim Start dafür sorgen, dass der wiederkehrende Auftrag in der Schlange ist.
 *
 * Mit `uniqueKey`, also entsteht bei jedem Neustart **kein** neuer: nach zehn
 * Neustarts liefe das Aufräumen sonst zehnmal. Der frühere Zeitpunkt gewinnt
 * (siehe `enqueue`) — „läuft spätestens dann" ist die Zusage, die man hier
 * will.
 */
export async function scheduleRecurring(pool: Pool): Promise<void> {
  await enqueue(pool, 'trash.purge', { uniqueKey: 'trash.purge' });
}
