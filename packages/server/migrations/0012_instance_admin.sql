-- SOTE 0012 — der Instanzadministrator.
--
-- Die Lücke, die in `settings.ts` seit ihrer Entstehung als Kommentar stand:
--
-- > Die **Instanz**: nur wer den Arbeitsbereich besitzt, in dem er gerade ist —
-- > SOTE hat noch keinen Instanzadministrator. **Das ist zu grob**, und es
-- > steht hier statt in einem Bugtracker: sobald es Rollen über
-- > Arbeitsbereiche hinweg gibt, gehört diese Prüfung dorthin.
--
-- Jetzt gibt es sie. Das Recht ist eine **Spalte am Konto** und keine Rolle in
-- einer Tabelle: es gilt über alle Arbeitsbereiche hinweg, hat keine Stufen und
-- gehört keinem Arbeitsbereich — dieselbe Bauart wie
-- `workspace_members.is_owner`, aus demselben Grund (SONEs ADR-0102:
-- Eigentümerschaft ist eine Spalte, kein Recht).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_admin IS
  'Darf die Instanz verwalten: Konten sehen, Administratoren bestimmen, '
  'Instanzeinstellungen aendern. Ueber alle Arbeitsbereiche hinweg.';

-- Wer die Instanz eingerichtet hat, verwaltet sie.
--
-- Das älteste Konto, und nur wenn es noch keinen Administrator gibt. Die
-- Alternative wäre, niemanden zu setzen — dann könnte nach dieser Migration
-- **niemand** die Instanz verwalten, und das ließe sich nur noch über die
-- Datenbank heilen. Eine Migration, die einen Server verwaist zurücklässt, ist
-- schlimmer als eine, die eine Annahme trifft und sie hinschreibt.
UPDATE users SET is_admin = true
 WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin);

CREATE INDEX IF NOT EXISTS users_admins ON users (is_admin) WHERE is_admin;
