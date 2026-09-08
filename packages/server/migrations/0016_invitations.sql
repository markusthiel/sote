-- SOTE 0016 — Einladungen: die Instanz lädt ein.
--
-- SONEs ADR-0073: **ein Arbeitsbereich gibt Zugang, die Instanz lädt ein.** Wer
-- schon ein Konto hat, wird unter „Leute" hinzugefügt; wer noch keines hat,
-- braucht eines, und darüber entscheidet die Instanz.
--
-- Darum hängt eine Einladung an **keinem** Arbeitsbereich: sie erzeugt ein
-- Konto. Was danach damit passiert, ist die andere Frage.

CREATE TABLE IF NOT EXISTS invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- An wen. Eine Einladung ohne Adresse wäre ein Link, der jedem ein Konto
  -- gibt, der ihn hat — das ist keine Einladung, das ist eine offene Tür.
  email        text NOT NULL,

  -- Nachgeschlagen wird über den Hash, angezeigt über die verschlüsselte
  -- Fassung — dieselbe Bauart wie bei Freigaben, aus demselben Grund
  -- (ADR-0113: der Link behält den Link).
  token_hash   text NOT NULL UNIQUE,
  token_enc    text NOT NULL,

  -- Eine Einladung läuft ab, und zwar von sich aus. Anders als bei Freigaben
  -- ist das hier PFLICHT: eine Freigabe ist ein Arbeitsmittel, das man
  -- absichtlich lange offen lässt, eine Einladung ist ein einmaliger Vorgang.
  -- Eine, die drei Jahre gilt, ist ein vergessenes Konto in Wartestellung.
  expires_at   timestamptz NOT NULL,

  invited_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Wann sie eingelöst wurde, und von wem. Beides bleibt stehen: „wer ist
  -- dieses Konto und wie kam es hierher" ist eine Frage, die man später stellt.
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users (id),

  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS invitations_open
  ON invitations (created_at DESC) WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE invitations IS
  'Die Instanz laedt ein (ADR-0073). Eine Einladung erzeugt ein KONTO und '
  'haengt an keinem Arbeitsbereich.';
