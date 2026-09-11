-- SOTE 0035 — die Klingel kennt das Aussehen.
--
-- `tasks.look` ist neu (0034), und der Test aus 0032 hat sofort danach
-- gefragt: „Diese Spalten sieht der Trigger nicht: look."
--
-- Genau dafür steht er da. Vorher sind drei Spalten nacheinander durchgerutscht
-- (`duration_min`, `column_id`, `cover`), und niemand hat es gemerkt, bis ein
-- Titelbild nicht ankam.
--
-- Die Antwort ist KLINGELN: das Aussehen einer Aufgabe sieht man in der Liste
-- — ein Zeichen vor dem Titel, eine Farbe an der Schrift. Wer es setzt, ändert
-- etwas, das alle anderen sehen.

CREATE OR REPLACE FUNCTION notify_tasks_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.workspace_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.title, n.project_id, n.parent_id, n.planned_at, n.due_at,
            n.priority, n.sort_key, n.completed_at, n.trashed_at,
            n.duration_min, n.column_id, n.cover, n.look,
            n.planned_all_day, n.due_all_day,
            n.recur_rrule, n.recur_dtstart, n.recur_after_n, n.recur_after_unit)
        IS DISTINCT FROM
           (o.title, o.project_id, o.parent_id, o.planned_at, o.due_at,
            o.priority, o.sort_key, o.completed_at, o.trashed_at,
            o.duration_min, o.column_id, o.cover, o.look,
            o.planned_all_day, o.due_all_day,
            o.recur_rrule, o.recur_dtstart, o.recur_after_n, o.recur_after_unit)
  LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
