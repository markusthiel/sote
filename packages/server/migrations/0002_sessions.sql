-- SOTE 0002 — Anmeldung.
--
-- Kennwörter als scrypt-Hash mit eigenem Salz; kein Fremdpaket, weil Node es
-- mitbringt. Sitzungen liegen in der Datenbank und nicht in einem
-- signierten Keks: eine Abmeldung, die nur der Browser kennt, ist keine.

CREATE TABLE user_passwords (
  user_id  uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  salt     bytea NOT NULL,
  hash     bytea NOT NULL,
  set_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_by_user ON sessions (user_id);
