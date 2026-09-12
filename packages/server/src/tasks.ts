/**
 * SOTE — Aufgaben schreiben und lesen.
 *
 * Die Entscheidungen aus dem Konzept liegen hier und nicht in einer Route:
 * eine Route soll HTTP übersetzen, nicht bestimmen, was Abhaken bedeutet.
 */

import {
  isTaskCover,
  isTaskLook,
  generateKeyBetween,
  MAX_DURATION,
  MAX_LABEL,
  normalizeLabel,
  uniqueLabels,
  nextAfterCompletion,
  nextOccurrence,
  parseQuickAdd,
  type Priority,
  parseRrule,
  type Recurrence,
} from '@sote/core';
import type { Pool } from 'pg';

import { queryOne, queryRows, withTransaction, type PoolClient } from './db.js';
import { deliver } from './deliver.js';
import { baseUrl } from './env.js';
import { notify } from './notifications.js';

export interface TaskRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  note: string;
  planned_at: Date | null;
  planned_all_day: boolean;
  due_at: Date | null;
  due_all_day: boolean;
  priority: number;
  completed_at: Date | null;
  recur_rrule: string | null;
  recur_dtstart: Date | null;
  recur_after_n: number | null;
  recur_after_unit: string | null;
  duration_min: number | null;
  /** Wo die Karte auf der Tafel liegt. `null` heißt Auffangbecken (0029). */
  column_id: string | null;
  /** Das Titelbild der Karte, roh aus `jsonb` (0031). Gelesen von `readTaskCover`. */
  cover: unknown;
  /** Das Aussehen DIESER Aufgabe, roh aus `jsonb` (0034). */
  look: unknown;
  sort_key: string;
  /**
   * Die Schlagwörter, nach Namen sortiert — `[]` wenn keine.
   *
   * Keine Spalte, sondern `labels_of(id)` aus Migration 0025. Sie kommen
   * damit an ALLEN vier Lesestellen mit, ohne dass eine davon eine
   * Verbindung selbst zusammensetzt: eine Zeile, die in der Liste
   * Schlagwörter hat und im Detail nicht, sieht wie ein Verlust aus.
   */
  labels: string[];
  /**
   * Was an der Aufgabe hängt, als sortierte Wörter — `[]` wenn nichts.
   *
   * `note`, `image`, `file`, `comment`, `subtask`, `assignee`, `reminder`.
   * Keine Zahlen: die Zeile sagt, DASS etwas dran ist. Wer wissen will, wie
   * viel, öffnet die Aufgabe (Migration 0027).
   */
  marks: string[];
}

/**
 * Aus den vier Spalten wieder der Union-Typ aus `core`.
 *
 * Die Datenbank kann keinen Union speichern, also hält ein CHECK die Regel und
 * diese Funktion stellt sie wieder her. Wenn die Zeile beides oder halb etwas
 * trägt, ist der CHECK umgangen worden — dann ist das ein Fehler und keine
 * Aufgabe ohne Wiederholung.
 */
export function recurrenceOf(row: TaskRow): Recurrence | undefined {
  if (row.recur_rrule !== null && row.recur_dtstart !== null) {
    return { kind: 'calendar', rrule: row.recur_rrule, dtstart: row.recur_dtstart };
  }
  if (row.recur_after_n !== null && row.recur_after_unit !== null) {
    return {
      kind: 'afterCompletion',
      n: row.recur_after_n,
      unit: row.recur_after_unit as 'day' | 'week' | 'month' | 'year',
    };
  }
  if (
    row.recur_rrule !== null ||
    row.recur_dtstart !== null ||
    row.recur_after_n !== null ||
    row.recur_after_unit !== null
  ) {
    throw new Error(
      `Aufgabe ${row.id} trägt eine halbe Wiederholung — der CHECK wurde umgangen`,
    );
  }
  return undefined;
}

/** Die Spaltenliste einmal. Viermal abgeschrieben ist viermal Gelegenheit. */
/**
 * Bei einer Schlüsselkollision denselben Vorgang wiederholen.
 *
 * `generateKeyBetween` ist deterministisch: zwei Transaktionen mit denselben
 * Nachbarn rechnen denselben Schlüssel. Der Unique-Index aus Migration 0003
 * lässt nur eine davon durch, und die andere bekommt `23505`. Wiederholt wird
 * der **ganze** Vorgang und nicht nur die Rechnung — die Transaktion ist
 * abgebrochen, und beim zweiten Lesen ist der Gewinner ein Nachbar, also fällt
 * der Schlüssel dazwischen und die Sache endet.
 *
 * Begrenzt, weil eine unbegrenzte Wiederholung aus einem seltenen Wettlauf eine
 * Endlosschleife macht, sobald die Ursache eine andere ist.
 */
const ORDER_CLASH = '23505';
const ORDER_INDEX = 'tasks_sibling_order';

async function retryOnOrderClash<T>(body: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await body();
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      const clash = err.code === ORDER_CLASH && err.constraint === ORDER_INDEX;
      if (!clash || i >= attempts) throw e;
    }
  }
}

const RETURNING = `
  id, workspace_id, project_id, parent_id, title, note,
  planned_at, planned_all_day, due_at, due_all_day, priority,
  completed_at, recur_rrule, recur_dtstart, recur_after_n,
  recur_after_unit, duration_min, column_id, cover, look, sort_key,
  labels_of(id) AS labels, marks_of(id) AS marks`;

const SELECT = `SELECT ${RETURNING} FROM tasks`;

/**
 * Der nächste Sortierschlüssel am Ende einer Liste.
 *
 * **Weggeworfene Zeilen zählen mit.** Sie sind aus jeder Ansicht verschwunden,
 * aber nicht aus der Tabelle — und der Unique-Index aus Migration 0003 kennt
 * keinen Papierkorb. Die erste Fassung filterte `trashed_at IS NULL` und
 * rechnete darum denselben Schlüssel, den eine weggeworfene Zeile noch hielt:
 * ein Projekt, aus dem einmal etwas weggeworfen wurde, nahm keine neue Aufgabe
 * mehr an. Gefunden von `trash.db.test.ts`.
 *
 * Die Lehre ist allgemeiner als der Fall: **eine Abfrage, die einen Schlüssel
 * für einen Index rechnet, muss denselben Umfang haben wie der Index.**
 */
export async function keyAtEnd(
  q: Pool | PoolClient,
  workspaceId: string,
  projectId: string | null,
  parentId: string | null = null,
): Promise<string> {
  const last = await queryOne<{ sort_key: string }>(
    q,
    `SELECT sort_key FROM tasks
      WHERE workspace_id = $1
        AND project_id IS NOT DISTINCT FROM $2
        AND parent_id IS NOT DISTINCT FROM $3
      ORDER BY sort_key DESC LIMIT 1`,
    [workspaceId, projectId, parentId],
  );
  return generateKeyBetween(last?.sort_key ?? null, null);
}

