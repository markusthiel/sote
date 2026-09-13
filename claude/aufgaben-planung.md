# Datum, Uhrzeit, Ganztägig und Dauer direkt an Aufgaben

Stand: 13.09.2026.

In den Aufgabeneigenschaften **Geplant** öffnen oder im Menü einer Aufgabenzeile **Datum, Uhrzeit und Dauer …** wählen. Beide Wege verwenden denselben Planungsdialog. Datum auswählen, **Ganztägig** nach Bedarf ausschalten und eine Uhrzeit eingeben. Als Dauer gibt es **15 Minuten**, **30 Minuten**, **1 Stunde**, **2 Stunden**, eine freie Eingabe wie `45 min` oder `1:30 h` und **Ohne Dauer**. **Übernehmen** speichert die Angaben gemeinsam; **Abbrechen** verwirft den Entwurf. Die bisherigen schnellen Datumsvorgaben und das eigenständige Dauerfeld bleiben verfügbar.

Die Eingabe verwendet die örtliche Browserzeit und wandelt erst den vollständigen Zeitpunkt in UTC um. Eine durch die Zeitumstellung ausfallende Uhrzeit wird abgelehnt. Ohne Datum lässt sich weiterhin eine Dauer schätzen. Bei Ganztagsterminen bleibt die Dauer eine Aufwandsschätzung und verlängert den Kalendertermin nicht auf mehrere Tage.

Es werden die vorhandenen Aufgabenfelder `planned`, `plannedAllDay` und `duration` verwendet; keine Migration und keine neue Kalenderanbindung. Zeitgebundene Aufgaben erscheinen im Stundenraster; 15 Minuten werden nun auch dort als Viertelstunde gezeichnet. Ganztägige Aufgaben erscheinen oben. Bestehende ICS-/CalDAV-Ausgabe und Google-/Microsoft-Übertragung verwenden dieselben Aufgabenfelder.

Geprüft: vier neue Tests für lokale Uhrzeiten, Datum/Dauer-Rücklesen, Ganztag, freie Dauer, ungültige Werte und Sommerzeitlücken; insgesamt 96 Webtests sowie 31 vorhandene Dauer- und ICS-/CalDAV-Tests. Browserprüfung der echten Komponenten mit simulierter API: manuelle 14:35 Uhr, 15-Minuten-Block, freie 90 Minuten, Wechsel auf Ganztägig, Entfernen der Dauer, Wiederöffnen, Abbrechen und Validierung. Dialog bei 320 × 568 innerhalb des Fensters ohne horizontalen Überlauf.
