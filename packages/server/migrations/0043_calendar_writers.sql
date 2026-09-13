-- SOTE 0043 — Aufgaben als Termine in einen fremden CalDAV-Kalender schreiben.
-- Die Leseadresse bleibt getrennt. Zugangsdaten und Schreibadresse sind versiegelt.
CREATE TABLE calendar_writers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL UNIQUE REFERENCES calendar_sources(id) ON DELETE CASCADE,
  credentials_sealed text NOT NULL,
  workspaces uuid[] NOT NULL,
  mode text NOT NULL CHECK (mode IN ('planned', 'due', 'both')),
  timezone text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  last_error text,
  conflict_uid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Kein FK auf tasks: auch nach endgültigem Löschen braucht der Läufer die
-- Adresse und den ETag, um genau seine eigene Kopie zurückzunehmen.
CREATE TABLE calendar_write_events (
  writer_id uuid NOT NULL REFERENCES calendar_writers(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan', 'due')),
  uid text NOT NULL UNIQUE,
  etag text,
  content_hash text,
  pending_hash text,
  PRIMARY KEY (writer_id, task_id, kind)
);
