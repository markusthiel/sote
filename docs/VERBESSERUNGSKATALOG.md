# SOTE – Fehlerprüfung und Verbesserungskatalog

Stand: 12.09.2026 · geprüfter Commit: `e17eb6e` · Schwerpunkt: einfache Aufgabenverwaltung, Zusammenarbeit und Gäste.

## Einschätzung

Die Anwendung hat brauchbare Grundlagen: parametrisierte SQL-Abfragen, zufällige und gehashte Sitzungstoken, scrypt für Kennwörter, serverseitig geprüfte Freigaben sowie zahlreiche Tests. Die entscheidende Schwäche ist allerdings die **unvollständige Durchsetzung des Rechtemodells**. Ein Gastkonto im Arbeitsbereich ist derzeit erheblich mächtiger, als die Rollenbeschreibung verspricht. Daneben gibt es konkrete Funktionsfehler bei Terminen, SSO, Kalendern, Bildvarianten und Push-Nachrichten.

**Vor einer Öffnung für nicht vertrauenswürdige Gäste sollten insbesondere F01–F04 behoben werden.** Bei aktiviertem SSO gehören F09–F11 dazu. Neue Funktionen sind weniger dringlich als verlässliche Berechtigungen und bestehende Kernabläufe.

Es gibt zwei unterschiedliche Gästearten: Mitglieder mit Rolle `guest`/ohne Listenstufe und Personen mit anonymem Freigabelink. Sie müssen getrennt geprüft werden. Eine Mitgliedschaft allein darf ein fehlendes Listenrecht nicht ersetzen.

## Umfang und Nachweise

Untersucht wurden Authentifizierung, HTTP-Routing, Rollen/Gruppen, Arbeitsbereiche, Freigaben, Einladungen, Aufgaben und Kommentare, Anhänge, Benachrichtigungen, Hintergrundaufträge, relevante Frontend-Aufrufe, Migrationen, Containerkonfiguration und Prüfscripte. Dies ist ein fokussierter Quellcodeaudit mit lokalen Prüfungen, kein vollständiger Penetrationstest einer laufenden Installation.

| Prüfung | Ergebnis |
|---|---|
| Installation mit unverändertem Lockfile und deaktivierten Installationsscripts | erfolgreich |
| `pnpm typecheck` | erfolgreich, alle drei Pakete |
| Core- und Server-Build | erfolgreich |
| Core-Tests | 237 bestanden |
| Web-Tests | 77 bestanden |
| Server: `static.test.ts` | 8 bestanden |
| Zusätzliche Audit-Reproduktionen | 6 bestanden; sie bestätigen **Fehler des aktuellen Stands**, keine Fehlerfreiheit |
| 11 einzeln ausgeführte Wächter | 9 erfolgreich; 2 scheitern unter Windows, siehe F16 |
| `pnpm check` | nicht erfolgreich: Abbruch bei `check-env-passed.mjs` |
| `pnpm audit --json` | 0 gemeldete bekannte Schwachstellen, 197 Abhängigkeitseinträge laut Ausgabe |
| PostgreSQL-Integrationstests | nicht ausgeführt: keine eingerichtete Testdatenbank, kein verfügbares Docker/psql |
| Produktions-Webbuild, Browser-E2E, echte SSO-/Mail-/Push-Anbieter | nicht ausgeführt |

Umgebung: Windows, Node 24.19.0, verfügbarer pnpm-Starter 11.19.0; das Projekt nennt pnpm 9.15.0 und nutzt im Container Node 22. Die erfolgreichen Prüfungen ersetzen deshalb keinen Lauf in der Produktionsumgebung. Die Teststarter scheiterten zunächst am Benutzerprofilzugriff innerhalb der Sandbox; außerhalb der Sandbox bestanden die oben genannten Tests.

Reproduktionen: `docs/audit/reproduce.mjs`. Ausführen nach `pnpm build:core` und `pnpm --filter @sote/server build` mit `node --test docs/audit/reproduce.mjs`. Sie verwenden echten Anwendungscode mit streng begrenzten Datenbank- und HTTP-Doubles, keine echten Konten und keine externe Infrastruktur. Die Dateibereinigung wird mit echten temporären Dateien geprüft. Die Doubles prüfen den Kontrollfluss; sie ersetzen keine Migrationen oder Datenbank-Integrationstests. Protokolle liegen in `docs/audit/`.

