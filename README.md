# SOTE

**S**elfhosted **O**pensource **T**asks for **E**veryone.

Aufgaben verwalten. Auf deinem Server.

---

## Stand

**Nichts davon ist gebaut.** Dieses Repository enthält bislang das
Konzeptpapier und die Gestaltungsentwürfe. Reihenfolge des Vorgehens:
Konzept → Artboards → ADRs → Bau.

- [`claude/konzept.md`](claude/konzept.md) — die Festlegungen und die offenen
  Punkte
- [`design/artboards.html`](design/artboards.html) — Schale, Zeile, Erfassung
- [`design/artboards-2.html`](design/artboards-2.html) — Wiederholung, Freigabe,
  Papierkorb

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
