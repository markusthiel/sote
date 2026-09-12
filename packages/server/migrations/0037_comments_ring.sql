-- SOTE 0037 — ein Kommentar klingelt.
--
-- Gewünscht: „Die Kommentare kommen noch nicht live rein bei anderen, die es
-- gerade offen haben. Geht das? Dann wäre es schon fast ein Chat."
--
-- Ja, und es ist derselbe Weg wie bei den Aufgaben: ein Trigger ruft
-- `notify_workspace`, der Strom trägt es zu jeder offenen Seite, die Ansicht
-- lädt neu.
--
-- ## Ein EIGENER Scope und nicht `tasks`
--
-- Ein Kommentar könnte sich als Aufgaben-Anstoß tarnen; dann würde aber jede
-- Liste neu laden, obwohl in keiner Liste ein Kommentar steht. Bei zwei Leuten,
-- die sich unterhalten, wäre das ein vollständiger Listenabruf je Satz — für
-- eine Zeile, die nur in EINER offenen Detailspalte sichtbar ist.
--
-- Also `comments`. Wer es braucht, hört darauf; alle anderen bemerken es nicht.
--
-- ## Der Arbeitsbereich steht nicht am Kommentar
--
-- `task_comments` hat nur `task_id`. Der Trigger holt ihn über die Aufgabe —
-- eine Abfrage je Anweisung, nicht je Zeile, weil er `FOR EACH STATEMENT` mit
-- Übergangstabellen arbeitet wie die anderen.
--
-- ## Löschen klingelt auch
--
-- Ein zurückgenommener Kommentar verschwindet bei allen, nicht nur bei dem, der
-- ihn zurückgenommen hat. Sonst stünde er bei den anderen weiter da, und beim
-- nächsten Laden verschwände er ohne Zutun — das liest sich wie ein Fehler.

CREATE OR REPLACE FUNCTION notify_comments() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT t.workspace_id
      FROM changed c JOIN tasks t ON t.id = c.task_id
  LOOP
    PERFORM notify_workspace(ws, 'comments');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_comments_ins ON task_comments;
CREATE TRIGGER notify_comments_ins
  AFTER INSERT ON task_comments
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_comments();

DROP TRIGGER IF EXISTS notify_comments_del ON task_comments;
CREATE TRIGGER notify_comments_del
  AFTER DELETE ON task_comments
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_comments();

COMMENT ON FUNCTION notify_comments IS
  'Klingelt mit dem Scope "comments", wenn ein Kommentar kommt oder geht. '
  'Ein eigener Scope, damit nicht jede Liste neu laedt, wenn zwei Leute sich '
  'unterhalten.';