## Priorisierte Übersicht

P1 = vor breiter Nutzung beheben; P2 = im nächsten Stabilisierungsschritt. Aufwand S = lokal begrenzt, M = mehrere Komponenten, L = Architektur/umfangreiche Integration. Die Angaben sind Größenordnungen, keine Terminzusagen.

| ID | Priorität | Befund | Aufwand |
|---|---|---|---|
| F01 | P1 | Listenrechte werden bei Mitgliedern nicht durchgehend geprüft | M |
| F02 | P1 | Leser können vorhandene Bearbeitungslinks abrufen | S |
| F03 | P1 | Gastdetails verraten Schlagwörter des gesamten Arbeitsbereichs | S |
| F04 | P1 | Unbegrenzter Upload von Gast-Bildvarianten | S |
| F05 | P1 | Gaständerungen von Fälligkeit/Planung werden nicht gespeichert | S |
| F06 | P1 | Dateibereinigung löscht weiterhin referenzierte Vorschaubilder | S |
| F07 | P1 | Kalenderroute ist unerreichbar | S |
| F08 | P1 | Push-Aufträge haben keinen Handler | S |
| F09 | P1 bei SSO | SSO setzt einen unbrauchbaren Sitzungscookie | S |
| F10 | P1 bei SSO | Automatische Kontoverknüpfung ohne bestätigte E-Mail | M |
| F11 | P1 bei SSO | SSO-Vorgang ist nicht an den Browser gebunden | M |
| F12 | P2 | Fehlende Login-Drosselung und unvollständige Cookie-Härtung | M |
| F13 | P1 | Entfernte Mitglieder können neue Kommentarinhalte erhalten | M |
| F14 | P2 | Push-Ziele werden nicht begrenzt; Besitzprüfung unvollständig | M |
| F15 | P2 | Gleichzeitige Bearbeitung kann Änderungen überschreiben | M |
| F16 | P2 | Prüfscripte scheitern unter Windows und übersehen Routingfehler | S |
| F17 | P2 | Gast-Schnellerfassung umgeht Zuweisungsbeschränkung und Zeitzone | M |
| F18 | P2 | Arbeitsbereichsexport enthält nicht alle wiederherstellbaren Daten | M |

## Befunde und konkrete Maßnahmen

### F01 – Listenrechte schützen die normalen Aufgabenrouten nicht

**Beleg:** `packages/server/src/routes.ts:982` prüft die Mitgliedschaft; z. B. `routes.ts:2630` ruft danach `patch()` ohne Listenrechteprüfung auf. Gleichartige Lücken bestehen bei Aufgabenanlage, Kommentaren, Verschieben und Anhängen. `settings.ts:126` stellt bereits `mayWriteLists()` bereit, verwendet wird es in den Routen jedoch nur für Erstellung/Widerruf von Freigaben. Es gibt keinen vorgeschalteten allgemeinen Rollenfilter oder eine Datenbank-RLS, die das kompensiert. `bootstrap.ts:98` beschreibt eine Rolle ohne Listenstufe ausdrücklich als Gast ohne allgemeinen Zugriff.

**Auswirkung:** Eine Leserrolle verhindert keine direkten API-Änderungen. Auch ein Gastkonto ohne Listenstufe kann über die bloße Mitgliedschaft Arbeitsbereichsdaten lesen und Aufgaben verändern. Das ist eine Berechtigungsumgehung, unabhängig davon, welche Knöpfe die Oberfläche zeigt. Die lokale PATCH-Reproduktion erreicht HTTP 200, ohne dass Rollen überhaupt abgefragt werden.

**Maßnahme:** Eine zentrale Berechtigungsfunktion für Lesen, Kommentieren, Bearbeiten und Verwalten verwenden. Effektive Rechte aus Rolle, Gruppen und Eigentümerschaft berechnen; ohne passende Berechtigung ablehnen. Alle Aufgaben-, Listen-, Board-, Datei-, Such- und Exportwege anhand einer vollständigen Matrix prüfen.

**Abnahme:** Gast ohne Listenstufe, viewer, commenter, editor und Eigentümer jeweils gegen jede relevante HTTP-Methode testen. Nicht erlaubte Zugriffe liefern 403/404 und ändern keine Daten.

### F02 – Vorhandene Schreiblinks umgehen reduzierte Mitgliederrechte

