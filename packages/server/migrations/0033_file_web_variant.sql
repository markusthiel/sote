-- SOTE 0033 — die kleine Fassung eines Bildes.
--
-- Gemeldet: „Ist es entsprechend verkleinert, damit keine mehrere MB große
-- Datei geladen wird? … Thumbnails sollten ebenfalls verkleinert dargestellt
-- werden und nicht das volle Bild laden."
--
-- ## Zwei Dateien, eine Zeile
--
-- Das Original bleibt, wie es kam — ein Anhang ist etwas, das jemand
-- AUFBEWAHREN will, und ihn beim Hochladen kleinzurechnen wäre eine stille
-- Enteignung. Daneben liegt eine Web-Fassung, und beide gehören demselben
-- Anhang.
--
-- Darum KEINE zweite Zeile in `task_files`: eine Web-Fassung ist kein
-- Anhang. Stünde sie als eigene Zeile da, erschiene sie in der Liste, im
-- Papierkorb und in der Zählung „wie viel liegt in diesem Arbeitsbereich" —
-- und jede dieser Stellen müsste sie wieder herausfiltern. Drei Filter, die
-- man vergessen kann, gegen zwei Spalten, die man nicht vergessen kann.
--
-- ## Warum `web_bytes` mitsteht
--
-- Die Verwaltung zählt Bytes, und sie soll nicht dafür ins Dateisystem sehen
-- müssen. Ausserdem beantwortet die Zahl beim Nachsehen die Frage, ob sich die
-- zweite Fassung überhaupt gelohnt hat.

ALTER TABLE task_files
  ADD COLUMN IF NOT EXISTS web_key   text UNIQUE,
  ADD COLUMN IF NOT EXISTS web_bytes bigint CHECK (web_bytes IS NULL OR web_bytes > 0);

COMMENT ON COLUMN task_files.web_key IS
  'Ablageschluessel der kleinen Fassung, NULL wenn es keine gibt (kein Bild, '
  'schon klein genug, oder eine Art, die man nicht neu zeichnet). Sie ist '
  'KEIN eigener Anhang: sie steht in derselben Zeile, damit Liste, Papierkorb '
  'und Zaehlung sie nicht herausfiltern muessen.';
