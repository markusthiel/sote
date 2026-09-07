# SOTE

**S**elfhosted **O**pensource **T**asks for **E**veryone.

Aufgaben verwalten. Auf deinem Server.

---

## Stand

Konzept und Gestaltung stehen. Der Kern, der Server und die Heute-Ansicht
laufen; alles andere ist noch nicht gebaut. **94 Tests**, davon 26 gegen eine
echte Datenbank.

```
pnpm install
SOTE_TEST_DATABASE_URL=postgres://… pnpm check     # Wächter, Typprüfung, 217 Tests
pnpm dev                                           # Oberfläche auf :5173
```

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
hört auf `SOTE_PORT`, Vorgabe 3001, weil SONE 3000 nimmt. Gebunden wird an alle
Schnittstellen, wie bei SONE; davor gehört ein Reverse Proxy mit TLS, weil der
Keks sonst im Klartext reist.

### Was SOTE nicht liest

Wer von SONE kommt, hat eine `.env` mit siebzehn Zeilen. SOTE liest drei, und
das ist keine Sparsamkeit, sondern der Stand: eine Variable für eine Sache, die
es nicht gibt, ist eine Zusage, die nichts einlöst.

| in SONE | in SOTE | warum |
|---|---|---|
| `SONE_SECRET_KEY` | **nicht nötig** | Sitzungen und Freigabelinks tragen einen Zufallswert, und die Datenbank hält nur seinen sha256. Ohne Signatur braucht es keinen Schlüssel — und keinen, dessen Verlust alle Sitzungen entwertet. |
| `POSTGRES_PASSWORD` | gleich | |
| `SONE_PORT` | `SOTE_PORT` | Host-Port, Vorgabe 32901. |
| `SONE_PUBLIC_URL` | **noch nicht** | Wird gebraucht, sobald etwas eine absolute URL erzeugt: die Erinnerungsmail, der Freigabelink, der Rückverweis für SONE. Nichts davon ist gebaut, also liest es niemand. |
| `SONE_LOG_LEVEL` | **noch nicht** | SOTE schreibt auf stdout, ohne Stufen. |
| `SONE_MAX_UPLOAD_MB` | **noch nicht** | Anhänge sind entworfen (Blatt 17), nicht gebaut. Die Zahl kommt in die `.env`, wenn sie gelesen wird — und nicht vorher. |
| `SONE_STORAGE_BACKEND` | **kommt nicht** | Ein Volume, und keine Variable für ein Backend, das es nicht gibt: genau die Falle aus ADR-0107, wo `s3` dastand, nichts es umsetzte und die Sicherung deshalb das lokale Volume übersprang. |
| `SONE_SMTP_*` | **noch nicht** | Kein Mailweg. Entworfen ist er (Erinnerungen, Blatt 12), gebaut nicht. |
| `SONE_IMAP_*`, `SONE_REPLY_MAILBOX` | **noch nicht** | Kein Antworten per Mail. |

Eine Zeile stand hier zu Unrecht und ist wieder weg:
`SOTE_REMINDER_MAIL_AFTER_MINUTES`. Sie war in `env.ts` gelesen und geprüft —
und **nichts versendete Mail**. Sie kommt zurück, wenn der Mailweg da ist.

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

Ein weiteres Konto legt bis auf Weiteres ein Skript an — Einladungen gibt es
noch nicht:

```
docker compose exec server \
  env SOTE_NEW_PASSWORD='…' \
  node packages/server/dist/scripts/createAccount.js \
  anna@example.org "Anna Kern"
```

Das Kennwort kommt aus der Umgebung und nicht aus einem Argument:
Kommandozeilen landen in der Shell-Geschichte und in `ps`. Ein bestehendes Konto
wird nicht stillschweigend überschrieben.

### Was SOTE nicht liest

Wer von SONE kommt, hat eine `.env` mit siebzehn Zeilen. SOTE liest drei, und
das ist keine Sparsamkeit, sondern der Stand: eine Variable für eine Sache, die
es nicht gibt, ist eine Zusage, die nichts einlöst.

| in SONE | in SOTE | warum |
|---|---|---|
| `SONE_SECRET_KEY` | **nicht nötig** | Sitzungen und Freigabelinks tragen einen Zufallswert, und die Datenbank hält nur seinen sha256. Ohne Signatur braucht es keinen Schlüssel — und keinen, dessen Verlust alle Sitzungen entwertet. |
| `POSTGRES_PASSWORD` | gleich | |
| `SONE_PORT` | `SOTE_PORT` | Host-Port, Vorgabe 32901. |
| `SONE_PUBLIC_URL` | **noch nicht** | Wird gebraucht, sobald etwas eine absolute URL erzeugt: die Erinnerungsmail, der Freigabelink, der Rückverweis für SONE. Nichts davon ist gebaut, also liest es niemand. |
| `SONE_LOG_LEVEL` | **noch nicht** | SOTE schreibt auf stdout, ohne Stufen. |
| `SONE_MAX_UPLOAD_MB` | **noch nicht** | Anhänge sind entworfen (Blatt 17), nicht gebaut. Die Zahl kommt in die `.env`, wenn sie gelesen wird — und nicht vorher. |
| `SONE_STORAGE_BACKEND` | **kommt nicht** | Ein Volume, und keine Variable für ein Backend, das es nicht gibt: genau die Falle aus ADR-0107, wo `s3` dastand, nichts es umsetzte und die Sicherung deshalb das lokale Volume übersprang. |
| `SONE_SMTP_*` | **noch nicht** | Kein Mailweg. Entworfen ist er (Erinnerungen, Blatt 12), gebaut nicht. |
| `SONE_IMAP_*`, `SONE_REPLY_MAILBOX` | **noch nicht** | Kein Antworten per Mail. |

Eine Zeile stand hier zu Unrecht und ist wieder weg:
`SOTE_REMINDER_MAIL_AFTER_MINUTES`. Sie war in `env.ts` gelesen und geprüft —
und **nichts versendete Mail**. Sie kommt zurück, wenn der Mailweg da ist.

### Das erste Konto

Das erste Konto legt ein Skript an — eine Einladung gibt es noch nicht:

```
docker compose exec server \
  env SOTE_NEW_PASSWORD='…' \
  node packages/server/dist/scripts/createAccount.js \
  du@example.org "Dein Name" "Mein Arbeitsbereich"
```

Das Kennwort kommt aus der Umgebung und nicht aus einem Argument:
Kommandozeilen landen in der Shell-Geschichte und in `ps`. Ein bestehendes
Konto wird nicht stillschweigend überschrieben.

- [`claude/konzept.md`](claude/konzept.md) — die Festlegungen und die offenen
  Punkte
- [`design/artboards.html`](design/artboards.html) — Schale, Zeile, Erfassung
- [`design/artboards-2.html`](design/artboards-2.html) — Wiederholung, Freigabe,
  Papierkorb
- [`design/artboards-3.html`](design/artboards-3.html) — Erinnerungen, CalDAV,
  Einstellungen, Kopplung
- [`design/artboards-4.html`](design/artboards-4.html) — Anhänge (entworfen,
  nicht gebaut)
- [`packages/core`](packages/core) — Schnellerfassung, Wiederholungen,
  Sortierung. Rein und getestet.
- [`packages/server/migrations`](packages/server/migrations) — das Schema
- [`packages/server/src/tasks.ts`](packages/server/src/tasks.ts) — was Abhaken
  bedeutet, und die Heute-Ansicht
- [`packages/web/src/modes.tsx`](packages/web/src/modes.tsx) — die eine
  Modusliste, aus der Schiene und Fußleiste gezeichnet werden

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
