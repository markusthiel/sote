-- SOTE 0015 — Aufträge, die später laufen.
--
-- ## Warum es das braucht
--
-- Drei Dinge im Konzept warten darauf und tun bis jetzt nichts: Erinnerungen,
-- Einladungen, das Leeren des Papierkorbs. Alle drei haben dieselbe Form —
-- *etwas soll zu einer Zeit geschehen, zu der niemand auf einen Knopf drückt*.
--
-- ## Eine Tabelle, kein zweiter Dienst
--
-- SOTE wird selbst betrieben, in einem Prozess. Ein eigener Läuferdienst wäre
-- ein zweites Ding zum Ausrollen, Überwachen und Neustarten — für einen Server,
-- auf dem eine Handvoll Leute Aufgaben führt. Der Läufer sitzt darum im
-- Serverprozess und die Warteschlange in der Datenbank, die es ohnehin gibt.
--
-- Das ist mit mehreren Prozessen trotzdem richtig: geholt wird mit
-- `FOR UPDATE SKIP LOCKED`, also nimmt sich jeder Läufer nur, was kein anderer
-- schon hat.
--
-- ## Mindestens einmal, nicht genau einmal
--
-- Ein Auftrag kann **zweimal** laufen: wenn der Prozess zwischen Ausführung und
-- Quittung stirbt, ist die Arbeit getan und die Zeile noch offen. Genau einmal
-- wäre nur mit einer Quittung *innerhalb* derselben Transaktion wie die Arbeit
-- zu haben, und das geht nicht, sobald die Arbeit den Server verlässt (Mail).
--
-- Also die ehrliche Zusage: **mindestens einmal**, und jeder Bearbeiter muss
-- mehrfaches Laufen aushalten. Das steht hier, weil es die eine Eigenschaft
-- ist, die man beim Schreiben eines Bearbeiters wissen muss.

CREATE TABLE IF NOT EXISTS jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Was zu tun ist. Ein Name, den ein Bearbeiter im Code beansprucht; ein
  -- unbekannter Name ist ein FEHLER und nichts, was still liegen bleibt.
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',

  -- Wann frühestens. Auch die Wiederholung läuft darüber: ein Bearbeiter, der
  -- regelmäßig laufen soll, legt am Ende den nächsten Auftrag an.
  run_at       timestamptz NOT NULL DEFAULT now(),

  -- Damit derselbe wiederkehrende Auftrag nicht zweimal in der Schlange liegt.
  -- Ohne diesen Schlüssel entstehen bei jedem Neustart neue Ticks, und nach
  -- zehn Neustarts läuft das Aufräumen zehnmal.
  unique_key   text UNIQUE,

  attempts     integer NOT NULL DEFAULT 0,
  -- Wer gerade dran ist. Eine Zeit und kein Flag: ein Flag, das ein
  -- abgestürzter Prozess gesetzt hat, bleibt für immer gesetzt.
  locked_at    timestamptz,
  last_error   text,
  done_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Der Index, den das Holen braucht: offene Aufträge, die fällig sind.
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE done_at IS NULL;

COMMENT ON TABLE jobs IS
  'Auftraege, die spaeter laufen. Zusage: MINDESTENS EINMAL -- jeder '
  'Bearbeiter muss mehrfaches Laufen aushalten (siehe Migration 0015).';
