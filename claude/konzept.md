# SOTE — Konzept und Festlegungen

Stand: 2026-09-07. **Nichts davon ist gebaut.** Dieses Dokument hält fest, was
entschieden ist, bevor gezeichnet wird, und was ausdrücklich offen bleibt. Es
ist das Gegenstück zu `claude/navigationsmodell.md` und
`claude/markensystem-entscheidung.md` im SONE-Repo und zitiert dessen ADRs, wo
eine Regel von dort übernommen wird.

Reihenfolge des Vorgehens: **dieses Papier → Canvas mit Artboards → ADRs →
Bau.** Derselbe Weg, der bei Markensystem und Navigationsmodell funktioniert
hat.

---

## 1. Was SOTE ist

**S**elfhosted **O**pensource **T**asks for **E**veryone. Ein selbst
gehostetes Aufgabenwerkzeug, das für sich allein eine hervorragende App ist und
mit SONE verknüpft werden kann.

Die Namensfamilie ist `SO_E`: Position drei nennt den Gegenstand, der Rest ist
die Signatur. SONE = Notes, SOTE = Tasks. Der Preis ist bekannt und wurde
bewusst bezahlt: ein Buchstabe Unterschied in der Mitte sieht in Logzeilen und
Dateipfaden nach Tippfehler aus. Dafür gehören die beiden erkennbar zusammen,
und sie werden ohnehin fast immer als Paar genannt.

Signet: dieselbe Geometrie wie SONE (ADR-0068) — vier Zeilen, Tuschekasten
12–88 waagerecht und 16–88 senkrecht, die dritte Zeile im Akzent —, aber
**jede Zeile beginnt mit einem Punkt, dann ein Abstand, dann die Linie.** Punkt
9 × 9 auf der ursprünglichen Startkante, Abstand 7, Linie bis zur alten rechten
Kante 88.

Zwei Gründe für diese Fassung und gegen die beiden zuerst gezeichneten
(Akzentbalken durchgestrichen; Akzentbalken durch ein Häkchen ersetzt):

- Sie liest sich als **Liste von Dingen** statt als ein durchgestrichenes Ding,
  und sie behält den Akzentbalken für den Workspace-Ton (ADR-0023), statt ihn
  für ein Häkchen auszugeben.
- Sie unterscheidet sich in **allen vier Zeilen**. Zwei Marken, die sich um
  einen Balken unterscheiden, sind in einer Tab-Leiste mit beiden Anwendungen
  nicht auseinanderzuhalten.

Punkt + Abstand = 16 ist genau der Einrückungsschritt, also steht jeder Punkt in
der Spalte, in der die Zeile darüber ihre Linie beginnt. Die Linien messen
60 / 44 / 28 / 44 — SONEs Rampe um einen Schritt versetzt, als Folge des
Abstands und nicht als eigene Wahl.

**Offen:** bei 16 px trägt der Abstand nicht mehr. SONE geht dort auf drei
Balken; mit Punkten wäre die dritte Zeile so breit wie ihr eigener Punkt.
Vorschlag ist **zweizeilig für Favicon und Installations-Icons**. Und: Punkt 9 /
Abstand 7 gegen Punkt 8 / Abstand 6 — die zweite Fassung wiegt etwas mehr, weil
C insgesamt rund ein Fünftel Fläche gegenüber SONE verliert. Beides am
Bildschirm zu entscheiden, beides in `design/artboards.html` gezeichnet.

### Der Maßstab

Nicht Vikunja, nicht OpenProject. Der Maßstab ist **Todoist bei der Erfassung
und Things beim Gefühl**, mit SONEs Gestaltung und SONEs Zusammenarbeit.

Die Recherche sagt eindeutig, woran das hängt: bei Things ist das Öffnen sofort,
das Anlegen sofort, keine Ladespinner und keine kurzen Pausen, in denen man
wartet. Das ist der Grund, aus dem Leute über eine Aufgabenverwaltung mit
ungewöhnlicher Zuneigung sprechen — und der Grund, aus dem sich selbst
gehostete Alternativen schlecht anfühlen, obwohl sie mehr Funktionen haben.

**Es ist Latenz, nicht Umfang.** Eine schöne Oberfläche über einer Runde zum
Server pro Tastendruck fühlt sich an wie Vikunja mit besseren Farben.

### Was SOTE nicht ist

