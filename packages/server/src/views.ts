/**
 * SOTE — die Ansichten.
 *
 * **Eine** Stelle entscheidet, was „Heute" heißt. Vorher stand die Bedingung in
 * `tasks.ts` neben dem Schreiben, und die nächste Ansicht hätte ihre eigene
 * Kopie bekommen — das ist der Weg zu zwei Antworten auf eine Frage (SONE,
 * ADR-0086). Die Zähler im Panel lesen dieselben Bedingungen wie die Listen;
 * ein zweiter Weg zur Zahl ist, wie Zahl und Liste sich uneins werden
 * (ADR-0092).
 *
 * Die vier Ansichten und ihre Bedeutung:
 *
 * - **Heute** — geplant für heute oder früher, **oder** die Frist läuft heute
 *   oder früher ab. Zwei Felder, eine Ansicht: das ist der Sinn der Trennung.
 * - **Demnächst** — hat einen Zeitpunkt, aber er liegt nach heute.
 * - **Irgendwann** — hat keinen Zeitpunkt. Nicht „unwichtig", sondern
 *   „ungeplant"; hier liegt auch die erledigungsbezogene Wiederholung vor ihrem
 *   ersten Abhaken.
 * - **Ein Projekt** — alles darin, ungeachtet der Zeit.
 */

import { endOfDayIn, startOfDayIn } from '@sote/core';
import type { Pool } from 'pg';

import { queryRows, type PoolClient } from './db.js';
import type { TaskRow } from './tasks.js';

export type ViewId = 'today' | 'upcoming' | 'someday' | 'inbox' | 'project';

const COLUMNS = `
  id, workspace_id, project_id, parent_id, title, note,
  planned_at, planned_all_day, due_at, due_all_day, priority,
  completed_at, recur_rrule, recur_dtstart, recur_after_n,
  recur_after_unit, duration_min, column_id, cover, sort_key,
  labels_of(id) AS labels, marks_of(id) AS marks`;

/**
 * Immer wahr für jede Zeile, die überhaupt in einer Ansicht auftauchen darf.
 *
 * **Auch der ganze Pfad muss leben.** Ein Projekt in den Papierkorb zu werfen
 * nimmt seine Aufgaben mit (Konzept, Abschnitt 8a) — ohne diese Bedingung
 * blieben sie in Heute stehen, während das Projekt aus dem Panel verschwunden
 * ist, und niemand fände den Ort, an dem man sie loswird.
 *
 * **Seit Ordner und Projekte getrennt sind** (Konzept 10d), reicht das Projekt
 * nicht: über ihm liegt mindestens ein Ordner, und der kann im Korb liegen,
 * während das Projekt selbst unberührt ist. Das war im Konzept als die
 * heikelste Stelle der Umstellung benannt, und sie ist keine Zeile — es wird
 * eine Prüfung **entlang des Pfades**.
 *
 * Rekursiv und nicht mit einer Pfadspalte: eine gespeicherte Pfadspalte müsste
 * bei jedem Umhängen für den ganzen Teilbaum nachgezogen werden, und ein
 * vergessenes Nachziehen zeigt Aufgaben aus einem weggeworfenen Ordner. Die
 * Rekursion kann nichts vergessen.
 *
 * **Als Funktion und nicht als CTE hier im Text**, und das ist kein Stil: eine
 * rekursive CTE in einer korrelierten Unterabfrage **sieht die äußere Zeile
 * nicht**. Genau so stand es hier zuerst, lief ohne Fehler und lieferte nie
 * eine Zeile — also galt jede Aufgabe als lebendig, auch unter einem
 * weggeworfenen Ordner. Aufgefallen ist es an neun sichtbaren Aufgaben, nachdem
 * der oberste Ordner im Korb lag; ein Test hätte es gemeldet, ein Blick auf den
 * Code nicht.
 *
 * Als NOT EXISTS und nicht als JOIN: ein JOIN müsste `LEFT` sein, weil
 * `project_id` NULL sein darf, und ein vergessenes `LEFT` verliert genau die
 * Aufgaben ohne Projekt.
 */
const ALIVE = `completed_at IS NULL AND trashed_at IS NULL
  AND (tasks.project_id IS NULL OR NOT project_in_trash(tasks.project_id))`;

/**
 * Dasselbe, aber Erledigtes darf mit.
 *
 * Gemeldet: „es sollte überall die möglichkeit geben abgehakte einzublenden.
 * vielleicht schieben die sich in eine gesonderte liste unten und sind dann
 * ausgegraut."
 *
 * Zwei Zeichenketten und keine Bedingung mit `OR $n`: die Ansichten setzen
 * ihre Parameter durchnumeriert ein, und ein zusätzlicher Platzhalter mitten
 * in `ALIVE` würde jede Nummer danach verschieben. Der Papierkorb bleibt in
 * **beiden** Fassungen ausgeschlossen — „einblenden" heißt erledigt, nicht
 * weggeworfen.
 */
