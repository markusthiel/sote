-- SOTE 0032 — die Klingel kennt die neuen Spalten.
--
-- Gemeldet: „Wenn ich es als Titelbild setze, dann sollte es live updaten. Ich
-- muss erst die Seite reloaden, damit es sichtbar wird."
--
-- ## Die Ursache war eine Spaltenliste, die niemand nachgezogen hat
--
-- `notify_tasks_upd` vergleicht seit Migration 0020 einen ausdrücklichen Satz
-- Spalten. Alles, was seitdem dazugekommen ist, fehlt darin: `duration_min`
-- (0024), `column_id` (0029) und `cover` (0031). Eine Aufgabe ändert ihr
-- Titelbild — und niemand erfährt es. Dasselbe gilt für eine Karte, die in
-- einem anderen Fenster in eine andere Spalte gezogen wird, und für eine
-- Dauer, die jemand schätzt.
--
-- ## Warum die Liste trotzdem bleibt
--
-- Mein erster Griff war, sie durch `n IS DISTINCT FROM o` zu ersetzen — die
-- ganze Zeile vergleichen, nichts mehr nachzuziehen. Ein Test aus Migration
-- 0020 hat das sofort abgelehnt, und sein Kommentar sagt warum:
--
--   „Der Test für die Abwesenheit, und er ist der Grund für die ganze
--    Spaltenliste: die Notiz steht nur in der Detailspalte, und die hat die
--    Aufgabe schon offen. Ein Trigger auf jedes Update verwandelte das Tippen
--    einer Person in volle Listen-Abrufe für alle anderen — ein Push, der
--    schlechter ist als das Polling, das er ersetzt."
--
-- Die Liste ist also kein Versehen, sondern eine Entscheidung: **es klingelt,
-- was andere in ihrer LISTE sehen.** Die Notiz sehen sie dort nicht.
--
-- Also kommt dazu, was in einer Zeile oder auf einer Karte steht: die
-- geschätzte Dauer, die Spalte auf der Tafel, das Titelbild und die
-- Wiederholung. `note` bleibt draussen, und zwar mit demselben Grund wie
-- damals.
--
-- Der neue Test hat beim ersten Lauf noch drei weitere gefunden, die schon
-- 2020 gefehlt haben: `planned_all_day`, `due_all_day` und `recur_dtstart`.
-- „Morgen" und „morgen 9 Uhr" stehen verschieden in der Zeile — das eine als
-- Datum, das andere mit Uhrzeit; wer das umstellt, ändert, was andere lesen.
--
-- Damit die Liste nicht wieder veraltet, prüft `nudge.db.test.ts` sie jetzt
-- gegen die tatsächlichen Spalten der Tabelle: eine neue Spalte lässt den Test
-- fallen, bis jemand entschieden hat, ob sie klingelt oder schweigt.

CREATE OR REPLACE FUNCTION notify_tasks_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.workspace_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.title, n.project_id, n.parent_id, n.planned_at, n.due_at,
            n.priority, n.sort_key, n.completed_at, n.trashed_at,
            n.duration_min, n.column_id, n.cover,
            n.planned_all_day, n.due_all_day,
            n.recur_rrule, n.recur_dtstart, n.recur_after_n, n.recur_after_unit)
        IS DISTINCT FROM
           (o.title, o.project_id, o.parent_id, o.planned_at, o.due_at,
            o.priority, o.sort_key, o.completed_at, o.trashed_at,
            o.duration_min, o.column_id, o.cover,
            o.planned_all_day, o.due_all_day,
            o.recur_rrule, o.recur_dtstart, o.recur_after_n, o.recur_after_unit)
  LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_tasks_upd IS
  'Klingelt bei Aenderungen, die andere in ihrer LISTE sehen. note bleibt '
  'absichtlich draussen: sie steht nur in der Detailspalte, und ein Anstoss '
  'je Tastendruck waere ein Push, der schlechter ist als Polling. Die Liste '
  'wird von nudge.db.test.ts gegen die Tabellenspalten geprueft.';
