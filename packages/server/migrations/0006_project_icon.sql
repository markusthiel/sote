-- SOTE 0006 — Projekte bekommen ein Zeichen.
--
-- Gemeldet: „Projekte und Unterprojekte sollten so möglich sein wie bei SONE
-- die Ordner. Also Unterordner anlegen, icons, Farben."
--
-- Dieselbe Form wie SONEs `pages.icon` — {icon, iconColor} als jsonb — damit
-- wer beide Systeme liest, nicht zwei Formen für eine Sache lernen muss. SONE
-- hat dort zusätzlich `titleColor`; das fehlt hier, weil eine Zeile in der
-- Seitenleiste keinen eigenen Titel hat, der sich färben ließe.
--
-- Und jsonb, nicht zwei Spalten: das Zeichen ist EINE Wahl. Zwei Spalten
-- lassen den halben Zustand zu, in dem eine Farbe ohne Zeichen gespeichert ist
-- und niemand weiß, ob das Absicht war.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS icon jsonb;

COMMENT ON COLUMN projects.icon IS
  'Woran ein Projekt in einer Liste erkannt wird: {icon, iconColor} — '
  'dieselbe Form wie SONEs pages.icon. Der Name des Zeichens wird nicht '
  'geprüft: welche Zeichen es gibt, weiß die Oberfläche.';

-- Die Farbe darf jetzt auch ein Palettenname sein.
--
-- Bisher stand hier ausschließlich `#rrggbb`, serverseitig geprüft. Ein Name
-- ist mehr als eine Bequemlichkeit: `blau` gespeichert folgt der Palette, und
-- wer die Palette ändert, ändert damit jedes blaue Ding. Ein gespeichertes
-- `#2563eb` bleibt für immer dieses eine Blau (SONE, ADR-0023).
--
-- Keine CHECK-Bedingung darauf: die Prüfung liegt im Kern (`readColor`), und
-- eine zweite in SQL wäre eine zweite Wahrheit, die bei jedem neuen
-- Palettennamen nachzuziehen wäre. Was die Oberfläche nicht erkennt, zeichnet
-- sie ohne Farbe.
COMMENT ON COLUMN projects.color IS
  'Ein Palettenname (grau, rot, orange, gelb, gruen, blau, lila, pink) oder '
  'ein #rrggbb. Ein Name folgt der Palette, ein Hex-Wert nicht.';
