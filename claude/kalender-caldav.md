# Kalenderverbindungen: Oberfläche, privates Lesen und Aufgabenübertragung

Stand: 13.09.2026. iCloud-Suche und erster vollständiger Schreibabgleich am echten Konto vom Nutzer bestätigt: sieben Kalenderkopien, zuletzt abgeglichen um 16:44:39 Uhr nach Update auf `5d78301`.

## Einrichtung

Unter **Kalenderverbindungen → Kalender hinzufügen** den Anbieter wählen. Die Übersicht zeigt je Verbindung Lesestatus, Aufgabenübertragung und sichtbare Arbeitsbereiche. **Einstellungen** öffnet Darstellung und Übertragungsregeln; Zugangsdaten und ausführliche Hinweise sind eingeklappt. Bestehende ICS- und Schreibverbindungen bleiben erhalten.

Die Anbieterauswahl kennzeichnet jede Verbindungsart mit **Nur Lesen** oder **Lesen und Schreiben**. Gefundene und verbundene Kalender zeigen ihre ermittelten Rechte; geteilte Kalender können eingeschränkt sein. Ohne eindeutige Rechteauskunft steht dort **Lesen · Schreibrechte ungeprüft**. Migration `0046_calendar_access.sql` speichert diese Auskunft, die beim Lesen erneut abgefragt wird. Ein ICS-Abo mit separat eingerichtetem Schreibzugang wird als Lesen und Schreiben angezeigt. **Aktiv**, **Pausiert** und **Nicht eingerichtet** beschreiben unabhängig davon die Aufgabenübertragung; Schreibrechte allein aktivieren sie nicht.

- **iCloud:** Apple Account und App-Passwort eingeben, Kalender suchen und auswählen. Neue Verbindungen lesen über den privaten CalDAV-Zugang; eine öffentliche Freigabe ist nicht nötig.
- **Nextcloud / anderer CalDAV-Anbieter:** öffentliche HTTPS-Serveradresse beziehungsweise CalDAV-Adresse, Benutzername und App-Passwort eingeben. Die Suche folgt Principal und Kalender-Heimat, unterstützt direkte Kalenderordner und zeigt auch Kalender mit reinen Leserechten an. Allgemeine Weiterleitungen und Hrefs müssen auf derselben Herkunft bleiben; bei einem Serverwechsel ist dessen endgültige Adresse einzugeben.
- **Google / Microsoft 365 / Outlook:** Kontoanmeldung mit Kalenderauswahl, Lesen und Aufgabenübertragung. Die einmalige App-Konfiguration ist in [kalender-oauth.md](kalender-oauth.md) beschrieben. ICS-Abos bleiben als Alternative verfügbar.
- **Kalenderlink:** HTTPS- oder webcal-Abo eines beliebigen unterstützten ICS-Dienstes.

Nach dem Verbinden unter **Einstellungen → Aufgabenübertragung** die Arbeitsbereiche und geplante Aufgaben/Fristen/beides auswählen. **Aufgaben automatisch übertragen** ausdrücklich einschalten und **Einstellungen speichern** wählen. Ein privater Lesezugang kann ohne erneute Kennworteingabe für das Schreiben übernommen werden; Schreibrechte werden vor dem Speichern geprüft. Bei bestehenden ICS-Abos den Schreibzugang separat einrichten. Beide Zugänge müssen auf denselben Kalender zeigen.

Die allgemeine Suche und der private Abruf sind mit simulierten CalDAV-Antworten und echter isolierter PostgreSQL-Datenbank geprüft. Ein realer Nextcloud-Test steht noch aus. Die bestehende iCloud-Schreibverbindung ist vom Nutzer bestätigt; der neue private REPORT-Leseweg wurde noch nicht an dessen Konto geprüft.

### Privater Abruf

