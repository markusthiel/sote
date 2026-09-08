# SOTE

**S**elfhosted **O**pensource **T**asks for **E**veryone.

Aufgaben verwalten. Auf deinem Server.

---

## Stand

Benutzbar. Aufgaben, Projekte und Ordner, die vier Ansichten und der
Posteingang, Suche, Papierkorb, Teilaufgaben und Kommentare, wiederkehrende
Aufgaben, Freigaben per Link ohne Konto, Leute, Rollen und Gruppen, Einladungen,
Erinnerungen, Single-Sign-on, Export und Löschen eines Arbeitsbereichs.

Was noch fehlt, ist die **Kopplung an SONE** — Blockanker, `/`-Menü,
bidirektionale Links.

```
pnpm install
SOTE_TEST_DATABASE_URL=postgres://… pnpm check     # Wächter, Typprüfung, Tests
pnpm dev                                           # Oberfläche auf :5173
```

Die Testzahl steht hier absichtlich **nicht**. Sie stand zweimal in diesem
Abschnitt, mit zwei verschiedenen Werten (94 und 217), und beide waren zum
Schluss falsch — eine Zahl, die von Hand gepflegt wird, ist eine Zahl, die
irgendwann lügt. `pnpm check` sagt sie.

`pnpm check` ist genau das, was die CI fährt — ein Befehl, damit die beiden
Listen von Prüfungen nicht auseinanderlaufen können.

**`@sote/core` muss vor allem anderen gebaut sein**, weil es mit `types` und
`main` auf `dist` zeigt. Die Skripte tun das selbst (`build:core` läuft vor
Typprüfung und Tests) — wer `tsc` oder `tsx` direkt aufruft, muss daran
denken.

Die Testdatenbank muss mit `--locale=C` angelegt sein. Sonst sortiert eine
sprachabhängige Collation die Sortierschlüssel um und vertauscht Zeilen.

### Deployen

```
cp .env.example .env      # POSTGRES_PASSWORD ausfüllen
docker compose up -d
```

Das zieht `ghcr.io/markusthiel/sote:main`. **Solange der Bau-Workflow
nicht einmal gelaufen ist, gibt es dieses Abbild nicht** — dann aus dem
Quellstand bauen:

