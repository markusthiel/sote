-- SOTE 0045 — Google- und Microsoft-Kalender mit delegiertem Kontozugang.
CREATE TABLE calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google','microsoft')),
  subject text NOT NULL,
  label text NOT NULL,
  tokens_sealed text NOT NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, subject),
  UNIQUE (id, user_id)
);
CREATE TABLE calendar_oauth_flows (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google','microsoft')),
  verifier_sealed text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE calendar_sources
  DROP CONSTRAINT calendar_sources_connection_kind_check,
  ADD CONSTRAINT calendar_sources_connection_kind_check CHECK (connection_kind IN ('ics','caldav','google','microsoft')),
  ADD COLUMN oauth_account_id uuid,
  ADD COLUMN remote_calendar_id text,
  ADD FOREIGN KEY (oauth_account_id, user_id) REFERENCES calendar_accounts(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT calendar_source_oauth CHECK (
    (connection_kind IN ('google','microsoft')) = (oauth_account_id IS NOT NULL AND remote_calendar_id IS NOT NULL)
  );
CREATE UNIQUE INDEX calendar_sources_remote ON calendar_sources(oauth_account_id, remote_calendar_id) WHERE oauth_account_id IS NOT NULL;
ALTER TABLE calendar_write_events ADD COLUMN remote_id text;