export interface CreateFromLine {
  readonly workspaceId: string;
  /**
   * Wer anlegt — oder **niemand**.
   *
   * `null` ist der Gast über einen Link (Konzept 10e). Die Spalte
   * `tasks.created_by` war schon immer optional; nur der Typ hier behauptete,
   * es gebe immer jemanden. Ein Typ, der mehr verspricht als die Datenbank,
   * ist ein Typ, der an einer Stelle zur Lüge wird — hier an der ersten, die
   * ihn braucht.
   */
  readonly userId: string | null;
  readonly line: string;
  readonly now: Date;
  /** Die Zone, in der „9 Uhr" gemeint ist. Fehlt sie: UTC, wie vorher. */
  readonly zone?: string;
  /** Projekt, in dem die Zeile getippt wurde. `#name` schlägt es. */
  readonly projectId?: string | null;
}

export interface Created {
  readonly task: TaskRow;
  /** Ein `#name`, den es im Arbeitsbereich nicht gibt. Wird gemeldet, nicht angelegt. */
  readonly unknownProject: string | undefined;
  /**
   * Ein `#name`, auf den mehrere passen.
   *
   * „Kabel" darf es unter „Haus" und unter „Büro" geben — das sind zwei
   * verschiedene Dinge, und der Index in Migration 0004 lässt sie zu Recht
   * beide zu. Also entscheidet hier niemand: dieselbe Regel wie bei
   * `ambiguousAssignees`.
   */
  readonly ambiguousProject: string | undefined;
  /**
   * Der Name gehoert einem ORDNER.
   *
   * Getrennt von „unbekannt", weil der Unterschied fuer den Menschen zaehlt:
   * unbekannt heisst vertippt, dies heisst falsche Ebene gemeint. Eine
   * Meldung, die beides zusammenwirft, schickt jemanden auf die Suche nach
   * einem Tippfehler, den es nicht gibt.
   */
  readonly folderProject: string | undefined;
  readonly unknownAssignees: readonly string[];
  /**
   * Ein `+name`, auf den **mehrere** passen.
   *
   * Getrennt von `unknownAssignees`, weil es eine andere Nachricht ist: „gibt
   * es hier nicht" gegen „wen von beiden meinst du". Eine von zwei Personen
   * still auszuwählen wäre schlimmer als keine — die Aufgabe hätte einen
   * Zuständigen, der nichts davon weiß.
   */
  readonly ambiguousAssignees: readonly string[];
}

/**
 * Eine Zeile wird eine Aufgabe.
 *
 * Was der Parser nicht auflösen kann — ein Projekt- oder Personenname, den es
 * nicht gibt —, wird **gemeldet und nicht erfunden**. Ein `#finanzen`, das
 * stillschweigend ein neues Projekt anlegt, produziert Karteileichen; eines,
 * das stillschweigend verschwindet, verliert, was jemand gemeint hat.
 */
export async function createFromLine(pool: Pool, input: CreateFromLine): Promise<Created> {
  const q = parseQuickAdd(input.line, {
    now: input.now,
    ...(input.zone === undefined ? {} : { zone: input.zone }),
  });

  return retryOnOrderClash(() => withTransaction(pool, async (client) => {
    let projectId = input.projectId ?? null;
    let unknownProject: string | undefined;
    let ambiguousProject: string | undefined;
    /** Der Name gehört einem Ordner — er trägt keine Aufgaben. */
    let folderProject: string | undefined;
    if (q.project !== undefined) {
      /*
       * `#name` meint ein **Projekt**, keinen Ordner (Konzept 10d).
       *
       * Ohne `kind = 'list'` fand die Abfrage nach der Migration zwei Zeilen —
       * den Ordner „Haus" und das Projekt „Haus" darin — und meldete
       * Mehrdeutigkeit. Die Aufgabe entstand dann ohne Projekt: angelegt,
       * gemeldet, und trotzdem nicht dort, wo sie hin sollte. Genau der Fehler,
       * den die Trennung eigentlich beseitigt.
       *
       * Und der ganze Pfad muss leben: ein Projekt unter einem weggeworfenen
       * Ordner ist kein Ziel, auch wenn es selbst unberührt ist.
       */
      const found = await queryRows<{ id: string }>(
        client,
        `SELECT id FROM projects
          WHERE workspace_id = $1 AND lower(name) = lower($2)
            AND kind = 'list' AND NOT project_in_trash(id)
          LIMIT 2`,
        [input.workspaceId, q.project],
      );
      if (found.length === 1) projectId = found[0]!.id;
      else if (found.length === 0) {
        /*
         * Nichts gefunden — aber vielleicht gibt es einen ORDNER mit dem Namen.
         * Dann ist „gibt es nicht" die falsche Auskunft: der Name existiert,
         * er trägt nur keine Aufgaben. Das ist die fünfte Meldung aus dem
         * Konzept, und sie ist der Unterschied zwischen „vertippt" und
         * „falsche Ebene gemeint".
         */
        const folder = await queryOne<{ id: string }>(
          client,
          `SELECT id FROM projects
            WHERE workspace_id = $1 AND lower(name) = lower($2)
              AND kind = 'folder' AND NOT project_in_trash(id)
            LIMIT 1`,
          [input.workspaceId, q.project],
        );
        if (folder === undefined) unknownProject = q.project;
        else folderProject = q.project;
      } else ambiguousProject = q.project;
    }

    const rec = q.recurrence;
    const sortKey = await keyAtEnd(client, input.workspaceId, projectId);

    let row = await queryOne<TaskRow>(
      client,
      `INSERT INTO tasks (
         workspace_id, project_id, title,
         planned_at, planned_all_day, due_at, due_all_day, priority,
         recur_rrule, recur_dtstart, recur_after_n, recur_after_unit,
         duration_min, sort_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${RETURNING}`,
      [
        input.workspaceId,
        projectId,
        q.title,
        q.planned ?? null,
        // Eine Uhrzeit ist eine Erinnerung (Konzept, Abschnitt 9). Ob eine
        // gesetzt wurde, steht in genau diesem Feld — nicht in einem zweiten
        // Schalter, den niemand pflegt.
        q.planned === undefined ? true : !hasTime(q.planned),
        q.due ?? null,
        q.due === undefined ? true : !hasTime(q.due),
        (q.priority ?? 4) satisfies Priority | 4,
        rec?.kind === 'calendar' ? rec.rrule : null,
        rec?.kind === 'calendar' ? rec.dtstart : null,
        rec?.kind === 'afterCompletion' ? rec.n : null,
        rec?.kind === 'afterCompletion' ? rec.unit : null,
        // Was der Kern gelesen hat, wird nicht nachgeprüft: `parseQuickAdd`
        // gibt Minuten oder nichts, und der CHECK in 0024 haelt die Grenzen.
        q.duration ?? null,
        sortKey,
        input.userId,
      ],
    );
    if (row === undefined) throw new Error('INSERT ohne Zeile');

    const unknownAssignees: string[] = [];
    const ambiguousAssignees: string[] = [];
    for (const name of q.assignees) {
      // Vier Schreibweisen, weil niemand „+Markus Thiel" tippt: ein
      // Leerzeichen beendet das Zeichen, also muss der Vorname reichen. Und
      // der Teil vor dem @, weil Adressen kürzer sind als Namen.
      const people = await queryRows<{ id: string }>(
        client,
        `SELECT u.id FROM users u
           JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
          WHERE lower(u.display_name) = lower($2)
             OR lower(u.email) = lower($2)
             OR lower(split_part(u.display_name, ' ', 1)) = lower($2)
             OR lower(split_part(u.email, '@', 1)) = lower($2)
          LIMIT 2`,
        [input.workspaceId, name],
      );
      if (people.length === 1) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, people[0]!.id],
        );
        /*
         * In DERSELBEN Transaktion wie die Zuweisung.
         *
         * Sonst gibt es einen Zustand, in dem jemand zuständig ist und nichts
         * davon erfährt — oder umgekehrt eine Meldung über eine Zuweisung, die
         * zurückgerollt wurde. `notify` selbst schweigt, wenn jemand sich
         * selbst zuweist.
         */
        /*
         * Über `deliver`, nicht über `notify` allein: eine Zuweisung ist die
         * lauteste Sorte Meldung — jemand legt mir etwas hin, und wer es nicht
         * mitbekommt, hält jemand anderen auf. Sie geht darum nach Vorgabe
         * auch per Mail und aufs Gerät, und wer das anders will, stellt es ein.
         */
        await deliver(client, {
          userId: people[0]!.id,
          actorId: input.userId,
          workspaceId: input.workspaceId,
          kind: 'assigned',
          taskId: row.id,
          title: row.title,
          body: 'Dir zugewiesen',
          url: `${baseUrl() ?? ''}/a/${row.id}`,
        });
      } else if (people.length === 0) {
        unknownAssignees.push(name);
      } else {
        // Mehr als einer: nicht raten. Die Aufgabe bleibt ohne Zuständigen und
        // die Antwort sagt, warum.
        ambiguousAssignees.push(name);
      }
    }

    // Dazu und nichts weg: eine Zeile nennt, was drankommt.
    await setLabels(client, row.id, input.workspaceId, q.labels, false);

    /*
     * NOCHMAL LESEN, wenn Schlagwörter dabei waren.
     *
     * `labels` ist keine Spalte, sondern `labels_of(id)` — das `RETURNING` des
     * INSERT wertet sie aus, BEVOR die Zuordnungen geschrieben sind, und liefert
     * darum immer `[]`. Der Test „+wort beim Anlegen steht an der Zeile" hat
     * genau das gefunden; im Browser wäre es „die Etiketten erscheinen erst
     * beim Neuladen" gewesen, also die Sorte Fehler, die man dem Netz
     * zuschreibt.
     *
     * Nur wenn es welche gab: eine zweite Abfrage für jede Zeile ohne
     * Schlagwörter wäre eine Abfrage, die nichts erfährt.
     */
    if (q.labels.length > 0) {
      const wieder = await client.query<TaskRow>(
        `${SELECT} WHERE id = $1`,
        [row.id],
      );
      row = wieder.rows[0] ?? row;
    }

    return {
      task: row,
      unknownProject,
      ambiguousProject,
      folderProject,
      unknownAssignees,
      ambiguousAssignees,
    };
  }));
}

