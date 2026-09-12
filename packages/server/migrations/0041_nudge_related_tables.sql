-- SOTE 0041 — die Klingel kennt auch die Tabellen NEBEN den Aufgaben.
--
-- Gemeldet: „Wenn ich das Schlagwort einer Aufgabe hinzufüge, färbt sich die
-- Aufgabe erst nach Reload. Das hatten wir mehrfach."
--
-- Stimmt, und zwar in einer anderen Form als die drei Male davor. 0032 und
-- 0035 haben die Spaltenliste von `tasks` vervollständigt, und der Test aus
-- 0032 hält sie seither vollständig. Aber ein Schlagwort AN einer Aufgabe ist
-- keine Spalte von `tasks` — es ist eine Zeile in `task_labels`, und die
-- Tabelle hatte keinen Trigger. Ebenso `task_assignees` (die Köpfe an der
-- Zeile), `labels` selbst (Name und Farbe, die jede Zeile mit diesem
-- Schlagwort zeigt), `board_columns` (die Tafel) und `workspaces` (Name und
-- Zeichen im Kopf der Leiste).
--
-- Die Regel, die der Test aus 0032 für Spalten festhält, gilt für Tabellen
-- genauso: ALLES, was jemand in einer Liste sieht, klingelt, wenn es sich
-- ändert. Der Scope ist `tasks`, wo Zeilen anders aussehen, und `projects`,
-- wo die Leiste anders aussieht — dieselben zwei Klingeln wie bisher, keine
-- neuen. Ein Hörer, der auf `tasks` hört, muss nicht wissen, ob die Farbe aus
-- `labels` oder aus `tasks.look` kam.
--
-- Statement-Trigger mit Übergangstabellen, wie in 0020: ein Statement, das
-- zwanzig Zeilen trifft, klingelt einmal je Arbeitsbereich.

-- Schlagwörter an Aufgaben: der Arbeitsbereich steht an der Aufgabe.
CREATE OR REPLACE FUNCTION notify_task_links() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT t.workspace_id
      FROM tasks t
     WHERE t.id IN (SELECT task_id FROM changed)
  LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION notify_task_links IS
  'Fuer Tabellen, die an einer Aufgabe haengen (task_labels, task_assignees): '
  'der Arbeitsbereich steht an der Aufgabe, der Scope ist tasks.';

DROP TRIGGER IF EXISTS notify_task_labels_ins ON task_labels;
CREATE TRIGGER notify_task_labels_ins AFTER INSERT ON task_labels
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_links();
DROP TRIGGER IF EXISTS notify_task_labels_del ON task_labels;
CREATE TRIGGER notify_task_labels_del AFTER DELETE ON task_labels
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_links();

DROP TRIGGER IF EXISTS notify_task_assignees_ins ON task_assignees;
CREATE TRIGGER notify_task_assignees_ins AFTER INSERT ON task_assignees
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_links();
DROP TRIGGER IF EXISTS notify_task_assignees_del ON task_assignees;
CREATE TRIGGER notify_task_assignees_del AFTER DELETE ON task_assignees
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_links();

-- Die Schlagwörter selbst: Name und Farbe stehen an jeder Zeile, die eines trägt.
CREATE OR REPLACE FUNCTION notify_labels() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM changed LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_labels_ins ON labels;
CREATE TRIGGER notify_labels_ins AFTER INSERT ON labels
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_labels();
DROP TRIGGER IF EXISTS notify_labels_upd ON labels;
CREATE TRIGGER notify_labels_upd AFTER UPDATE ON labels
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_labels();
DROP TRIGGER IF EXISTS notify_labels_del ON labels;
CREATE TRIGGER notify_labels_del AFTER DELETE ON labels
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_labels();

-- Die Spalten der Tafel: der Arbeitsbereich steht am Projekt.
CREATE OR REPLACE FUNCTION notify_board_columns() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT p.workspace_id
      FROM projects p
     WHERE p.id IN (SELECT project_id FROM changed)
  LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_board_columns_ins ON board_columns;
CREATE TRIGGER notify_board_columns_ins AFTER INSERT ON board_columns
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_board_columns();
DROP TRIGGER IF EXISTS notify_board_columns_upd ON board_columns;
CREATE TRIGGER notify_board_columns_upd AFTER UPDATE ON board_columns
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_board_columns();
DROP TRIGGER IF EXISTS notify_board_columns_del ON board_columns;
CREATE TRIGGER notify_board_columns_del AFTER DELETE ON board_columns
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_board_columns();

-- Der Arbeitsbereich selbst: Name und Zeichen stehen im Kopf der Leiste.
-- Scope `projects`, denn das ist die Klingel für „die Leiste sieht anders aus".
CREATE OR REPLACE FUNCTION notify_workspaces_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.name, n.icon) IS DISTINCT FROM (o.name, o.icon)
  LOOP
    PERFORM notify_workspace(ws, 'projects');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_workspaces_upd_trg ON workspaces;
CREATE TRIGGER notify_workspaces_upd_trg AFTER UPDATE ON workspaces
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_workspaces_upd();
