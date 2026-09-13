-- SOTE 0047 — Persönliche, projektbegrenzte SONE-Freigaben.
CREATE TABLE integration_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 base_url text NOT NULL, secret_hash text NOT NULL,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL, revoked_at timestamptz
);
CREATE UNIQUE INDEX integration_clients_active_base ON integration_clients(base_url) WHERE revoked_at IS NULL;
CREATE TABLE integration_codes (
 code_hash text PRIMARY KEY, client_id uuid NOT NULL REFERENCES integration_clients(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 challenge text NOT NULL, projects uuid[] NOT NULL, writable boolean NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE integration_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES integration_clients(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, projects uuid[] NOT NULL, writable boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE TABLE integration_operations (
 client_id uuid NOT NULL REFERENCES integration_clients(id), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL, payload_hash text NOT NULL,
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 PRIMARY KEY(client_id,user_id,operation_id)
);
CREATE TABLE integration_references (
 client_id uuid NOT NULL REFERENCES integration_clients(id), page_id uuid NOT NULL, block_id uuid NOT NULL,
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 PRIMARY KEY(client_id,page_id,block_id,task_id)
);
ALTER TABLE tasks ADD COLUMN integration_revision bigint NOT NULL DEFAULT 1;
CREATE FUNCTION bump_integration_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.integration_revision := OLD.integration_revision + 1; RETURN NEW; END $$;
CREATE TRIGGER tasks_integration_revision BEFORE UPDATE ON tasks
 FOR EACH ROW EXECUTE FUNCTION bump_integration_revision();