Kein Projektmanagement. Im ersten Wurf: kein Kanban, keine Gantt, keine
Zeiterfassung, keine Abhängigkeiten, keine Berichte, keine Vorlagen. Genau daran
verlieren die schlechten Werkzeuge ihre Ruhe.

**Prüfstein für Eigenständigkeit:** die Heute-Ansicht muss vollständig und schön
funktionieren, ohne dass ein einziger SONE-Bezug darin vorkommt. Der
Dokumentkontext ist eine Schicht darüber, kein Fundament.

---

## 2. Eigenständigkeit — die Grundentscheidung

Drei Modelle standen zur Wahl:

1. **Zwei Produkte, zwei Datenbanken**, verbunden über API und OIDC.
2. Ein Server, zwei Oberflächen.
3. Ein geteilter Kern für Identität, Workspaces, Rollen, Gastlinks, Posteingang
   und Suche.

**Gewählt: 1.** Die Funktionen sind gleich benannt — Workspaces, Suche, Rechte,
Posteingang — aber je Produkt anders gebaut. Es braucht keine gemeinsame Basis,
sondern eine Möglichkeit der Verknüpfung.

Der stärkste Einwand gegen 1 war der doppelte Posteingang, und er fällt weg:
SONEs Posteingang beantwortet *„was haben andere geschrieben"*, SOTEs
beantwortet *„was habe ich zu tun"*. Nach ADR-0070 sind das zwei Gegenstände,
also sind zwei Listen keine Verletzung der Regel gegen mehrere Wege in dasselbe
Thema, sondern ihre Anwendung.

Kein geteiltes Schema, keine geteilte Migration, keine geteilte Datenbank.

---

## 3. Das Aufgabenmodell

### Zwei Datumsfelder, nicht eins

Die Unterscheidung, die Things richtig macht und die meisten Werkzeuge nicht
haben: der Zeitpunkt, an dem man **anfangen** will, und die **Frist**. Daraus
fallen die Ansichten von selbst — Heute ist „geplant für heute oder überfällig",
Demnächst ist die Frist, Irgendwann ist ohne beides.

Ein Feld für beides erzwingt die Lüge, dass jede Aufgabe an ihrem Fälligkeitstag
begonnen wird.

### Felder

| Feld | Anmerkung |
|---|---|
| Titel | Text. Eine Zeile. |
| Notiz | Text, länger. Die zweite Stelle mit echtem Freitext. |
| geplant | Zeitpunkt, an dem sie auftauchen soll |
| Frist | Zeitpunkt, an dem sie fällig ist |
| Priorität | vier Stufen, wie Todoist. Keine Zahl ohne Bedeutung. |
| Status | offen/erledigt als Grundfall. **Offen:** ob mehr nötig ist. |
| Projekt | ein Baum, siehe unten |
| Zuweisung | Mitglied oder Gastschlüssel |
| Wiederholung | Regel, siehe unten |
| Sortierung | gebrochener Index, siehe Abschnitt 6 |
| Label | Menge, quer zu Projekten |

### Projekte sind der Baum

Wo SONE Seiten hat, hat SOTE Projekte — im selben Panel, mit demselben
Umschalter im Kopf. Damit ist die Verschachtelung geschenkt: echte
Teilaufgaben mit eigener Fälligkeit und eigener Priorität, nicht bloß
Checklistenpunkte innerhalb einer Aufgabe (Todoist kann das, Things nicht).

**Rechte werden nicht geerbt.** Wer ein Oberprojekt teilt, gibt damit keinen
Zugriff auf die Unterprojekte. Genau ADR-0110s Regel: Rechte werden erklärt,
nicht abgeleitet. Todoist macht es ebenso.

### Wiederholungen

Hier trennen sich gute von mittelmäßigen Werkzeugen. „Jeden zweiten Dienstag"
wird bei Things zur Übung in Frustration, Todoist erkennt es sofort.

Zwei Arten, und sie müssen unterscheidbar bleiben:

- **kalenderfest** — jeden Montag, am 1. des Monats, jeden zweiten Dienstag.
- **erledigungsbezogen** — drei Tage *nachdem* sie das letzte Mal abgehakt
  wurde. Für alles, was aus einem Rhythmus fällt, wenn man es einmal auslässt.

RRULE als Speicherform für den kalenderfesten Fall, weil es das über CalDAV
ohnehin sprechen muss. Der erledigungsbezogene Fall ist keine RRULE und
bekommt eigene Felder.

