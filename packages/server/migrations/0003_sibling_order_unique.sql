-- SOTE 0003 — die Reihenfolge von Geschwistern ist eindeutig.
--
-- Gefunden von `views.db.test.ts`, „zwei gleichzeitige Einfügungen in dieselbe
-- Lücke": `generateKeyBetween` ist **deterministisch**. Zwei Transaktionen, die
-- dieselben Nachbarn lesen, rechnen denselben Schlüssel und schreiben ihn
-- beide. Danach ist die Reihenfolge zwischen den zwei Zeilen undefiniert und
-- kann von Abfrage zu Abfrage kippen.
--
-- In SONE fällt das nicht auf, weil die Schlüssel dort in Yjs liegen und ein
-- CRDT eine eigene Gleichstandsregel hat. Eine Tabelle hat keine. Also wird
-- die Invariante hier eine Bedingung, und der Schreiber wiederholt bei
-- Kollision mit dem Gewinner als neuem Nachbarn.
--
-- `NULLS NOT DISTINCT` ist der Kern: `project_id` und `parent_id` sind oft
-- NULL, und Postgres hält zwei NULLs standardmäßig für verschieden — der Index
-- hätte also genau die Zeilen nicht geschützt, um die es am häufigsten geht.
-- Braucht PostgreSQL 15 oder neuer.

CREATE UNIQUE INDEX tasks_sibling_order
  ON tasks (workspace_id, project_id, parent_id, sort_key)
  NULLS NOT DISTINCT;