Migration `0044_caldav_sources.sql` ergänzt Verbindungsart und verschlüsselte Zugangsdaten. Bestehende Quellen bleiben ICS-Abos. `caldavCalendars.ts` liest private Kalender per zeitlich begrenztem REPORT und verwendet den vorhandenen ICS-Parser für Zeitzonen, Serien und Ausnahmen. Ein fehlgeschlagener oder unvollständiger Abruf erhält die bisher gespeicherten Termine. Grenzen: ein Monat zurück, zwölf Monate voraus, höchstens 1000 Ressourcen und 2000 Vorkommen; der DAV-Transport begrenzt zusätzlich Antwortgröße und Laufzeit. Es werden nur öffentlich erreichbare HTTPS-Ziele mit Basic-Authentifizierung unterstützt.

Der private CalDAV-Lesezugang und ein eingerichteter Schreibzugang werden getrennt gespeichert. Zugangsfelder unter Aufgabenübertragung ändern den Schreibzugang; eine eigene Bearbeitung des privaten CalDAV-Lesezugangs ist noch offen. Eine Rückübernahme fremder Kalenderänderungen in SOTE-Aufgaben ist ebenfalls nicht enthalten. Google/Microsoft verwenden einen gemeinsamen erneuerbaren Kontozugang für Lesen und Schreiben.

Aktuelle Prüfung: 56 Kalender-, Protokoll-, Transport- und PostgreSQL-Tests sowie 90 Web-Tests bestehen. Die echten React-Komponenten wurden mit einer simulierten API für Suche, Auswahl, Speichern und Aktivierung der Aufgabenübertragung geprüft; mobile Ansicht bei 390 Pixeln ohne horizontales Überlaufen und ohne Browserfehler. Typprüfungen bestehen.

### Hintergrund der bisherigen iCloud-Schreibanbindung

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

### Programmkennung beim Schreiben

Die Rückmeldung vom echten Konto bestätigt PUT 404 auf `p39-caldav.icloud.com` mit kurzer UID (32 Bytes), leerem Antworttext von Apple und erfolgreicher anschließender Kalenderprüfung. Die UID-Verkürzung und erneute Einrichtung haben den Schreibfehler nicht behoben.