Eine wiederkehrende Aufgabe erzeugt beim Abhaken die **nächste Instanz**; die
erledigte bleibt als Beleg stehen — zwei Zeilen, nicht eine umdatierte, sonst
gibt es keinen Beleg. Kein Job weckt sie: die Uhr geht vorbei, wie beim
Zurückstellen in ADR-0075.

Drei Festlegungen zum Bedienelement (Artboards 2, Blatt 08):

- **Die Art ist die erste Wahl**, keine versteckte Option. Die beiden
  beantworten verschiedene Fragen, und sie im selben Feld zu führen ist der
  Grund, warum sie in anderen Werkzeugen verwechselt werden.
- **Geprüft wird durch die Ausgabe**: unter der Einstellung steht ein Satz in
  normaler Sprache und darunter die nächsten drei Termine, gerechnet. Things
  scheitert bei „jeden zweiten Dienstag" nicht am Rechnen, sondern daran, dass
  man nicht zurücklesen kann, was eingestellt wurde.
- **Der erledigungsbezogene Fall zeigt keinen nächsten Termin**, weil es keinen
  gibt. Er nennt, woraus er entsteht, und den letzten bekannten Stand. Ein
  gerechnetes Datum wäre eine Behauptung über eine Handlung, die noch nicht
  stattgefunden hat.

---

## 4. Die Erfassung

Die Kernfähigkeit, nicht ein Detail. Todoists Quick Add liest Fälligkeit,
Projekt, Priorität und Wiederholung aus einer einzigen Zeile; Things erkennt nur
Datum und Erinnerung, und genau daran ist es in dieser Frage schwächer.

Regeln:

- **Ein Feld.** Kein Dialog, kein Formular, keine acht Bedienelemente.
- Der Cursor steht drin, Enter speichert, **das Feld bleibt offen** für die
  nächste Zeile.
- Ein Kürzel, das es überall öffnet.
- Der Bildschirm zeichnet **Chips für das, was er gelesen hat** — dieselbe
  Lösung wie bei SONEs Suche: das Vokabular wird im Nachhinein auffindbar,
  nicht durch Dokumentation vorher.

Das Parsing ist eine **reine Funktion** und gehört neben den Parser in `core`,
mit `buildTaskQuery` als Gegenstück (wie `buildSearchQuery` in SONE). Deutsch
und Englisch. „Steuerbescheid morgen 9 Uhr #finanzen !!" ist der Testfall, der
in der Suite steht, bevor die Oberfläche existiert.

**Offen:** ob die Zuweisung im selben Feld steht (`+markus`, wie bei Todoist)
oder nur im Anfasser-Menü.

---

## 5. Navigation — übernommen, nicht neu erfunden

Die Regel aus ADR-0069 gilt unverändert:

- **Spalte 1 (Leiste, 56 px)** wählt den **Modus**. Auf dem Telefon als
  Fußleiste quer (ADR-0074).
- **Spalte 2 (272 px) navigiert** — Projektbaum, Menü von Ansichten. Nie der
  Inhalt.
- **Spalte 3 zeigt**, was Spalte 2 ausgewählt hat.

Dazu die fünf weiteren Festlegungen: Panel-Kopf ist Pflicht; ein Modus ist ein
Ort, an dem man bleibt, keine Handlung; Einstellungen und Verwaltung bekommen
kein Icon und hängen am Kontomenü (ADR-0072); ein Menü beantwortet für einen
Gegenstand (ADR-0070); eine Liste, zwei Zeichnungen — kein Modus darf aus
Schiene oder Fußleiste fallen (ADR-0072/0074).

### Die Modusmenge — Entwurf für Artboard 1

| Modus | Spalte 2 |
|---|---|
| Aufgaben (Signet) | Kopf = Workspace-Umschalter, Rumpf = Ansichten (Heute, Demnächst, Irgendwann) + Projektbaum |
| Suche | Filter und gemerkte Suchen |
| Workspaces | ein Workspace, gewählt |
| Posteingang | was mir zugewiesen wurde, was kommentiert wurde |
| Freigaben | Links, von mir, für mich |
| Papierkorb | ein Workspace |
| Du | kein Modus, abgesetzt |

