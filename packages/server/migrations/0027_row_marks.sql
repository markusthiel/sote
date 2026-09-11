-- SOTE 0027 — was an einer Aufgabe dranhängt, in der Zeile sichtbar.
--
-- Gemeldet: „in der Aufgabenliste würde ich gerne sehen, was die Aufgabe
-- beinhaltet — ob ein Anhang dabei ist, ein Bild, eine Wiederholung."
--
-- Die Wiederholung stand schon dort. Alles andere nicht, und zwar nicht, weil
-- es fehlte, sondern weil es NICHT MITKOMMT: Anhänge, Kommentare,
-- Teilaufgaben, Zuständige und Erinnerungen liegen in eigenen Tabellen, und
-- die vier Lesestellen fragen nur `tasks`. Eine Notiz steht sogar in der
-- Spalte daneben und wurde trotzdem nicht gezeigt.
--
-- ## Ein Array von Wörtern und keine sechs Spalten
--
-- Die Alternative wären sechs `count(*)`-Unterausdrücke in vier Spaltenlisten,
-- also vierundzwanzig Stellen, an denen dasselbe steht. Und beim nächsten
-- Anhängsel wären es dreißig.
--
-- Hier ist es eine Funktion, wie `labels_of` (0025) und `project_in_trash`
-- (0009). Sie gibt WÖRTER zurück und keine Zahlen: die Zeile sagt „da ist ein
-- Anhang", nicht „da sind drei Anhänge" — eine Zahl an einem Zeichen ist eine
-- Auskunft, die man liest und nicht braucht, und sie kostet Platz in einer
-- Zeile, die von Titel und Datum lebt. Wer es genau wissen will, öffnet die
-- Aufgabe.
--
-- ## Warum `image` von `file` getrennt ist
--
-- Weil es der Grund war, aus dem gefragt wurde: „ob ein Anhang dabei ist, ein
-- Bild". Ein Bild an einer Aufgabe ist meistens der Inhalt (der Schaden, der
-- Beleg, der Screenshot) und nicht eine Beilage — und eine Büroklammer sagt
-- das nicht.

CREATE OR REPLACE FUNCTION marks_of(task uuid) RETURNS text[] AS $$
  -- JEDER Zweig steht in Klammern. Ohne sie ist `LIMIT 1` in einem
  -- UNION-Zweig ein Syntaxfehler, und zwar erst beim Ausfuehren -- die
  -- Migration schlaegt dann beim Deployen fehl und nicht beim Schreiben.
  -- (Von den Tests gefunden, bevor es soweit kam.)
  SELECT COALESCE(array_agg(m ORDER BY m), '{}') FROM (
    -- Eine Notiz. `note` steht in der Spalte daneben, aber die Oberfläche
    -- soll nicht an zwei Orten nachsehen müssen, was an einer Aufgabe hängt.
    (SELECT 'note' AS m FROM tasks t
      WHERE t.id = task AND t.note IS NOT NULL AND btrim(t.note) <> '')
    UNION ALL
    -- Bilder getrennt von den übrigen Anhängen.
    (SELECT 'image' FROM task_files f
      WHERE f.task_id = task AND f.mime_type LIKE 'image/%' LIMIT 1)
    UNION ALL
    (SELECT 'file' FROM task_files f
      WHERE f.task_id = task AND f.mime_type NOT LIKE 'image/%' LIMIT 1)
    UNION ALL
    (SELECT 'comment' FROM task_comments c WHERE c.task_id = task LIMIT 1)
    UNION ALL
    -- Teilaufgaben: nur OFFENE und nicht weggeworfene. Ein Zeichen für drei
    -- erledigte Unterpunkte wäre ein Hinweis auf Arbeit, die getan ist.
    (SELECT 'subtask' FROM tasks s
      WHERE s.parent_id = task AND s.completed_at IS NULL AND s.trashed_at IS NULL
      LIMIT 1)
    UNION ALL
    (SELECT 'assignee' FROM task_assignees a WHERE a.task_id = task LIMIT 1)
    UNION ALL
    -- Erinnerungen, die noch bevorstehen. Eine abgeschickte ist Vergangenheit.
    (SELECT 'reminder' FROM task_reminders r
      WHERE r.task_id = task AND r.sent_at IS NULL LIMIT 1)
  ) AS x;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION marks_of(uuid) IS
  'Was an dieser Aufgabe hängt, als sortierte Wörter: note, image, file, '
  'comment, subtask, assignee, reminder. Für die zweite Zeile in der Liste — '
  'Wörter und keine Zahlen, weil die Zeile sagt DASS etwas dran ist.';

-- Gelesen wird künftig je Aufgabe, und für zwei dieser Tabellen gab es dafür
-- keinen Index: ohne sie ist jede Liste ein Durchgang durch alle Kommentare
-- der Instanz.
CREATE INDEX IF NOT EXISTS task_comments_by_task ON task_comments (task_id);
CREATE INDEX IF NOT EXISTS task_assignees_by_task ON task_assignees (task_id);
CREATE INDEX IF NOT EXISTS tasks_by_parent ON tasks (parent_id) WHERE parent_id IS NOT NULL;
