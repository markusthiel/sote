-- SOTE 0009 — Ordner ordnen, Projekte halten.
--
-- Konzept 10d. Bis hier war ein Projekt zwei Dinge gleichzeitig: ein Behälter
-- (es hatte Unterprojekte) und eine Liste (es hielt Aufgaben). Die Vermischung
-- kostete an mehreren Stellen — das Zeilenmenü bot „Unterprojekt anlegen" UND
-- die Zeile war Ziel für Aufgaben, die Projektansicht musste `parent_id IS
-- NULL` filtern, und `#name` konnte auf einen reinen Behälter zeigen.
--
-- Jetzt: **Ordner ordnen, Projekte halten.** Dieselbe Trennung wie in SONE,
-- deren Kommentar an `pages.kind` sie in fünf Wörtern sagt: „Folders organise,
-- pages hold writing."
--
-- EINE TABELLE, wie dort. Eine Spalte `kind` und keine zweite Tabelle: ein
-- Baum, ein Sortierschlüsselraum, ein Papierkorb. Zwei Tabellen wären zwei
-- Sortierungen, die man beim Verschieben aufeinander abbilden müsste.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'list';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_kind_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_kind_check CHECK (kind IN ('folder', 'list'));
  END IF;
END $$;

COMMENT ON COLUMN projects.kind IS
  'Was diese Zeile ist. Ordner ordnen und verschachteln, Projekte halten '
  'Aufgaben und verschachteln nicht.';

