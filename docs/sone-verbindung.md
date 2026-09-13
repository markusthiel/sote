# SONE mit SOTE verbinden

Die erste Ausbaustufe verbindet Notizen mit zentralen SOTE-Aufgaben. Aufgaben lassen sich in SONE anlegen, umbenennen, beschreiben, planen, mit einer Dauer versehen, erledigen und wieder öffnen. SOTE bleibt für Aufgaben und Kalenderabgleich zuständig.

## Einrichten

1. Beide Anwendungen aktualisieren. Zuerst SOTE, anschließend SONE. Die Datenbankmigrationen laufen beim normalen Containerstart. Danach die offenen Browser-Tabs neu laden; SONE verwendet für die neuen Blöcke Dokumentformat 5.
2. Als Instanzadministrator in **SOTE → Einstellungen → Verbundene Anwendungen** die öffentliche SONE-Adresse registrieren, beispielsweise `https://notizen.example.org`. Client-ID und einmalig angezeigtes Geheimnis kopieren.
3. Als Instanzadministrator in **SONE → Einstellungen → Verbundene Anwendungen** die öffentliche SOTE-Adresse, Client-ID und das Geheimnis eintragen. Es werden Basisadressen ohne Unterpfad benötigt. `SONE_PUBLIC_URL` muss der tatsächlich aufgerufenen SONE-Adresse entsprechen. Die Server müssen einander über diese Adressen erreichen können.
4. In SONE **SOTE-Konto verbinden** wählen. In SOTE anmelden, die gewünschten Projekte auswählen und bei Bedarf **Aufgaben auch anlegen und bearbeiten** aktivieren. Die Rückkehr nach SONE erfolgt automatisch.
5. In den SONE-Verbindungseinstellungen die **Projekte in diesem Arbeitsbereich** auswählen und speichern. Diese Zuordnung benötigt Verwaltungsrechte in beiden Arbeitsbereichen. Mehrere Projekte desselben SOTE-Arbeitsbereichs sind möglich.
6. In einer SONE-Notiz `/sote` eingeben und **SOTE-Aufgabe** oder **SOTE-Aufgabenliste** auswählen. Projekt auswählen und einbetten. Einzelblöcke können eine vorhandene Aufgabe anzeigen oder eine neue Aufgabe anlegen.

Die Instanzregistrierung erfolgt einmal, die persönliche Kontofreigabe für jede Person separat. Eine Freigabe gilt **30 Tage**. Sie kann in SONE erneuert und in beiden Anwendungen getrennt werden. Beim Einschränken einer Freigabe alte Freigaben in SOTE ausdrücklich widerrufen; eine neue Freigabe macht frühere Freigaben nicht automatisch ungültig.

## Im Alltag

- **Lesen und Schreiben / Nur Lesen** steht direkt am Aufgabenblock. Seitenrechte, Seitensperre, persönliche SOTE-Rechte, freigegebene Projekte und Projektzuordnung werden vor jedem Zugriff geprüft.
- **Neue Aufgabe** öffnet Titel, Datum mit Uhrzeit, Ganztägig, Dauer in Minuten und Beschreibung. Für die Dauer werden 15, 30, 60 und 120 Minuten angeboten; eigene Werte sind möglich.
- Der Aufgabentitel öffnet die vollständige SOTE-Aufgabe. Dort führt **entstanden in SONE** zur Notiz und zum Ursprungsblock zurück.
- Sichtbare Tabs laden ungefähr alle 15 Sekunden nach. Über den Aktualisieren-Knopf geht es sofort.
- Bei gleichzeitigen Änderungen erscheint ein Vergleich mit dem aktuellen Stand. Der Entwurf bleibt erhalten und wird erst nach ausdrücklicher Prüfung erneut gespeichert.
- Bei unklarer Antwort auf das Anlegen wird dieselbe Vorgangs-ID wiederholt. Der Browser hält nur diese ID im Sitzungsspeicher. Nach einem Reload kann ein bereits bestätigter Vorgang wiedergefunden werden; noch nicht gespeicherter Formulartext wird nicht dauerhaft gespeichert.
- Das Entfernen einer Einbettung, Notiz oder Verbindung löscht keine SOTE-Aufgabe. Ein Notizexport enthält den neutralen Referenzblock, keine live geladenen Aufgabendetails.

## Zugriffsgrenzen und Betrieb

Anonyme Seitenfreigaben erhalten keine Aufgabendaten. Auch ein angemeldeter SONE-Leser benötigt eine eigene persönliche SOTE-Freigabe. In Yjs, Notizsuche und Notizversionen stehen nur Referenz-IDs und der Darstellungsmodus. Geheimnisse und persönliche Zugangstokens speichert SONE verschlüsselt mit dem bestehenden `SONE_SECRET_KEY`; SOTE speichert nur Token-Hashes.

Die Verbindung verwendet einen begrenzten, versionierten Freigabeablauf mit einmaligem Code, S256-PKCE, sitzungsgebundenem Zustand und fest registrierter Rücksprungadresse. Die Schnittstelle ist eine private Verbindung zwischen SONE und SOTE, kein allgemeiner OAuth-/OpenID-Provider. Automatische Token-Erneuerung ist noch nicht enthalten.

HTTPS ist erforderlich; für lokale Entwicklung ist HTTP auf `localhost` und `127.0.0.1` erlaubt. Weiterleitungen bei Serveranfragen werden abgelehnt. Neue Integrations-Umgebungsvariablen werden nicht benötigt. Nach dem Entfernen der Instanz in SONE sollte die Registrierung auch in SOTE widerrufen werden, um alle noch vorhandenen Freigaben zu sperren.

Noch ausstehend sind Webhooks, zusätzliche Filter, eine größere durchsuchbare Aufgabenauswahl, mehrere Quellen pro Aufgabe, SONE-Vorschauen in SOTE und Offline-Schreiben. Geschützte SONE-Abschnitte werden in dieser Stufe nicht unterstützt. Bestehende normale Checklisten und die frühere technische Kopplung bleiben erhalten.