**Heute ist kein Modus, sondern ein Menüeintrag.** Ein Modus ist ein Ort mit
einem Menü daneben; Heute ist, was das Menü ausgewählt hat. Das Feld über dem
Baum ist der Eingang zur Suche, nicht ein Knopf, der einen Bildschirm mit einem
Feld öffnet.

**Nicht offen:** sieben Einträge tragen. Die ausgelieferte SONE-Fußleiste zeigt
genau diese sieben mit vollen Beschriftungen — Seiten, Suchen, Workspaces,
Posteingang, Freigaben, Papierkorb, Du. Es gibt also keinen Grund zu kürzen und
erst recht keinen, gegen ADR-0072 zwei Modi zusammenzulegen. Die Reihenfolge
oben folgt der Leiste, wie sie steht.

---

## 6. Echtzeit — SONE-Niveau, anderer Apparat

**Der Anspruch ist gleich hoch. Das Werkzeug ist ein anderes.**

Die Lebendigkeit in SONE kommt nicht aus Yjs, sondern aus dem Notify-Rahmen
(ADR-0093): Trigger auf die Tabelle → `pg_notify` → `UpdateBus` → Hook im
Browser. Dieser Apparat ist übertragbar wie er ist, samt der Lehre aus
ADR-0076: **jeder Push-Test gibt dem Bus die datei-eigene Testdatenbank**, sonst
hört er jahrelang auf der falschen zu und die Suite bleibt grün.

Was Yjs zusätzlich kann, ist zeichenweises Verschmelzen gleichzeitigen Tippens
in einem Textfeld. Das zählt an genau zwei Stellen: **Titel** und **Notiz**.
Alles andere sind Felder, und für Felder ist der jüngste Schreiber pro Feld mit
Server-Sequenz die richtige Antwort — sie fühlt sich sofort an, weil sie lokal
optimistisch ist.

### Local-first ist Pflicht, nicht Ausbaustufe

Jede Änderung landet zuerst lokal und rendert sofort; der Server ist der
Abgleich. Lokaler Speicher plus Änderungsprotokoll pro Aufgabe mit feldweiser
Auflösung. Kein Speichern-Knopf, kein Spinner, kein Modal.

### Die Sortierung ist die eigentliche Ingenieursarbeit

Zwei Leute ziehen gleichzeitig Zeilen. Mit ganzzahligen Positionen springen die
Reihen, und zwar sichtbar. Deshalb ein **gebrochener Index zwischen den
Nachbarn** statt einer Nummer, mit definierter Behandlung des Falls, dass der
Abstand aufgebraucht ist.

Das gehört ins Konzept und nicht in die Umsetzung als Überraschung.

### Anwesenheit

Wer schaut auf dieses Projekt, wer bearbeitet diese Aufgabe. Vorläufer ist
`writersIn` und die Leute-Spalte aus ADR-0116 — samt deren Lehre: **eine Liste,
die „inkonsistent" gemeldet wird, ist meistens vollkommen konsistent zu einer
anderen Frage.** Die Anzeige muss sagen, welche Frage sie beantwortet.

---

## 7. Zusammenarbeit und Rechte

Aus SONE übernommen: Rollen als Zeile mit einer **Leiter** und einer **Menge**
(hier `list_level` statt `page_level` plus `rights`), Systemrollen unverändert
und unlöschbar, Eigentümerschaft als Spalte und nicht als Recht,
`level = NULL` heißt wirklich nichts (ADR-0110). Freigaben erweitern, eine
Deckelung senkt und hängt am Gegenstand, nicht an der Person.

Von Todoist übernommen, weil schlicht und richtig:

- **Wer eine Aufgabe sehen kann, kann sie zuweisen.** Keine eigene Berechtigung
  fürs Delegieren.
- Kommentare und Dateien liegen **in der Aufgabe**, damit Diskussion und
  Material im Kontext bleiben.
- Zugewiesene werden benachrichtigt, per Glocke und per Mail.
- Direkte Links auf Projekt, Abschnitt, Aufgabe und Kommentar.

### Der Link (Artboards 2, Blatt 09 und 10)

Leute und Link sind **zwei Reiter**, weil es zwei Dinge sind: Leute sind
Entscheidungen über Personen, ein Link ist eine Fähigkeit, die frei herumliegt
und von jemandem weitergegeben werden kann, der nie etwas bekommen hat
(ADR-0088).

- **Zurückziehen ja, umstufen nein.** Ein Link, dessen Rechte man ändern kann,
  ist ein zweiter Ort für Rechte.
