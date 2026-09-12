/**
 * SOTE — die Suche.
 *
 * Die Abfrage wird in `@sote/core` gelesen, nicht hier: dieselbe Funktion, die
 * die Oberfläche für die Chips benutzt. Wenn der Server sie selbst zerlegte,
 * würden Anzeige und Ergebnis beim ersten Sonderfall auseinanderlaufen — und
 * niemand sähe, welche der beiden falsch liegt.
 *
 * Hier wird nur aus der gelesenen Abfrage SQL. Das ist die Stelle, an der die
 * Facetten Bedingungen werden, und jede von ihnen hat eine Begründung:
 *
 * - **Präfix ODER gestemmt, je Wort.** `:*` schaltet die Stemmung ab —
 *   `to_tsquery('german','dosen:*')` ergibt `'dosen':*` und trifft den
 *   gestemmten Vektor `'dos'` nicht. Präfix braucht man beim Tippen (wer tippt,
 *   hat das Wort noch nicht fertig), Stemmung bei einer fertigen Abfrage
 *   („Dosen" soll „Dose" finden). Keins von beiden allein genügt, also wird
 *   jedes Wort zu `(wort:* | wort)`.
 * - **Projekt und Schlagwort nach Namen**, nicht nach Id: die Abfrage ist ein
 *   String, den jemand getippt haben kann, und `+haus` soll auch dann gehen,
 *   wenn es aus einem Lesezeichen kommt.
 * - **Offen ist die Vorgabe.** Wer sucht, sucht meistens etwas zu tun. Wer
 *   Erledigtes will, sagt `ist:erledigt`.
 */

import { parseTaskQuery, type TaskQuery } from '@sote/core';
import type { Pool } from 'pg';

import { queryRows } from './db.js';
import type { TaskRow } from './tasks.js';
import { boundsOf } from './views.js';

const COLUMNS = `
  t.id, t.workspace_id, t.project_id, t.parent_id, t.title, t.note,
  t.planned_at, t.planned_all_day, t.due_at, t.due_all_day, t.priority,
  t.completed_at, t.recur_rrule, t.recur_dtstart, t.recur_after_n,
  t.recur_after_unit, t.duration_min, t.column_id, t.cover, t.look, t.sort_key,
  labels_of(t.id) AS labels, marks_of(t.id) AS marks`;

/**
 * Aus Wörtern eine `tsquery`.
 *
 * Jedes Wort wird auf Buchstaben und Ziffern beschnitten. Beschnitten wird,
 * weil `to_tsquery` eine eigene Sprache mit `&`, `|`, `!` und Klammern hat —
 * ein getipptes `!` oder `(` löste sonst einen Syntaxfehler aus, und der käme
 * beim Tippen ständig.
 *
 * Dann wird jedes Wort zu `(wort:* | wort)`: der erste Teil trifft beim Tippen,
 * der zweite wird gestemmt und trifft die Beugung. Die Wörter werden mit UND
 * verbunden — zwei Wörter verengen, sie erweitern nicht.
 */
export function toTsQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w !== '');
  if (terms.length === 0) return null;
  return terms.map((w) => `(${w}:* | ${w})`).join(' & ');
}

export interface SearchResult {
  readonly query: TaskQuery;
  readonly tasks: readonly TaskRow[];
  /** Mehr als `limit` Treffer? Dann ist die Liste nicht vollständig. */
  readonly more: boolean;
}

export async function search(
  pool: Pool,
  workspaceId: string,
  raw: string,
  now: Date,
  limit = 100,
  zone?: string,
): Promise<SearchResult> {
  const query = parseTaskQuery(raw);
  const where: string[] = ['t.workspace_id = $1', 't.trashed_at IS NULL'];
  const params: unknown[] = [workspaceId];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };

  if (query.status === 'open') where.push('t.completed_at IS NULL');
  else if (query.status === 'done') where.push('t.completed_at IS NOT NULL');

  const ts = toTsQuery(query.text);
  if (ts !== null) {
    add(
      (n) =>
        `to_tsvector('german', coalesce(t.title,'') || ' ' || coalesce(t.note,''))
           @@ to_tsquery('german', $${n})`,
      ts,
    );
  }

  if (query.projects.length > 0) {
    add(
      (n) => `EXISTS (
        SELECT 1 FROM projects p
         WHERE p.id = t.project_id AND lower(p.name) = ANY($${n})
      )`,
      query.projects.map((p) => p.toLowerCase()),
    );
  }

  if (query.labels.length > 0) {
    // ALLE genannten Schlagwörter, nicht irgendeines: zwei Schlagwörter
    // nebeneinander sind eine Verengung. Wer eine Auswahl will, sucht zweimal.
    add(
      (n) => `(
        SELECT count(DISTINCT lower(l.name)) FROM task_labels tl
          JOIN labels l ON l.id = tl.label_id
         WHERE tl.task_id = t.id AND lower(l.name) = ANY($${n})
      ) = array_length($${n}, 1)`,
      query.labels.map((l) => l.toLowerCase()),
    );
  }

  if (query.assignees.length > 0) {
    add(
      (n) => `EXISTS (
        SELECT 1 FROM task_assignees a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.task_id = t.id
           AND (lower(u.display_name) = ANY($${n})
             OR lower(split_part(u.display_name, ' ', 1)) = ANY($${n})
             OR lower(u.email) = ANY($${n})
             OR lower(split_part(u.email, '@', 1)) = ANY($${n})
             OR lower(a.guest_key) = ANY($${n}))
      )`,
      query.assignees.map((a) => a.toLowerCase()),
    );
  }

  if (query.priorities.length > 0) {
    add((n) => `t.priority = ANY($${n})`, query.priorities);
  }

  if (query.due !== undefined) {
    const bounds = boundsOf(now, zone);
    if (query.due === 'today') {
      add((n) => `t.due_at <= $${n}`, bounds.endOfDay);
    } else if (query.due === 'overdue') {
      add((n) => `t.due_at < $${n}`, bounds.startOfDay);
    } else {
      add(
        (n) => `t.due_at <= $${n}`,
        new Date(bounds.endOfDay.getTime() + 6 * 86_400_000),
      );
    }
  }

  params.push(limit + 1);
  const rows = await queryRows<TaskRow>(
    pool,
    `SELECT ${COLUMNS} FROM tasks t
      WHERE ${where.join(' AND ')}
      ORDER BY t.completed_at IS NOT NULL,
               t.priority ASC,
               COALESCE(t.planned_at, t.due_at) ASC NULLS LAST,
               t.sort_key ASC
      LIMIT $${params.length}`,
    params,
  );

  return {
    query,
    tasks: rows.slice(0, limit),
    // Ehrlich statt „ungefähr 100": eine Zahl, die nicht stimmt, ist
    // schlechter als der Hinweis, dass es mehr gibt.
    more: rows.length > limit,
  };
}
