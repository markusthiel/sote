-- SOTE 0013 — jedes Recht bewacht etwas.
--
-- SONEs ADR-0087 sagt den Satz, an dem sich diese Migration messen lässt:
--
-- > A settings screen offering a switch that gates nothing is worse than not
-- > offering it, because somebody will turn it off and believe something.
--
-- In SOTE war genau das der Zustand, und zwar in beiden Richtungen:
--
-- * `groups.manage` stand in den Daten und bewachte **nichts** — es gibt keine
--   Gruppen. Es kommt zurück, wenn sie kommen, im selben Commit wie die Wege,
--   die es prüfen.
-- * `workspace.settings` bewachte etwas, aber unter falschem Namen: geprüft
--   wurde `roles.manage`, und zwar für Einstellungen, Leute UND Rollen — drei
--   Dinge, von denen es nur eines heißt. Wer es vergab, vergab mehr als er las.
--
-- Die Umschreibung ist darum keine Umbenennung, sondern eine Berichtigung:
-- jede Rolle, die bisher Rollen verwalten durfte, durfte tatsächlich auch
-- Einstellungen und Leute. Sie behält beides, jetzt beim Namen genannt.

UPDATE roles
   SET rights = (
     SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(
       array_remove(rights, 'groups.manage')
       || CASE WHEN 'roles.manage' = ANY(rights)
               THEN ARRAY['people.manage', 'workspace.settings']
               ELSE ARRAY[]::text[] END
     ) AS r
   )
 WHERE 'groups.manage' = ANY(rights) OR 'roles.manage' = ANY(rights);

-- Und ein CHECK, damit kein unbekannter Name mehr hineinkommt.
--
-- Als Bedingung an der Tabelle und nicht als Prüfung im Code: die Liste ist
-- geschlossen (ADR-0087), und eine geschlossene Liste, die nur der
-- Anwendungscode kennt, ist beim nächsten Schreibweg offen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_rights_known'
  ) THEN
    ALTER TABLE roles ADD CONSTRAINT roles_rights_known CHECK (
      rights <@ ARRAY['people.manage', 'roles.manage', 'workspace.settings']::text[]
    );
  END IF;
END $$;