- **Keine Vererbung auf Unterprojekte.** Jedes braucht seine eigene Freigabe.
- **Ein Name wird verlangt, bevor ein Gast schreibt.** Lesen geht vorher. Der
  Grund ist nicht Höflichkeit: ein Gastschlüssel ist keine uuid, und wer ohne
  Konto schreibt, muss in jeder Liste benennbar sein.
- Der Gast sieht **ein Projekt**, keine Schiene, keinen Workspace.

Der Freigaben-Modus hat drei Ansichten in dieser Reihenfolge: Links, von mir,
für mich. Zahlen aus der Liste, die der Bildschirm ohnehin hält, und keine Null.

**Voraus vor Todoist:** Freigabe per Link mit Bearbeitung an Leute ohne Konto.
Bei Todoist braucht Mitarbeit eine Einladung. SONEs Gastschlüssel (ADR-0046)
können das schon — mit der bekannten Falle: ein `guest:`-Schlüssel ist keine
uuid, und jede Projektion, die ihn in eine uuid-Spalte schreibt, reißt die ganze
Transaktion mit (ADR-0091/0092). Das ist hier von Anfang an einzuplanen, nicht
dreimal nachträglich zu finden.

**Offen, und vor dem ersten Nutzer zu entscheiden:** die Eigentumsregel.
Todoists Fassung ist gut — Teamprojekte gehören dem Team, persönliche bleiben
privat, auch wenn jemand das Team verlässt. Was passiert mit den Zuweisungen
einer Person, die geht?

---

## 8. Die Verknüpfung mit SONE

### Gekoppelt wird ein Projekt, nicht ein Workspace

Ein SONE-Workspace koppelt an ein SOTE-**Projekt**. Präziser für die
Rechteaussage, und es hält den Fall klein.

### Die Kopplung ist eine Rechteaussage, keine ID-Zuordnung

Wenn ein SONE-Block Titel und Datum einer Aufgabe zeigt, sieht jeder, der die
Seite lesen darf, Inhalt aus dem anderen System — vorbei an dessen Rechten. Zwei
getrennte Rechteverwaltungen heißen, dass jede für ihre eigenen Daten zuständig
bleibt.

Also ist die Kopplung ein **ausdrücklicher, einmaliger Akt** von jemandem, der
beide Seiten verwalten darf: *dieser Workspace und dieses Projekt gehören
zusammen, und wer hier lesen darf, darf dort diese Aufgaben lesen.* Nicht
ableitbar, nicht automatisch, umkehrbar. Ohne Kopplung zeigt der Block nur, dass
dort eine Aufgabe liegt.

### Der Anker ist der Block, nicht die Seite

`/`-Menü in SONE → **Neue Aufgabe (SOTE)**. Die erste Aufgabe legt das Projekt
an, jede weitere im **selben Block** landet darin. Zwei Listen auf einer Seite
sind zwei Projekte, und das ist richtig.

Wenn stattdessen jedes Einfügen ein Projekt anlegte, hätte man nach drei
Aufgaben drei Projekte.

Der zweite Weg endet im gleichen Zustand: eine **bestehende** SOTE-Liste in SONE
auswählen und dort weiterführen.

### SONE löscht in SOTE nie etwas

Hart. Block entfernt, Seite gelöscht, Workspace weg — das Projekt lebt weiter
und ist in SOTE auffindbar. Sonst wäre ein Tastendruck in einem Textdokument
eine Löschung in einem anderen System, und für den Weg „bestehende Liste
einbinden" wäre es offensichtlich falsch.

### Eine Wahrheit pro Feld, plus eine Anzeigekopie

Die Aufgabe lebt in SOTE. Der SONE-Block hält die Id und eine Kopie für die
Anzeige, damit die Seite lädt, wenn SOTE gerade nicht da ist. Die Kopie ist
**nie bearbeitbar** und **sagt, dass sie eine Kopie ist**, mit sichtbarem
Verfallszustand. „In SOTE gelöscht" braucht eine sichtbare Antwort im Block,
kein stilles Verschwinden.

Umgekehrt trägt die Aufgabe die Herkunftsseite als Rückverweis, gespeichert als
URL plus Titel — er muss auch funktionieren, wenn SONE unerreichbar ist.

