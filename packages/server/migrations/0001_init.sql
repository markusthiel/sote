-- SOTE 0001 — Grundschema.
--
-- Aufgaben sind **relationale Datensätze**, keine kollaborativen Dokumente
-- (Konzept, Abschnitt 6). Kein Yjs, kein Dokumentenspeicher: Titel und Notiz
-- sind die einzigen Freitextfelder, alles andere sind Werte, und für Werte ist
-- der jüngste Schreiber pro Feld mit Server-Sequenz die richtige Auflösung.
--
-- ACHTUNG COLLATION. `sort_key` ist ein Fractional Index und wird
-- lexikographisch verglichen. Die Datenbank **muss** mit `--locale=C` angelegt
-- sein, sonst sortiert eine sprachabhängige Collation diese Schlüssel um und
-- vertauscht Zeilen. Dieselbe Falle wie in SONE; dort steht es im
-- docker-compose.yml neben POSTGRES_INITDB_ARGS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Leute und Arbeitsbereiche ────────────────────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Eine Rolle ist eine Leiter **und** eine Menge, wie in SONE (ADR-0087,
-- ADR-0100). `list_level = NULL` heißt wirklich nichts: kein Zugriff ohne
-- ausdrückliche Freigabe (ADR-0110). Wer eine eigene Rolle ohne Stufe anlegt,
-- legt einen Gast an.
CREATE TYPE list_level AS ENUM ('viewer', 'commenter', 'editor', 'admin');

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  list_level    list_level,
  rights        text[] NOT NULL DEFAULT '{}',
  UNIQUE (workspace_id, name)
);

CREATE TABLE workspace_members (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES roles (id),
  -- Eigentümerschaft ist eine Spalte, kein Recht (SONE, ADR-0102).
  is_owner      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, user_id)
);

-- ── Projekte: der Baum ───────────────────────────────────────────────────

CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_id      uuid REFERENCES projects (id) ON DELETE CASCADE,
  name           text NOT NULL,
  color          text,
  sort_key       text COLLATE "C" NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Im Papierkorb, nicht gelöscht. Es gibt **keinen** Sweep, der das leert:
  -- eine Frist, die von selbst löscht, ist eine Löschung, die niemand
  -- angeordnet hat (Konzept, Abschnitt 8a).
  trashed_at     timestamptz,
  trashed_by     uuid REFERENCES users (id)
);

CREATE INDEX projects_by_parent ON projects (workspace_id, parent_id, sort_key);

-- ── Aufgaben ─────────────────────────────────────────────────────────────

-- Binär. „In Arbeit" ist der Anfang von Projektmanagement (Konzept,
-- Abschnitt 10): ein dritter Wert braucht sofort eine Spalte, in der man ihn
-- sieht. Zwischenstände sind Teilaufgaben.
CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES tasks (id) ON DELETE CASCADE,

  title         text NOT NULL,
  note          text NOT NULL DEFAULT '',

  -- Zwei Zeitpunkte, nicht einer. Ein Feld für beides erzwingt die Lüge, dass
  -- jede Aufgabe an ihrem Fälligkeitstag begonnen wird (Abschnitt 3).
  -- `planned_all_day` unterscheidet „morgen" von „morgen 9 Uhr" — und daran
  -- hängt, ob es eine Erinnerung gibt (Abschnitt 9).
  planned_at        timestamptz,
  planned_all_day   boolean NOT NULL DEFAULT true,
  due_at            timestamptz,
  due_all_day       boolean NOT NULL DEFAULT true,

  -- 1 = dringend … 4 = später. Vier Stufen innen; nach draußen fährt die
  -- vierte als „ohne Priorität" (Blatt 13).
  priority      smallint NOT NULL DEFAULT 4
                  CHECK (priority BETWEEN 1 AND 4),

  completed_at  timestamptz,
  completed_by  uuid REFERENCES users (id),

  -- Genau eine der beiden Arten, oder keine. Der CHECK hält, was der
  -- TypeScript-Union in core/task/recurrence.ts hält: eine Aufgabe kann nicht
  -- kalenderfest **und** erledigungsbezogen wiederkehren.
  recur_rrule        text,
  recur_dtstart      timestamptz,
  recur_after_n      smallint CHECK (recur_after_n IS NULL OR recur_after_n >= 1),
  recur_after_unit   text CHECK (recur_after_unit IN ('day','week','month','year')),
  CONSTRAINT recurrence_is_one_kind CHECK (
    (recur_rrule IS NULL AND recur_dtstart IS NULL
       AND recur_after_n IS NULL AND recur_after_unit IS NULL)
    OR (recur_rrule IS NOT NULL AND recur_dtstart IS NOT NULL
       AND recur_after_n IS NULL AND recur_after_unit IS NULL)
    OR (recur_rrule IS NULL AND recur_dtstart IS NULL
       AND recur_after_n IS NOT NULL AND recur_after_unit IS NOT NULL)
  ),

  sort_key      text COLLATE "C" NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  trashed_at    timestamptz,
  trashed_by    uuid REFERENCES users (id)
);

