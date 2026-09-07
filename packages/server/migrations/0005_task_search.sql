-- SOTE 0005 — Suche über Titel und Notiz.
--
-- `to_tsvector` mit einer **festen** Konfiguration ist immutable, also lässt
-- sich darauf ein Funktionsindex legen. Mit `current_setting` oder einer
-- Spalte als Konfiguration wäre es das nicht, und der Index ginge nicht.
--
-- Deutsch als Konfiguration: sie stemmt („Kabel" findet „Kabeln") und kennt die
-- Füllwörter. Das ist eine Entscheidung mit Preis — eine englische Aufgabe wird
-- nach deutschen Regeln gestemmt. Eine Konfiguration pro Arbeitsbereich wäre
-- richtiger und würde den Index vervielfachen; steht als offener Punkt.
--
-- `coalesce`, weil `note` NOT NULL DEFAULT '' ist, aber ein NULL im Ausdruck
-- den ganzen Vektor zu NULL machen würde, und dann findet die Suche eine Zeile
-- nicht mehr, ohne dass jemand es merkt.

CREATE INDEX tasks_search
  ON tasks
  USING gin (to_tsvector('german', coalesce(title, '') || ' ' || coalesce(note, '')));