**Beleg:** `routes.ts:1978` liefert `GET /api/shares` ohne Verwaltungs-/Schreibprüfung. Die Antwort enthält `token` und `right`. `shares.ts:listShares()` entschlüsselt dafür die aktiven Links. Im Gegensatz dazu sind POST/DELETE geschützt.

**Auswirkung:** Ein Mitglied mit Leserechten kann einen bestehenden Bearbeitungslink übernehmen und anschließend anonym mit dessen Rechten schreiben. Dies bleibt ein eigenständiges Problem, auch wenn F01 behoben wurde. Voraussetzung ist ein vorhandener aktiver Bearbeitungslink.

**Maßnahme:** Geheimnisse nur an Personen ausgeben, die diese Freigaben verwalten dürfen. Für andere Nutzer gegebenenfalls reine Metadaten ohne Token anzeigen. Liste und Einzelobjekt müssen dieselben Regeln verwenden.

**Abnahme:** Ein viewer erhält keinen Bearbeitungstoken; auch eine Herabstufung oder Gruppenänderung entzieht den Abruf sofort.

### F03 – Projektfreigaben geben arbeitsbereichsweite Schlagwörter preis

**Beleg:** `detail.ts:157` liest sämtliche Namen aus `labels WHERE workspace_id = $1`. `routes.ts:264` gibt sie als `known` aus. Die Gastdetailroute in `shareRoutes.ts` verwendet dieselbe `detailView()` inklusive dieses Feldes.

**Auswirkung:** Schon ein Leselink für Projekt A kann Namen von Schlagwörtern sehen, die ausschließlich in vertraulichen Projekten B/C verwendet werden. Dafür genügt ein Detailabruf einer freigegebenen Aufgabe.

**Maßnahme:** Eine explizite Gast-Antwortform mit bewusst freigegebenen Feldern verwenden. `known` weglassen oder auf zulässige Projektinhalte begrenzen. Auch Herkunftslinks und Personenangaben anhand des gewünschten Gastumfangs überprüfen; deren Vorhandensein allein ist noch kein bestätigter Fehler.

**Abnahme:** Ein nur in Projekt B verwendetes Test-Schlagwort taucht in keiner Antwort über den Freigabelink von A auf.

### F04 – Gast-Bildvarianten können unbegrenzt Speicher verbrauchen

**Beleg:** `shareRoutes.ts:315–324`: PUT auf `/tasks/:id/files/:fileId/web` sammelt den gesamten Request ohne Größenkontrolle. `taskFiles.ts:325`/`attachWeb()` begrenzt die Größe ebenfalls nicht. Die entsprechende Mitgliederroute besitzt dagegen eine Grenze.

**Auswirkung:** Wer einen Bearbeitungslink und eine zulässige Aufgaben-ID besitzt, kann den Arbeitsspeicher des Serverprozesses erschöpfen. Bei vorhandenem Anhang ohne Variante werden die Bytes zusätzlich gespeichert. Die Prüfung auf eine vorhandene Variante kommt erst nach dem Einlesen. Ein Proxy-Limit kann den Schaden begrenzen, ist im Repo aber nicht gewährleistet.

**Maßnahme:** Einen gemeinsamen begrenzten Body-Reader für alle Uploadwege einsetzen; zweite Größenprüfung in der Speicherfunktion. Zusätzlich Gesamtquote pro Arbeitsbereich/Freigabe, begrenzte Parallelität und kontrollierte 413-Antworten einführen.

**Abnahme:** Chunked Uploads über dem Limit brechen begrenzt ab, hinterlassen keine Dateien und beeinträchtigen andere Nutzer nicht. Keine Lasttests gegen eine echte Instanz ohne eigenen Testaufbau.

### F05 – Gasttermine verwenden die falschen Feldnamen

**Beleg:** `shareRoutes.ts:594–609` reicht `planned` und `due` direkt an `patch()` weiter und unterdrückt den Typfehler mit `as never`. `tasks.ts:1005–1008` erwartet `plannedAt` und `dueAt`. Die Mitgliederroute übersetzt dies über `readPatch()`.

**Auswirkung:** Nur ein Termin im PATCH führt zu „nichts zu ändern“. Zusammen mit einem Titel kann die Anfrage erfolgreich sein, während der Termin unverändert bleibt. Die lokale Reproduktion bestätigt genau diesen zweiten Fall.

