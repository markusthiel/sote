# CalDAV-Schreibanbindung

Stand: 13.09.2026. Implementierung für main; noch nicht mit einem echten Kalenderkonto geprüft.

## Einrichtung

Unter **Kalender einbinden** eine ICS-Lesequelle öffnen und **Aufgaben in diesen Kalender schreiben** ausklappen. Die vollständige HTTPS-CalDAV-Adresse des Kalenderordners (mit abschließendem `/`), Benutzername und App-Kennwort eintragen. Die ICS-Adresse und die CalDAV-Adresse sind unterschiedliche Zugänge; beide müssen auf denselben Kalender zeigen, damit geschriebene Termine wieder eingelesen werden.

Arbeitsbereiche, geplante Aufgaben/Fristen/beides und die Zeitzone für ganztägige Aufgaben auswählen. Automatisches Schreiben ausdrücklich einschalten und **Zugang prüfen und speichern** wählen. Leere Zugangsfelder behalten später die verschlüsselt gespeicherten Werte bei. Unterstützt sind direkte CalDAV-Kalenderadressen mit Basic-Authentifizierung über HTTPS sowie die automatische Kalenderermittlung für iCloud; OAuth ist nicht enthalten.

### iCloud

Öffentliche `webcal://…/published/…`-Adressen sind ausschließlich Lesezugänge. Auch ein Wechsel zu `https://` macht daraus keinen Schreibzugang ([Apple: öffentliche Kalender sind schreibgeschützt](https://support.apple.com/en-au/guide/iphone/iph7613c4fb/ios)).

Für die Schreibanbindung die E-Mail-Adresse des Apple Accounts als Benutzername und ein [App-spezifisches Passwort](https://support.apple.com/de-de/102654) eintragen. **iCloud-Kalender suchen** funktioniert ohne vorab eingetragene Kalenderadresse. Anschließend den passenden **iCloud-Zielkalender** auswählen; SOTE übernimmt die private CalDAV-Adresse in das Formular. Suche und Auswahl speichern noch keine Verbindung und schreiben keine Termine. Erst **Zugang prüfen und speichern** übernimmt die Einstellungen.

Die Suche beginnt bei `https://caldav.icloud.com/`, ermittelt Principal und Kalenderordner und fragt deren Kalender ab ([CalDAV-Client-Dokumentation](https://caldav.readthedocs.io/stable/about.html)). Alle Hrefs und Weiterleitungen werden auf HTTPS, Standardport und die Hosts `caldav.icloud.com` beziehungsweise `p<Nummer>-caldav.icloud.com` begrenzt. Es werden keine Zugangsdaten an andere Dienste weitergereicht. Die Anmeldung wird nur für die Suche verwendet; erst das Speichern versiegelt sie in der Datenbank.

Nach einer gemeldeten HTTP-404-Antwort bei der Suche: Liefert der Einstieg 404 oder 405, fragt SOTE einmal `/.well-known/caldav` gemäß [RFC 6764](https://www.rfc-editor.org/rfc/rfc6764.html#section-5) ab. Anmeldung, Kalenderordner und Kalenderliste werden in HTTP-Fehlern getrennt benannt; nur der Servername, keine Kontopfade oder Zugangsdaten, erscheint dabei. Ein Fehler an einem späteren Abruf wird nicht durch einen neuen Anmeldeversuch verdeckt. Der genaue Auslöser der gemeldeten 404 ist noch nicht bestätigt und muss mit der präziseren Meldung eingegrenzt werden.

## Verhalten

- Offene Aufgaben werden etwa jede Minute als einzelne VEVENT-Ressourcen übertragen: Titel, Beschreibung, Zeitpunkt, Dauer und Aufgabenlink. Plan und Frist können getrennte Termine ergeben.
- Erledigte, gelöschte und nicht mehr ausgewählte Aufgaben werden aus dem Zielkalender entfernt. SOTE bearbeitet nur seine selbst angelegten Ressourcen.
- Stabile UIDs und gespeicherte ETags verhindern Duplikate und unbemerkte Überschreibungen. Fremde Änderungen werden beim nächsten betroffenen Schreib- oder Löschversuch als Konflikt gemeldet; unveränderte Aufgaben werden nicht laufend vom Zielserver abgefragt.
- Ein Konflikt kann ausdrücklich mit dem aktuellen SOTE-Stand aufgelöst werden. Die Oberfläche fragt vorher nach. Änderungen im Zielkalender werden nicht in Aufgaben übernommen.
- Pausieren lässt vorhandene Termine stehen. Trennen oder Entfernen der Quelle beendet die Pflege und lässt ebenfalls die Kalenderkopien stehen. Eine spätere neue Verbindung erzeugt neue Kopien.
- Pro Verbindung sind höchstens 1000 offene Aufgaben vorgesehen. Größere Abgleiche laufen in Abschnitten mit bis zu 20 Änderungen und werden fortgesetzt.

## Betrieb und Implementierung

Der Server führt Migration `0043_calendar_writers.sql` beim Start automatisch aus. `SOTE_SHARE_KEY` muss wie für die Lesequellen gesetzt sein; er verschlüsselt auch die Schreibzugänge. Der bestehende Job-Läufer übernimmt `calendars.tick` und `calendars.write`. Es ist kein weiterer Dienst notwendig.

`caldav.ts` prüft das Ziel mit PROPFIND, verlangt HTTPS und öffentliche DNS-Ziele, bindet die Verbindung an eine geprüfte IP und folgt keinen Weiterleitungen mit Zugangsdaten. Fehler enthalten weder Kennwörter noch fremde Antworttexte. `calendarWriters.ts` prüft Quellenbesitz und Leserechte der Arbeitsbereiche. Datenbank-Sperren koordinieren Abgleich, Konfigurationswechsel und Entfernen.

Die Lesequelle unterdrückt zurückgelesene eigene Plantermine, wenn dieselbe Aufgabe bereits im lokalen Kalender dargestellt wird. Externe Termine bleiben schreibgeschützt.

## Prüfung

18 neue CalDAV-Tests bestehen: Protokollprüfung, Zugriffsrechte, verschlüsselte Zugangsdaten, Anlegen/Ändern/Löschen, Konflikte samt Freigabe, Abbrüche nach PUT, Wiederholung, gleichzeitige Aufrufe, Stapelverarbeitung und Vermeidung doppelter Anzeige. Datenbanktests verwenden eine isolierte echte PostgreSQL-Datenbank und einen simulierten DAV-Transport.

242 Core- und 90 Web-Tests bestehen. Einrichtung, Pausieren und Konfliktauflösung wurden zusätzlich mit den echten React-Komponenten und einer simulierten API im Browser geprüft. Im vollständigen Serverlauf scheiterten 14 bestehende Dateianhangtests an Windows-Pfadprüfungen; ein weiterer bestehender Datumstest besteht mit `TZ=UTC` wie in CI. Ein Test mit einem echten Anbieter steht noch aus.

Die iCloud-Erweiterung ergänzt sieben Tests für Kalenderermittlung, Rechtefilter, erfolgreiche Eigenschaften, erlaubte und gesperrte Weiterleitungen, ungültiges XML, Anmeldung und öffentliche Leselinks. Zusammen mit den acht CalDAV-Protokolltests bestehen alle 15 Tests. Suche, Auswahl, Übernahme der Schreibadresse und Speichern wurden im Browser mit einer simulierten iCloud-Antwort geprüft; ein echtes Apple-Konto wurde dafür nicht verwendet.

Drei weitere Tests prüfen den 404-Ausweichweg, Fehlermeldungen je Abrufschritt und den unveränderten Schutz von Zugangsdaten. Alle 18 Protokolltests sowie Server-Typprüfung und -Build bestehen.

### HTTP 404 beim ersten Schreiben

Nach erfolgreicher Suche und Einrichtung wurde HTTP 404 beim Schreiben gemeldet. Die bisherigen IDs kombinierten zwei UUIDs und überschritten 80 Zeichen. Ein anderer CalDAV-Client dokumentiert [iCloud-404-Antworten bei langen UIDs](https://github.com/cutzenfriend/cardAndCalSyncer#notes--limitations); das ist eine plausible Ursache, noch kein Nachweis am betroffenen Konto.

Neue Einträge erhalten deshalb eine stabile 32-stellige Kennung aus Verbindung, Aufgabe und Terminart. Bereits bestätigte Einträge behalten ihre ID. Ein alter iCloud-Erstversuch ohne gespeicherten ETag und ohne bestätigten Inhalt wird nur dann auf die kurze ID umgestellt, wenn GET am bisherigen Ressourcenpfad 404 liefert. Eine vorhandene Ressource bleibt unter ihrer alten ID. Die Zuordnung wird vor dem nächsten PUT gespeichert, sodass Wiederholungen keine zusätzlichen Kopien erzeugen.

Die Statusanzeige zählt nur bestätigte Kalenderkopien; eine vorgemerkte, aber abgelehnte Übertragung zählt nicht mehr als Erfolg. PUT-Fehler sind als „Termin schreiben (PUT)“ erkennbar. Nach dem Update genügt **Jetzt abgleichen** an der bestehenden Verbindung.

33 Protokoll- und PostgreSQL-Tests bestehen, einschließlich Reparatur einer alten ID, erneuter Abgleiche, anschließender Erledigung, Schutz bestehender Ressourcen und korrigierter Statuszählung. Server-Typprüfung und -Build bestehen. Der erneute Versuch mit einem eigenen iCloud-Kalender lieferte weiterhin PUT 404; die Verkürzung der UID hat den gemeldeten Fehler somit nicht behoben.

### Schreibdiagnose

Bei PUT 404 prüft SOTE denselben Kalenderordner noch einmal lesend mit PROPFIND. Die Fehlermeldung nennt den Zielserver, die tatsächlich verwendete UID-Länge, den Antworttyp (leer/XML/HTML/Text), bekannte DAV-Fehlercodes und das Ergebnis der Kalenderprüfung. So lassen sich ein nicht mehr erreichbarer Kalenderordner und eine Ablehnung ausschließlich beim Schreiben unterscheiden. Die Diagnose wiederholt keinen PUT, wechselt kein Ziel und zeigt weder Kontopfade noch Kennwörter oder beliebige Antworttexte an.

24 Protokolltests einschließlich drei neuer Diagnosetests bestehen. Die Diagnose ist eine Eingrenzung des weiterhin offenen Fehlers, keine bestätigte iCloud-Schreibkorrektur.
