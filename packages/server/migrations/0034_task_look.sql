-- SOTE 0034 — wie eine Aufgabe aussieht.
--
-- Gewünscht: „Ein Icon, das dann vor dem Titel angezeigt wird, Textfarbe und
-- Hintergrundfarbe für die Kartenansicht." Und zur Herkunft: „Das würde ich
-- mehrstufig machen: Sie kann vom Projekt kommen oder vom Schlagwort, und
-- darüber hinaus kann sie manuell noch einzeln gefärbt werden."
--
-- ## Zwei Spalten, drei Ebenen
--
-- Das Projekt hat sein Aussehen längst (`projects.icon`, `projects.color`).
-- Neu sind zwei Stellen:
--
--   * `tasks.look` — was an DIESER Aufgabe steht, und damit die genaueste
--     Aussage.
--   * `labels.color` — die Farbe eines Schlagworts, also die Aussage über eine
--     ART von Aufgaben.
--
-- Aufgelöst wird im Kern (`resolveTaskLook`), Feld für Feld: wer nur ein
-- Zeichen an die Aufgabe hängt, behält die Farbe seines Projekts.
--
-- ## `jsonb` an der Aufgabe, `text` am Schlagwort
--
-- Kein Widerspruch, sondern die Form der jeweiligen Aussage: an der Aufgabe
-- können Zeichen UND Farbe stehen, ein Schlagwort trägt nur eine Farbe. Eine
-- `jsonb`-Spalte mit einem einzigen möglichen Schlüssel wäre eine Einladung,
-- irgendwann zwei daraus zu machen, ohne dass jemand es entscheidet.
--
-- Ein Zeichen am Schlagwort wäre denkbar und fehlt mit Absicht: Schlagwörter
-- stehen schon als Wort in der Zeile. Zwei Zeichen vor einem Titel — eines vom
-- Schlagwort, eines von der Aufgabe — wären eine Reihe, in der man nicht mehr
-- weiss, was wovon kommt.

ALTER TABLE tasks  ADD COLUMN IF NOT EXISTS look  jsonb;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN tasks.look IS
  'Aussehen DIESER Aufgabe: {"icon": "<name>", "color": "<palette|#rrggbb>"}. '
  'Die genaueste der drei Ebenen -- darunter das Schlagwort, darunter das '
  'Projekt. Aufgeloest wird Feld fuer Feld in resolveTaskLook.';

COMMENT ON COLUMN labels.color IS
  'Farbe dieses Schlagworts. Sie faerbt die Aufgaben, die es tragen -- eine '
  'Aussage ueber eine ART von Aufgaben, nicht ueber ihre Dringlichkeit (die '
  'steht im Kaestchen).';