const hasTime = (d: Date) =>
  d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;

export interface Completion {
  readonly completed: TaskRow;
  /** Die nächste Instanz, falls die Aufgabe wiederkehrt. */
  readonly next: TaskRow | undefined;
}

/**
 * Abhaken.
 *
 * **Zwei Zeilen, nicht eine umdatierte** (Blatt 08): die erledigte bleibt als
 * Beleg stehen, die nächste erscheint. Eine umdatierte Zeile hätte keine
 * Geschichte, und „wann habe ich das zuletzt gemacht" wäre nicht beantwortbar —
 * was bei der erledigungsbezogenen Wiederholung ausgerechnet die Frage ist, aus
 * der der nächste Termin entsteht.
 *
 * Beides in **einer** Transaktion: eine erledigte Aufgabe ohne Nachfolger ist
 * eine verschwundene Aufgabe.
 */
/**
 * Ein Haken zurücknehmen.
 *
 * Gemeldet: „Ich kann übrigens abgehakte Aufgaben nicht wieder eröffnen." Und
 * das war wörtlich so: die Oberfläche rief bei einem Klick immer `complete`,
 * und `complete` kehrt bei einer schon erledigten Aufgabe früh zurück. Das
 * Kästchen trug `aria-label="… wieder öffnen"`, sah aus wie ein Umschalter und
 * war keiner — dasselbe Muster wie der Kontoknopf, die Schublade und der
 * Workspace-Wechsler.
 *
 * `completed_by` wird mitgelöscht: „von wem" ohne „wann" ist eine Auskunft über
 * ein Ereignis, das nicht stattgefunden hat.
 *
 * **Ein bekanntes Loch, benannt statt versteckt:** hat das Abhaken einer
 * wiederkehrenden Aufgabe einen Nachfolger angelegt, bleibt der stehen. Es gibt
 * keine Spalte, die ihn mit dieser Erledigung verbindet, also kann diese
 * Funktion ihn nicht finden — und ihn über den Titel zu erraten wäre schlimmer
 * als ihn zu lassen. Die Oberfläche sagt es darum dazu, und die Verbindung
 * gehört in eine eigene Runde.
 */
export async function reopen(pool: Pool, taskId: string, workspaceId: string): Promise<TaskRow> {
  const row = await queryOne<TaskRow>(
    pool,
    /*
     * Wieder öffnen — und aus der Fertig-Spalte heraus.
     *
     * Sie steht auf „fertig", und eine offene Aufgabe darin wäre genau der
     * Widerspruch, den die Regel oben vermeidet. Zurück ins AUFFANGBECKEN
     * (`column_id = NULL`, also in die erste Spalte) und nicht dorthin, wo sie
     * vor dem Abhaken lag: das müsste eine zweite Spalte in der Tabelle
     * merken, und sie wäre falsch, sobald jemand die alte Spalte weggeräumt
     * hat. Die erste Spalte ist der Ort, an dem auch alles Neue anfängt.
     *
     * Lag sie NICHT in der Fertig-Spalte, bleibt sie liegen — dann gibt es
     * keinen Widerspruch aufzulösen.
     */
    `UPDATE tasks t SET
        completed_at = NULL,
        completed_by = NULL,
        updated_at = now(),
        column_id = CASE
          WHEN EXISTS (
            SELECT 1 FROM board_columns c
             WHERE c.id = t.column_id AND c.is_done
          ) THEN NULL
          ELSE t.column_id
        END
      WHERE t.id = $1 AND t.workspace_id = $2 AND t.trashed_at IS NULL
     RETURNING ${RETURNING}`,
    [taskId, workspaceId],
  );
  if (row === undefined) {
    throw new NotFound(`Aufgabe ${taskId} gibt es nicht oder liegt im Papierkorb`);
  }
  return row;
}

