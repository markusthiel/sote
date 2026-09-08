-- SOTE 0021 — Profilbilder.
--
-- ## Verkleinert im Browser, und das Original wird NICHT behalten
--
-- SONEs ADR-0029, und für Profilbilder gilt dort die Abweichung, die hier die
-- ganze Regel ist: ein Profilbild wird 22 Pixel breit gezeichnet. Ein
-- Handyfoto mit viertausend Pixeln aufzubewahren, damit es nie in dieser Größe
-- gebraucht wird, ist Speicher für einen Fall, der nicht vorkommt — und ein
-- Bild, das man nicht mehr herunterladen kann, ist eines, das niemand
-- vermisst.
--
-- Verkleinert wird im **Browser**: serverseitig hieße eine Bildbibliothek im
-- Container, mit eigenen Sicherheitsausgaben und einem Bau, der sich je
-- Architektur unterscheidet — für Arbeit, die die hochladende Maschine hinter
-- einem Fortschrittsbalken tun kann, den sowieso jemand ansieht. Und das Netz
-- trägt die große Datei einmal statt zweimal.
--
-- ## In der Datenbank und nicht im Dateisystem
--
-- Ein Bild je Konto, ein halbes Dutzend Konten, wenige zehn Kilobyte je Bild.
-- Ein Volume dafür wäre ein zweiter Ort, den die Sicherung kennen muss — und
-- genau daran ist SONEs ADR-0107 aufgelaufen: ein Backend, das dastand,
-- nichts umsetzte, und die Sicherung übersprang das lokale Volume.
--
-- Die Grenze ist benannt: bei Anhängen an Aufgaben (Blatt 17) gilt das nicht
-- mehr, denn dort geht es um Megabyte je Zeile. Dann kommt ein Volume, und
-- dieser Kommentar ist die Stelle, an der die Entscheidung neu ansteht.

CREATE TABLE IF NOT EXISTS user_avatars (
  -- Eines je Konto: der Primärschlüssel sagt es, statt es zu prüfen.
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,

  -- Was drin ist, damit der Server es beim Ausliefern nicht raten muss.
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes        bytea NOT NULL,

  -- Für den ETag: ein Bild ändert sich selten, und ein Browser soll es nicht
  -- bei jedem Zeichnen neu holen.
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Ein Deckel in der Datenbank und nicht nur im Server.
  --
  -- 512 Pixel als JPEG sind etwa 60 KB; eine Viertelmegabyte ist reichlich Luft
  -- und schließt trotzdem aus, dass jemand das Feld als Ablage benutzt. Die
  -- Regel steht hier, weil sie auch für ein Skript gilt, das die Route nicht
  -- benutzt.
  CONSTRAINT avatar_stays_small CHECK (octet_length(bytes) <= 262144)
);

COMMENT ON TABLE user_avatars IS
  'Profilbilder, im Browser auf 512px verkleinert. Kein Original: ein '
  'Profilbild wird 22 Pixel breit gezeichnet (ADR-0029).';
