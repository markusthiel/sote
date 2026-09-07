-- SOTE 0004 — ein Projektname ist in seinem Geschwisterkreis eindeutig.
--
-- Grund ist die Schnellerfassung: `#haus` sucht ein Projekt nach Namen. Gäbe es
-- zwei mit demselben Namen an derselben Stelle, müsste sie eines auswählen —
-- und still eines von zwei zu wählen ist derselbe Fehler wie bei `+markus`
-- (siehe `ambiguousAssignees`): die Aufgabe landet irgendwo, und niemand
-- erfährt davon.
--
-- **Pro Geschwisterkreis, nicht pro Arbeitsbereich.** „Kabel" darf es unter
-- „Haus" und unter „Büro" geben; das sind zwei verschiedene Dinge. Dass `#kabel`
-- dann mehrdeutig ist, meldet die Erfassung — der Index kann es nicht
-- entscheiden, weil beide Namen berechtigt sind.
--
-- `NULLS NOT DISTINCT` wieder, weil oberste Projekte `parent_id IS NULL`
-- haben und Postgres zwei NULLs sonst für verschieden hält. Und nur für
-- lebende Projekte: ein weggeworfenes soll den Namen nicht blockieren.

CREATE UNIQUE INDEX projects_sibling_name
  ON projects (workspace_id, parent_id, lower(name))
  NULLS NOT DISTINCT
  WHERE trashed_at IS NULL;
