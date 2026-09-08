-- SOTE 0010 — ein Arbeitsbereich bekommt Name und Zeichen.
--
-- Aus SONEs Bildern: der Wechsler oben in der Leiste zeigt Zeichen und Name,
-- und beide sind einstellbar. Dieselbe Form wie `projects.icon` und wie SONEs
-- `workspaces.icon` — mit einem Feld mehr.
--
-- ## Warum hier `titleColor` dazukommt und bei Projekten nicht
--
-- Bei `projects.icon` habe ich es weggelassen, mit der Begründung: „eine Zeile
-- in der Seitenleiste hat keinen eigenen Titel, der sich färben ließe."
--
-- Beim Arbeitsbereich ist das anders, und genau daran erkennt man, dass die
-- Begründung damals stimmte: sein **Name steht sichtbar** im Wechsler, im
-- Kopf der Leiste und in der Übersicht. Also hat er zwei Dinge zu färben, und
-- SONEs Form kennt darum drei Felder.
--
-- Bewusst NICHT Teil des Themas (`settings.look`): das Thema sagt, wie der
-- Arbeitsbereich aussieht, das Zeichen sagt, **welcher es ist**. Wer sein Thema
-- zurücksetzt, will nicht sein Signet verlieren. Dieselbe Trennung, die SONEs
-- Kommentar an `workspaces.icon` zieht: „Deliberately not part of the workspace
-- theme."

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon jsonb;

COMMENT ON COLUMN workspaces.icon IS
  'Woran dieser Arbeitsbereich erkannt wird: {icon, iconColor, titleColor}. '
  'Absichtlich nicht Teil des Themas — das Thema sagt, wie er aussieht, das '
  'Zeichen sagt, welcher er ist.';
