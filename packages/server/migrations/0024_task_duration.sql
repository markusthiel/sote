-- SOTE 0024 — wie lange das etwa dauert.
--
-- Eine SCHÄTZUNG in Minuten, und nur eine Spalte. Zeiterfassung wäre etwas
-- anderes: Start, Stopp, eine Historie und eine Antwort auf „ich habe es
-- vergessen" — drei Tabellen und drei Fragen, die diese Zahl nicht stellt.
--
-- MINUTEN UND KEINE EINHEITENSPALTE. „2 Stunden" und „120 Minuten" sind
-- dieselbe Aufgabe; zwei Spalten wären zwei Schreibweisen für eine Angabe, und
-- jede Summe müsste sie erst wieder zusammenrechnen. Die Einheit gehört ins
-- Lesen und Schreiben (`core/task/duration.ts`), nicht in die Daten.
--
-- `integer` und nicht `smallint`: eine Woche sind 10 080 Minuten, das passt
-- zwar noch, aber die Grenze liegt bei 32 767 — also drei Wochen. Eine Spalte,
-- deren Typ eine Fachregel mit trägt, hält sie am falschen Ort: ändert sich die
-- Grenze, ändert sich die Tabelle.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS duration_min integer;

-- Die Grenzen als CHECK und nicht als Prüfung im Code.
--
-- Beide Seiten haben einen Grund:
--
-- * NULL ist „keine Angabe", 0 wäre eine zweite Schreibweise dafür — und die
--   Summe im Kopf einer Liste müsste dann beide kennen. Negativ ist gar nichts.
-- * Eine Woche ist die Grenze, an der die Angabe die Sorte wechselt: was
--   länger dauert, ist kein Vorgang mit einer Schätzung, sondern ein Projekt
--   mit Teilaufgaben, und beides gibt es hier schon.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_duration_sane'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_duration_sane CHECK (
      duration_min IS NULL OR (duration_min > 0 AND duration_min <= 10080)
    );
  END IF;
END $$;

COMMENT ON COLUMN tasks.duration_min IS
  'Geschätzte Dauer in Minuten, NULL heißt keine Angabe. Eine Schätzung und '
  'keine Messung — Zeiterfassung ist etwas anderes und gibt es nicht.';