export async function complete(
  pool: Pool,
  taskId: string,
  /** `null` ist der Gast über einen Link — `completed_by` ist optional. */
  userId: string | null,
  at: Date,
): Promise<Completion> {
  return retryOnOrderClash(() => withTransaction(pool, async (client) => {
    const rows = await queryRows<TaskRow>(
      client,
      `${SELECT} WHERE id = $1 AND trashed_at IS NULL FOR UPDATE`,
      [taskId],
    );
    const task = rows[0];
    if (task === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);
    if (task.completed_at !== null) return { completed: task, next: undefined };

    /*
     * Abhaken — und auf der Tafel umziehen, WENN es eine Fertig-Spalte gibt.
     *
     * Abgesprochen: „sobald man diese Spalte im Projekt angelegt hat, wandern
     * fertige Elemente automatisch da rein. Wenn man diese Spalte nicht
     * angelegt hat, dann bleiben die Aufgaben als abgehakt in der jeweiligen
     * Spalte liegen."
     *
     * Das Häkchen bleibt die WAHRHEIT, die Spalte folgt ihm. Umgekehrt wäre
     * es zwei Antworten auf dieselbe Frage — und eine abgehakte Aufgabe in
     * „In Arbeit" ein Widerspruch, den jemand auflösen muss.
     *
     * In DEMSELBEN Schreibvorgang wie das Häkchen: zwei Aufrufe wären ein
     * Zwischenzustand, in dem etwas fertig ist und noch in der alten Spalte
     * liegt — und wenn der zweite scheitert, bleibt er stehen.
     */
    const done = await queryOne<TaskRow>(
      client,
      `UPDATE tasks t SET
          completed_at = $2,
          completed_by = $3,
          updated_at = $2,
          column_id = COALESCE(
            (SELECT c.id FROM board_columns c
              WHERE c.project_id = t.project_id AND c.is_done),
            t.column_id
          )
        WHERE t.id = $1
       RETURNING ${RETURNING}`,
      [taskId, at, userId],
    );
    if (done === undefined) throw new Error('UPDATE ohne Zeile');

    const rec = recurrenceOf(task);
    if (rec === undefined) return { completed: done, next: undefined };

    const when =
      rec.kind === 'calendar'
        ? nextOccurrence(rec, task.planned_at ?? at)
        : nextAfterCompletion(rec, at);
    if (when === null) return { completed: done, next: undefined };

    const sortKey = generateKeyBetween(task.sort_key, null);
    const next = await queryOne<TaskRow>(
      client,
      `INSERT INTO tasks (
         workspace_id, project_id, parent_id, title, note,
         planned_at, planned_all_day, due_at, due_all_day, priority,
         recur_rrule, recur_dtstart, recur_after_n, recur_after_unit,
         duration_min, sort_key, created_by)
       SELECT workspace_id, project_id, parent_id, title, note,
              $2::timestamptz, planned_all_day,
              CASE WHEN due_at IS NULL THEN NULL
                   ELSE $2::timestamptz + (due_at - COALESCE(planned_at, created_at))
              END,
              due_all_day, priority,
              recur_rrule, $3::timestamptz, recur_after_n, recur_after_unit,
              -- Die Schaetzung geht mit: derselbe Vorgang dauert beim
              -- naechsten Mal dasselbe. Sie ist eine Eigenschaft der
              -- Aufgabe und nicht dieses Termins.
              duration_min, $4, $5
         FROM tasks WHERE id = $1
       RETURNING ${RETURNING}`,
      [
        taskId,
        when,
        // Der Anker wandert mit, damit „jeden zweiten Dienstag" beim nächsten
        // Abhaken wieder von der richtigen Woche aus rechnet.
        rec.kind === 'calendar' ? when : null,
        sortKey,
        userId,
      ],
    );
    return { completed: done, next: next ?? undefined };
  }));
}

export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}

/**
 * Verschieben.
 *
 * Der neue Schlüssel wird **zwischen den Nachbarn** gerechnet und nicht als
 * Position gesetzt (SONE, ADR-0002). Zwei Leute, die gleichzeitig dieselbe
 * Lücke treffen, bekommen dann verschiedene Schlüssel, und beide Reihen
 * bleiben gültig — mit ganzzahligen Positionen würde eine sichtbar springen.
 *
 * **Der rechte Nachbar kommt aus der Datenbank, nicht aus der Anfrage.** Das
 * ist der Kern und war beim ersten Versuch falsch: `generateKeyBetween` ist
 * deterministisch, also rechnen zwei Transaktionen mit denselben Nachbar-Ids
 * denselben Schlüssel — auch beim Wiederholen, immer wieder. Gefragt wird
 * darum nach dem *nächsten vorhandenen* Schlüssel hinter dem linken Nachbarn.
 * Nach dem ersten Gewinner ist das seiner, die Lücke ist kleiner, und die
 * Sache endet.
 *
 * `beforeId` wird noch gelesen, aber nur zum Prüfen: es sagt, welche
 * Reihenfolge der Browser gesehen hat, und eine vertauschte Angabe ist eine
 * veraltete Ansicht und keine Anweisung.
 */
/**
 * Der neue Sortierschlüssel für eine Zeile, zwischen zwei genannten Nachbarn.
 *
 * Herausgelöst, weil es zwei Aufrufer gibt: das Verschieben in der Liste
 * (`move`) und das Legen einer Karte auf der Tafel (`placeCard`). Zwei
 * Fassungen derselben Rechnung wären zwei Antworten auf „wo landet das", und
 * die beiden liefen genau bei dem Fall auseinander, der selten vorkommt.
 *
 * Der Kreis, in dem gerechnet wird, ist (Bereich, Projekt, Elternteil) — also
 * derselbe, über den `tasks_sibling_order` eindeutig ist.
 */
export async function sortKeyFor(
  client: PoolClient,
  input: {
    taskId: string;
    workspaceId: string;
    projectId: string | null;
    parentId: string | null;
    between: { afterId?: string | null; beforeId?: string | null };
  },
): Promise<string> {
  const { taskId, workspaceId, projectId, parentId, between } = input;

  /** Ein Nachbar muss im selben Geschwisterkreis liegen wie der Index. */
  const keyOf = async (id: string | null | undefined): Promise<string | null> => {
    if (id === null || id === undefined) return null;
    const row = await queryOne<{ sort_key: string }>(
      client,
      `SELECT sort_key FROM tasks
        WHERE id = $1 AND workspace_id = $2
          AND project_id IS NOT DISTINCT FROM $3
          AND parent_id IS NOT DISTINCT FROM $4`,
      [id, workspaceId, projectId, parentId],
    );
    if (row === undefined) throw new NotFound(`${id} ist hier kein Nachbar`);
    return row.sort_key;
  };

  const after = await keyOf(between.afterId);
  const claimed = await keyOf(between.beforeId);
  if (after !== null && claimed !== null && after >= claimed) {
    throw new OutOfOrder(
      'die beiden Nachbarn stehen nicht in dieser Reihenfolge — die Ansicht ist veraltet',
    );
  }

  // Der tatsächliche rechte Nachbar: der kleinste Schlüssel, der größer ist
  // als der linke. Die eigene Zeile zählt nicht mit, sonst wäre sie beim
  // Verschieben um eine Stelle ihr eigener Nachbar.
  const next = await queryOne<{ sort_key: string }>(
    client,
    `SELECT sort_key FROM tasks
      WHERE workspace_id = $1
        AND project_id IS NOT DISTINCT FROM $2
        AND parent_id IS NOT DISTINCT FROM $3
        AND id <> $4
        AND ($5::text IS NULL OR sort_key > $5)
      ORDER BY sort_key ASC LIMIT 1`,
    [workspaceId, projectId, parentId, taskId, after],
  );

  return generateKeyBetween(after, next?.sort_key ?? null);
}