const ALIVE_WITH_DONE = `trashed_at IS NULL
  AND (tasks.project_id IS NULL OR NOT project_in_trash(tasks.project_id))`;

/** Erledigtes zuletzt — die Reihenfolge, die die Projektansicht schon hatte. */
const DONE_LAST = 'completed_at IS NOT NULL, ';

export interface Bounds {
  readonly startOfDay: Date;
  readonly endOfDay: Date;
}

/**
 * Der Tag, in dem `now` liegt.
 *
 * Hier stand: „gerechnet in UTC, weil der Server keine Zeitzone hat. Die
 * Zeitzone gehört dem Browser." Der Gedanke war richtig, die Umsetzung nicht —
 * der Browser schickte einen **Zeitpunkt** mit, keine **Zeitzone**, und ein
 * Zeitpunkt sagt nicht, in welchem Tag jemand steht. Um 00:30 in Berlin ist es
 * in UTC noch gestern, und „Heute" zeigte dann den falschen Tag.
 *
 * Jetzt kommt die Zone mit. Ohne sie wird weiter in UTC gerechnet — für Tests,
 * die das annehmen, und für nichts sonst.
 *
 * Ein Tag ist damit nicht mehr immer 24 Stunden lang: an den beiden
 * Umstellungstagen sind es 23 und 25. Deshalb werden Anfang und Ende getrennt
 * ausgerechnet und nicht eines aus dem anderen.
 */
export function boundsOf(now: Date, zone?: string): Bounds {
  if (zone === undefined || zone === 'UTC') {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    return {
      startOfDay: new Date(Date.UTC(y, m, d)),
      endOfDay: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
    };
  }
  return { startOfDay: startOfDayIn(zone, now), endOfDay: endOfDayIn(zone, now) };
}

interface Where {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly order: string;
}

