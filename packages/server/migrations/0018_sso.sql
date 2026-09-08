-- SOTE 0018 — Single-Sign-on über OIDC.
--
-- ## SSO meldet an, es lädt nicht ein
--
-- Der Grundsatz, der in diesem Projekt schon gilt (SONEs ADR-0073): **die
-- Instanz lädt ein.** Ein SSO, das Konten von selbst anlegt, bricht das —
-- dann bekommt jeder ein Konto, der im Verzeichnis des Anbieters steht, und
-- die Instanz hat aufgehört zu entscheiden, wer hier existiert.
--
-- Also: SSO meldet an, wer schon ein Konto hat, und eine **Einladung** lässt
-- sich mit SSO annehmen. Wer nichts von beidem hat, bekommt einen Satz, der
-- sagt, was fehlt — und nicht ein Konto.
--
-- **Benannt statt versteckt:** in einer Firma, in der das Verzeichnis des
-- Anbieters ohnehin die Wahrheit über die Belegschaft ist, ist die andere
-- Entscheidung die richtige. Dann wird hier eine Einstellung nötig, und dieser
-- Kommentar ist die Stelle, an der sie beginnt.
--
-- ## Warum die Verknüpfung am Subjekt hängt und nicht an der Adresse
--
-- Eine Adresse wechselt (Heirat, Namensänderung, Firmenübernahme), das Subjekt
-- des Anbieters nicht. Wer über die Adresse verknüpft, verliert bei einem
-- Wechsel den Zugang — oder, schlimmer, gibt ihn an den Nächsten weiter, der
-- die freigewordene Adresse bekommt.
--
-- Beim **ersten** Anmelden gibt es noch kein Subjekt, also wird dann über die
-- Adresse gefunden und das Subjekt gemerkt. Genau einmal, und danach nie wieder.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sso_subject text UNIQUE;

COMMENT ON COLUMN users.sso_subject IS
  'Das Subjekt beim Anbieter (sub). Beim ersten Anmelden ueber die Adresse '
  'gefunden und dann gemerkt -- eine Adresse wechselt, ein Subjekt nicht.';

-- Der Zwischenzustand einer Anmeldung.
--
-- Er MUSS auf dem Server liegen und nicht im Browser: `state` schützt gegen
-- eine untergeschobene Antwort, und ein `state`, den der Browser selbst
-- mitbringt, schützt gegen nichts. Der `code_verifier` (PKCE) ebenso — er ist
-- das Geheimnis, das beweist, dass dieselbe Sitzung den Code eingelöst hat,
-- die ihn angefordert hat.
CREATE TABLE IF NOT EXISTS sso_flows (
  state          text PRIMARY KEY,
  code_verifier  text NOT NULL,
  -- Wohin danach. Nur ein PFAD, keine URL: eine URL aus der Anfrage wäre eine
  -- offene Weiterleitung — wer sie setzt, schickt jemanden nach dem Anmelden
  -- auf eine fremde Seite, die aussieht wie diese.
  next_path      text,
  -- Eine Einladung, falls das Anmelden eine annimmt.
  invitation_id  uuid REFERENCES invitations (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sso_flows_stale ON sso_flows (expires_at);