export async function move(
  pool: Pool,
  taskId: string,
  workspaceId: string,
  between: {
    afterId?: string | null;
    beforeId?: string | null;
    /**
     * Wohin sie GEHÖRT — eine Elternaufgabe, oder `null` für „ganz oben".
     *
     * Fehlt der Schlüssel, bleibt sie, wo sie ist, und nur die Reihenfolge
     * ändert sich. Beides in EINEM Aufruf und nicht in zweien: dieselbe
     * Überlegung wie beim Baum. Zwei Aufrufe wären zwei Wege, von denen der
     * zweite scheitern kann — und dann hinge eine Aufgabe unter einer neuen
     * Elternaufgabe an einer Stelle, die dort niemand gewählt hat.
     */
    parentId?: string | null;
  },
): Promise<TaskRow> {
  return retryOnOrderClash(() =>
    withTransaction(pool, async (client) => {
      const me = await queryOne<{
        project_id: string | null;
        parent_id: string | null;
      }>(
        client,
        'SELECT project_id, parent_id FROM tasks WHERE id = $1 AND workspace_id = $2',
        [taskId, workspaceId],
      );
      if (me === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);

      let umgehaengt = false;

      /*
       * Umhängen, falls gewünscht — und zwar VOR dem Rechnen der Nachbarn.
       *
       * Die Nachbarn gelten im NEUEN Geschwisterkreis: „hinter diese Zeile"
       * meint eine Zeile unter der neuen Elternaufgabe. Würde erst sortiert
       * und dann umgehängt, käme ein Schlüssel heraus, der im Zielkreis nichts
       * bedeutet.
       *
       * ## Eine Ebene, und die Regeln dafür
       *
       * Abgesprochen: „mach eine Ebene. Du hast recht, mit den Ordnern haben
       * wir Tiefe." Also braucht es keine Zyklusprüfung mit rekursiver
       * Abfrage, sondern zwei Sätze:
       *
       * - Eine Elternaufgabe hat selbst KEINE Elternaufgabe. Sonst entstünde
       *   die zweite Ebene durch die Hintertür.
       * - Eine Aufgabe MIT Kindern wird selbst kein Kind. Sonst wären ihre
       *   Kinder Enkel, ohne dass jemand das entschieden hätte.
       *
       * Beides zusammen schließt auch den Kreis aus: niemand kann sein eigenes
       * Kind werden, weil er dafür Elternteil und Kind zugleich wäre.
       *
       * Das Projekt wandert MIT. Eine Unteraufgabe, die in einem anderen
       * Projekt steht als ihre Elternaufgabe, wäre in zwei Listen zugleich —
       * einmal als Kind und einmal als eigene Zeile.
       */
      if (between.parentId !== undefined && between.parentId !== me.parent_id) {
        const neuerVater = between.parentId;
        if (neuerVater === taskId) {
          throw new OutOfOrder('eine Aufgabe kann nicht ihre eigene Unteraufgabe sein');
        }

        const hatKinder = await queryOne<{ id: string }>(
          client,
          'SELECT id FROM tasks WHERE parent_id = $1 AND trashed_at IS NULL LIMIT 1',
          [taskId],
        );
        if (neuerVater !== null && hatKinder !== undefined) {
          throw new OutOfOrder(
            'diese Aufgabe hat selbst Unteraufgaben — es gibt nur eine Ebene',
          );
        }

        let projekt = me.project_id;
        if (neuerVater !== null) {
          const vater = await queryOne<{ parent_id: string | null; project_id: string | null }>(
            client,
            `SELECT parent_id, project_id FROM tasks
              WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
            [neuerVater, workspaceId],
          );
          if (vater === undefined) throw new NotFound('diese Aufgabe gibt es hier nicht');
          if (vater.parent_id !== null) {
            throw new OutOfOrder(
              'das ist schon eine Unteraufgabe — es gibt nur eine Ebene',
            );
          }
          projekt = vater.project_id;
        }

        /*
         * HIER WIRD NOCH NICHT GESCHRIEBEN, und das war ein Fehler, den der
         * Test gefunden hat.
         *
         * Die erste Fassung hängte sofort um und rechnete danach den
         * Sortierschlüssel. Dazwischen trug die Zeile ihren ALTEN Schlüssel
         * im NEUEN Geschwisterkreis — und `tasks_sibling_order` ist eindeutig
         * über (Bereich, Projekt, Elternteil, Schlüssel). Traf der alte
         * Schlüssel einen vorhandenen, brach das Umhängen mit einem
         * Datenbankfehler ab, obwohl der Schlüssel zwei Zeilen später ohnehin
         * ersetzt worden wäre.
         *
         * Also: nur merken, und am Ende alles drei in EINEM UPDATE. Ein
         * Zwischenzustand, den niemand sehen will, darf gar nicht erst
         * entstehen.
         */
        me.parent_id = neuerVater;
        me.project_id = projekt;
        umgehaengt = true;
      }

      const key = await sortKeyFor(client, {
        taskId,
        workspaceId,
        projectId: me.project_id,
        parentId: me.parent_id,
        between,
      });
      const row = await queryOne<TaskRow>(
        client,
        umgehaengt
          ? `UPDATE tasks
                SET sort_key = $3, parent_id = $4, project_id = $5, updated_at = now()
              WHERE id = $1 AND workspace_id = $2
             RETURNING ${RETURNING}`
          : `UPDATE tasks SET sort_key = $3, updated_at = now()
              WHERE id = $1 AND workspace_id = $2
             RETURNING ${RETURNING}`,
        umgehaengt
          ? [taskId, workspaceId, key, me.parent_id, me.project_id]
          : [taskId, workspaceId, key],
      );
      if (row === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);
      return row;
    }),
  );
}

export class OutOfOrder extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfOrder';
  }
}

/**
 * Schlagwörter an eine Aufgabe hängen — die EINE Stelle, die das tut.
 *
 * Zwei Aufrufer: das Anlegen aus einer Zeile (`+wort` im Schnellerfasser) und
 * das nachträgliche Setzen aus der Oberfläche. Die erste Fassung hatte die
 * Einfügung nur im Anlegen, und sie verglich `ON CONFLICT (workspace_id, name)`
 * — also Zeichen für Zeichen. Ein zweiter Aufrufer mit derselben Zeile wäre ein
 * zweiter Vergleich, und einer von beiden hätte irgendwann ein `lower()` und der
 * andere nicht.
 *
 * `replace` unterscheidet die beiden Fälle, und zwar deutlich:
 *
 * - **false** (Anlegen): dazu, nichts weg. Eine Zeile nennt, was drankommt.
 * - **true** (Setzen): die Liste ist VOLLSTÄNDIG, was nicht drinsteht, geht ab.
 *   Ganz und nicht als Zu-/Abgang — dieselbe Regel wie bei den Zuständigen: eine
 *   Liste, die man nur ergänzen kann, hat keinen Weg zurück.
 *
 * GEFUNDEN WIRD OHNE RÜCKSICHT AUF GROSS UND KLEIN, angelegt wird in der
 * getippten Schreibweise. Wer `+Haus` schreibt, wo `+haus` schon steht, bekommt
 * `haus` — die erste Schreibweise ist die, die jemand bewusst gewählt hat, und
 * der eindeutige Index aus 0025 lässt die zweite ohnehin nicht daneben.
 */
async function setLabels(
  client: PoolClient,
  taskId: string,
  workspaceId: string,
  names: readonly string[],
  replace: boolean,
): Promise<void> {
  const wanted = uniqueLabels(names);
  if (wanted.length !== names.filter((n) => n.trim() !== '').length && replace) {
    // Nur beim Setzen ein Wurf: dort hat jemand ein Feld ausgefüllt und soll
    // erfahren, warum es nicht gilt. Beim Anlegen bleibt ein unbrauchbares
    // `@…` im Titel stehen (der Kern nimmt es dort nicht heraus), und ein
    // Wurf würde die ganze Aufgabe verhindern.
    const bad = names.find((n) => n.trim() !== '' && normalizeLabel(n) === undefined);
    if (bad !== undefined) {
      throw new OutOfOrder(
        `„${bad.trim()}“ ist kein Schlagwort — ein Wort ohne Leerzeichen, höchstens ${MAX_LABEL} Zeichen`,
      );
    }
  }

  const ids: string[] = [];
  for (const name of wanted) {
    /*
     * Erst suchen, dann anlegen — und beides über `lower(name)`.
     *
     * Kein `ON CONFLICT`, weil der Konflikt hier auf einem AUSDRUCK liegt
     * (`labels_by_name_ci`): `ON CONFLICT (workspace_id, lower(name))` wäre
     * möglich, aber dann steht die Regel ein zweites Mal im Abfragetext. Die
     * Suche davor ist ausserdem die, die die getippte Schreibweise verwirft
     * und die vorhandene behält.
     */
    const found = await queryOne<{ id: string }>(
      client,
      'SELECT id FROM labels WHERE workspace_id = $1 AND lower(name) = lower($2)',
      [workspaceId, name],
    );
    if (found !== undefined) {
      ids.push(found.id);
      continue;
    }
    const made = await queryOne<{ id: string }>(
      client,
      'INSERT INTO labels (workspace_id, name) VALUES ($1,$2) RETURNING id',
      [workspaceId, name],
    );
    if (made !== undefined) ids.push(made.id);
  }

  if (replace) {
    await client.query(
      'DELETE FROM task_labels WHERE task_id = $1 AND NOT (label_id = ANY($2::uuid[]))',
      [taskId, ids],
    );
  }
  for (const id of ids) {
    await client.query(
      'INSERT INTO task_labels (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [taskId, id],
    );
  }
}

/**
 * Einzelne Felder ändern — was das Anfasser-Menü schreibt.
 *
 * **Nur die genannten Felder.** Ein `undefined` heißt „nicht angefasst", ein
 * `null` heißt „leeren"; die beiden zu vermischen wäre ein Menü, das beim
 * Setzen eines Datums die Priorität mitnimmt. Dieselbe Regel wie beim
 * CalDAV-Fenster, nur von innen: wer ein Feld nicht trägt, darf es nicht
 * löschen.
 */
export interface Patch {
  readonly title?: string;
  readonly note?: string;
  readonly plannedAt?: Date | null;
  readonly plannedAllDay?: boolean;
  readonly dueAt?: Date | null;
  readonly dueAllDay?: boolean;
  readonly priority?: number;
  readonly projectId?: string | null;
  /**
   * Die Wiederholung — `null` nimmt sie weg.
   *
   * Sie war nur beim Anlegen setzbar (über `jeden Montag` im Schnellerfasser),
   * und danach nie mehr. Die Spalten, der Kern und das Abhaken waren die ganze
   * Zeit fertig; es fehlte der Weg dorthin. Ein Feld, das man einmal setzen und
   * nie ändern kann, ist ein halbes Versprechen.
   */
  readonly recurrence?: Recurrence | null;
  /**
   * Das Titelbild der Karte — `null` nimmt es weg.
   *
   * Geprüft wird beim SCHREIBEN und nicht beim Lesen: ein fehlerhaftes
   * Titelbild wird abgelehnt, nicht still geleert. `null` ist, wie man es
   * entfernt, und ein kaputtes als „lösch es" zu lesen wäre die schlechteste
   * verfügbare Deutung (SONEs Satz, ADR-0117).
   */
  readonly cover?: unknown;
  /**
   * Das Aussehen dieser Aufgabe — `null` nimmt es weg.
   *
   * Die genaueste der drei Ebenen (Projekt, Schlagwort, Aufgabe). Geprüft wird
   * beim Schreiben: ein unbekannter Schlüssel wird abgelehnt und nicht still
   * weggefiltert.
   */
  readonly look?: unknown;
  /**
   * Die geschätzte Dauer in Minuten — `null` nimmt sie weg.
   *
   * Als Zahl und nicht als Text: das Auslegen von „1h30" gehört dem Kern
   * (`parseDuration`), und zwei Auslegungen — eine im Feld, eine hier — wären
   * zwei Sprachen für dieselbe Angabe. Wer über die Route schreibt, schickt
   * Minuten.
   */
  readonly duration?: number | null;
  /**
   * Wer zuständig ist, vollständig — `[]` nimmt alle weg.
   *
   * Ganz und nicht als Zu-/Abgang: eine Liste, die man nur ergänzen kann, hat
   * keinen Weg zurück, und zwei Wege (hinzu, weg) wären zwei Routen für eine
   * Frage. Der Aufrufer schickt, wer es sein soll.
   */
  readonly assignees?: readonly string[];
  /**
   * Die Schlagwörter, vollständig — `[]` nimmt alle weg.
   *
   * Namen und nicht Ids: ein Schlagwort ENTSTEHT beim Vergeben, so wie im
   * Schnellerfasser. Wer erst eines anlegen müsste, um es zu benutzen, legt
   * keines an.
   */
  readonly labels?: readonly string[];
}

export async function patch(
  pool: Pool,
  taskId: string,
  workspaceId: string,
  fields: Patch,
): Promise<TaskRow> {
  const sets: string[] = [];
  const params: unknown[] = [taskId, workspaceId];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (title === '') throw new OutOfOrder('ein Titel darf nicht leer werden');
    set('title', title);
  }
  if (fields.note !== undefined) set('note', fields.note);
  if (fields.plannedAt !== undefined) set('planned_at', fields.plannedAt);
  if (fields.plannedAllDay !== undefined) set('planned_all_day', fields.plannedAllDay);
  if (fields.dueAt !== undefined) set('due_at', fields.dueAt);
  if (fields.dueAllDay !== undefined) set('due_all_day', fields.dueAllDay);
  if (fields.priority !== undefined) {
    if (!Number.isInteger(fields.priority) || fields.priority < 1 || fields.priority > 4) {
      throw new OutOfOrder('die Priorität hat vier Stufen');
    }
    set('priority', fields.priority);
  }
  if (fields.projectId !== undefined) set('project_id', fields.projectId);

  /*
   * Die Dauer, geprüft und nicht geglaubt.
   *
   * Der CHECK in Migration 0024 hält dieselben Grenzen — und trotzdem stehen
   * sie hier: ein Verstoß gegen den CHECK kommt als Postgres-Fehler zurück und
   * wird ein 500, also „der Server hat etwas falsch gemacht". Falsch ist aber
   * die Eingabe, und das ist ein 409 mit einem Satz, den man lesen kann. Die
   * Grenze selbst kommt aus dem Kern, damit sie nicht an zwei Stellen wächst.
   */
  if (fields.look !== undefined) {
    if (!isTaskLook(fields.look)) {
      throw new OutOfOrder('ein Aussehen kennt nur ein Zeichen und eine Farbe');
    }
    set('look', fields.look === null ? null : JSON.stringify(fields.look));
  }

  if (fields.cover !== undefined) {
    if (!isTaskCover(fields.cover)) {
      /*
       * Der Grund für die Ablehnung, und er ist wichtiger als die Regel: ein
       * Titelbild wird bei jedem Zeichnen geladen. Eine fremde Adresse darin
       * ist eine Karte, die jeden Betrachter bei jemand anderem meldet.
       */
      throw new OutOfOrder(
        'ein Titelbild ist ein eigener Anhang oder eine Farbe — eine fremde Adresse nicht',
      );
    }
    set('cover', fields.cover === null ? null : JSON.stringify(fields.cover));
  }

  if (fields.duration !== undefined) {
    const d = fields.duration;
    if (d === null) set('duration_min', null);
    else {
      if (!Number.isInteger(d) || d <= 0) {
        throw new OutOfOrder('eine Dauer ist eine ganze Zahl von Minuten ab 1');
      }
      if (d > MAX_DURATION) {
        throw new OutOfOrder(
          'länger als eine Woche ist keine Schätzung mehr — das ist ein Projekt mit Teilaufgaben',
        );
      }
      set('duration_min', d);
    }
  }

  /*
   * Wiederholung: vier Spalten, zwei Formen, und immer ALLE vier gesetzt.
   *
   * Sonst bleibt beim Wechsel von „jeden Montag" auf „3 Tage nach Erledigung"
   * die alte RRULE stehen, und `recurrenceOf` liest die zuerst — die Aufgabe
   * würde weiter montags kommen, obwohl etwas anderes dasteht.
   */
  if (fields.recurrence !== undefined) {
    const r = fields.recurrence;
    if (r === null) {
      set('recur_rrule', null);
      set('recur_dtstart', null);
      set('recur_after_n', null);
      set('recur_after_unit', null);
    } else if (r.kind === 'calendar') {
      // Geprüft und nicht geglaubt: `parseRrule` wirft bei allem, was der Kern
      // nicht anbietet, und eine ungültige Regel in der Spalte wäre eine
      // Aufgabe, die beim Abhaken fehlschlägt.
      parseRrule(r.rrule);
      set('recur_rrule', r.rrule);
      set('recur_dtstart', r.dtstart);
      set('recur_after_n', null);
      set('recur_after_unit', null);
    } else {
      if (!Number.isInteger(r.n) || r.n < 1) {
        throw new OutOfOrder('eine Wiederholung nach Erledigung braucht eine ganze Zahl ab 1');
      }
      set('recur_rrule', null);
      set('recur_dtstart', null);
      set('recur_after_n', r.n);
      set('recur_after_unit', r.unit);
    }
  }

  if (sets.length === 0 && fields.assignees === undefined && fields.labels === undefined) {
    throw new OutOfOrder('nichts zu ändern');
  }

  /*
   * Eine Transaktion, weil Zuständige eine zweite Tabelle sind.
   *
   * Ohne sie könnte die Zuweisung stehen und das Feld daneben nicht (oder
   * umgekehrt) — zwei Wahrheiten über einen Vorgang, für den es eine gibt.
   */
  return withTransaction(pool, async (client) => {
    let row: TaskRow | undefined;
    if (sets.length > 0) {
      const out = await client.query<TaskRow>(
        `UPDATE tasks SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1 AND workspace_id = $2
         RETURNING ${RETURNING}`,
        params,
      );
      row = out.rows[0];
    } else {
      // Nur Zuständige oder Schlagwörter: die Aufgabe wird trotzdem angefasst,
      // damit `updated_at` stimmt und die Türklingel läutet.
      const out = await client.query<TaskRow>(
        `UPDATE tasks SET updated_at = now()
          WHERE id = $1 AND workspace_id = $2
         RETURNING ${RETURNING}`,
        [taskId, workspaceId],
      );
      row = out.rows[0];
    }
    if (row === undefined) throw new NotFound(`Aufgabe ${taskId} gibt es nicht`);

    if (fields.assignees !== undefined) {
      const wanted = [...new Set(fields.assignees)];
      /*
       * Nur Mitglieder DIESES Arbeitsbereichs.
       *
       * Sonst schreibt eine Id von außen eine Zuständigkeit, die niemand
       * einsehen kann — und die Benachrichtigung ginge an jemanden, der die
       * Aufgabe nicht öffnen darf.
       */
      if (wanted.length > 0) {
        const ok = await client.query<{ user_id: string }>(
          `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`,
          [workspaceId, wanted],
        );
        if (ok.rows.length !== wanted.length) {
          throw new OutOfOrder('nur Mitglieder dieses Arbeitsbereichs können zuständig sein');
        }
      }
      await client.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
      for (const userId of wanted) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [taskId, userId],
        );
      }
    }

    if (fields.labels !== undefined) {
      await setLabels(client, taskId, workspaceId, fields.labels, true);
      /*
       * NOCHMAL LESEN, und das ist kein Luxus.
       *
       * `labels` ist keine Spalte, sondern `labels_of(id)` — die Zeile von
       * oben trägt also den Stand VOR dieser Änderung. Ohne das zweite Lesen
       * antwortet die Route mit den alten Etiketten, die Oberfläche zeichnet
       * sie, und das nächste Laden zeigt plötzlich andere. Genau die Sorte
       * Fehler, die aussieht wie „hat nicht gespeichert".
       */
      const wieder = await client.query<TaskRow>(
        `${SELECT} WHERE id = $1 AND workspace_id = $2`,
        [taskId, workspaceId],
      );
      row = wieder.rows[0] ?? row;
    }
    return row;
  });
}

/* ── Papierkorb ────────────────────────────────────────────────────────────
   „Erledigt ist nicht gelöscht" (Konzept, Abschnitt 8a). Eine abgehakte
   Aufgabe ist ein Ergebnis und bleibt in ihrem Projekt; eine gelöschte ist ein
   Irrtum und liegt hier. Und **es gibt keinen Sweep**: eine Frist, die von
   selbst löscht, ist eine Löschung, die niemand angeordnet hat. */

export type TrashKind = 'task' | 'project';

export interface TrashEntry {
  readonly kind: TrashKind;
  readonly id: string;
  readonly title: string;
  readonly trashedAt: Date;
  readonly trashedBy: string | null;
  /** Bei einer Aufgabe: das Projekt, in das sie zurückwill. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  /** Ist dieses Projekt selbst im Papierkorb? Dann braucht das Zurück ein Ziel. */
  readonly projectTrashed: boolean;
  /** Bei einem Projekt: wie viele Aufgaben mitkommen. */
  readonly carries: number | null;
  /** Ein Blick hinein, ohne die Zeile zu öffnen. */
  readonly peek: string | null;
}

export async function trash(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const table = kind === 'task' ? 'tasks' : 'projects';
  const res = await pool.query(
    `UPDATE ${table} SET trashed_at = now(), trashed_by = $3
      WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL`,
    [id, workspaceId, userId],
  );
  if (res.rowCount === 0) {
    throw new NotFound(`${kind} ${id} gibt es nicht oder liegt schon im Papierkorb`);
  }
}

/**
 * Zurückholen.
 *
 * **Ein Projekt nimmt seine Aufgaben mit**, in beide Richtungen: weggeworfen
 * verschwinden sie, zurückgeholt kommen sie wieder. Sie tragen dafür kein
 * eigenes `trashed_at` — dass ihr Projekt im Papierkorb liegt, genügt. Damit
 * gibt es auch keinen Zustand, in dem die Aufgaben zurück sind und das Projekt
 * nicht.
 *
 * Eine **einzeln** weggeworfene Aufgabe braucht ein Ziel, wenn ihr Projekt
 * inzwischen selbst im Papierkorb liegt: sonst wäre sie zurückgeholt und
 * trotzdem unsichtbar, und das ist der eine Ausgang, den ein Zurück-Knopf nicht
 * haben darf.
 */
export async function restore(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
  target?: string | null,
): Promise<void> {
  if (kind === 'project') {
    const res = await pool.query(
      `UPDATE projects SET trashed_at = NULL, trashed_by = NULL
        WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NOT NULL`,
      [id, workspaceId],
    );
    if (res.rowCount === 0) throw new NotFound(`Projekt ${id} liegt nicht im Papierkorb`);
    return;
  }

  await withTransaction(pool, async (client) => {
    const row = await queryOne<{ project_id: string | null; project_trashed: boolean }>(
      client,
      `SELECT t.project_id,
              COALESCE(p.trashed_at IS NOT NULL, false) AS project_trashed
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1 AND t.workspace_id = $2 AND t.trashed_at IS NOT NULL`,
      [id, workspaceId],
    );
    if (row === undefined) throw new NotFound(`Aufgabe ${id} liegt nicht im Papierkorb`);

    let projectId = row.project_id;
    if (row.project_trashed) {
      if (target === undefined) {
        throw new NeedsTarget(
          'das Projekt dieser Aufgabe liegt selbst im Papierkorb — wohin soll sie zurück?',
        );
      }
      if (target !== null) {
        /*
         * Nicht nur das Projekt selbst muss leben, sondern der ganze Pfad.
         *
         * Seit Ordner und Projekte getrennt sind, kann ein Ordner über einem
         * unberührten Projekt im Korb liegen. Etwas dorthin zurückzuholen
         * hieße, es an einen Ort zu legen, den man nicht sieht — und das ist
         * schlimmer als eine Fehlermeldung.
         *
         * Und die Art zählt: ein Ordner ist kein Ziel für Aufgaben.
         */
        const ok = await queryOne<{ kind: string }>(
          client,
          `SELECT kind FROM projects
            WHERE id = $1 AND workspace_id = $2 AND NOT project_in_trash(id)`,
          [target, workspaceId],
        );
        if (ok === undefined) throw new NotFound(`Projekt ${target} gibt es nicht`);
        if (ok.kind !== 'list') {
          throw new OutOfOrder('ein Ordner hält keine Aufgaben');
        }
      }
      projectId = target;
    } else if (target !== undefined) {
      projectId = target;
    }

    // Am Ende der Zielliste, nicht an der alten Stelle: die Lücke ist längst
    // zu, und ein alter Schlüssel kollidiert mit dem Index aus 0003.
    const key = await keyAtEnd(client, workspaceId, projectId);
    await client.query(
      `UPDATE tasks SET trashed_at = NULL, trashed_by = NULL,
              project_id = $3, sort_key = $4, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId, projectId, key],
    );
  });
}

export class NeedsTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsTarget';
  }
}

