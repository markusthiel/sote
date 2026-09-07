-- SOTE 0008 — Einstellungen auf drei Ebenen.
--
-- Gemeldet: „Man kann auch viel konfigurieren pro Instanz, pro workplace und
-- pro user." SOTE hatte bis hier GAR KEINE Einstellungen — keine Tabelle, keinen
-- Bildschirm, und Hell/Dunkel folgte allein dem Gerät.
--
-- ## Eine Tabelle für drei Ebenen und nicht drei Tabellen
--
-- Die drei unterscheiden sich in genau einem Punkt: WESSEN Einstellung es ist.
-- Drei Tabellen wären dreimal dasselbe Schema und drei Stellen, an denen ein
-- neues Feld nachzuziehen wäre — und die Auflösung („Person, dann
-- Arbeitsbereich über Instanz") müsste dreimal woanders nachsehen.
--
-- `scope_id` ist NULL für die Instanz: es gibt nur eine. Der Primärschlüssel
-- benutzt darum COALESCE über eine Nullgruppe, sonst ließe Postgres zwei
-- Instanzzeilen zu — NULL ist nicht gleich NULL.
--
-- ## jsonb und keine Spalten
--
-- Eine Einstellung ist selten und wird gelesen, nicht gefiltert. Eine Spalte
-- pro Einstellung wäre eine Migration pro Einstellung; ein Dokument ist eine.
-- Gültig ist, was der Kern liest (`readSettings`) — was er nicht kennt, bleibt
-- unangetastet stehen, damit eine ältere Fassung die Werte einer neueren nicht
-- wegwirft.

CREATE TABLE IF NOT EXISTS settings (
  scope text NOT NULL CHECK (scope IN ('instance', 'workspace', 'user')),
  scope_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Genau eine Zeile je Ebene und Gegenstand.
  CONSTRAINT settings_one_per_scope
    UNIQUE NULLS NOT DISTINCT (scope, scope_id),

  -- Die Instanz hat kein Gegenüber, alles andere schon. Ohne diese Prüfung
  -- wäre eine Arbeitsbereichszeile ohne Arbeitsbereich möglich, und die fände
  -- niemand wieder.
  CONSTRAINT settings_scope_id_matches CHECK (
    (scope = 'instance' AND scope_id IS NULL)
    OR (scope <> 'instance' AND scope_id IS NOT NULL)
  )
);

COMMENT ON TABLE settings IS
  'Einstellungen auf drei Ebenen. Aufgelöst wird Person, dann Arbeitsbereich '
  'über Instanz, dann das Gerät — dieselbe Reihenfolge wie SONEs ADR-0124.';

COMMENT ON COLUMN settings.data IS
  'Was der Kern liest, bleibt gültig; was er nicht kennt, bleibt stehen. Eine '
  'ältere Fassung darf die Werte einer neueren nicht wegwerfen.';

-- Geht eine Person oder ein Arbeitsbereich, gehen ihre Einstellungen mit.
--
-- Kein FOREIGN KEY, weil `scope_id` je nach Ebene auf zwei verschiedene
-- Tabellen zeigt. Also zwei Trigger — oder, einfacher und ohne stille
-- Verwaisung: aufgeräumt wird beim Löschen dort, wo gelöscht wird.
CREATE INDEX IF NOT EXISTS settings_scope_id ON settings (scope_id)
  WHERE scope_id IS NOT NULL;
