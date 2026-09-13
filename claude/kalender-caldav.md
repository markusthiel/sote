# CalDAV-Schreibanbindung

Stand: 13.09.2026. Implementierung für main; noch nicht mit einem echten Kalenderkonto geprüft.

## Einrichtung

Unter **Kalender einbinden** eine ICS-Lesequelle öffnen und **Aufgaben in diesen Kalender schreiben** ausklappen. Die vollständige HTTPS-CalDAV-Adresse des Kalenderordners (mit abschließendem `/`), Benutzername und App-Kennwort eintragen. Die ICS-Adresse und die CalDAV-Adresse sind unterschiedliche Zugänge; beide müssen auf denselben Kalender zeigen, damit geschriebene Termine wieder eingelesen werden.

Arbeitsbereiche, geplante Aufgaben/Fristen/beides und die Zeitzone für ganztägige Aufgaben auswählen. Automatisches Schreiben ausdrücklich einschalten und **Zugang prüfen und speichern** wählen. Leere Zugangsfelder behalten später die verschlüsselt gespeicherten Werte bei. Unterstützt sind direkte CalDAV-Kalenderadressen mit Basic-Authentifizierung über HTTPS; OAuth und automatische Kalenderermittlung sind nicht enthalten.

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
