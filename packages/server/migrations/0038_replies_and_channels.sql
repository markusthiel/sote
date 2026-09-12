-- SOTE 0038 — Antworten, Erwähnungen und wohin eine Meldung geht.
--
-- Gewünscht: „Bei SONE haben wir auch Antworten in Kommentaren,
-- Namensnennungen und Zuweisungen bei den Benachrichtigungen. Können wir das
-- hier auch einbauen und konfigurierbar machen, was per E-Mail benachrichtigt
-- wird, über die Oberfläche oder per App?"
--
-- ## Antworten: EINE Ebene, wie bei den Teilaufgaben
--
-- `parent_id` zeigt auf einen Kommentar derselben Aufgabe. Mehr Tiefe ist
-- nicht vorgesehen, und aus demselben Grund wie dort: ein Gespräch, das sich
-- verzweigt, liest niemand mehr von oben nach unten. Wer auf eine Antwort
-- antwortet, antwortet auf deren Ursprung — das ist die Regel, die der Server
-- durchsetzt, und sie ist die einzige, die ohne Einrückungstiefe auskommt.
--
-- ## Wohin: eine Zeile je Person UND Art
--
-- Nicht ein Feld „Benachrichtigungen: an/aus". Wer zugewiesen wird, will das
-- vielleicht per Mail; wer in einem Kommentar genannt wird, vielleicht nur auf
-- dem Telefon. Eine Tabelle mit (Person, Art) und zwei Schaltern bildet das ab,
-- ohne dass eine neue Art die Spalten ändert.
--
-- ## KEINE Zeile heisst „Vorgabe"
--
-- Die Tabelle ist leer, bis jemand etwas einstellt. Was dann gilt, steht im
-- Kern (`channelDefaults`) und nicht als Vorgabewert in der Spalte: eine
-- Vorgabe in der Datenbank müsste beim Anlegen jedes Kontos für jede Art eine
-- Zeile schreiben — und bei jeder neuen Art eine Wanderung über alle Konten.
--
-- Die Oberfläche im Posteingang bleibt IMMER an. Sie ist kein Kanal, sondern
-- der Ort, an dem eine Meldung ohnehin steht; sie abschaltbar zu machen hiesse,
-- Meldungen zu erzeugen, die niemand je sieht.

ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES task_comments (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS task_comments_parent ON task_comments (parent_id);

COMMENT ON COLUMN task_comments.parent_id IS
  'Die Antwort haengt am Ursprung. EINE Ebene: wer auf eine Antwort '
  'antwortet, antwortet auf deren Ursprung -- ein Gespraech, das sich '
  'verzweigt, liest niemand mehr von oben nach unten.';

CREATE TABLE IF NOT EXISTS notification_channels (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'assigned' | 'commented' | 'mentioned' | 'replied' | 'reminder'
  kind    text NOT NULL,
  email   boolean NOT NULL,
  push    boolean NOT NULL,
  PRIMARY KEY (user_id, kind)
);

COMMENT ON TABLE notification_channels IS
  'Wohin eine Meldung geht, je Person und Art. KEINE Zeile heisst Vorgabe -- '
  'die steht im Kern (channelDefaults), damit eine neue Art nicht eine '
  'Wanderung ueber alle Konten braucht. Die Oberflaeche im Posteingang ist '
  'kein Kanal: dort steht eine Meldung ohnehin.';