**Maßnahme:** Gemeinsamen validierten Request-Parser verwenden und davor die Gast-Felder erlauben/begrenzen. Unsicheren Type-Cast entfernen; Datum, Nullwerte und Ganztagsoption gemeinsam prüfen.

**Abnahme:** Planung/Fälligkeit allein, zusammen mit Text sowie Löschen eines Datums als Gast funktionieren nach erneutem Laden.

### F06 – Bereinigung löscht gültige Bildvarianten

**Beleg:** `taskFiles.ts:254` berücksichtigt beim Aufbau der Menge gültiger Dateien nur `storage_key`, nicht `web_key`. Beide Varianten liegen aber im selben gescannten Dateibaum. `readFileOf()` bevorzugt bei `size=web` weiterhin den gesetzten `web_key`.

**Auswirkung:** Alte Vorschauvarianten werden als verwaist gelöscht. Danach schlägt ihr Abruf fehl, obwohl die Datenbank sie noch referenziert. Die Originaldatei bleibt erhalten. Ein lokaler Dateisystemtest bestätigt die Löschung.

**Maßnahme:** Alle nichtleeren Original- und Variantenschlüssel berücksichtigen. Fehlende Varianten beim Lesen kontrolliert auf das Original zurückfallen lassen und später neu erzeugen. Vor Aktivierung der korrigierten Bereinigung bestehende Referenzen prüfen.

**Abnahme:** Alte Originale und Varianten bleiben erhalten; nur echte Waisen werden gelöscht. Fehlende Varianten führen nicht zu kaputten Aufgabenansichten.

### F07 – Kalenderabonnements erreichen ihren Handler nicht

**Beleg:** `routes.ts:437` behandelt jeden Pfad außerhalb `/api/` als statische Datei und kehrt zurück. Die Route `/kalender/:token.ics` folgt erst bei `routes.ts:565`.

**Auswirkung:** Kalenderprogramme erhalten 404 statt ICS. Ohne Webroot antwortet der Server bereits vor jeder Datenbankabfrage; mit Webroot sucht er eine nicht vorhandene statische Datei. Die lokale Reproduktion bestätigt den unerreichbaren Handler.

**Maßnahme:** Kalenderroute vor den statischen Fallback ziehen oder Routing explizit strukturieren. Die erzeugten Abonnement-URLs müssen zur neuen Reihenfolge passen.

**Abnahme:** Echter HTTP-Test mit gültigem Token, GET/HEAD, ungültigem und widerrufenem Token sowie vorhandener gebauter Oberfläche.

### F08 – Kommentar-/Zuweisungs-Push bleibt in der Warteschlange

**Beleg:** `deliver.ts:148` erzeugt Jobs der Art `push.send`. Kein Quellmodul registriert `handle('push.send', ...)`. `jobs.ts:188–190` behandelt das als fehlenden Bearbeiter. `pushTo()` wird für bestimmte Aufgabenerinnerungen direkt verwendet; das repariert die Jobs nicht.

**Auswirkung:** Push für die über `deliver()` erzeugten Ereignisse wird nicht versendet; Jobs laufen in Fehler/Wiederholungen. Direkte Erinnerungs-Pushs sind davon zu unterscheiden.

**Maßnahme:** Handler mit validierter Nutzlast registrieren und beim Serverstart laden. Prüfen, ob alle produzierten Job-Arten registriert sind. Rückstau nach Reparatur kontrolliert behandeln, damit alte Ereignisse keine Benachrichtigungsflut auslösen.

**Abnahme:** Zuweisung oder Kommentar erzeugt einen Job, der mit einem Push-Testdouble genau einmal verarbeitet wird; Fehler und ungültige Abonnements werden sinnvoll behandelt.

### F09 – SSO speichert das Sessionobjekt statt des Tokens

**Beleg:** `routes.ts:720–726` interpoliert `${session}`. `openSession()` liefert aber `{ token, userId, expiresAt }`; die Kennwortanmeldung verwendet korrekt `session.token`.

**Auswirkung:** Der Cookie enthält `[object Object]`. Nach erfolgreicher Anmeldung beim Anbieter bleibt der Nutzer in SOTE unangemeldet, obwohl eine Sitzung angelegt wurde.