Nebenbefund: eine Seite mit fremden Aufgaben ist nicht mehr in sich
abgeschlossen. Export, Backup und Versionierung nehmen die Anzeigekopie. Das ist
ehrlich und muss dokumentiert sein.

### Das Anfasser-Menü schreibt durch

Datum, Priorität, Sortierung, Status im Anfasser-Menü ändern den Wert **in
SOTE**. Damit ist das Fehlerverhalten Teil des Entwurfs:

- **Abhaken ist optimistisch** — die schnelle Handlung, mit sichtbarem
  Rücksprung bei Fehlschlag.
- **Alles andere nicht optimistisch**, wie das Entfernen im Posteingang
  (ADR-0115). Ein Datum, das gesetzt aussieht und nirgends steht, ist schlimmer
  als eins, das eine halbe Sekunde braucht.

### Identität

Zwei Kontosysteme brauchen eine belastbare Zuordnung. SONE ist OIDC-**Client**
(ADR-0024, ADR-0082), nicht Provider. Zwei Wege, beide nötig:

1. Beide sprechen gegen **denselben Anbieter** — dann ist die Zuordnung
   geschenkt.
2. **Verbindung pro Person** über ein Token, das man in den eigenen
   Einstellungen anlegt.

Daraus folgt: die Kopplung kennt **zwei Zustände** — Workspace gekoppelt, und
ich persönlich verbunden. Das `/`-Menü darf nur anlegen, wenn beide stehen.

### Das Protokoll bleibt klein

REST plus Webhook, versioniert, idempotent, mit Wiederholung. Wenn ein Aufruf
drei Tabellen im anderen System kennen muss, ist die Grenze falsch gezogen.

---

## 8a. Der Papierkorb

**Erledigt ist nicht gelöscht.** Eine abgehakte Aufgabe ist ein Ergebnis und
bleibt in ihrem Projekt; eine gelöschte ist ein Irrtum und liegt im Papierkorb.
Der Papierkorb zeigt darum nichts Abgehaktes, und Abhaken bringt nichts dorthin.
In vielen Werkzeugen ist das verwischt, und dann ist die Frage „wo ist die
Aufgabe von letzter Woche" nicht mehr beantwortbar.

Aufbau wie SONEs Papierkorb: Suchfeld über dem Menü, Ansichten mit Zählern,
Hineinschauen. Und derselbe Fall, der dort „Wiederherstellen nach…" nötig
gemacht hat: **eine gelöschte Aufgabe kann ein Projekt haben, das es nicht mehr
gibt** — dann wird ein Ziel verlangt, sonst entsteht eine Aufgabe, die nirgends
liegt.

---

## 9. Erinnerungen

Vorhanden und übertragbar: der Notify-Rahmen für die Glocke (ADR-0093), das
Mail-Relay samt Antwort per Mail (ADR-0060, ADR-0078), die Job-Queue für
Digests (ADR-0081).

**Eine Uhrzeit ist eine Erinnerung.** Diese Regel ersetzt einen Schalter: wer
„morgen 9 Uhr" tippt, will um 9 Uhr etwas hören; wer „morgen" tippt, will die
Aufgabe morgen in der Liste sehen. Ohne sie muss jede Aufgabe zweimal
eingestellt werden, und das ist der Grund, warum Erinnerungen in den meisten
Werkzeugen eine Funktion sind, die niemand pflegt.

**Und hier ist die erste Stelle, die einen Wecker braucht.** Zurückstellen kommt
ohne Job aus, weil nichts weckt (ADR-0075) — eine Erinnerung ist das Gegenteil
und muss zu einem Zeitpunkt etwas tun. Deshalb kommt die Job-Queue von Anfang an
mit und nicht später.

Die Zeile im Posteingang trägt **Handlungen**, nicht nur eine Meldung: abhaken,
in drei Stunden, morgen früh — dieselben drei Zeiten wie beim Zurückstellen. Eine
Benachrichtigung, die man nur wegklicken kann, erzeugt eine zweite Aufgabe: sich
an sie zu erinnern. Die Mail geht erst, wenn niemand hinsieht; ein Wecker, der
gleichzeitig klingelt und schreibt, ist zweimal dieselbe Nachricht.

### CalDAV: SOTE ist die Wahrheit, CalDAV ist ein Fenster

