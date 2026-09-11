-- SOTE 0026 — die Kalender-Ausgabe.
--
-- Ein Abonnement-Link je Person und Arbeitsbereich: die Aufgaben mit Datum als
-- iCalendar, damit sie im Kalenderprogramm neben allem anderen stehen.
--
-- ## Ein Feed und keine Datei
--
-- Eine Datei zum Herunterladen wäre harmlos und tot: einmal geladen, nie
-- wieder richtig. Ein Kalender, der nicht nachzieht, ist schlimmer als keiner
-- — er zeigt mit Überzeugung den Stand von letzter Woche.
--
-- Der Preis ist ein Link, der ohne Anmeldung gilt, also ein Passwort-Ersatz.
-- Darum steht er in einer eigenen Tabelle und ist WIDERRUFBAR: wer ihn
-- verloren glaubt, macht einen neuen, und der alte ist sofort tot.
--
-- ## Derselbe Umgang mit dem Geheimnis wie bei den Freigaben
--
-- `token_hash` zum Nachschlagen, `token_enc` zum Wiederzeigen — die Abwägung
-- steht in `shares.ts` und gilt hier wörtlich: gehasht allein könnte man den
-- Link nie wieder anzeigen, im Klartext läge er in jeder Sicherung. Der
-- Schlüssel kommt aus der Umgebung (`SOTE_SHARE_KEY`), nicht aus dieser
-- Datenbank, sonst wäre die Verschlüsselung Theater.
--
-- ## Einer je Person und Bereich, nicht viele
--
-- `UNIQUE (workspace_id, user_id)` über die nicht widerrufenen: zwei gültige
-- Links wären zwei Dinge zu widerrufen, und wer nur eines widerruft, glaubt
-- sich sicher. Ein neuer ersetzt den alten — das ist auch, was „neu machen"
-- bedeutet.

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Zum Nachschlagen: sha256 des Tokens, hex.
  token_hash text NOT NULL,
  -- Zum Wiederzeigen: mit dem Instanzschlüssel versiegelt.
  token_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Wann zuletzt abgeholt. Die einzige Auskunft darüber, ob das Abonnement
  -- lebt — ohne sie sieht ein vergessener Link aus wie ein benutzter.
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Nachschlagen geschieht bei JEDEM Abholen, und Kalender fragen oft.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_feeds_by_hash
  ON calendar_feeds (token_hash);

-- Höchstens ein gültiger je Person und Bereich. Als teilweiser Index, damit
-- widerrufene stehen bleiben dürfen: sie sind die Antwort auf „hat den jemand
-- noch benutzt, nachdem ich ihn abgeschaltet habe".
CREATE UNIQUE INDEX IF NOT EXISTS calendar_feeds_one_live
  ON calendar_feeds (workspace_id, user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE calendar_feeds IS
  'Abonnement-Links auf die Kalender-Ausgabe. Ein Link gilt ohne Anmeldung, '
  'ist also ein Passwort-Ersatz — darum widerrufbar und je Person und '
  'Arbeitsbereich nur einer gültig.';