**Maßnahme:** Gemeinsame Funktion zum Setzen/Löschen von Sitzungscookies verwenden und `session.token` übergeben.

**Abnahme:** SSO-Callback durchlaufen und mit dem zurückgegebenen Cookie `/api/me` erfolgreich aufrufen. Ein reiner Test von `openSession()` findet diesen Fehler nicht.

### F10 – SSO verknüpft Konten über unbestätigte E-Mail-Adressen

**Beleg:** `sso.ts:223–242` übernimmt E-Mail und Subject aus UserInfo, ohne `email_verified` zu prüfen. `findAccount()` verknüpft bei fehlender Subject-Zuordnung automatisch anhand der E-Mail (`sso.ts:255–285`). Gespeichert wird nur das Subject, nicht die Kombination aus Aussteller und Subject.

**Auswirkung:** Wenn der konfigurierte Anbieter unbestätigte, vom Nutzer wählbare E-Mail-Adressen ausgibt, kann eine Person ein bestehendes lokales Konto beanspruchen. Das ist anbieterabhängig; keine pauschale Behauptung, dass jeder OIDC-Anbieter angreifbar ist. Der fehlerhafte SSO-Cookie F09 verhindert derzeit die normale Nutzung dieser Sitzung, ersetzt jedoch keine sichere Verknüpfung. Ein Anbieterwechsel schafft außerdem Kollisionsrisiken bei Subjects.

**Maßnahme:** Bestätigte E-Mail als Mindestbedingung für automatische Verknüpfung; für bestehende Konten vorzugsweise ausdrückliche Verknüpfung nach erneuter Anmeldung. Identität als `(issuer, subject)` speichern. OIDC-Antworten einschließlich relevanter Token-Claims vollständig über einen geprüften Client validieren. Änderungen vorhandener Zuordnungen migrieren.

**Abnahme:** `email_verified: false`, fehlender Claim, abweichender Issuer und fremdes Subject übernehmen kein Konto. Die lokale Probe bestätigt, dass ein explizites `false` derzeit akzeptiert wird. Die Bedeutung bestätigter E-Mail und stabiler Subject-/Issuer-Zuordnung beschreibt [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).

### F11 – SSO-State schützt nicht vor Übertragung zwischen Browsern

**Beleg:** `sso.ts:begin()/takeFlow()` speichern State und PKCE-Verifier ausschließlich serverseitig. `/api/sso/start` setzt keinen vorgangsspezifischen Browsercookie; `/api/sso/callback` prüft lediglich den State aus der URL. Zusätzlich lässt die Next-Path-Regel bei `sso.ts:132` Werte wie `//attacker` zu, die `routes.ts:728` als Location ausgibt.

**Auswirkung:** Ein begonnener SSO-Vorgang kann im Browser einer anderen Person abgeschlossen werden (Login-CSRF); PKCE allein beweist nicht, welcher Browser den Vorgang begonnen hat. Die Next-Path-Prüfung lässt zudem protokollrelative Ziele zu. Punkte im Host werden zwar abgelehnt, ein Einlabel-Host wie `attacker` wird aber akzeptiert. Die praktische Zielauflösung hängt von der Netzwerkumgebung ab. F09 muss für einen brauchbaren SSO-Login ebenfalls behoben sein.

**Maßnahme:** State an ein zufälliges Browsergeheimnis binden, kurzlebig und einmalig prüfen. Next-Ziele über URL-Parsing auf denselben Origin beschränken; `//` ablehnen. OIDC-Client und Negativtests ergänzen.