Daraus folgt die eine Regel, die diesen Weg sicher macht: **ein Schreibzugriff
von außen berührt nur die Felder, die er selbst tragen kann.** Was ein fremder
Client nicht ausdrücken kann, darf er nicht löschen können — sonst nimmt eine
Apple-Erinnerung, die von Wiederholung nach Erledigung nichts weiß, beim ersten
Abhaken die Wiederholung mit. Das ist dieselbe Regel wie „eine Wahrheit pro
Feld", nur von der anderen Seite.

Die vollständige Feldabbildung samt der vier Verluste steht in
`design/artboards-3.html`, Blatt 13. Vier Zeilen mit Verlust: Priorität (vier
Stufen auf drei), Teilaufgaben (Norm ja, Clients unterschiedlich), Wiederholung
nach Erledigung (kein Gegenstück — hakt ein fremder Client ab, rechnet SOTE die
nächste), Zuweisung und Kommentare (werden nicht geschrieben, damit nichts
behauptet wird).

Dass VTODO `DTSTART` **und** `DUE` von Haus aus kennt, ist der Grund, aus dem
die Trennung von geplant und Frist hier keinen Preis hat.

Zugang pro Gerät mit eigenem Kennwort, nicht dem Anmeldekennwort: es wird in
einer fremden App gespeichert und ist dort auslesbar. Einzeln zurückziehbar.

**CalDAV (VTODO) ist der Hebel für Mobil.** Wer VTODO spricht, wird von Apple
Erinnerungen, Tasks.org und anderen bedient — mobile Benachrichtigungen ohne
eigene App und ohne APNs/FCM. Das ist vor der eigenen Mobil-App zu bauen, nicht
danach.

Eine PWA mit lokalem Speicher trägt weiter als erwartet, **weil** der spürbare
Unterschied zu einer nativen App vor allem Latenz ist und nicht der Rahmen.

**Offen:** Ort. Als Metadatum trivial, als Auslöser braucht es Geofencing und
damit eine native App. Im ersten Wurf ist Ort ein Feld, keine Erinnerung.

---

## 9a. Einstellungen und die Kopplung als Vorgang

**Einstellungen sind du, Verwaltung ist der Server** (ADR-0072). Zwei getrennte
Bereiche, beide ohne Symbol in der Schiene, beide am Kontomenü. Der
Arbeitsbereich liegt dazwischen, weil er weder das eine noch das andere ist.
Eigener Vollbildbereich, Liste links und Abschnitt rechts, auf dem Telefon zwei
Ansichten hintereinander. Karten mit Zeilen, jede Zeile ein Ding mit einer
Erklärung darunter.

**Die Kopplung ist ein Satz, den jemand liest und bestätigt** — kein Häkchen an
einem Feld namens „SONE-Integration":

> Wer den Workspace **X** lesen darf, darf die Aufgaben des Projekts **Y**
> lesen. Wer dort schreiben darf, darf sie abhaken und ändern.

Sie wird nicht aus den Rollen abgeleitet, sondern hier erklärt, und ist jederzeit
aufhebbar. **Aufheben nimmt in SONE nichts weg**, es hört nur auf, Aufgaben zu
zeigen.

Drei Zustände, und jeder sagt, was fehlt: nicht eingerichtet · Workspace
gekoppelt, ich noch nicht verbunden · verbunden. Beide müssen stehen, bevor in
SONE ein Menüeintrag erscheint — ein Workspace kann gekoppelt sein, während die
Hälfte des Teams noch keine Verbindung hat.

---

## 10. Offene Entscheidungen

1. Status — binär oder mehr?
2. Zuweisung in der Schnellerfassung oder nur im Anfasser-Menü?
3. Die Benachrichtigungen ins Profil, in **beiden** Werkzeugen? Dann sind es
   sechs Einträge statt sieben. Das ist eine gemeinsame Entscheidung über beide
   Produkte und keine über SOTE allein — und sie **dreht ADR-0092 um**, das das
   Abzeichen ausdrücklich vom Profilbild auf die Glocke gelegt hat. Die
   Begründung dort war, dass ein Abzeichen nicht auf einem Bedienelement sitzen
   darf, das ein Menü öffnet, in dem die Benachrichtigungen nicht liegen. Wenn
   sie ins Profil wandern, liegen sie darin, und dieselbe Regel führt zur
   umgekehrten Platzierung. Das ist zulässig, muss aber als Begründung
   aufgeschrieben werden und nicht als Aufräumen durchgehen.
