-- SOTE 0019 — Benachrichtigungen.
--
-- ## Zwei Dinge, die eine Glocke waren
--
-- Die Glocke in der Schiene hieß **Posteingang** und zeigte Aufgaben ohne
-- Projekt. Das sind zwei verschiedene Fragen, und eine Glocke beantwortet nur
-- die zweite:
--
-- * **Posteingang** ist eine Aufgabenansicht — was noch nicht einsortiert ist.
--   Sie gehört zwischen „Heute" und die Projekte, nicht in eine eigene Schiene.
-- * **Benachrichtigungen** sind, was *jemand anderes* getan hat und mich
--   angeht.
--
-- Gemeldet als „Benachrichtigungen haben noch kein eigenes Menü. Auch wie
-- Sone." — und der Grund, warum es keines gab, war, dass es die Sache nicht gab.
--
-- ## Woraus sie entstehen
--
-- Aus zwei Ereignissen, weil es zwei gibt, die einen anderen betreffen:
-- **zugewiesen** und **kommentiert**. Kein „Aufgabe geändert": eine
-- Benachrichtigung je Tastendruck wäre eine Glocke, die man abstellt.
--
-- ## Nie über sich selbst
--
-- Wer eine Aufgabe sich selbst zuweist oder seinen eigenen Kommentar schreibt,
-- bekommt keine Post. Das steht als Bedingung im Schreibweg und nicht als
-- Filter beim Lesen: eine Zeile, die niemand sehen soll, soll nicht entstehen.

CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Wen es angeht. Nicht „wer es getan hat" — das steht in `actor_id`.
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  kind          text NOT NULL CHECK (kind IN ('assigned', 'commented')),

  -- Worum es geht. `ON DELETE CASCADE`: eine Benachrichtigung über eine
  -- gelöschte Aufgabe ist eine Zeile, die auf nichts zeigt — und ein Klick
  -- darauf wäre ein Fehler statt einer Auskunft.
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,

  -- Wer. `NULL` ist möglich, weil ein Gast über einen Link niemand ist
  -- (Konzept 10e) — und „über einen Link" ist eine ehrlichere Auskunft als ein
  -- erfundener Name.
  actor_id      uuid REFERENCES users (id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Gelesen ist eine ZEIT und kein Flag: „wann habe ich das gesehen" ist die
  -- Frage, die man an eine Liste stellt, die man durchgeht.
  read_at       timestamptz
);

-- Der Index, den die Liste braucht: meine, neueste zuerst.
CREATE INDEX IF NOT EXISTS notifications_mine
  ON notifications (user_id, created_at DESC);

-- Und der, den die Zahl an der Glocke braucht.
CREATE INDEX IF NOT EXISTS notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;

COMMENT ON TABLE notifications IS
  'Was jemand anderes getan hat und mich angeht. Entsteht nie ueber sich '
  'selbst -- das steht im Schreibweg und nicht als Filter beim Lesen.';
