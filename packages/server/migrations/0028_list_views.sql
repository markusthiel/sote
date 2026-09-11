-- SOTE 0028 — wie dicht eine Liste gezeichnet wird.
--
-- Gewünscht: „pro Aufgabenliste einstellen, ob nur die Aufgabe oder die Aufgabe
-- + zweite Zeile angezeigt wird" — und auf Nachfrage: „Pro Liste und Name wäre
-- mir lieber, jeder sollte die Liste so anzeigen können wie er möchte."
--
-- ## Darum (Person × Ort) und nicht (Ort)
--
-- Die Wahl gehört der Person UND der Liste zusammen. Läge sie an der Liste
-- allein, würde einer auf „schmal" stellen und alle anderen sähen es — dieselbe
-- Vermischung, gegen die ADR-0028 schon einmal argumentiert hat: *mein
-- Dunkelmodus geht dich nichts an, auch während wir dieselbe Seite bearbeiten.*
--
-- Die VORGABE des Arbeitsbereichs liegt nicht hier, sondern in `settings`
-- (scope 'workspace'), wo alle anderen Vorgaben stehen. Eine zweite Tabelle
-- dafür wäre ein zweiter Ort für dieselbe Sorte Angabe.
--
-- ## Warum zwei Spalten für den Ort
--
-- Eine Liste hat eine Id, Heute nicht. Beides in EINE Textspalte zu legen
-- („entweder eine uuid oder das Wort today") wäre bequem und kostet den
-- Fremdschlüssel: eine gelöschte Liste ließe ihre Einstellung als Waise
-- zurück, und niemand käme je dazu, sie wegzuräumen.
--
-- Also `project_id` mit `ON DELETE CASCADE` für Listen, `place` für die festen
-- Ansichten, und ein CHECK, dass genau eines von beiden gesetzt ist. Zwei
-- Spalten, eine Bedeutung — aber die Datenbank kennt sie.

CREATE TABLE IF NOT EXISTS list_views (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Eine Liste (oder ein Ordner — der zeigt auch Aufgaben).
  project_id   uuid REFERENCES projects (id) ON DELETE CASCADE,
  -- Oder eine der festen Ansichten.
  place        text,
  -- `display` und nicht `view`: `VIEW` ist in SQL ein Schlüsselwort, und eine
  -- Spalte, die man überall in Anführungszeichen setzen muss, wird irgendwo
  -- vergessen.
  display      text NOT NULL,

  CONSTRAINT list_views_one_place CHECK ((project_id IS NULL) <> (place IS NULL)),
  CONSTRAINT list_views_known_place CHECK (
    place IS NULL OR place IN ('today', 'upcoming', 'someday', 'inbox')
  ),
  -- Die Formen stehen auch hier, nicht nur im Kern: eine Zeile, die über einen
  -- anderen Weg hereinkommt, soll nicht „gruen" enthalten können. `board` kommt
  -- dazu, wenn es die Tafel gibt — eine Form im CHECK, die die Oberfläche nicht
  -- zeichnen kann, wäre eine Einstellung ohne Wirkung.
  CONSTRAINT list_views_known_display CHECK (display IN ('full', 'plain', 'cards'))
);

-- Je Person eine Wahl je Ort. Zwei Zeilen wären zwei Antworten, und welche
-- gilt, entschiede die Reihenfolge des Lesens.
CREATE UNIQUE INDEX IF NOT EXISTS list_views_by_project
  ON list_views (user_id, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS list_views_by_place
  ON list_views (user_id, workspace_id, place) WHERE place IS NOT NULL;

-- Gelesen wird beim Öffnen eines Arbeitsbereichs, alles auf einmal.
CREATE INDEX IF NOT EXISTS list_views_by_user
  ON list_views (user_id, workspace_id);

COMMENT ON TABLE list_views IS
  'Wie dicht eine Person eine bestimmte Liste (oder feste Ansicht) gezeichnet '
  'haben will. Die Vorgabe des Arbeitsbereichs steht in settings; hier steht '
  'nur, wo jemand davon abweicht.';
