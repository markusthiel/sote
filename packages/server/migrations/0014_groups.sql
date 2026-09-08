-- SOTE 0014 — Gruppen, und `groups.manage` kommt zurück.
--
-- Es war in Migration 0013 entfernt worden, weil es nichts bewachte (ADR-0087:
-- „a settings screen offering a switch that gates nothing is worse than not
-- offering it"). Dort stand: *es kommt zurück, wenn Gruppen kommen, im selben
-- Commit wie die Wege, die es prüfen.* Das ist dieser Commit.
--
-- ## Eine Gruppe trägt eine Rolle
--
-- SONEs ADR-0087: Rollen sind an Leute UND an Gruppen vergebbar, und die
-- wirksame Rolle einer Person ist die **Vereinigung** der Rechte und das
-- **Maximum** der Stufen über ihre eigene Rolle und die Rollen aller ihrer
-- Gruppen.
--
-- Vereinigung und Maximum, niemals Abzug — und der Grund ist nicht Bequemlichkeit
-- (ADR-0026): **in eine Gruppe aufgenommen zu werden darf niemals wegnehmen,
-- was jemand schon durfte.** Ein Modell, in dem Beitreten etwas nimmt, macht
-- jede Gruppenmitgliedschaft zu einer Sache, die man vor dem Vergeben prüfen
-- muss.

CREATE TABLE IF NOT EXISTS groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- Die Rolle, die diese Gruppe trägt. `NULL` ist erlaubt und heißt: sie
  -- ordnet nur, sie gibt nichts — eine Gruppe ohne Rolle ist eine Liste von
  -- Leuten, und das ist ein legitimer Zweck.
  role_id       uuid REFERENCES roles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members (user_id);

COMMENT ON COLUMN groups.role_id IS
  'Die Rolle, die diese Gruppe traegt. NULL heisst: sie ordnet nur. Die '
  'wirksame Rolle einer Person ist die Vereinigung der Rechte und das Maximum '
  'der Stufen ueber ihre eigene Rolle und die aller ihrer Gruppen (ADR-0087).';

-- Der CHECK aus 0013 kennt `groups.manage` noch nicht.
--
-- Ersetzt und nicht erweitert: eine Bedingung, die zwei Fassungen derselben
-- Liste enthält, ist eine, bei der man nicht weiß, welche gilt.
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_rights_known;
ALTER TABLE roles ADD CONSTRAINT roles_rights_known CHECK (
  rights <@ ARRAY['people.manage', 'roles.manage', 'workspace.settings', 'groups.manage']::text[]
);

-- Wer Leute verwalten darf, verwaltet auch Gruppen — bis jemand es trennt.
--
-- Die Alternative wäre, niemandem das neue Recht zu geben: dann könnte nach
-- dieser Migration keine Gruppe entstehen, und der Bildschirm wäre für alle
-- leer. Eine Migration, die eine Annahme trifft und sie hinschreibt, ist besser
-- als eine, die eine neue Sache unerreichbar zurücklässt.
UPDATE roles
   SET rights = array_append(rights, 'groups.manage')
 WHERE 'people.manage' = ANY(rights) AND NOT ('groups.manage' = ANY(rights));
