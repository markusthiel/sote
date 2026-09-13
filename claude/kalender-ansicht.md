# Persönliche Kalenderansicht und begrenzte Scrollbereiche

Stand: 13.09.2026.

Termine und Aufgaben zeigen in Monat, Woche und Tag beim Überfahren mit der Maus sofort eine Detailkarte mit vollständigem Titel, Kalender beziehungsweise Arbeitsbereich, Datum und Uhrzeit, Dauer sowie vorhandenen Notizen oder Ortsangaben. Ganztagstermine zeigen ihren tatsächlichen Zeitraum. Die Karte passt ihre Position an den verfügbaren Platz im Fenster an und bleibt beim Wechsel des Mauszeigers in die Karte geöffnet. Tastaturfokus öffnet sie ebenfalls; Escape, Scrollen im Kalender, Öffnen einer Aufgabe und Klicken außerhalb schließen sie. Lange Inhalte lassen sich innerhalb der Karte scrollen.

Tooltip-Prüfung: Tests für Positionierung an Fensterrändern, Ganztagszeiträume mit exklusivem Enddatum und Termine über Mitternacht; Browser-Vorschau mit vollständigen Titeln und Details bei 1280 und 390 Pixeln sowie Tastaturfokus und Escape.

Unter **Persönliche Einstellungen → Kalender → Kalender Standardansicht** stehen **Letzte Ansicht**, **Tag**, **Woche** und **Monat** zur Wahl. Die Vorgabe wird als `calendarDefault` in den bestehenden persönlichen Einstellungen gespeichert; eine Migration ist nicht erforderlich. Ohne eigene Wahl gilt „Letzte Ansicht“, beim allerersten Besuch Woche.

Die zuletzt besuchte Ansicht wird je Konto im Browser gemerkt. Bei gesperrtem Browserspeicher bleibt sie für die laufende Sitzung erhalten. Alle drei Navigationseinstiege verwenden dieselbe Auflösung. Explizite Kalenderadressen, Datumswechsel und der Browser-Zurück-Knopf behalten ihre eigene Ansicht; eine feste Vorgabe gilt beim erneuten Öffnen über die Navigation.

Tag und Woche füllen den verfügbaren Hauptbereich. Tagesköpfe und Ganztagstermine liegen außerhalb des scrollbaren Stundenrasters. Sehr viele Ganztagstermine erhalten einen begrenzten eigenen Scrollbereich. Die Aufgabenliste bleibt darunter sichtbar und scrollt unabhängig. Das Stundenraster startet bei 7 Uhr; Aktualisieren der Daten setzt die Scrollposition nicht zurück. Auch bei schmalen Fenstern bleibt die Werkzeugleiste unterhalb des Titels.

Geprüft: persönliche Speicherung und Validierung in PostgreSQL, feste Vorgaben und Kontotrennung des letzten Browserstands, gesperrter Browserspeicher sowie Browser-Vorschau der echten Komponenten bei 1280 und 390 Pixeln. Beim Scrollen der Stunden bleiben Kopf, Ganztagsbereich und Liste ortsfest; Seitenhöhe und -breite bleiben innerhalb des Fensters. Monatswiederbesuch und feste Tagesvorgabe wurden über die Vorschau bedient.
