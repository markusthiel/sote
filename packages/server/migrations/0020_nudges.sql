-- SOTE 0020 — die Türklingel.
--
-- Gemeldet: „Wenn ich per Link teile und dort arbeite klappt das zwar, wird
-- aber beim Hauptuser nicht live aktualisiert. Das war ja Thema."
--
-- Übernommen aus SONE (`claude/live-aktualisierung.md`, ADR-0093 bis ADR-0100).
-- Die Regeln dort sind teuer erarbeitet, und ich schreibe sie nicht neu:
--
-- ## Der Rahmen ist eine Türklingel, kein Brief
--
-- Die Nutzlast nennt einen **Scope** und sonst nichts — keine Zahl, keine Id,
-- keinen Auszug. Drei Gründe, in der Reihenfolge ihrer Wichtigkeit:
--
-- 1. Eine NOTIFY-Nutzlast erreicht **jede** lauschende Instanz, und der Anstoß
--    geht an jeden mit dem Arbeitsbereich offen. Was jemand sehen darf,
--    entscheidet die Route, die die Liste liefert — genau eine Stelle.
-- 2. Eine Zahl auf der Leitung wäre eine zweite Antwort auf die Frage, die die
--    Liste schon beantwortet. Genau so wurden in SONE Abzeichen und Liste
--    uneins (ADR-0092).
-- 3. Bei Löschen ließe sich gar nicht sagen, wen es angeht: die Zeile ist weg.
--
-- ## Die Spaltenliste ist das Design
--
-- Ein Trigger auf jedes Update verwandelt das Tippen einer Person in mehrere
-- volle Listen-Abrufe pro Sekunde für alle anderen — ein Push, der schlechter
-- ist als das Polling, das er ersetzt. Die Update-Trigger vergleichen darum
-- vorher/nachher über **genau die Spalten, die die betroffene Liste zeichnet**.
--
-- `updated_at` steht in keiner: es ändert sich bei jedem Schreiben und sagt
-- nichts darüber, dass eine Liste anders aussieht.
--
-- ## Statement-level über Transition Tables, immer
--
-- Ein Import schreibt viele Zeilen in einem Statement. Ein NOTIFY pro Zeile
-- wäre ein voller Listen-Abruf pro Zeile für alle. Und drei
-- Postgres-Grenzen, die SONE schon aufgelaufen ist:
--
-- * Keine Spaltenliste neben Transition Tables (`AFTER UPDATE OF x` geht
--   nicht) — deshalb wird verglichen, was strenger ausfällt.
-- * Kein Trigger mit mehreren Ereignissen neben Transition Tables — deshalb je
--   ein Trigger pro Ereignis.
-- * Ein Statement, das nichts trifft, sendet nichts. Richtig, und beim
--   Debuggen von einem fehlenden Trigger nicht zu unterscheiden.

-- Der Kanal. Einer, nach Arbeitsbereich adressiert.
--
-- `pg_notify` und nicht `NOTIFY`: der Kanalname ist fest, aber die Nutzlast
-- wird gebaut, und `NOTIFY` nimmt keine Ausdrücke.
CREATE OR REPLACE FUNCTION notify_workspace(ws uuid, scope text) RETURNS void AS $$
BEGIN
  IF ws IS NOT NULL THEN
    PERFORM pg_notify('sote_workspace_changed', ws::text || ':' || scope);
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_workspace IS
  'Die Tuerklingel: Arbeitsbereich und Scope, sonst nichts. Was jemand sehen '
  'darf, entscheidet die Route, die die Liste liefert.';

-- ── Aufgaben ───────────────────────────────────────────────────────────────
--
-- Welche Spalten die Listen zeichnen: Titel, Ort, Termin, Frist, Priorität,
-- Reihenfolge, abgehakt, weggeworfen. Die Notiz **nicht** — sie steht nur in
-- der Detailspalte, und die hat die Aufgabe schon offen.
CREATE OR REPLACE FUNCTION notify_tasks_ins() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM new_rows LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_tasks_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.workspace_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.title, n.project_id, n.parent_id, n.planned_at, n.due_at,
            n.priority, n.sort_key, n.completed_at, n.trashed_at)
        IS DISTINCT FROM
           (o.title, o.project_id, o.parent_id, o.planned_at, o.due_at,
            o.priority, o.sort_key, o.completed_at, o.trashed_at)
  LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_tasks_del() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM old_rows LOOP
    PERFORM notify_workspace(ws, 'tasks');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_tasks_ins_trg ON tasks;
CREATE TRIGGER notify_tasks_ins_trg AFTER INSERT ON tasks
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_tasks_ins();

DROP TRIGGER IF EXISTS notify_tasks_upd_trg ON tasks;
CREATE TRIGGER notify_tasks_upd_trg AFTER UPDATE ON tasks
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_tasks_upd();

DROP TRIGGER IF EXISTS notify_tasks_del_trg ON tasks;
CREATE TRIGGER notify_tasks_del_trg AFTER DELETE ON tasks
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_tasks_del();

-- ── Projekte ───────────────────────────────────────────────────────────────
--
-- Der Baum zeichnet Name, Ort, Art, Zeichen, Farbe, Reihenfolge und
-- Papierkorb. Ein Scope `projects`, damit ein Umbenennen im Baum nicht die
-- Aufgabenliste neu holt.
CREATE OR REPLACE FUNCTION notify_projects_ins() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM new_rows LOOP
    PERFORM notify_workspace(ws, 'projects');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_projects_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.workspace_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.name, n.parent_id, n.kind, n.icon, n.color, n.sort_key, n.trashed_at)
        IS DISTINCT FROM
           (o.name, o.parent_id, o.kind, o.icon, o.color, o.sort_key, o.trashed_at)
  LOOP
    PERFORM notify_workspace(ws, 'projects');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_projects_del() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM old_rows LOOP
    PERFORM notify_workspace(ws, 'projects');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_projects_ins_trg ON projects;
CREATE TRIGGER notify_projects_ins_trg AFTER INSERT ON projects
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_projects_ins();

DROP TRIGGER IF EXISTS notify_projects_upd_trg ON projects;
CREATE TRIGGER notify_projects_upd_trg AFTER UPDATE ON projects
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_projects_upd();

DROP TRIGGER IF EXISTS notify_projects_del_trg ON projects;
CREATE TRIGGER notify_projects_del_trg AFTER DELETE ON projects
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_projects_del();

-- ── Freigaben ──────────────────────────────────────────────────────────────
--
-- Der Freigaben-Bildschirm zeichnet Recht, Ablauf, Widerruf und „zuletzt
-- benutzt". Das Letzte **nicht**: es ändert sich bei jedem Aufruf eines Gasts,
-- und dann läutet das Arbeiten eines Gasts die Liste des Eigentümers im
-- Sekundentakt.
CREATE OR REPLACE FUNCTION notify_shares_ins() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM new_rows LOOP
    PERFORM notify_workspace(ws, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_shares_upd() RETURNS trigger AS $$
DECLARE ws uuid;
BEGIN
  FOR ws IN
    SELECT DISTINCT n.workspace_id
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE (n.right_level, n.expires_at, n.revoked_at)
        IS DISTINCT FROM (o.right_level, o.expires_at, o.revoked_at)
  LOOP
    PERFORM notify_workspace(ws, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_shares_ins_trg ON shares;
CREATE TRIGGER notify_shares_ins_trg AFTER INSERT ON shares
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_ins();

DROP TRIGGER IF EXISTS notify_shares_upd_trg ON shares;
CREATE TRIGGER notify_shares_upd_trg AFTER UPDATE ON shares
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_upd();
