-- SOTE 0022 — Erinnerungen an einer Aufgabe
-- ── Erinnerungen an einer Aufgabe ────────────────────────────────────────
--
-- Bis hierher gab es genau EINE Sorte Erinnerung: eine Mail am Morgen mit dem
-- Tagesüberblick (`reminders_sent`, ein Brief je Person und Tag). Das ist bei
-- TickTick und Todoist das Kernmerkmal, und SOTE hatte davon die Hälfte.
--
-- Diese Tabelle ist die andere Hälfte: mehrere Erinnerungen JE AUFGABE, jede
-- mit ihrem eigenen Zeitpunkt.
--
-- ## Relativ gespeichert, nicht absolut
--
-- `offset_minutes` zählt VOR dem geplanten Zeitpunkt (0 = pünktlich, 15 = eine
-- Viertelstunde vorher). Ein absoluter Zeitpunkt wäre nach jedem Verschieben
-- der Aufgabe falsch, und ein Programm, das nach dem Verschieben zur alten
-- Zeit klingelt, ist eines, dem man nicht mehr glaubt. Wer eine feste Uhrzeit
-- will, setzt `at` — dann gilt die statt der Rechnung.
--
-- ## Warum eine Quittung an der Zeile
--
-- `sent_at` steht hier und nicht in einer zweiten Tabelle: eine Erinnerung ist
-- entweder noch offen oder verschickt, und das ist eine Eigenschaft von ihr.
-- Zwei Tabellen wären zwei Wahrheiten über denselben Brief (Lehre aus
-- `reminders_sent`, wo die Quittung genau darum in derselben Transaktion
-- steht wie der Mailauftrag).

CREATE TABLE task_reminders (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id  uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  -- An WEN. Eine Aufgabe kann mehrere Zuständige haben, und eine Erinnerung
  -- gehört einer Person: „erinnere mich" ist keine Aussage über die anderen.
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Entweder relativ (Vorlauf in Minuten) oder absolut (`at`). Genau eines.
  offset_minutes  integer,
  at              timestamptz,

  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reminder_is_one_kind CHECK (
    (offset_minutes IS NOT NULL AND at IS NULL)
    OR (offset_minutes IS NULL AND at IS NOT NULL)
  ),
  -- Kein Vorlauf in die Vergangenheit hinter dem Termin: negative Werte wären
  -- „danach", und dafür gibt es die Frist.
  CONSTRAINT reminder_offset_not_negative CHECK (offset_minutes IS NULL OR offset_minutes >= 0),

  /*
   * Zweimal dieselbe Erinnerung an dieselbe Person ist ein Doppelbrief.
   *
   * `NULLS NOT DISTINCT` ist hier das Entscheidende, und ich hatte es
   * vergessen: eine relative Erinnerung hat `at IS NULL`, und Postgres hält
   * NULL-Werte in einem UNIQUE für VERSCHIEDEN. Ohne diesen Zusatz greift die
   * Sperre also genau dort nicht, wo sie gebraucht wird — bei den relativen,
   * also bei fast allen. Der Test „zweimal dieselbe ist keine zweite" hat es
   * gefunden.
   */
  CONSTRAINT reminder_not_twice UNIQUE NULLS NOT DISTINCT (task_id, user_id, offset_minutes, at)
);

-- Der Bearbeiter fragt „was ist fällig und noch nicht verschickt".
CREATE INDEX task_reminders_due ON task_reminders (task_id) WHERE sent_at IS NULL;

-- Und die Türklingel: eine neue oder weggenommene Erinnerung ändert die
-- Aufgabe für alle, die sie offen haben.
--
-- Eigene Funktion, weil `notify_tasks_ins` aus `new_rows` die
-- `workspace_id` liest — die steht hier nicht, sie hängt an der Aufgabe. Also
-- über den Verweis nachgeschlagen. (Mein erster Anlauf rief eine Funktion
-- `nudge_from_tasks` auf, die es nicht gibt: geraten statt in 0020
-- nachgesehen.)
CREATE OR REPLACE FUNCTION notify_task_reminders() RETURNS trigger AS $$
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

CREATE TRIGGER task_reminders_ins AFTER INSERT ON task_reminders
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_reminders();

CREATE TRIGGER task_reminders_del AFTER DELETE ON task_reminders
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_reminders();

/*
 * Bewusst KEIN Trigger auf UPDATE.
 *
 * Das einzige Update ist die Quittung `sent_at` durch den Bearbeiter, und die
 * ändert nichts, was jemand auf dem Bildschirm sieht. Ein Klingeln dafür wäre
 * ein Klingeln je verschickter Mail — dieselbe Spaltenliste-als-Design wie in
 * 0020, wo `last_used_at` und `updated_at` auch nicht klingeln.
 */