```
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Der Workflow braucht ein Repository-Secret `REGISTRY_TOKEN` mit den Bereichen
`write:package` und `read:package`. Der automatische Actions-Token kann keine
Pakete schreiben; ein Push scheitert damit mit „401 reqPackageAccess".

Die Vorgabe ist `:main` und nicht `:latest`: `:latest` wird erst für ein
Nicht-Vorab-Tag veröffentlicht, und eine Vorgabe darauf gäbe vorher einen 404 —
was wie ein kaputtes Deployment aussieht und nicht wie ein unveröffentlichtes
Projekt.

Der Server migriert beim Start selbst und liefert die gebaute Oberfläche mit
aus — ein Ursprung für beides, damit der Sitzungskeks ohne CORS auskommt. Er
hört im Container auf 8080; nach draußen bildet `SOTE_PORT` ab, Vorgabe 32901. Gebunden wird an alle
Schnittstellen, wie bei SONE; davor gehört ein Reverse Proxy mit TLS, weil der
Keks sonst im Klartext reist.

### Was SOTE liest

Dreizehn Einstellungen, und für jede steht hier, **was ohne sie passiert** —
das ist beim Einrichten die einzige Auskunft, die zählt.

Ein Wächter im Prüflauf (`scripts/check-env-passed.mjs`) hält beide Richtungen
fest: jede Variable, die der Server liest, steht in `docker-compose.yml`, und
jede, die dort steht, wird gelesen. Der Grund ist eine Lehre aus SONE, die dort
vierzehn Variablen betraf und mir hier trotzdem passiert ist:
**Compose gibt die Umgebung des Rechners nicht weiter.** Was in `.env` steht und
in `docker-compose.yml` nicht genannt ist, erreicht den Container nie — man
füllt etwas aus, es wirkt nicht, und nichts sagt warum.

| Variable | ohne sie |
|---|---|
| `POSTGRES_PASSWORD` | Start bricht ab. Pflicht. |
| `SOTE_PORT` | Host-Port, Vorgabe 32901. Im Container hört der Server immer auf 8080. |
| `SOTE_SESSION_DAYS` | 30 Tage. |
| `SOTE_BASE_URL` | **Keine Einladungsmail und kein SSO.** Beide brauchen einen Rückweg, und der kann nicht aus der Anfrage kommen: wer die `Host`-Kopfzeile fälscht, lässt diesen Server Links auf einen fremden Namen verschicken. |
| `SOTE_SHARE_KEY` | **Keine Freigaben und keine Einladungslinks.** Die Bildschirme sagen das und nennen den Befehl: `openssl rand -hex 32`. In der Umgebung und nicht in der Datenbank — läge der Schlüssel neben den Links, die er schützt, wäre er keiner. |
| `SOTE_SMTP_HOST`, `SOTE_MAIL_FROM` | **Keine Mail.** Einladen geht trotzdem: der Link steht in der Liste zum Weitergeben. Erinnerungen laufen dann gar nicht, und der Server sagt es beim Start. |
| `SOTE_SMTP_PORT` | 587. |
| `SOTE_SMTP_USER`, `SOTE_SMTP_PASS` | Ohne Anmeldung beim Mailserver. |
| `SOTE_SMTP_SECURE` | Aus dem Port abgeleitet: 465 von Anfang an verschlüsselt, sonst STARTTLS. |
| `SOTE_OIDC_ISSUER`, `SOTE_OIDC_CLIENT_ID`, `SOTE_OIDC_CLIENT_SECRET` | **Kein Single-Sign-on** — der Knopf fehlt dann, statt in einen Fehler zu führen. Alle drei oder keines; `https` ist Pflicht. Rückkehradresse beim Anbieter: `$SOTE_BASE_URL/api/sso/callback`. |
| `SOTE_OIDC_LABEL` | Der Knopf heißt „Single-Sign-on", was nichts über den Anbieter sagt. |

Zwei stehen nur auf dem Rechner und nie im Container:
`SOTE_TEST_DATABASE_URL` für die Testläufe und `SOTE_NEW_PASSWORD` für das
Kennwortskript.

### Was SOTE nicht liest

| in SONE | in SOTE | warum |
|---|---|---|
| `SONE_SECRET_KEY` | **nicht nötig** | Sitzungen tragen einen Zufallswert, und die Datenbank hält nur seinen sha256. Ohne Signatur braucht es keinen Schlüssel, dessen Verlust alle Sitzungen entwertet. (Freigabe- und Einladungslinks brauchen einen — das ist `SOTE_SHARE_KEY`, und er verschlüsselt, statt zu signieren.) |
| `SONE_LOG_LEVEL` | **noch nicht** | SOTE schreibt auf stdout, ohne Stufen. |
| `SONE_MAX_UPLOAD_MB` | **noch nicht** | Anhänge sind entworfen (Blatt 17), nicht gebaut. Die Zahl kommt in die `.env`, wenn sie gelesen wird — und nicht vorher. |
| `SONE_STORAGE_BACKEND` | **kommt nicht** | Ein Volume, und keine Variable für ein Backend, das es nicht gibt: genau die Falle aus ADR-0107, wo `s3` dastand, nichts es umsetzte und die Sicherung deshalb das lokale Volume übersprang. |
| `SONE_IMAP_*`, `SONE_REPLY_MAILBOX` | **noch nicht** | Kein Antworten per Mail. |

Eine Zeile stand hier zu Unrecht und ist wieder weg:
`SOTE_REMINDER_MAIL_AFTER_MINUTES`. Sie war in `env.ts` gelesen und geprüft —
und **nichts versendete Mail**. Sie ist auch nicht zurückgekommen, als der
Mailweg kam: Erinnerungen sind jetzt *ein Brief am Tag zu einer Zeit, die jede
Person selbst wählt*, und eine Instanzvariable für „nach so vielen Minuten"
würde diese Frage zum zweiten Mal beantworten.

### Das erste Konto

Beim ersten Start wirft der Server einen **Einrichtungsschlüssel** ins
Protokoll:

```
docker compose logs server
```

Dann SOTE im Browser öffnen, den Schlüssel eingeben, Konto anlegen — man ist
gleich angemeldet.

Warum ein Schlüssel und nicht einfach eine offene Maske: eine Maske, die beim
ersten Aufruf ein Konto anlegt, kann das auch beim tausendsten, sobald die
Bedingung „es gibt kein Konto" einmal wieder wahr wird — zum Beispiel, weil
jemand das letzte Konto löscht. Dann stünde die Kontoerstellung offen im Netz.
Der Schlüssel liegt nur im Speicher des Prozesses, verfällt beim Neustart und
ist mit dem ersten Konto verbraucht.

Weitere Konten kommen über **Einladungen** (Verwaltung › Einladungen). Ohne
Mailweg steht der Link dort zum Weitergeben. Und es gibt weiterhin ein Skript,
für den Fall, dass man vor dem ersten Anmelden ein zweites Konto braucht:

```
docker compose exec server \
  env SOTE_NEW_PASSWORD='…' \
  node packages/server/dist/scripts/createAccount.js \
  anna@example.org "Anna Kern"
