-- SOTE 0023 — Anhänge an einer Aufgabe.
--
-- Bis hierher gab es Bilder nur als Profilbild (0021), und das liegt als
-- `bytea` in Postgres — vertretbar bei 256 KB und einem je Konto. Anhänge sind
-- etwas anderes: beliebig viele, beliebig groß, und man will sie nicht in
-- jedem Datenbank-Abzug mitschleppen.
--
-- ## Die Bytes liegen nicht hier
--
-- Wie in SONEs `files`: die Zeile beschreibt den Anhang, `storage_key` sagt,
-- wo er liegt. SOTE speichert unter `SOTE_FILES_DIR` im Dateisystem. Das hat
-- eine Folge, die man wissen muss: **ein Datenbank-Abzug allein reicht nicht
-- zum Wiederherstellen.** Dafür bleibt die Datenbank klein und ein Anhang
-- lässt sich ausliefern, ohne ihn durch Postgres zu ziehen.
--
-- ## Autorisiert über die Aufgabe
--
-- Kein eigenes Recht: wer die Aufgabe sehen darf, darf ihre Anhänge sehen. Ein
-- zweites Rechtesystem für Dateien wäre eines, das mit dem ersten uneins
-- werden kann.

CREATE TABLE task_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  -- Der Arbeitsbereich steht mit dran, obwohl er über die Aufgabe zu finden
  -- wäre: die Abfrage „wie viel liegt in diesem Arbeitsbereich" ist eine, die
  -- die Verwaltung stellt, und sie soll nicht über die Aufgaben gehen müssen.
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  filename     text   NOT NULL CHECK (length(filename) BETWEEN 1 AND 260),
  mime_type    text   NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),

  -- Wo die Bytes liegen. `local` ist der Anfang; ein zweiter Wert (`s3`) ist
  -- später möglich, ohne die Zeilen anzufassen.
  storage      text   NOT NULL DEFAULT 'local',
  storage_key  text   NOT NULL UNIQUE,

  -- `SET NULL` und nicht `CASCADE`: ein gelöschtes Konto nimmt nicht die
  -- Anhänge mit, die es an gemeinsame Aufgaben gehängt hat. Wer sie hochgeladen
  -- hat, ist dann unbekannt — die Datei bleibt.
  uploaded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_files_of_task ON task_files (task_id, created_at);

-- Und die Türklingel: ein neuer Anhang ändert die Aufgabe für alle, die sie
-- offen haben. Eigene Funktion, weil die `workspace_id` hier direkt an der
-- Zeile steht (siehe 0022, wo sie über die Aufgabe nachgeschlagen werden muss).
CREATE OR REPLACE FUNCTION notify_task_files() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM changed LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_files_ins AFTER INSERT ON task_files
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_files();

CREATE TRIGGER task_files_del AFTER DELETE ON task_files
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_task_files();
