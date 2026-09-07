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
pnpm -r typecheck
pnpm --filter @sote/core test                      # 46, ohne Datenbank
pnpm --filter @sote/web test                       # 16, Wächter über Tokens und Leiste
SOTE_TEST_DATABASE_URL=postgres://… \
  pnpm --filter @sote/server test                  # 32, gegen Postgres
node scripts/check-migrations.mjs

pnpm dev                                           # Oberfläche auf :5173
```

Die Testdatenbank muss mit `--locale=C` angelegt sein. Sonst sortiert eine
sprachabhängige Collation die Sortierschlüssel um und vertauscht Zeilen.

### Deployen

```
cp .env.example .env      # SOTE_DB_PASSWORD ausfüllen
docker compose up -d
```

Der Server migriert beim Start selbst und liefert die gebaute Oberfläche mit
aus — ein Ursprung für beides, damit der Sitzungskeks ohne CORS auskommt. Er
bindet nur an localhost; davor gehört ein Reverse Proxy mit TLS, weil der Keks
sonst im Klartext reist.

Ein erstes Konto legt man derzeit von Hand an; eine Einladung gibt es noch
nicht.

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