4. Eigentum von Projekten und Zuweisungen, wenn jemand geht.
5. Ob ein Link **ohne Ablauf** überhaupt angeboten wird. Sicherheitsfrage, keine
   gestalterische. Blatt 10 zeigt einen solchen Link, damit man sieht, wie er
   sich in der Liste liest.
6. Wie viel ein Gast von anderen Gästen sieht.
7. Der Zähler „2 Gäste haben geschrieben" in Blatt 10 beantwortet eine Frage,
   die noch nicht geprüft ist. Nach ADR-0116 ist das die gefährlichste Sorte
   Anzeige — sie ist konsistent zu *irgendeiner* Frage, und welche das ist, muss
   vor dem Bau feststehen.
8. Die dreißig Tage im Papierkorb sind aus SONE übernommen, ohne nachgesehen zu
   haben, ob dort dieselbe Zahl steht.
9. Der Löschweg für ein ganzes Projekt: was mit den Aufgaben darin passiert und
   ob sie einzeln wiederherstellbar bleiben.
10. Die Frist, nach der die Erinnerungsmail geht (im Blatt zehn Minuten, aus dem
    Bauch). Gehört zu den Einstellungen, die nach ADR-0111 über
    `check-env-numbers` abzusichern sind, sonst erreicht die Zahl den Container
    nie.
11. Vier Prioritätsstufen auf drei abbilden, oder draußen nur drei anbieten und
    den Preis innen zahlen.
12. Welches Recht auf SONE-Seite eine Kopplung setzen darf — `people.manage`,
    `roles.manage` oder Seitenstufe `admin`.
13. Ein Workspace zu **mehreren** Projekten. Alle Blätter zeigen eins zu eins;
    der Blockanker erlaubt technisch mehr.
14. Was beim Trennen mit den Anzeigekopien in SONE passiert: als „nicht mehr
    gekoppelt" markiert, oder als reiner Text weiterleben?

### Entschieden am 2026-09-07: die Reihenfolge

**SOTE ist in erster Linie eine eigenständige Aufgaben-App.** Die Verbindung zu
SONE ist optional, aber sinnvoll.

Damit ist die offene Frage nach der Reihenfolge beantwortet: erst SOTE allein
bis zur Heute-Ansicht, dann die Kopplung. Der Prüfstein aus Abschnitt 1 gilt als
Abnahmekriterium — braucht die Heute-Ansicht die Kopplung, um gut zu sein, ist
es kein eigenständiges Produkt.

Praktische Folge für den Entwurf: **jede Stelle, an der SONE vorkommt, muss
einen definierten Zustand für „nicht verbunden" haben** — und der ist nicht
„ausgegraut", sondern „gar nicht da". Der Eintrag *Neue Aufgabe (SOTE)* im
`/`-Menü existiert nur bei bestehender Kopplung, das Herkunftsfeld einer Aufgabe
erscheint nur, wenn es eine Herkunft gibt, und die Einstellungen zeigen die
Kopplung als etwas, das man einrichten kann, nicht als etwas, das fehlt.

---

## 11. Was aus SONE mitkommt, ohne neu entschieden zu werden

- Tokens dreischichtig, warme Neutralrampe, Radien 2/2/4, Archivo +
  JetBrains Mono selbst ausgeliefert (ADR-0028, ADR-0068).
- **Die color-mix-Falle:** der Fallback eines Tint-Mixes ist immer die eigene
  Basisfarbe der Fläche. `transparent` ist `rgb(0 0 0 / 0)`, nicht „nichts".
- **Ein Token-Paritätstest**, der Hell und Dunkel als gleichrangige Listen
  hält — und die Lehre, dass er Namen vergleicht und keine Werte.
- Die Einstiegs-Regel: drei Wege in dasselbe Thema sind keine Verbesserung. Die
  Ortsliste lebt genau einmal.
- Scripted guardrails: `check-routes-reachable.mjs`,
  `check-adr-references.mjs` — und dessen Lehre: **die Nummer wird geprüft, das
  Thema nicht.**
- `check-env-numbers.mjs` und `check-env-reaches-container.mjs`.
- **Der Durchgang.** Nicht „ist der Code gut", sondern **„hat das je etwas
  ausgeführt"** — pro Schritt der Kette. Und: ein Punkt auf so einer Liste ist
  eine Frage zum Nachprüfen, nie eine Beschreibung zum Danach-Handeln.
