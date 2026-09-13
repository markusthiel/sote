-- SOTE 0046 — Ermittelte Schreibrechte getrennt von aktivierter Aufgabenübertragung.
-- NULL bedeutet: der Anbieter hat noch keine eindeutige Auskunft geliefert.
ALTER TABLE calendar_sources ADD COLUMN writable boolean;
UPDATE calendar_sources SET writable=false WHERE connection_kind='ics';
