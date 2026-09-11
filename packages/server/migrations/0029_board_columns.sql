-- SOTE 0029 — Spalten für die Tafel.
--
-- Abgesprochen, in drei Punkten:
--
-- 1. Eigene Tabelle, frei benennbare Spalten. „Ich würde auch die Tabelle
--    nehmen." Die Alternative wären Spalten aus etwas, das es schon gibt
--    (Schlagwörter, Priorität) — das kostet keine Tabelle und kann genau das
--    nicht, worum es ging: eigene Namen.
-- 2. Die ERSTE Spalte ist das Auffangbecken. „Ich denke, eine erste Spalte zum
--    Auffangbecken machen geht. Die kann man dann ja umbenennen." Darum steht
--    hier NICHTS davon: keine Spalte trägt eine Eigenschaft „Auffangbecken",
--    und Aufgaben ohne Zuordnung behalten `column_id IS NULL`. Wer die erste
--    Spalte umbenennt, verschiebt keine Aufgabe; wer sie löscht, macht die
--    zweite zur ersten. Eine gespeicherte Markierung müsste bei jedem
--    Umsortieren nachgezogen werden — und wäre irgendwann an der zweiten.
-- 3. Eine Spalte KANN „fertig" bedeuten. „Kann man einfach eine Spalte anlegen
--    und ihr die Eigenschaft geben, dass es eine Spalte für Fertig ist. Und
--    sobald man diese Spalte angelegt hat, wandern fertige Elemente
--    automatisch da rein? Wenn man diese Spalte nicht angelegt hat, dann
--    bleiben die Aufgaben als abgehakt in der jeweiligen Spalte liegen."
--
-- ## Das Häkchen bleibt die Wahrheit
--
-- Die Spalte FOLGT ihm und ersetzt es nicht. `completed_at` sagt weiterhin, ob
-- etwas fertig ist — sonst gäbe es zwei Antworten auf dieselbe Frage, und eine
-- abgehakte Aufgabe in „In Arbeit" wäre ein Widerspruch, den jemand auflösen
-- muss. So ist sie nur eine Karte, die dort liegt, wo sie lag.

CREATE TABLE IF NOT EXISTS board_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- An der LISTE und nicht am Arbeitsbereich: Spalten sind die Gliederung
  -- eines Vorhabens, und zwei Vorhaben gliedern sich verschieden.
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Dieselbe Bauart wie überall hier: ein Bruchzahl-Schlüssel, gerechnet in
  -- der Oberfläche, weil nur sie die Nachbarn kennt.
  --
  -- `COLLATE "C"` ist zwingend und nicht Zierde: Bruchzahl-Schlüssel werden
  -- LEXIKOGRAPHISCH verglichen, und eine sprachabhängige Sortierung ordnet sie
  -- um — dann stehen Spalten in einer anderen Reihenfolge, als die Oberfläche
  -- gerechnet hat. Der Wächter `check-migrations` hat diese Zeile gefangen,
  -- bevor sie auf einen Server kam.
  sort_key   text COLLATE "C" NOT NULL,
  -- Ob abgehakte Aufgaben hierher wandern.
  is_done    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_columns_order UNIQUE (project_id, sort_key)
);

-- HÖCHSTENS EINE Fertig-Spalte je Liste.
--
-- Als teilweiser Index und nicht als Prüfung im Code: zwei Spalten, die beide
-- „fertig" bedeuten, wären zwei Ziele für dasselbe Abhaken — und welches
-- gewinnt, entschiede die Reihenfolge des Lesens.
CREATE UNIQUE INDEX IF NOT EXISTS board_columns_one_done
  ON board_columns (project_id) WHERE is_done;

CREATE INDEX IF NOT EXISTS board_columns_by_project
  ON board_columns (project_id, sort_key);

-- Wo eine Aufgabe auf der Tafel liegt.
--
-- `ON DELETE SET NULL`: wer eine Spalte wegräumt, verliert keine Aufgabe. Sie
-- fällt zurück ins Auffangbecken, also in die erste Spalte — und das ist
-- dasselbe, was mit einer neu erfassten Aufgabe geschieht. Ein `CASCADE` hier
-- wäre die Antwort „Spalte weg, Arbeit weg", und die will niemand.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS column_id uuid REFERENCES board_columns (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_by_column ON tasks (column_id) WHERE column_id IS NOT NULL;

COMMENT ON COLUMN tasks.column_id IS
  'Spalte auf der Tafel, NULL heißt Auffangbecken (die erste Spalte). Die '
  'Zugehörigkeit wird nicht gespeichert, sondern beim Zeichnen bestimmt — '
  'darum verschiebt Umbenennen oder Umsortieren der Spalten keine Aufgabe.';

COMMENT ON COLUMN board_columns.is_done IS
  'Abgehakte Aufgaben wandern hierher. Gibt es keine solche Spalte, bleiben '
  'sie abgehakt liegen, wo sie sind. Das Haekchen bleibt die Wahrheit; die '
  'Spalte folgt ihm.';
