-- SOTE 0030 — `board` wird eine Anzeigeform.
--
-- Migration 0028 hat die Formen als CHECK festgehalten und dabei gesagt, warum
-- `board` noch fehlte: „eine Form im CHECK, die die Oberfläche nicht zeichnen
-- kann, wäre eine Einstellung ohne Wirkung." Jetzt kann sie es.
--
-- Das ist der ganze Ertrag der Entscheidung von damals, einen WORTSCHATZ zu
-- nehmen statt eines Ja-Nein-Schalters: die Tafel kostet hier eine Zeile.

ALTER TABLE list_views DROP CONSTRAINT IF EXISTS list_views_known_display;
ALTER TABLE list_views ADD CONSTRAINT list_views_known_display
  CHECK (display IN ('full', 'plain', 'cards', 'board'));