function whereFor(
  view: ViewId,
  workspaceId: string,
  bounds: Bounds,
  projectId: string | null,
  /**
   * Ob Erledigtes mitkommt.
   *
   * Es rutscht dann **an das Ende derselben Abfrage** und nicht in eine zweite:
   * eine zweite Abfrage hätte eine eigene Sortierung, eine eigene Grenze und
   * einen eigenen Zeitpunkt — und zwei Listen, die zusammen eine sein sollen,
   * laufen genau daran auseinander.
   */
  withDone: boolean,
): Where {
  const alive = withDone ? ALIVE_WITH_DONE : ALIVE;
  const last = withDone ? DONE_LAST : '';
  switch (view) {
    case 'today':
      return {
        sql: `workspace_id = $1 AND ${alive}
              AND (planned_at <= $2 OR due_at <= $2)`,
        params: [workspaceId, bounds.endOfDay],
        /*
         * HEUTE WIRD VON HAND SORTIERT — innerhalb der Dringlichkeit.
         *
         * GEMELDET: „Bei der Heute-Ansicht kann man nicht sortieren. Bei der
         * Aufgabe mit Unteraufgaben erscheint aber der Anfasser. Entweder kann
         * man auch dort sortieren oder Anfasser weg. Ich tendiere zu ersterem,
         * da wir ja gesagt haben, dass ich auch heute eine Prio ordnen möchte."
         *
         * Vorher stand die Uhrzeit zwischen Dringlichkeit und Hand-Reihenfolge.
         * Damit war Ziehen in Heute unmöglich: zwei Zeilen mit verschiedenen
         * Zeiten hätte der Sortierschlüssel nie auseinanderhalten können, und
         * jede abgelegte Zeile wäre an ihren alten Platz zurückgesprungen. Ein
         * Ablegen, das nicht hält, ist schlimmer als eines, das gar nicht
         * angeboten wird.
         *
         * Was dabei aufgegeben wird, und man soll es wissen: die Termine des
         * Tages stehen nicht mehr von selbst in Uhrzeit-Reihenfolge. Sie tragen
         * ihre Zeit weiterhin sichtbar in der Zeile — und wer sie in dieser
         * Reihenfolge haben will, zieht sie einmal dorthin. Danach bleibt es so.
         *
         * Die Dringlichkeit bleibt VOR der Hand: sie ist die Aussage „das ist
         * wichtiger", und die soll eine Handbewegung nicht beiläufig
         * überschreiben. Wer über die Grenze zieht, ändert sie ausdrücklich —
         * das entscheidet die Oberfläche und schreibt beides.
         */
        order: `${last}priority ASC, sort_key ASC`,
      };
    case 'upcoming':
      return {
        sql: `workspace_id = $1 AND ${alive}
              AND (planned_at IS NOT NULL OR due_at IS NOT NULL)
              AND COALESCE(planned_at, due_at) > $2`,
        params: [workspaceId, bounds.endOfDay],
        order: `${last}COALESCE(planned_at, due_at) ASC, priority ASC, sort_key ASC`,
      };
    case 'inbox':
      /*
       * Der Posteingang: was noch keinen Ort hat.
       *
       * Die Schnellerfassung zieht ihren Wert daraus, dass man **nichts
       * entscheiden muss**, um etwas festzuhalten (Konzept 10d) — also
       * entstehen Aufgaben ohne Projekt, und die brauchen einen Ort, an dem man
       * sie wiederfindet. Bis hierher lagen sie in Irgendwann, zusammen mit
       * allem, was jemand ausdrücklich als „irgendwann" eingeordnet hat. Das
       * sind zwei verschiedene Dinge: **ohne Ort** und **ohne Zeit**.
       *
       * Ein Datum schließt hier nicht aus. Wer „Zahnarzt anrufen morgen"
       * tippt, hat einen Zeitpunkt gesagt und keinen Ort — die Aufgabe steht
       * dann in Demnächst UND hier, und das ist richtig: sie ist erfasst und
       * nicht eingeordnet. Der Posteingang ist eine Frage an den Menschen
       * („wohin gehört das?"), keine Ansicht über die Zeit.
       */
      return {
        sql: `workspace_id = $1 AND ${alive} AND project_id IS NULL AND parent_id IS NULL`,
        params: [workspaceId],
        order: `${last}COALESCE(planned_at, due_at) ASC NULLS LAST, priority ASC, sort_key ASC`,
      };
    case 'someday':
      return {
        /*
         * Irgendwann heißt **ohne Zeit**, nicht „ohne Ort".
         *
         * `project_id IS NOT NULL` ist neu: was noch nirgends einsortiert ist,
         * steht im Posteingang und hier nicht mehr doppelt. Eine Aufgabe an
         * zwei Orten, von denen einer „ungeplant" und der andere „unerfasst"
         * heißt, lässt niemanden wissen, welchen er abarbeiten soll.
         */
        sql: `workspace_id = $1 AND ${alive}
              AND planned_at IS NULL AND due_at IS NULL
              AND project_id IS NOT NULL`,
        params: [workspaceId],
        order: `${last}priority ASC, sort_key ASC`,
      };
    case 'project':
      return {
        // Ein Projekt zeigt auch Erledigtes, aber unten: „was habe ich hier
        // geschafft" ist eine Frage, die dieser Bildschirm beantworten soll,
        // und `Heute` soll sie nicht beantworten.
        //
        // Und **nur die obersten Zeilen**: eine Teilaufgabe steht in der
        // Detailspalte unter ihrer Aufgabe. Beides zu zeigen hieße, dieselbe
        // Sache zweimal in einer Liste zu haben, mit zwei Kästchen, die
        // dasselbe meinen. In den Zeit-Ansichten ist es umgekehrt: dort steht
        // sie, weil sie ein eigenes Datum hat, und genau das ist der Grund für
        // echte Teilaufgaben statt Checklistenpunkte.
        // Auch hier ist Erledigtes jetzt eine WAHL und nicht die Vorgabe der
        // Ansicht. Vorher zeigte das Projekt es immer — eine Ansicht, die
        // etwas zeigt, was die Nachbarn verbergen, ist genau die
        // Ungleichheit, die gemeldet wurde. Die Vorgabe je Ansicht bleibt
        // trotzdem unterschiedlich, und das entscheidet die Oberfläche.
        sql: `workspace_id = $1 AND project_id = $2 AND trashed_at IS NULL
              AND parent_id IS NULL
              ${withDone ? '' : 'AND completed_at IS NULL'}`,
        params: [workspaceId, projectId],
        order: `${last}sort_key ASC`,
      };
  }
}

/**
 * Die Unteraufgaben zu einer Handvoll Aufgaben, in einem Zug.
 *
 * Mit der Liste zusammen geholt und nicht beim Aufklappen: das Aufklappen wäre
 * sonst eine Abfrage, und das ZIEHEN bräuchte die Kinder schon vorher — wer
 * eine Aufgabe auf eine zugeklappte zieht, soll sie ans Ende der Kinder
 * setzen, und dafür muss bekannt sein, was dort am Ende steht.
 *
 * Es sind wenige Zeilen: Unteraufgaben gibt es an einzelnen Aufgaben, nicht an
 * allen. Wer keine hat, bekommt eine leere Karte.
 *
 * Erledigte kommen MIT, wenn die Liste sie auch zeigt — sonst stünde unter
 * einer aufgeklappten Aufgabe „zwei von fünf", und drei wären unsichtbar.
 */
