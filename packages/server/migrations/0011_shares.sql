-- SOTE 0011 — Freigaben: ein Link auf ein Projekt.
--
-- Konzept 10e. Eine Freigabe ist ein **Token und kein Konto** — das ist die
-- Abweichung von SONE, wo ein Gast ein Mitglied ist (ADR-0110). Dort hängen
-- Rechte an Seiten; hier gilt alles je Arbeitsbereich, also wäre ein Gast als
-- Mitglied ein Gast mit Zugriff auf alles. Das ist keine Freigabe, das ist eine
-- Einladung.

CREATE TABLE IF NOT EXISTS shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  -- Genau ein PROJEKT, kein Ordner: ein Ordner ist kein Ort, an dem Aufgaben
  -- stehen. Der Trigger unten hält das, nicht nur der Anwendungscode.
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- Zwei Stufen, keine Matrix. `edit` heißt abhaken, anlegen, Titel und Datum
  -- ändern — nicht umbenennen, nicht löschen, keine anderen Projekte sehen.
  -- Die Grenze ist nicht „was ist gefährlich", sondern was zum Projekt gehört.
  right_level    text NOT NULL CHECK (right_level IN ('read', 'edit')),

  -- Nachschlagen geht über den HASH, anzeigen über die verschlüsselte Fassung.
  --
  -- Zwei Spalten für einen Token, und beide braucht es: ein Hash ist der
  -- schnelle, indexierbare Weg von „hier ist ein Link" zu „das ist die Zeile",
  -- ohne jede Zeile entschlüsseln zu müssen. Die verschlüsselte Fassung hält
  -- ADR-0113 („der Link behält den Link"): man kann ihn wieder anzeigen, und
  -- damit legt niemand einen zweiten an und vergisst den ersten zu widerrufen.
  token_hash     text NOT NULL UNIQUE,
  token_enc      text NOT NULL,

  expires_at     timestamptz,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Sofort und endgültig: kein Papierkorb für Freigaben. „Widerrufen, aber
  -- wiederherstellbar" heißt, der Link geht noch.
  revoked_at     timestamptz,

  -- Die Spalte, die eine vergessene Freigabe sichtbar macht.
  last_used_at   timestamptz
);

COMMENT ON COLUMN shares.token_hash IS
  'SHA-256 des Tokens — der Weg vom Link zur Zeile, ohne alles zu entschluesseln.';
COMMENT ON COLUMN shares.token_enc IS
  'Der Token, verschluesselt mit dem Schluessel aus der Umgebung. Haelt '
  'ADR-0113: der Link laesst sich wieder anzeigen.';

CREATE INDEX IF NOT EXISTS shares_by_project
  ON shares (workspace_id, project_id, created_at DESC);

-- Nur Projekte, keine Ordner. Als Trigger, weil ein CHECK nur seine eigene
-- Zeile sieht — dieselbe Bauart wie bei `tasks_project_is_list`.
CREATE OR REPLACE FUNCTION shares_project_is_list() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM projects WHERE id = NEW.project_id) <> 'list' THEN
    RAISE EXCEPTION 'ein Ordner wird nicht freigegeben, ein Projekt schon'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shares_project_is_list_trg ON shares;
CREATE TRIGGER shares_project_is_list_trg
  BEFORE INSERT OR UPDATE OF project_id ON shares
  FOR EACH ROW EXECUTE FUNCTION shares_project_is_list();
