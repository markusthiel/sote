# SOTE

**S**elfhosted **O**pensource **T**asks for **E**veryone.

Aufgaben verwalten. Auf deinem Server.

---

## Stand

Konzept und Gestaltung stehen, das Gerippe hat angefangen. **Es läuft noch
nichts** — es gibt keinen Server und keine Oberfläche. Was da ist, ist der Kern
mit den reinen Funktionen und dem Schema.

```
pnpm install
pnpm -r typecheck
pnpm --filter @sote/core test                      # 46 Tests, ohne Datenbank
SOTE_TEST_DATABASE_URL=postgres://… \
  pnpm --filter @sote/server test                  # 25 Tests, gegen Postgres
node scripts/check-migrations.mjs
```

Die Testdatenbank muss mit `--locale=C` angelegt sein. Sonst sortiert eine
sprachabhängige Collation die Sortierschlüssel um und vertauscht Zeilen.

### Deployen

```
cp .env.example .env      # SOTE_DB_PASSWORD ausfüllen
docker compose up -d
```

Der Server migriert beim Start selbst. Er bindet nur an localhost; davor gehört
ein Reverse Proxy mit TLS, weil der Sitzungskeks sonst im Klartext reist. Eine
Oberfläche gibt es noch nicht — bislang ist es eine API.

- [`claude/konzept.md`](claude/konzept.md) — die Festlegungen und die offenen
  Punkte
- [`design/artboards.html`](design/artboards.html) — Schale, Zeile, Erfassung
- [`design/artboards-2.html`](design/artboards-2.html) — Wiederholung, Freigabe,
  Papierkorb
- [`design/artboards-3.html`](design/artboards-3.html) — Erinnerungen, CalDAV,
  Einstellungen, Kopplung
- [`packages/core`](packages/core) — Schnellerfassung, Wiederholungen,
  Sortierung. Rein und getestet.
- [`packages/server/migrations`](packages/server/migrations) — das Schema
- [`packages/server/src/tasks.ts`](packages/server/src/tasks.ts) — was Abhaken
  bedeutet, und die Heute-Ansicht

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
