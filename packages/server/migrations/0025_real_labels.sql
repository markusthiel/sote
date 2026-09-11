-- SOTE 0025 — Schlagwörter, die es wirklich gibt.
--
-- Die Tabellen stehen seit 0001, der Schnellerfasser schreibt sie seit damals,
-- und die Suche filtert darauf. Was fehlte, war beides: eine Regel, welche
-- Namen dasselbe meinen, und ein Weg, die Schlagwörter einer Aufgabe zu LESEN.
--
-- ## Erstens: gleich ist gleich, ohne Rücksicht auf Groß und Klein
--
-- `UNIQUE (workspace_id, name)` aus 0001 vergleicht Zeichen für Zeichen. Die
-- Suche vergleicht seit immer `lower(l.name)`. Zwei Vergleiche für eine Frage,
-- und das Ergebnis war absehbar: wer `@Haus` tippte, bekam ein zweites
-- Schlagwort neben `@haus`, und in einer Liste sahen die beiden gleich aus.
-- Beim Suchen fand `@haus` dann Aufgaben aus beiden — also war schon vorher
-- klar, welcher der beiden Vergleiche der gemeinte ist.
--
-- ## Zweitens: eine Funktion statt einer Unterabfrage im Abfragetext
--
-- Eine Aufgabe wird an vier Stellen gelesen (`tasks.ts`, `views.ts`,
-- `detail.ts`, `search.ts`), und jede zählt ihre Spalten selbst auf. Ein
-- `array_agg`-Unterausdruck müsste viermal dort stehen — dieselbe Überlegung,
-- die in 0009 zu `project_in_trash()` geführt hat, und dort stand sie schon:
-- eine Regel, die im Abfragetext lebt, lebt an so vielen Orten, wie es
-- Abfragen gibt.

-- ── Die Verschmelzung: vor dem Index, sonst schlägt er fehl ────────────────
--
-- Reihenfolge und Auswahl sind beides Entscheidungen:
--
-- * Es GEWINNT DIE ÄLTESTE Schreibweise (`ctid` als Näherung an „zuerst
--   angelegt" — die Tabelle hat kein `created_at`, und eines nachträglich zu
--   erfinden wäre eine Spalte mit erfundenen Werten). Die erste ist die, die
--   jemand bewusst getippt hat; jede spätere war ein Nebenprodukt.
-- * Die Zuordnungen wandern MIT, mit `ON CONFLICT DO NOTHING`: eine Aufgabe,
--   die sowohl `@Haus` als `@haus` trug, hat danach eines.
WITH kanon AS (
  SELECT DISTINCT ON (workspace_id, lower(name))
         id, workspace_id, lower(name) AS key
    FROM labels
   ORDER BY workspace_id, lower(name), ctid
),
doppelt AS (
  SELECT l.id AS alt, k.id AS neu
    FROM labels l
    JOIN kanon k
      ON k.workspace_id = l.workspace_id AND k.key = lower(l.name)
   WHERE l.id <> k.id
)
INSERT INTO task_labels (task_id, label_id)
SELECT tl.task_id, d.neu
  FROM task_labels tl JOIN doppelt d ON d.alt = tl.label_id
ON CONFLICT DO NOTHING;

-- Und die überzähligen weg. Ihre Zuordnungen nimmt der Fremdschlüssel mit
-- (ON DELETE CASCADE aus 0001) — sie stehen nach dem Schritt oben schon am
-- kanonischen Schlagwort.
WITH kanon AS (
  SELECT DISTINCT ON (workspace_id, lower(name))
         id, workspace_id, lower(name) AS key
    FROM labels
   ORDER BY workspace_id, lower(name), ctid
)
DELETE FROM labels l
 USING kanon k
 WHERE k.workspace_id = l.workspace_id
   AND k.key = lower(l.name)
   AND l.id <> k.id;

-- ── Der Index, der es von jetzt an hält ───────────────────────────────────
--
-- Als eindeutiger Index über `lower(name)` und nicht als CHECK: ein CHECK sieht
-- nur seine eigene Zeile und kann nicht wissen, dass es die andere Schreibweise
-- schon gibt. Der alte `UNIQUE (workspace_id, name)` bleibt stehen — er ist
-- jetzt die schwächere von zwei Bedingungen und stört nicht.
CREATE UNIQUE INDEX IF NOT EXISTS labels_by_name_ci
  ON labels (workspace_id, lower(name));

-- ── Die Schlagwörter einer Aufgabe ────────────────────────────────────────
--
-- Sortiert nach `lower(name)`, damit die Reihenfolge in der Zeile nicht davon
-- abhängt, welches zuerst angehängt wurde: eine Zeile, deren Etiketten
-- springen, sieht bei jedem Laden anders aus.
--
-- `'{}'` und nicht NULL, wenn keines dran ist: NULL wäre eine zweite
-- Schreibweise für „keine", und jede Stelle in der Oberfläche müsste beide
-- kennen. `array_agg` gibt über einer leeren Menge NULL, daher das COALESCE.
--
-- STABLE, damit der Planer sie je Zeile einmal auswertet.
CREATE OR REPLACE FUNCTION labels_of(task uuid) RETURNS text[] AS $$
  SELECT COALESCE(array_agg(l.name ORDER BY lower(l.name)), '{}')
    FROM task_labels tl JOIN labels l ON l.id = tl.label_id
   WHERE tl.task_id = task;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION labels_of(uuid) IS
  'Die Schlagwörter dieser Aufgabe, nach Namen sortiert, leeres Array wenn '
  'keine. Als Funktion, damit die vier Spaltenlisten im Server sie nennen '
  'können, ohne die Abfrage viermal zu enthalten (wie project_in_trash, 0009).';

-- Gelesen wird künftig je Aufgabe; der Index dafür fehlte.
CREATE INDEX IF NOT EXISTS task_labels_by_task ON task_labels (task_id);
