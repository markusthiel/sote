-- SOTE 0017 — Erinnerungen: eine Mail am Tag.
--
-- ## Warum eine und nicht eine je Aufgabe
--
-- Eine Mail je fälliger Aufgabe heißt an einem normalen Dienstag dreißig Mails,
-- und dreißig Mails am Tag heißt einen Filter im Postfach — danach erinnert
-- nichts mehr an nichts. Also **ein Brief**, der sagt, was heute anliegt und
-- was überfällig ist.
--
-- Das ist auch die Antwort auf die Frage, wie oft erinnert wird: einmal
-- täglich, zu einer Zeit, die die Person selbst wählt.
--
-- ## Diese Tabelle ist die Quittung, nicht die Einstellung
--
-- Die Einstellung („um wie viel Uhr, und überhaupt?") liegt bei der Person, in
-- `settings` — wo alles Persönliche liegt. Hier steht nur, **dass** für einen
-- Tag schon geschrieben wurde.
--
-- Sie ist nötig, weil der Läufer „mindestens einmal" zusagt (Migration 0015):
-- ohne Quittung schickt ein wiederholter Auftrag einen zweiten Brief. Und sie
-- wirkt, weil Quittung und Mailauftrag **in derselben Transaktion** entstehen —
-- beides sind Zeilen in derselben Datenbank, also gibt es hier wirklich
-- *genau einmal*. Nur das Zustellen bleibt „mindestens einmal", denn das
-- verlässt den Server.

CREATE TABLE IF NOT EXISTS reminders_sent (
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Das Datum in der Zone der PERSON und nicht in UTC. Wer in Tokio um 8 Uhr
  -- erinnert wird, soll seinen Brief am japanischen Dienstag bekommen und nicht
  -- am UTC-Montag — sonst gibt es einen Tag mit zwei Briefen und einen ohne.
  for_date  date NOT NULL,

  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, for_date)
);

COMMENT ON TABLE reminders_sent IS
  'Quittung: fuer diesen Tag wurde schon geschrieben. Entsteht in DERSELBEN '
  'Transaktion wie der Mailauftrag -- deshalb genau einmal je Tag.';