/** Endgültig. Bei einem Projekt gehen seine Aufgaben mit (ON DELETE CASCADE). */
export async function purge(
  pool: Pool,
  kind: TrashKind,
  id: string,
  workspaceId: string,
): Promise<void> {
  const table = kind === 'task' ? 'tasks' : 'projects';
  const res = await pool.query(
    `DELETE FROM ${table}
      WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NOT NULL`,
    [id, workspaceId],
  );
  // Nur aus dem Papierkorb: endgültig löschen ist kein Weg, der an ihm
  // vorbeiführt.
  if (res.rowCount === 0) throw new NotFound(`${kind} ${id} liegt nicht im Papierkorb`);
}

export async function listTrash(
  pool: Pool,
  workspaceId: string,
  kind: TrashKind,
): Promise<TrashEntry[]> {
  if (kind === 'project') {
    const rows = await queryRows<{
      id: string;
      name: string;
      trashed_at: Date;
      trashed_by: string | null;
      carries: string;
      peek: string | null;
    }>(
      pool,
      `SELECT p.id, p.name, p.trashed_at, p.trashed_by,
              count(t.id) FILTER (WHERE t.trashed_at IS NULL) AS carries,
              string_agg(t.title, ', ' ORDER BY t.sort_key)
                FILTER (WHERE t.trashed_at IS NULL) AS peek
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.workspace_id = $1 AND p.trashed_at IS NOT NULL
        GROUP BY p.id ORDER BY p.trashed_at DESC`,
      [workspaceId],
    );
    return rows.map((r) => ({
      kind: 'project' as const,
      id: r.id,
      title: r.name,
      trashedAt: r.trashed_at,
      trashedBy: r.trashed_by,
      projectId: null,
      projectName: null,
      projectTrashed: false,
      carries: Number(r.carries),
      peek: r.peek,
    }));
  }

  const rows = await queryRows<{
    id: string;
    title: string;
    note: string;
    trashed_at: Date;
    trashed_by: string | null;
    project_id: string | null;
    project_name: string | null;
    project_trashed: boolean;
  }>(
    pool,
    `SELECT t.id, t.title, t.note, t.trashed_at, t.trashed_by,
            t.project_id, p.name AS project_name,
            COALESCE(p.trashed_at IS NOT NULL, false) AS project_trashed
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.workspace_id = $1 AND t.trashed_at IS NOT NULL
      ORDER BY t.trashed_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => ({
    kind: 'task' as const,
    id: r.id,
    title: r.title,
    trashedAt: r.trashed_at,
    trashedBy: r.trashed_by,
    projectId: r.project_id,
    projectName: r.project_name,
    projectTrashed: r.project_trashed,
    carries: null,
    peek: r.note === '' ? null : r.note.slice(0, 200),
  }));
}
