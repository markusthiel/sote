# Google Kalender und Microsoft 365 / Outlook

Stand: 13.09.2026. Beide Kontoanbindungen sind implementiert. Die Einrichtung benötigt pro Anbieter eine eigene Web-App-Registrierung. Ohne diese Konfiguration zeigt SOTE den Einrichtungshinweis; bestehende iCloud-/CalDAV-Verbindungen und Kalenderabos funktionieren weiter.

## Einmalige Serverkonfiguration

`SOTE_BASE_URL` muss die öffentliche HTTPS-Adresse von SOTE enthalten, ohne abschließenden Schrägstrich. `SOTE_SHARE_KEY` muss gesetzt und dauerhaft beibehalten werden. Die konkreten Rücksprungadressen zeigt **Kalender hinzufügen → Anbieter → Einrichtung für die Administration** an.

```dotenv
SOTE_GOOGLE_CALENDAR_CLIENT_ID=
SOTE_GOOGLE_CALENDAR_CLIENT_SECRET=
SOTE_MICROSOFT_CALENDAR_CLIENT_ID=
SOTE_MICROSOFT_CALENDAR_CLIENT_SECRET=
SOTE_MICROSOFT_CALENDAR_TENANT=common
```

Die Variablen werden in `docker-compose.yml` an den Server weitergegeben. In Portainer die Werte als Stack-Umgebungsvariablen setzen und auch die neuen `environment`-Zeilen aus der Compose-Datei übernehmen, falls der Stack dort als eigenständige Kopie gepflegt wird. Danach das neue Image ziehen und den Stack aktualisieren. Ein neues Image allein ergänzt keine fehlenden Stack-Variablen. Client-Geheimnisse gehören weder in Git noch in öffentliche Links oder Screenshots.

## Google

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt wählen oder erstellen und die **Google Calendar API** aktivieren.
2. Unter **Google Auth Platform** App-Name und Zielgruppe konfigurieren. Für private Google-Konten die externe Zielgruppe verwenden; während des Testbetriebs das eigene Google-Konto als Testnutzer eintragen.
3. Einen OAuth-Client vom Typ **Webanwendung** erstellen. Als autorisierte Weiterleitungs-URI exakt `${SOTE_BASE_URL}/api/calendar-accounts/google/callback` eintragen. `${SOTE_BASE_URL}` dabei durch die öffentliche SOTE-Adresse ersetzen.
4. Client-ID und Client-Geheimnis in die beiden Google-Variablen übernehmen. Es sind keine JavaScript-Ursprünge für diesen serverseitigen Ablauf nötig.
5. In SOTE **Kalender hinzufügen → Google Kalender → Mit Google anmelden** wählen. Angeforderte Kalenderberechtigungen erlauben, Kalender auswählen und verbinden.