export async function childrenOf(
  q: Pool | PoolClient,
  workspaceId: string,
  parentIds: readonly string[],
  withDone = false,
): Promise<Record<string, TaskRow[]>> {
  if (parentIds.length === 0) return {};
  const rows = await queryRows<TaskRow>(
    q,
    `SELECT ${COLUMNS} FROM tasks
      WHERE workspace_id = $1 AND parent_id = ANY($2::uuid[])
       AND trashed_at IS NULL
       ${withDone ? '' : 'AND completed_at IS NULL'}
     ORDER BY completed_at IS NOT NULL, sort_key ASC`,
    [workspaceId, parentIds],
  );
  const out: Record<string, TaskRow[]> = {};
  for (const row of rows) {
    const key = row.parent_id;
    if (key === null) continue;
    (out[key] ??= []).push(row);
  }
  return out;
}

export async function list(
  q: Pool | PoolClient,
  view: ViewId,
  workspaceId: string,
  now: Date,
  projectId: string | null = null,
  zone?: string,
  withDone = false,
): Promise<TaskRow[]> {
  const bounds = boundsOf(now, zone);
  const where = whereFor(view, workspaceId, bounds, projectId, withDone);
  return queryRows<TaskRow>(
    q,
    `SELECT ${COLUMNS} FROM tasks WHERE ${where.sql} ORDER BY ${where.order}`,
    where.params,
  );
}

/**
 * Die Zahlen für das Panel — aus **denselben** Bedingungen wie die Listen.
 *
 * In einer Abfrage und nicht in drei: drei Runden für drei Zahlen sind drei
 * Zeitpunkte, und dann zeigt das Panel eine Summe, die es nie gegeben hat.
 */
export async function counts(
  q: Pool | PoolClient,
  workspaceId: string,
  now: Date,
  zone?: string,
): Promise<{
  today: number;
  upcoming: number;
  someday: number;
  inbox: number;
  overdue: number;
}> {
  const bounds = boundsOf(now, zone);
  const rows = await queryRows<{
    today: string;
    upcoming: string;
    someday: string;
    inbox: string;
    overdue: string;
  }>(
    q,
    `SELECT
       count(*) FILTER (WHERE planned_at <= $2 OR due_at <= $2)          AS today,
       count(*) FILTER (WHERE (planned_at IS NOT NULL OR due_at IS NOT NULL)
                          AND COALESCE(planned_at, due_at) > $2)         AS upcoming,
       -- Dieselben Bedingungen wie in whereFor, und das ist die Stelle, an
       -- der es auseinanderlaufen kann: eine Zahl, die anders zaehlt als die
       -- Liste, ist schlimmer als keine Zahl. Ein Test haelt beide zusammen.
       -- (Ohne Backticks im Kommentar: sie beenden das Template-Literal, und
       -- der Uebersetzer meldet dann eine fehlende Klammer irgendwo weiter
       -- unten. Eine halbe Stunde Suche fuer zwei Zeichen.)
       count(*) FILTER (WHERE planned_at IS NULL AND due_at IS NULL
                          AND project_id IS NOT NULL)                    AS someday,
       count(*) FILTER (WHERE project_id IS NULL AND parent_id IS NULL)   AS inbox,
       count(*) FILTER (WHERE COALESCE(planned_at, due_at) < $3)         AS overdue
     FROM tasks WHERE workspace_id = $1 AND ${ALIVE}`,
    [workspaceId, bounds.endOfDay, bounds.startOfDay],
  );
  const r = rows[0];
  return {
    today: Number(r?.today ?? 0),
    upcoming: Number(r?.upcoming ?? 0),
    someday: Number(r?.someday ?? 0),
    inbox: Number(r?.inbox ?? 0),
    overdue: Number(r?.overdue ?? 0),
  };
}

/** Was heute überfällig ist, aus einer bereits geholten Liste. */
export function splitOverdue(
  rows: readonly TaskRow[],
  now: Date,
  zone?: string,
): { overdue: TaskRow[]; rest: TaskRow[] } {
  const { startOfDay } = boundsOf(now, zone);
  const overdue: TaskRow[] = [];
  const rest: TaskRow[] = [];
  for (const row of rows) {
    const marker = row.planned_at ?? row.due_at;
    /*
     * Erledigtes ist nie überfällig.
     *
     * Ohne `completed_at === null` wäre eine abgehakte Aufgabe von letzter
     * Woche im Abschnitt „überfällig" gelandet, sobald man Erledigtes
     * einblendet — und „überfällig" ist eine Aufforderung. Sie an etwas zu
     * richten, das schon getan ist, macht den Abschnitt unbrauchbar, und zwar
     * genau für den, der ihn am meisten braucht.
     */
    const offen = row.completed_at === null;
    if (offen && marker !== null && marker.getTime() < startOfDay.getTime()) {
      overdue.push(row);
    } else rest.push(row);
  }
  return { overdue, rest };
}
