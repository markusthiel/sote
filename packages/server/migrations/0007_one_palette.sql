-- SOTE 0007 — ein Vokabular für Farben.
--
-- Die acht Palettennamen hießen hier deutsch (grau, rot, gelb, gruen, blau,
-- lila) und in SONE englisch. Der Name ist ein GESPEICHERTER WERT, und zwei
-- Systeme, die dasselbe Blau meinen und es verschieden schreiben, können ihre
-- Farben nicht miteinander vergleichen — spätestens wenn eine Aufgabe auf eine
-- SONE-Seite zeigt.
--
-- Also SONEs Schreibweise, und einmal umgeschrieben, was schon gespeichert ist.
-- Umbenennen ist eine Migration und kein Umbau; SONE sagt denselben Satz über
-- seine Zeichennamen.
--
-- Nur die sechs, die sich ändern: `orange` und `pink` heißen in beiden gleich.
-- Hex-Werte bleiben, wie sie sind — die haben nie einen Namen gehabt.

UPDATE projects SET color = CASE color
  WHEN 'grau'  THEN 'grey'
  WHEN 'rot'   THEN 'red'
  WHEN 'gelb'  THEN 'yellow'
  WHEN 'gruen' THEN 'green'
  WHEN 'blau'  THEN 'blue'
  WHEN 'lila'  THEN 'purple'
  ELSE color
END
WHERE color IN ('grau', 'rot', 'gelb', 'gruen', 'blau', 'lila');

-- Dasselbe für die Farbe im Zeichen.
--
-- `jsonb_set` und nicht ein neues Objekt: das Zeichen trägt auch einen Namen,
-- und ein Neubau würde ihn wegwerfen, wenn hier je ein Feld dazukommt.
UPDATE projects SET icon = jsonb_set(
  icon,
  '{iconColor}',
  to_jsonb(CASE icon->>'iconColor'
    WHEN 'grau'  THEN 'grey'
    WHEN 'rot'   THEN 'red'
    WHEN 'gelb'  THEN 'yellow'
    WHEN 'gruen' THEN 'green'
    WHEN 'blau'  THEN 'blue'
    WHEN 'lila'  THEN 'purple'
    ELSE icon->>'iconColor'
  END)
)
WHERE icon->>'iconColor' IN ('grau', 'rot', 'gelb', 'gruen', 'blau', 'lila');