-- ── Die Migration selbst ───────────────────────────────────────────────────
--
-- Alle vier Fälle haben dieselbe Form: aus einem Projekt wird ein ORDNER mit
-- dem Namen, und die Aufgaben ziehen in ein gleichnamiges PROJEKT darin. Nur
-- wo es keine Aufgaben gibt, entfällt das Projekt.
--
-- Das liest sich einen Moment lang doppelt („Haus ▸ Haus"), und die Alternative
-- ist schlechter: ein Sammelordner, in den alles wandert, erfindet eine
-- Ordnung, die niemand gewählt hat. Ein Ordner, der genau eine Sache enthält
-- und so heißt wie sie, behauptet nichts.

-- Schritt 1: alles Bestehende wird zum Ordner.
--
-- Zuerst und für alle, weil der zweite Schritt Kinder anlegt und die keine
-- Ordner sein sollen. Ein UPDATE ohne WHERE trifft hier genau das Richtige:
-- die Spalte ist neu, also gibt es noch keine Zeile, die schon 'folder' wäre.
UPDATE projects SET kind = 'folder';

-- Schritt 2: wo Aufgaben hängen, entsteht darunter ein Projekt gleichen Namens.
--
-- `sort_key` bekommt den kleinsten möglichen Wert seines Geschwisterkreises
-- ('a0' ist der Anfang der Fractional-Index-Reihe), weil das neue Projekt das
-- erste Kind ist — vorhandene Unterordner sollen darunter bleiben und nicht
-- davor rutschen. Farbe und Zeichen wandern MIT, damit die Zeile, in der die
-- Aufgaben liegen, aussieht wie die, in der sie vorher lagen.
WITH mit_aufgaben AS (
  SELECT DISTINCT p.id, p.workspace_id, p.name, p.color, p.icon
    FROM projects p
    JOIN tasks t ON t.project_id = p.id
)
INSERT INTO projects (workspace_id, parent_id, name, color, icon, kind, sort_key)
SELECT workspace_id, id, name, color, icon, 'list', 'a0'
  FROM mit_aufgaben;

-- Schritt 3: die Aufgaben ziehen um.
--
-- Über (parent_id, kind) und nicht über den Namen: zwei Ordner können
-- gleichnamige Kinder haben, und ein Umzug, der sich am Namen orientiert,
-- trifft dann den falschen.
UPDATE tasks t
   SET project_id = neu.id
  FROM projects neu
 WHERE neu.kind = 'list'
   AND neu.parent_id = t.project_id;

-- ── Was ab jetzt gilt ──────────────────────────────────────────────────────
--
-- Drei Regeln, und alle drei als CHECK bzw. Index, nicht als Vorsatz im Code.
-- Eine Regel, die nur im Anwendungscode steht, ist eine Regel, die der
-- nächste Schreibweg nicht kennt.

-- Ein Projekt liegt IMMER in einem Ordner. Ganz oben nur Ordner.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_list_needs_parent'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_list_needs_parent
      CHECK (kind = 'folder' OR parent_id IS NOT NULL);
  END IF;
END $$;

-- Und ein Projekt hat keine Kinder. Das lässt sich nicht als CHECK sagen — ein
-- CHECK sieht nur seine eigene Zeile —, also ein Trigger. Er ist billig: er
-- läuft nur beim Anlegen und Umhängen, und er liest genau eine Zeile.
CREATE OR REPLACE FUNCTION projects_parent_is_folder() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL
     AND (SELECT kind FROM projects WHERE id = NEW.parent_id) <> 'folder' THEN
    RAISE EXCEPTION 'ein Projekt hält Aufgaben und keine Unterpunkte'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_parent_is_folder_trg ON projects;
CREATE TRIGGER projects_parent_is_folder_trg
  BEFORE INSERT OR UPDATE OF parent_id ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_parent_is_folder();

-- Aufgaben hängen nur an Projekten, nie an Ordnern. Auch das ein Trigger, aus
-- demselben Grund.
CREATE OR REPLACE FUNCTION tasks_project_is_list() RETURNS trigger AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND (SELECT kind FROM projects WHERE id = NEW.project_id) <> 'list' THEN
    RAISE EXCEPTION 'ein Ordner hält keine Aufgaben'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_project_is_list_trg ON tasks;
CREATE TRIGGER tasks_project_is_list_trg
  BEFORE INSERT OR UPDATE OF project_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_project_is_list();

-- ── Liegt etwas über dieser Zeile im Papierkorb? ───────────────────────────
--
-- Eine Funktion und keine Bedingung im Abfragetext, und dafür gibt es einen
-- handfesten Grund: **eine rekursive CTE in einer korrelierten Unterabfrage
-- sieht die äußere Zeile nicht.** Der erste Versuch stand als `NOT EXISTS (WITH
-- RECURSIVE … WHERE p.id = tasks.project_id …)` in `views.ts`, lief ohne Fehler
-- und lieferte nie eine Zeile — also war jede Aufgabe „lebendig", auch unter
-- einem weggeworfenen Ordner. Gefunden, weil neun Aufgaben sichtbar blieben,
-- nachdem der oberste Ordner im Korb lag.
--
-- STABLE, damit der Planer sie je Zeile einmal auswertet und nicht je Bedingung.
CREATE OR REPLACE FUNCTION project_in_trash(start uuid) RETURNS boolean AS $$
  WITH RECURSIVE pfad AS (
    SELECT p.id, p.parent_id, p.trashed_at
      FROM projects p WHERE p.id = start
    UNION ALL
    SELECT e.id, e.parent_id, e.trashed_at
      FROM projects e JOIN pfad ON e.id = pfad.parent_id
  )
  SELECT EXISTS (SELECT 1 FROM pfad WHERE trashed_at IS NOT NULL);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION project_in_trash(uuid) IS
  'Ob dieses Projekt oder irgendein Ordner darüber im Papierkorb liegt. '
  'Eine Aufgabe darunter taucht in keiner Ansicht auf (Konzept 8a, 10d).';

-- Der Baum wird jetzt oft nach Art gefiltert gelesen — „welche Projekte gibt
-- es hier" —, also gehört `kind` in den Index, den es dafür schon gibt.
DROP INDEX IF EXISTS projects_by_parent;
CREATE INDEX projects_by_parent ON projects (workspace_id, parent_id, kind, sort_key);
