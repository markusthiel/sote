-- SOTE 0039 — Der Rückstau an `push.send`-Aufträgen, den es nie gab.
--
-- Bis zu diesem Stand legte `deliver()` für Zuweisungen und Kommentare
-- Aufträge der Art `push.send`, und kein Modul bearbeitete sie: fünf
-- Versuche „kein Bearbeiter", dann liegen gelassen (Audit 12.09.2026, F08).
--
-- Mit dieser Fassung gibt es den Bearbeiter. Die liegenden Aufträge sind
-- Meldungen über Ereignisse von Tagen oder Wochen — sie jetzt zuzustellen
-- wäre eine Flut alter Nachrichten auf jedem Gerät, jede davon zu spät.
-- Also weg damit: was offen ist, wird als erledigt markiert, mit dem Grund
-- daneben. Nicht gelöscht, damit die Wartungsansicht zeigen kann, dass hier
-- etwas war.
UPDATE jobs
   SET done_at = now(),
       last_error = 'verworfen: kein Bearbeiter bis Migration 0039 (Audit F08)'
 WHERE kind = 'push.send' AND done_at IS NULL;