Angeforderte Berechtigungen: `openid`, `email`, `calendar.calendarlist.readonly` und `calendar.events`. Die App kann damit die Kalenderliste lesen und Termine lesen/bearbeiten; SOTE schreibt nur in ausdrücklich eingerichtete Zielkalender. Die Einwilligung beim Anbieter umfasst mehr Kalender, als anschließend in SOTE ausgewählt werden können. [OAuth für Webanwendungen](https://developers.google.com/identity/protocols/oauth2/web-server), [Google-Kalenderberechtigungen](https://developers.google.com/workspace/calendar/api/auth).

Bei einer externen Google-App im Status **Testing** können Refresh-Tokens für diese Kalenderberechtigungen nach sieben Tagen ablaufen. Für dauerhaften Betrieb die App-Veröffentlichung entsprechend einrichten; Google kann je nach Zielgruppe und Nutzung eine Verifizierung verlangen. Ein abgelaufener Zugriff wird in SOTE angezeigt und lässt sich durch erneutes Anmelden desselben Kontos erneuern. [Token-Laufzeiten](https://developers.google.com/identity/protocols/oauth2#expiration).

## Microsoft 365 / Outlook

1. Im [Microsoft Entra Admin Center](https://entra.microsoft.com/) unter **App-Registrierungen → Neue Registrierung** eine App für SOTE erstellen.
2. Für `SOTE_MICROSOFT_CALENDAR_TENANT=common` den Kontotyp **Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten** wählen. Für eine reine Firmenanbindung können stattdessen die eigene Mandanten-ID und eine passende Registrierung verwendet werden.
3. Plattform **Web** und Rücksprungadresse `${SOTE_BASE_URL}/api/calendar-accounts/microsoft/callback` eintragen; den Platzhalter durch die öffentliche SOTE-Adresse ersetzen.
4. Delegierte Microsoft-Graph-Berechtigungen **User.Read** und **Calendars.ReadWrite** hinterlegen. SOTE fordert zusätzlich `openid` und `offline_access` für die Anmeldung und Erneuerung an. Es werden keine Anwendungsberechtigungen ohne angemeldete Person benötigt. Je nach Firmenrichtlinie muss die Administration die Einwilligung freigeben.
5. Unter **Zertifikate & Geheimnisse** ein Client-Geheimnis erstellen. Dessen **Wert**, nicht die Geheimnis-ID, als `SOTE_MICROSOFT_CALENDAR_CLIENT_SECRET` setzen. Die **Anwendungs-ID (Client)** kommt in `SOTE_MICROSOFT_CALENDAR_CLIENT_ID`.
6. In SOTE **Kalender hinzufügen → Microsoft 365 / Outlook → Mit Microsoft anmelden** wählen und den Zielkalender verbinden.

[Microsoft-App registrieren](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Authorization Code mit PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Graph-Kalender](https://learn.microsoft.com/en-us/graph/api/resources/calendar?view=graph-rest-1.0).

## Verwendung

- Nach der Anmeldung die Kalender einzeln auswählen. Kalender mit reinen Leserechten werden gekennzeichnet. Erneutes Verbinden desselben Kontokalenders legt keine zweite Quelle an.
- Unter **Einstellungen → Aufgabenübertragung** Arbeitsbereiche, Plan/Frist und Zeitzone wählen, **Aufgaben automatisch übertragen** aktivieren und speichern. Es sind keine CalDAV-Adressen oder App-Passwörter nötig.
- Offene Aufgaben werden etwa jede Minute übertragen. Titel, Beschreibung, Aufgabenlink, Zeitpunkt und Dauer werden übernommen. Ganztage behalten ihr Datum. Zeitpunkte ohne Dauer erscheinen als einminütige Termine. Termine werden stündlich eingelesen; **Jetzt aktualisieren** fordert beide Richtungen an.
- Der Leseabruf erweitert Serien über die jeweilige Anbieter-API im Fenster von 31 Tagen zurück bis 366 Tagen voraus. Höchstens 2000 Vorkommen pro Abruf. Unvollständige oder fehlgeschlagene Abrufe behalten den bisherigen Kalenderstand.
- Fremde Änderungen werden vor betroffenen Schreib- oder Löschzugriffen anhand der gespeicherten Versionskennung geprüft. Der Abgleich ändert nur Ressourcen mit passender SOTE-Kennung; fremde Termine werden nicht übernommen oder gelöscht. Änderungen werden nicht in SOTE-Aufgaben zurückgeschrieben.
- **Konto erneut oder weiteres Konto anmelden** erneuert bei gleicher Anbieter-Identität den Zugang vorhandener Verbindungen. Ein anderes Konto bleibt eine separate Verbindung. Das funktioniert auch bei zwölf verbundenen Kalendern über **Kalenderkonten verwalten**.
- Zum Trennen eines Kontos zuerst seine Kalender aus SOTE entfernen, dann das Konto über die Anbieterauswahl trennen. Die lokalen Tokens werden gelöscht; die Anbieter-Einwilligung kann zusätzlich direkt bei Google/Microsoft widerrufen werden. Bereits übertragene Termine bleiben beim Anbieter.

## Umsetzung und Prüfung

Migration `0045_calendar_oauth.sql` ergänzt Konten, kurzlebige OAuth-Vorgänge, Kalenderzuordnung und externe Termin-IDs. OAuth-State ist einmalig, zehn Minuten gültig und an SOTE-Konto, Sitzung und Anbieter gebunden. PKCE-Verifier und Access-/Refresh-Tokens werden verschlüsselt gespeichert. Eine Zeilensperre serialisiert die Erneuerung rotierender Tokens. Kontoidentität wird über den authentifizierten Profil-Endpunkt ermittelt; ID-Token-Inhalte werden nicht ungeprüft als Identität verwendet.

REST-Anfragen gehen ausschließlich an feste Google-/Microsoft-API-Ursprünge, folgen keinen Redirects und begrenzen Laufzeit sowie Antwortgröße. Graph-Folgeseiten müssen auf demselben API-Pfad bleiben. Fehlermeldungen enthalten keine Tokens, Zugangsdaten oder beliebige Anbieter-Antworttexte.

Google-Ereignisse erhalten eine stabile Client-ID. Microsoft-Ereignisse verwenden `transactionId` und eine private erweiterte Eigenschaft zur Wiedererkennung nach verlorenen Antworten. Updates und Löschungen senden `If-Match`; Microsoft-Versionskennungen können im Unterschied zu CalDAV schwache ETags sein. [Google-Versionierung](https://developers.google.com/calendar/api/guides/version-resources), [Graph-Ereignisse](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0), [Graph-Eigenschaften suchen](https://learn.microsoft.com/en-us/graph/api/singlevaluelegacyextendedproperty-get?view=graph-rest-1.0).

17 neue Tests mit echter isolierter PostgreSQL-Datenbank und simulierten Anbieterantworten prüfen OAuth/Sitzungsbindung, PKCE, unvollständige Einwilligung, Token-Erneuerung, HTTP-Routen, Besitz-/Schreibrechte, idempotente Kalenderauswahl, Lesen/Schreiben/Ändern/Löschen, Plan und Frist, Ganztage, verlorene Erstantworten, Konflikte, Pagination und Erhalt vorhandener Termine bei Fehlern. Zusammen mit den bestehenden Kalenderprüfungen bestehen 73 Server- und 90 Web-Tests, Typprüfungen, Projektwächter und Produktionsbuild. Die echten React-Komponenten wurden mit einer simulierten API für beide Anbieterauswahlen und Aktivierung der Aufgabenübertragung geprüft; 390- und 1280-Pixel-Ansichten ohne horizontales Überlaufen oder Browserfehler.

Echte Google-/Microsoft-Konten sind noch nicht durchgetestet; dafür müssen die App-Registrierungen auf dem Zielserver konfiguriert werden. Freigegebene Firmen-/Gruppenkalender mit zusätzlichen delegierten Berechtigungen sind nicht gesondert implementiert oder getestet. Der aktuelle Microsoft-Zugang verwendet `Calendars.ReadWrite` für die Kalender des angemeldeten Kontos.