Der native HTTPS-Transport sendete bisher keinen `User-Agent`. Ein [Entwicklerbericht mit iCloud-Serverantwort und bestätigter Korrektur](https://stackoverflow.com/questions/50720196/creating-new-event-to-icloud-apple-calendar-always-results-400-bad-request) beschreibt erfolgreiche Lesezugriffe, aber abgelehnte PUTs wegen dieser fehlenden Kennung. Dort war der Status 400 mit `Require-User-Agent`, hier ist es 404 ohne Antworttext; die Ursache am betroffenen Konto ist deshalb noch nicht nachgewiesen. SOTE sendet nun bei allen DAV-Aufrufen seine eigene Kennung `SOTE/1.0 (CalDAV)`.

Ein zusätzlicher Transporttest leitet den tatsächlichen Node-HTTP-Aufruf auf einen lokalen Testserver um und prüft die übertragenen Header, Ressourcenadresse, UTF-8-Inhalte sowie If-None-Match/If-Match. Er scheitert vor der Korrektur an der fehlenden Programmkennung. Es werden keine echten Zugangsdaten und kein Apple-Server verwendet. Der nächste reale Abgleich muss bestätigen, ob diese Korrektur den gemeldeten 404 behebt.

Mit der Korrektur bestehen alle 25 CalDAV-Protokoll- und Transporttests sowie Server-Typprüfung und -Build.

### Vergleich im laufenden Container

Der Nutzer hat die Programmkennung im laufenden `sote-server-1` nachgewiesen; PUT 404 besteht weiterhin. Damit ist auch diese Korrektur keine Lösung des konkreten Fehlers.

`scripts/diagnose-caldav.mjs --sync` kann ohne neues Image über stdin im vorhandenen Container (Arbeitsverzeichnis `/app`) ausgeführt werden. Es wählt nur dann eine Verbindung, wenn genau eine eingeschaltete private iCloud-Verbindung einen PUT-Fehler hat. Es führt den normalen `syncWriter` mit dessen Sperre, Auswahlregeln, gespeicherten Quittungen und Konfliktschutz aus. Nach einem aktuellen PUT 404 wiederholt es dieselbe URL, denselben Inhalt und dieselbe Schreibbedingung einmal über Nodes `fetch`; weitere Aufrufe dieses Abgleichs bleiben bei diesem Client. Ein erfolgreicher Versuch wird regulär in der Datenbank bestätigt. Es werden keine zusätzlichen Testtermine angelegt. Der reguläre Hintergrunddienst bleibt unverändert.

Die Ausgabe enthält nur HTTP-Ergebnisse, Servername, maskierte Pfadstruktur, Inhaltslänge und abschließenden Writerstatus. Zugangsdaten, Kontopfadsegmente, UIDs und Termininhalte werden nicht ausgegeben. Der alternative Client ist auf HTTPS mit privaten Apple-CalDAV-Zielen auf dem Standardport begrenzt, folgt keinen Redirects und begrenzt Antwortgröße und Laufzeit. Diese manuell gestartete Diagnose ist kein allgemeiner Ersatz für den DNS-gebundenen Produktionstransport.

Fünf zusätzliche Tests prüfen den identischen bedingten Wiederholungsaufruf, die Weiterverwendung des Clients, unverändertes Verhalten bei Erfolg/Anmeldefehlern/Konflikten, Zielbeschränkung, Ausgabe ohne private Inhalte und die Antwortgrößenbegrenzung. Sie laufen über `pnpm test` auch in CI. Das Ergebnis am echten Konto steht noch aus.

### iCloud: explizite Endzeit für Zeitpunkte

Der Vergleich wurde im echten Container ausgeführt: `node:https PUT` und `fetch PUT` liefern beide HTTP 404, die anschließende Kalenderprüfung HTTP 207. Die 705 Byte große Ressource verwendet einen plausiblen privaten Kalenderpfad ohne URL-kodierte Zeichen. Ein Wechsel des HTTP-Clients behebt den Fehler somit nicht.

Ein [reproduzierbarer Fehlerbericht in vdirsyncer #1200](https://github.com/pimutils/vdirsyncer/issues/1200) beschreibt iCloud-PUT-404 für VEVENT ohne DTEND und erfolgreiche Übertragung derselben Art von Zeitpunkt mit DTEND gleich DTSTART. Genau diese fehlende Endzeit erzeugte SOTE bei geplanten Aufgaben ohne Dauer und bei zeitgebundenen Fristen. Die iCloud-Schreibausgabe ergänzt deshalb für diese Fälle eine explizite Endzeit gleich dem Start, ohne eine zusätzliche Dauer zu erfinden. Das ist eine gezielte iCloud-Kompatibilitätsanpassung; andere Anbieter und ICS-Abonnements verwenden weiterhin die bisherige Ausgabe. Vorhandene Dauern und exklusive Ganztagsenden bleiben erhalten.

Die Anpassung erfolgt vor dem Erzeugen und Speichern des Fingerprints, damit Bestätigung, Wiederholung nach verlorener PUT-Antwort und Löschen dieselbe Kalenderdatei zuordnen. Es werden keine Ressourcen umbenannt und keine Verbindungen neu angelegt.

19 Kalenderformat- und 38 CalDAV-Protokoll-/PostgreSQL-Tests sowie Server-Typprüfung und -Build bestehen. Der neue Format-Test scheitert vor der Korrektur an der fehlenden Endzeit. Der Datenbanktest simuliert iClouds Ablehnung und prüft zusätzlich verlorene PUT-Antwort, Wiederholung ohne Duplikate und Aufräumen nach Erledigung. Für diese Produktivkorrektur muss nach erfolgreichem Image-Build das neue Image in Portainer gezogen und der Servercontainer neu erstellt werden; das frühere Diagnoseskript allein aktualisiert keinen Anwendungscode.

Nach dem Update auf `5d78301` meldet der Nutzer am 13.09.2026: „Schreiben eingeschaltet · 7 Kalenderkopien · Zuletzt abgeglichen: 13.9.2026, 16:44:39“. Damit ist der erste vollständige Schreibabgleich mit dem eigenen iCloud-Kalender bestätigt und der zuvor gemeldete PUT-404 behoben. Änderungen, Erledigung und Konflikte sind durch automatisierte Tests abgedeckt; eine zusätzliche Bestätigung dieser Abläufe am echten Konto liegt bisher nicht vor.
