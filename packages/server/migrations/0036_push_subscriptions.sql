-- SOTE 0036 — echte Benachrichtigungen auf dem Gerät.
--
-- Gewünscht: „Jetzt fehlt eigentlich nur noch echte Benachrichtigungen. Also
-- wenn ich als App installiere, dass es richtige App-Benachrichtigungen
-- sendet."
--
-- ## Was hier gespeichert wird
--
-- Ein Web-Push-Abonnement ist das, was der Browser ausstellt, wenn jemand
-- Benachrichtigungen erlaubt: eine Adresse beim Dienst des Herstellers
-- (`endpoint`) und zwei Schlüssel, mit denen man für genau dieses Gerät
-- verschlüsselt. Der Server kann damit eine Meldung schicken, ohne dass die
-- Seite offen ist — das ist der ganze Unterschied zur Klingel (`nudge`), die
-- nur läuft, solange jemand hinsieht.
--
-- ## JE GERÄT, nicht je Konto
--
-- Wer am Telefon und am Rechner installiert, hat zwei Abonnements und will auf
-- beiden eine Meldung. Der `endpoint` ist der Schlüssel dafür: er ist je Gerät
-- und Browser verschieden, und er ist es auch, den der Dienst zurückmeldet,
-- wenn ein Gerät nicht mehr da ist.
--
-- ## `ON DELETE CASCADE` am Konto
--
-- Ein gelöschtes Konto darf keine Meldungen mehr bekommen. Das ist keine
-- Aufräumarbeit, sondern der Unterschied zwischen „abgemeldet" und „bekommt
-- weiter Post".

-- ## Und der Schlüssel dieser Instanz
--
-- `push_keys` hält EIN Paar. Es weist die Instanz beim Zustelldienst des
-- Herstellers aus (VAPID) und darf sich NIE ändern: mit einem neuen Schlüssel
-- sind alle Abonnements ungültig, und niemand merkt es — ausser dass keine
-- Meldung mehr ankommt.
--
-- In der DATENBANK und nicht in einer Umgebungsvariablen, und das ist eine
-- Entscheidung: eine Variable, die jemand beim Umzug vergisst, richtet genau
-- diesen Schaden an. In der Datenbank zieht der Schlüssel mit den Daten um, zu
-- denen er gehört.

CREATE TABLE IF NOT EXISTS push_keys (
  -- Genau eine Zeile: die Bedingung macht eine zweite unmöglich.
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key  text NOT NULL,
  private_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE push_keys IS
  'Das VAPID-Schluesselpaar dieser Instanz, genau eine Zeile. Es darf sich nie '
  'aendern: mit einem neuen Schluessel sind alle Abonnements ungueltig, ohne '
  'dass jemand es merkt.';

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  -- Woher es kam, für die Liste im Konto: „iPhone" sagt mehr als eine Adresse
  -- mit 200 Zeichen.
  says        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Wann zuletzt erfolgreich zugestellt wurde. Ein Abonnement, das ein Jahr
  -- lang nichts angenommen hat, ist ein Geraet, das es nicht mehr gibt.
  last_ok_at  timestamptz,
  /*
   * Fehlversuche in Folge.
   *
   * Ein Dienst antwortet 404 oder 410, wenn ein Abonnement erloschen ist (App
   * gelöscht, Erlaubnis entzogen) — dann wird die Zeile sofort weggeräumt. Auf
   * alles andere (Netz weg, Dienst überlastet) mit Löschen zu antworten hiesse,
   * ein gültiges Gerät wegen einer schlechten Minute abzumelden.
   */
  failures    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id);

COMMENT ON TABLE push_subscriptions IS
  'Web-Push-Abonnements, je GERAET eines. Der Server kann damit melden, ohne '
  'dass die Seite offen ist -- der Unterschied zur Klingel in nudge.ts, die '
  'nur laeuft, solange jemand hinsieht.';
