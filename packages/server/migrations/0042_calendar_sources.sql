-- SOTE 0042 — fremde Kalender, lesend: die QUELLEN.
--
-- `calendar_feeds` (0026) gibt es schon — das sind die Links, über die ein
-- Kalenderprogramm SOTE liest, die Richtung hinaus. Hier ist die Richtung
-- herein, und darum ein anderes Wort: eine Quelle ist ein Kalender, aus dem
-- SOTE liest.
--
-- Der zweite Schritt des Kalender-Fahrplans: der eigene Kalender (0041 und die
-- Ansicht davor) zeigt Aufgaben; jetzt legt sich daneben, was in Outlook,
-- Google oder iCloud steht — damit man beim Planen sieht, wo der Tag schon
-- voll ist. Nur lesend: Termine werden nicht angefasst, und Aufgaben werden
-- (noch) nicht hinübergeschoben. Das ist Schritt 3.
--
-- Der Weg ist die ICS-Adresse, die jeder dieser Dienste hergibt („Kalender
-- veröffentlichen", „geheime Adresse im iCal-Format"). Kein OAuth, keine
-- App-Registrierung — eine Adresse, die der Server regelmässig liest.
--
-- ## Die Adresse ist ein Geheimnis
--
-- Eine ICS-Adresse von Google oder Microsoft ist ein Fähigkeitslink: wer sie
-- hat, liest den Kalender. Sie liegt darum VERSIEGELT (`url_sealed`, wie der
-- Freigabeschlüssel in `shares`) — ein Datenbankabzug allein reicht nicht,
-- um fremde Kalender zu lesen. Wer die Adresse zeigen will, braucht den
-- Schlüssel des Servers, und die Oberfläche zeigt sie ohnehin nur als
-- „gesetzt".
--
-- ## Die Termine liegen ausgerollt da
--
-- Wiederholungen werden beim Abruf für ein festes Fenster (ein Monat zurück,
-- zwölf voraus) in einzelne Zeilen aufgelöst. Nicht beim Anzeigen: `/api/span`
-- soll eine Abfrage sein und kein RRULE-Rechner, und ein Fenster, das jeder
-- Abruf neu füllt, ist immer so aktuell wie der letzte Abruf. Ausnahmen
-- (`RECURRENCE-ID`) sind eigene Zeilen mit eigener Kennung — darum ist der
-- Schlüssel (feed, uid, recurrence_id) und nicht (feed, uid).
--
-- ## Am Konto, nicht am Arbeitsbereich
--
-- Ein fremder Kalender gehört der PERSON — die Kollegin sieht meine Zahnarzt-
-- termine nicht, nur weil wir einen Arbeitsbereich teilen. Darum `user_id`
-- und kein `workspace_id`. WO er erscheint, sagt `shows_in`: NULL heisst in
-- jedem Arbeitsbereich, eine Liste heisst nur dort — der Arbeitskalender im
-- Bereich der Firma, der private im eigenen. Der Kalender in der Schiene
-- filtert nach Bereich, und ein Kalender folgt diesem Filter.
--
-- Schritt 3 (Aufgaben in den fremden Kalender schreiben) bekommt eigene
-- Spalten, wenn er kommt — eine Schreibadresse ist etwas anderes als eine
-- Leseadresse, und welche Aufgaben hinübergehen, ist eine Regel je Bereich.

CREATE TABLE calendar_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url_sealed  text NOT NULL,
  color       text,
  -- NULL: in jedem Arbeitsbereich; sonst nur in den genannten.
  shows_in    uuid[],
  -- Was der letzte Abruf ergab: Zeitpunkt, Fehlertext (oder NULL) und der
  -- Wert, den der Dienst als ETag gab — damit ein unveränderter Kalender
  -- nicht jede Stunde neu heruntergeladen wird.
  fetched_at  timestamptz,
  last_error  text,
  etag        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_sources_user ON calendar_sources (user_id);

CREATE TABLE calendar_source_events (
  feed_id        uuid NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  uid            text NOT NULL,
  -- '' für den Stammtermin und jedes regelmässige Vorkommen; die
  -- Vorkommens-Kennung als ISO-Zeitpunkt, wo der Kalender eine Ausnahme nennt.
  recurrence_id  text NOT NULL DEFAULT '',
  title          text NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  all_day        boolean NOT NULL DEFAULT false,
  location       text,
  PRIMARY KEY (feed_id, uid, recurrence_id, starts_at)
);

CREATE INDEX calendar_source_events_span ON calendar_source_events (feed_id, starts_at, ends_at);