**Abnahme:** Callback eines anderen Browsers wird abgelehnt; Replay und fremde Redirect-Ziele ebenfalls. Zur Browserbindung siehe [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

### F12 – Anmeldung und Sitzungscookies benötigen Schutz gegen Missbrauch

**Beleg:** `/api/session` bei `routes.ts:515` ruft für jeden Versuch `signIn()` auf. Kein anwendungsseitiger Rate-Limiter ist vorhanden. Die Cookieausgaben bei `routes.ts:506`, `531`, `724`, `793` enthalten HttpOnly/SameSite=Lax, aber kein Secure. Compose veröffentlicht den Serverport standardmäßig an allen Schnittstellen.

**Auswirkung:** Unbegrenztes Kennwortraten und kostspielige scrypt-Aufrufe sind möglich. Ohne zusätzliche Infrastruktur kann ein Sitzungscookie auch über HTTP übertragen werden. Welche Schutzmaßnahmen der echte Reverse Proxy setzt, wurde nicht geprüft.

**Maßnahme:** Begrenzung nach Konto und Herkunft mit vertrauenswürdig konfigurierter Proxy-Erkennung, kontrollierter Rückmeldung und ohne leicht missbrauchbare Dauersperren. Secure-Cookies bei HTTPS, zentrale Cookieausgabe, dokumentierter TLS-/Proxybetrieb. Origin-/Content-Type-Prüfungen für zustandsändernde Browseranfragen ergänzen.

**Abnahme:** Viele Fehlversuche werden gedrosselt, korrekte Anmeldung erholt sich nach der Frist, und HTTPS-Sitzungen setzen Secure. Ein bestehendes Proxy-Limit darf dokumentiert werden, muss aber tatsächlich eingerichtet sein.

### F13 – Entfernen aus dem Team stoppt Inhaltsbenachrichtigungen nicht zuverlässig

**Beleg:** `people.ts:228` löscht die Mitgliedschaft. `detail.ts:322` bestimmt Empfänger weiter aus Aufgabenersteller und Zuweisungen; Antworten verwenden auch frühere Kommentarautoren. `deliver.ts` prüft die aktuelle Mitgliedschaft nicht, bevor es Mail mit Aufgabentitel und Kommentarausschnitt einreiht.

**Auswirkung:** Ein entferntes, weiterhin existierendes Konto kann neue Kommentarinhalte per E-Mail erhalten, sofern der Kanal aktiviert ist. Auch schon eingereihte Mails enthalten die Inhalte bereits. Das ist besonders relevant beim Ausscheiden externer Mitarbeiter.

**Maßnahme:** Berechtigung beim Erzeugen und unmittelbar vor dem Versand prüfen. Beim Entzug offene Inhaltsjobs und aufgabenbezogene Erinnerungen berücksichtigen; historische Autorenschaft darf erhalten bleiben, aber kein Zustellrecht begründen.

**Abnahme:** Zugewiesenen Autor entfernen, anschließend kommentieren/antworten und wartende Jobs ausführen: kein neuer Inhalt geht an die entfernte Person. Dies ist eine Codepfad-Feststellung; ein echter Mail-Integrationstest steht aus.

### F14 – Push-Abonnements akzeptieren beliebige Ziele und unzureichende Besitzkontrollen

**Beleg:** `routes.ts:949–975` prüft nur nichtleere Endpoint-/Key-Felder. `push.ts:165` sendet an diesen Endpoint. `unsubscribePush()` löscht nur anhand des Endpoints; der Upsert in `subscribePush()` kann die zugehörige `user_id` überschreiben.

**Auswirkung:** Ein angemeldeter Nutzer kann bei syntaktisch gültigen Push-Keys serverseitige HTTPS-Anfragen an unerwünschte Ziele veranlassen. Der direkte Erinnerungsversand existiert unabhängig vom fehlenden Handler F08. Die genaue Erreichbarkeit interner Dienste hängt von Bibliothek, TLS und Netzwerk ab; eine vollständige SSRF-Ausnutzung wurde nicht durchgeführt. Kennt jemand den Endpoint eines anderen Kontos, kann er dessen Abonnement löschen oder umhängen; ein bloßes Erraten wird nicht vorausgesetzt.

**Maßnahme:** HTTPS, zulässige Pushdienste beziehungsweise eine klare Egress-Regel, Auflösung interner Adressen und Timeouts prüfen. DELETE auf `(user_id, endpoint)` begrenzen; Eigentümerwechsel bewusst behandeln. Keyformat und Abonnementanzahl validieren. Grundlage: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**Abnahme:** Private/Loopback-Ziele werden lokal mit Testdoubles abgelehnt; Konto A kann Abonnement B nicht ändern oder löschen.

### F15 – Zusammenarbeit hat keine Konflikterkennung für gleiche Felder

**Beleg:** `tasks.ts:1111` aktualisiert anhand von Aufgaben-ID und Arbeitsbereich, ohne erwartete Version. `taskView()` liefert keine Revisionsnummer. Push-/SSE-Neuladen entdeckt keinen bereits überschriebenen Entwurf.

**Auswirkung:** Bearbeiten zwei Personen denselben Titel oder dieselbe Notiz, gewinnt die letzte Anfrage; die erste Änderung geht ohne Warnung verloren. Änderungen an unterschiedlichen einzeln gepatchten Feldern sind davon nicht automatisch betroffen.

**Maßnahme:** Versionsnummer/ETag mit bedingtem Update einführen. Bei Konflikt den lokalen Entwurf erhalten und eine einfache Auswahl anbieten. Keine schwere Kollaborationsarchitektur nötig; optimistische Konflikterkennung genügt als erster Schritt.

**Abnahme:** Zwei Clients laden dieselbe Version, beide ändern dieselbe Notiz: der zweite veraltete Schreibzugriff erhält 409/412 und kann seinen Text wiederverwenden.

### F16 – Qualitätsprüfungen sind unter Windows defekt und zu eng gefasst

**Beleg:** `scripts/check-env-passed.mjs:39` und `check-styles.mjs:29` verwenden `URL.pathname` als Dateisystempfad. Unter Windows entsteht `C:\C:\...`. Beide Fehler wurden ausgeführt reproduziert. `check-routes-reachable.mjs` meldet alle Wege erreichbar, obwohl F07 besteht: sein Muster erfasst den `!path.startsWith('/api/')`-Fallback nicht.

**Maßnahme:** `fileURLToPath()` beziehungsweise URL-fähige Dateisystemaufrufe verwenden. HTTP-Smoke-Tests für Kalender, Freigaben, SSO und statische Auslieferung ergänzen. Wächter auf ihre begrenzte Aussage reduzieren; sie ersetzen keine Verhaltensprüfung. CI auf Windows und Linux mit festgelegter Node-/pnpm-Version ausführen.

**Abnahme:** `pnpm check` läuft mit Testdatenbank auf beiden Plattformen vollständig; eine absichtlich nach dem Fallback platzierte Kalenderroute lässt den HTTP-Test scheitern.

### F17 – Gast-Schnellerfassung wendet andere Regeln an als Gast-PATCH

**Beleg:** `shareRoutes.ts:443` übergibt die rohe Zeile an `createFromLine()`. Dort werden `+Name`-Zuweisungen gegen Arbeitsbereichsmitglieder aufgelöst und gespeichert (`tasks.ts:331–369`). Gast-PATCH verbietet Zuweisungen ausdrücklich. Außerdem wird keine Browserzeitzone an `createFromLine()` weitergegeben, obwohl es `zone` unterstützt.

**Auswirkung:** Ein Bearbeitungslink kann über die Schnellerfassung Personen zuweisen und Benachrichtigungen auslösen, obwohl die direkte Bearbeitung das nicht erlaubt. „Morgen 9 Uhr“ wird für Gäste nicht nach denselben Zeitzonenregeln gespeichert wie für Mitglieder.

**Maßnahme:** Fähigkeiten auch dem gemeinsamen Erfassungsdienst mitgeben oder aus einem geprüften Zugriffskontext ableiten. Unerlaubte Zuweisungen verständlich ablehnen; nicht erst nachträglich korrigieren. Die validierte Zeitzone in Gast- und Mitgliederpfaden identisch verwenden.

**Abnahme:** `Aufgabe +Anna` kann mit einer entsprechend begrenzten Freigabe keine Zuweisung erzeugen. Zeitangaben in Europe/Berlin stimmen im Sommer, Winter und beim Tageswechsel mit der Vorschau überein.

### F18 – Export ist kein vollständiger Wiederherstellungspunkt

**Beleg:** `workspace.ts:exportWorkspace()` exportiert Projekte, Aufgaben, Kommentare, Zuweisungen, Schlagwörter und Einstellungen, aber keine Anhangdateien/-metadaten oder Boardspalten. Aufgaben können gleichzeitig `column_id` und bildbezogene Referenzen enthalten.

**Auswirkung:** Ein Nutzer kann den Export nicht verwenden, um seinen Arbeitsbereich einschließlich Dateien und Boardstruktur vollständig wiederherzustellen. Ein Datenbankdump allein enthält ebenfalls keine Dateivolumes. Im Compose-Kommentar ist Letzteres richtig beschrieben, im Produkt muss es ebenso verständlich sein.

**Maßnahme:** Klar zwischen Datenexport und vollständiger Sicherung unterscheiden. Portables Archiv mit Manifest/Formatversion, relational benötigten Daten und Dateien anbieten oder den begrenzten Umfang sichtbar benennen. Für Betrieb ein abgestimmtes Backup von PostgreSQL, Dateivolume und erforderlichen Schlüsseln dokumentieren.

**Abnahme:** Ein Testarbeitsbereich mit Anhängen, Board, Kommentaren und Wiederholungen wird exportiert und in eine leere Testinstanz zurückgebracht; Inhalte und Referenzen bleiben verwendbar.

## Produktverbesserungen für Einfachheit und Teamwork

Diese Punkte sind Vorschläge, keine zusätzlich bewiesenen Sicherheitslücken.

| Vorschlag | Nutzen und bewusst kleiner erster Schritt | Priorität |
|---|---|---|
| Gastrollen verständlich benennen | „Nur lesen“, „Kommentieren“, „Bearbeiten“ mit kurzer Tätigkeitsliste; zunächst konsistente Rechte statt zusätzlicher Rollenschalter | nach F01 |
| Persönliche Freigaben optional | Pro Gast ein widerrufbarer Link; freiwilliger Anzeigename für Kommentare. Anzeigename ausdrücklich keine verifizierte Identität | P2 |
| Freigaben übersichtlich verwalten | Projekt, Recht, Ablauf, letzte Nutzung und Widerruf in einer Ansicht; bei hohem Schutzbedarf kurze Standardlaufzeit | P2 |
| Teambeitritt in einem nachvollziehbaren Ablauf | Einladung soll Arbeitsbereich und Zielrolle enthalten. Aktuell getrennte Kontoanlage und Teamaufnahme verständlich verbinden, ohne Rechte an den Browser zu delegieren | P2 |
| Speichern sichtbar und verlustarm machen | Dezenter Zustand „gespeichert / wird gespeichert / fehlgeschlagen“, Entwurf bei Fehler behalten, Wiederholen und Rückgängig für häufige Aktionen | P2 |
| Entzug von Freigaben sauber anzeigen | Offene SSE-Verbindungen bei Widerruf/Ablauf beenden; UI in eindeutigen Zustand setzen. Aktuell wird der Token nur beim Aufbau geprüft; der offene Strom liefert weiterhin Aktivitätssignale, keine neuen Aufgabendaten | P2 |
| Kleine Verlaufsspur | Akteur bzw. verwendete Freigabe, Zeitpunkt und geänderte Felder für relevante Änderungen speichern; gemeinsam verwendete Links nicht als bestimmte Person ausgeben | P2 |
| Barrierefreiheit prüfen | Tastaturbedienung, Fokus in Detailansicht/Modalen, verständliche Feldnamen, mobile Touchziele; mit echten Browser-E2E-Tests verifizieren | P2 |
| Eingaben konsistent validieren | Gemeinsame Laufzeitschemas für API-Bodies. Ungültiges JSON, Datum und UUID als 400/422 statt generischem 500 behandeln; Größenlimits mit 413 | P2 |
| Dokumentation kürzen und aktualisieren | Veraltete Aussagen zu fehlenden Anhängen und Gastfunktionen entfernen; Kalenderfeed klar von vollständigem CalDAV unterscheiden. Lange historische Kommentare in Entscheidungen/Changelog verschieben | P3 |

## Empfohlene Umsetzung

1. **Rechte und Datenabgrenzung schließen:** F01–F04, F13. Die Rechteprüfung muss auch in Negativtests über HTTP nachweisbar sein.
2. **Bestehende Kernabläufe reparieren:** F05–F09, F17. Dabei gemeinsame Parser und kleine wiederverwendbare Funktionen einführen, damit Gast- und Mitgliederpfade nicht erneut auseinanderlaufen.
3. **Anmeldung und Außenkommunikation absichern:** F10–F12, F14; bei aktivem SSO parallel zum ersten Schritt.
4. **Teamzuverlässigkeit und Betrieb verbessern:** F15, F16, F18; anschließend die kleinen Produktverbesserungen priorisieren.

Am Anwendungscode wurden für diesen Audit keine Reparaturen vorgenommen. Hinzugefügt wurden dieser Katalog, lokale Reproduktionen und Prüfprotokolle. Die Datenbank-Integration und die Prüfung einer tatsächlich betriebenen Instanz bleiben als ausdrücklich offene Validierungsschritte bestehen.
