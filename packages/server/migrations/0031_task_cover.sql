-- SOTE 0031 — das Titelbild einer Aufgabe.
--
-- Gewünscht: „Kann man ein Bild auch als Headerbild für Kanban einstellen? Also
-- bei der Aufgabe. Ein Vollbild, gecroppt, das die Karte einleitet, darunter
-- dann erst die eigentliche Karte."
--
-- ## `jsonb` und nicht `cover_url text`
--
-- SONE hatte genau diese Textspalte, und sie war der Fehler (ADR-0117): zwei
-- der drei Dinge, die ein Titelbild sein kann — eine Farbe, ein Verlauf — sind
-- keine URLs. Dort steht der Satz, der die Form entscheidet:
--
--   „Eine Spalte, die ein Drittel der Antwort halten kann, ist schlimmer als
--    eine, die gar nichts hält."
--
-- Bei SONE hieß das: ein Ordner mit Farb-Titelbild zeichnete nichts, während
-- die Seite daneben ihr Bild zeigte — und das liest sich als Fehler in Ordnern.
-- Hier wäre es eine Karte, die leer bleibt, wo die Nachbarkarte ein Bild trägt.
--
-- Also von Anfang an ein Objekt, neben `icon` bei den Projekten. Der eine Leser
-- ist `readTaskCover` im Kern, mit derselben Regel wie überall: eine Aufgabe
-- mit kaputtem Titelbild verliert ihr Titelbild, nie ihren Platz in der Liste.
--
-- ## Kein CHECK auf die Form
--
-- Die Form steht im Kern (`isTaskCover`), und der Schreibweg lehnt mit 422 ab.
-- Ein CHECK hier wäre eine zweite Fassung derselben Regel — und die beiden
-- liefen beim ersten neuen Feld auseinander. Was die Datenbank leisten soll,
-- ist „es ist ein Objekt", und das leistet `jsonb` von selbst.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cover jsonb;

COMMENT ON COLUMN tasks.cover IS
  'Titelbild der Karte: {"image": "/api/tasks/<id>/files/<id>"} oder '
  '{"color": "<palette|#rrggbb>"}. NULL heisst keines. Gelesen von '
  'readTaskCover im Kern; nur der eigene Anhangsweg wird angenommen, damit '
  'eine Karte niemanden bei einem fremden Server meldet.';