```

Das Kennwort kommt aus der Umgebung und nicht aus einem Argument:
Kommandozeilen landen in der Shell-Geschichte und in `ps`. Ein bestehendes Konto
wird nicht stillschweigend überschrieben.

## Was SOTE werden soll

Ein eigenständiges Aufgabenwerkzeug, das man selbst hostet und das sich beim
Benutzen gut anfühlt. Der Maßstab ist nicht der Funktionsumfang, sondern die
Geschwindigkeit: eine Aufgabe entsteht in einer Zeile und ohne Wartezeit.

Konkret heißt das:

- **Eine Zeile genügt.** Fälligkeit, Projekt, Priorität und Wiederholung werden
  aus dem Getippten gelesen. Der Bildschirm zeigt, was er verstanden hat.
- **Geplant und fällig sind zwei verschiedene Dinge.** Wann du anfangen willst,
  und wann es spätestens fertig sein muss.
- **Zusammenarbeit gehört dazu, nicht dran.** Zuweisen, kommentieren,
  benachrichtigen. Freigabe per Link mit Bearbeitung, auch an Leute ohne Konto.
- **Lokal zuerst.** Jede Änderung ist sofort sichtbar; der Server gleicht ab.
  Kein Speichern-Knopf, kein Ladebalken.
- **Wiederholungen, die stimmen.** Kalenderfest („jeden zweiten Dienstag") und
  erledigungsbezogen („drei Tage nachdem ich es zuletzt gemacht habe").
- **Auf dem Telefon ohne eigene App.** SOTE spricht CalDAV, also holen Apple
  Erinnerungen und Tasks.org die Aufgaben ab und wecken dich.

## Was SOTE nicht werden soll

Kein Projektmanagement. Keine Gantt-Diagramme, keine Zeiterfassung, keine
Abhängigkeiten, keine Auswertungen. Genau daran verlieren vergleichbare
Werkzeuge ihre Ruhe.

## Verhältnis zu SONE

[SONE](https://github.com/markusthiel/sone) ist das Notizsystem derselben
Familie. SOTE lässt sich damit verbinden: eine Aufgabenliste kann in einer
SONE-Seite stehen und dort weitergeführt werden, und jede Aufgabe weiß, aus
welcher Seite sie kommt.

**Die Verbindung ist optional.** SOTE funktioniert vollständig ohne SONE, und
umgekehrt. Es sind zwei getrennte Systeme mit eigener Datenbank, eigener
Anmeldung und eigenen Rechten — verbunden über eine ausdrückliche Kopplung, nicht
über eine gemeinsame Grundlage.

## Lizenz

AGPL-3.0. Siehe [`LICENSE`](LICENSE).
