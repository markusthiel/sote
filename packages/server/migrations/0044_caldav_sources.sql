-- SOTE 0044 — Private Kalender über CalDAV lesen; kein öffentlicher ICS-Link nötig.
ALTER TABLE calendar_sources
  ADD COLUMN connection_kind text NOT NULL DEFAULT 'ics' CHECK (connection_kind IN ('ics', 'caldav')),
  ADD COLUMN caldav_credentials_sealed text,
  ADD CONSTRAINT calendar_sources_caldav_credentials CHECK (
    (connection_kind = 'caldav') = (caldav_credentials_sealed IS NOT NULL)
  );