-- Die Heute-Ansicht fragt: geplant bis heute oder überfällig, nicht erledigt,
-- nicht im Papierkorb. Genau darauf zeigt dieser Index.
CREATE INDEX tasks_today
  ON tasks (workspace_id, planned_at)
  WHERE completed_at IS NULL AND trashed_at IS NULL;

CREATE INDEX tasks_by_project ON tasks (project_id, sort_key)
  WHERE trashed_at IS NULL;

CREATE INDEX tasks_by_due ON tasks (workspace_id, due_at)
  WHERE completed_at IS NULL AND trashed_at IS NULL;

-- ── Zuweisung: eine Person **oder** ein Gast ─────────────────────────────

-- `user_id` und `guest_key` schließen sich aus, und der CHECK ist kein Luxus:
-- in SONE hat ein `guest:`-Schlüssel in einer uuid-Spalte dreimal eine ganze
-- Projektionstransaktion mitgerissen (ADR-0091, ADR-0092). Getrennte Spalten
-- machen jede Stelle sichtbar, die nur den einen Fall kennt.
CREATE TABLE task_assignees (
  task_id    uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  guest_key  text,
  CONSTRAINT assignee_is_one_kind CHECK (
    (user_id IS NOT NULL AND guest_key IS NULL)
    OR (user_id IS NULL AND guest_key IS NOT NULL)
  ),
  UNIQUE (task_id, user_id, guest_key)
);

-- ── Schlagwörter ─────────────────────────────────────────────────────────

CREATE TABLE labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text,
  UNIQUE (workspace_id, name)
);

CREATE TABLE task_labels (
  task_id   uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  label_id  uuid NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- ── Gespräch an der Aufgabe ──────────────────────────────────────────────

CREATE TABLE task_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users (id),
  author_guest text,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_author_is_one_kind CHECK (
    (author_id IS NOT NULL AND author_guest IS NULL)
    OR (author_id IS NULL AND author_guest IS NOT NULL)
  )
);

-- ── Freigabe per Link ────────────────────────────────────────────────────

-- Zurückziehen ja, umstufen nein (Blatt 09): `list_level` ist unveränderlich,
-- durchgesetzt vom Trigger unten. Ein zweiter Ort für Rechte ist, wie zwei
-- Antworten auf eine Frage entstehen.
CREATE TABLE share_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  level        list_level NOT NULL,
  require_name boolean NOT NULL DEFAULT true,
  -- Pflicht, und höchstens ein Jahr: „ohne Ablauf" wird nicht angeboten
  -- (Abschnitt 10). Dieselbe Grenze wie beim Zurückstellen in SONE.
  expires_at   timestamptz NOT NULL,
  created_by   uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_write_at timestamptz,
  CONSTRAINT expiry_within_a_year
    CHECK (expires_at <= created_at + interval '1 year')
);

CREATE FUNCTION share_links_level_is_final() RETURNS trigger AS $$
BEGIN
  IF NEW.level <> OLD.level THEN
    RAISE EXCEPTION 'a share link cannot be re-levelled; revoke it and make a new one';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER share_links_no_relevel
  BEFORE UPDATE ON share_links
  FOR EACH ROW EXECUTE FUNCTION share_links_level_is_final();

-- ── Die Kopplung an SONE ─────────────────────────────────────────────────

-- Zwei Zustände (Blatt 15): der Workspace ist gekoppelt, **und** ich persönlich
-- bin verbunden. Zwei Tabellen, damit keine Abfrage den einen Zustand für den
-- anderen nehmen kann.
--
-- Eins zu eins (Abschnitt 10): ein SONE-Workspace zu genau einem Projekt.
-- Beide UNIQUE-Bedingungen halten das — sobald eine Seite in ein Projekt
-- schreiben könnte, das die Kopplung nicht nennt, ist die Rechteaussage nicht
-- mehr wahr.
CREATE TABLE sone_couplings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  sone_base_url      text NOT NULL,
  sone_workspace_id  uuid NOT NULL,
  -- Der Satz, der bestätigt wurde, im Wortlaut. Nicht abgeleitet, sondern
  -- erklärt — und nachlesbar, wer wann was zugesagt hat.
  consent_text       text NOT NULL,
  consented_by       uuid NOT NULL REFERENCES users (id),
  consented_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sone_base_url, sone_workspace_id)
);

CREATE TABLE sone_identities (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  base_url    text NOT NULL,
  sone_user   uuid NOT NULL,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, base_url)
);

-- Der Rückverweis an der Aufgabe: gespeicherte URL **und** Titel, damit er
-- auch funktioniert, wenn SONE nicht erreichbar ist (Abschnitt 8).
CREATE TABLE task_origins (
  task_id     uuid PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  url         text NOT NULL,
  page_title  text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now()
);
