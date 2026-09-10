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

**Entschieden: Punkt 9, Abstand 7. Und das Favicon bleibt dreibalkig**, wie bei
SONE — keine zweizeilige Sonderfassung.

Daraus folgt eine Rechnung: in SONEs dreibalkigem Raster (Linien 80 / 58 / 36)
wäre die dritte Linie mit Punkten nur 14 Einheiten lang, genau so breit wie ihr
eigener Punkt. **Also wird das Raster für diese Größe neu ausbalanciert statt
die Zeilenzahl zu ändern:** Punkt 13, Abstand 11, Einrückungsschritt 16 statt 22,
Linien 56 / 40 / 24. Bei 48 px wieder vierzeilig, wie in SONE.

Der Abstand misst bei 16 px 1,76 Pixel, und das entscheidet das Rendering des
Browsers und nicht die Geometrie. **Der einzige gültige Test ist eine Tab-Leiste
mit beiden Anwendungen.** Läuft es dort zu, ist der Ausweg Punkt 11 bei
Abstand 13 — nicht eine zweite Zeile.

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
| Status | offen/erledigt. Binär, siehe Abschnitt 10. |
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

Die Zuweisung steht **im selben Feld** (`+markus`, wie bei Todoist) und nicht
nur im Anfasser-Menü — sie war der einzige Grund, nach dem Anlegen noch etwas
anfassen zu müssen.

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
Nachbarn** statt einer Nummer.

**Und dabei liegt eine Falle, die SONEs Fassung nicht hat.** Gefunden beim Bauen
durch den Test „zwei gleichzeitige Einfügungen in dieselbe Lücke":
`generateKeyBetween` ist **deterministisch**. Zwei Transaktionen, die dieselben
Nachbarn lesen, rechnen denselben Schlüssel und schreiben ihn beide — danach ist
die Reihenfolge zwischen den zwei Zeilen undefiniert und kippt von Abfrage zu
Abfrage. In SONE fällt das nicht auf, weil die Schlüssel dort in Yjs liegen und
ein CRDT eine eigene Gleichstandsregel hat. **Eine Tabelle hat keine.**

Zwei Dinge machen es dicht:

- Ein Unique-Index über `(workspace_id, project_id, parent_id, sort_key)` mit
  **`NULLS NOT DISTINCT`** (Migration 0003). Ohne diesen Zusatz hätte der Index
  genau die Zeilen nicht geschützt, um die es am häufigsten geht: Postgres hält
  zwei NULLs standardmäßig für verschieden, und `project_id` ist oft NULL.
- **Der rechte Nachbar kommt aus der Datenbank, nicht aus der Anfrage.** Der
  erste Versuch wiederholte den Vorgang mit denselben Nachbar-*Ids* und rechnete
  deshalb endlos denselben Schlüssel. Jetzt wird nach dem *nächsten vorhandenen*
  Schlüssel hinter dem linken Nachbarn gefragt; nach dem ersten Gewinner ist das
  seiner, die Lücke ist kleiner, und die Wiederholung endet. `beforeId` aus der
  Anfrage dient nur noch der Prüfung: eine vertauschte Angabe ist eine veraltete
  Ansicht und keine Anweisung.

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
Hineinschauen. **Und ohne automatisches Leeren** — SONE hat keines, und eine
Frist, die von selbst löscht, ist eine Löschung, die niemand angeordnet hat. Die
Zeile zeigt darum das Alter, nicht eine Restzeit. Und derselbe Fall, der dort „Wiederherstellen nach…" nötig
gemacht hat: **eine gelöschte Aufgabe kann ein Projekt haben, das es nicht mehr
gibt** — dann wird ein Ziel verlangt, sonst entsteht eine Aufgabe, die nirgends
liegt.

---

## 8b. Anhänge

Bilder und Dokumente an einer Aufgabe. Entschieden am 2026-09-07, gezeichnet in
`design/artboards-4.html`; **nichts davon ist gebaut.**

### Wo ein Anhang hängt

**An der Aufgabe, nicht am Kommentar.** Blatt 05 sagt es schon für Kommentare
und Dateien: beides liegt *in* der Aufgabe, damit Diskussion und Material im
Zusammenhang bleiben. Ein Anhang trägt optional den Kommentar, in dem er
auftauchte — als Herkunftsangabe und nicht als Besitzverhältnis. Umgekehrt
verschwände er mit einem gelöschten Kommentar, und das ist der Fall, den niemand
erwartet.

### Nur `local`, und keine Variable für etwas anderes

SONEs ADR-0107 ist hier die Warnung und nicht das Vorbild: dort stand `s3` in
der Beispieldatei, mit sechs Einstellungen darunter, und **nichts hatte es
implementiert.** Die Uploads gingen trotzdem auf das lokale Volume, und die
Sicherung übersprang dieses Volume dann, weil das Flag behauptete, die Dateien
lägen woanders.

Also: ein Volume, keine `SOTE_STORAGE_BACKEND`. Kommt ein zweites Backend, kommt
die Variable mit ihm.

### Bilder wie in SONE (ADR-0029)

Im Browser verkleinern, **bevor** etwas hochgeht. Original plus Web-Variante bis
2048 px. Das kommt geprüft aus SONE, und beide Systeme verhalten sich dann
gleich — ein Bild, das in SONE anders ankommt als in SOTE, wäre eine Frage, die
niemand beantworten will.

### Ein Freigabelink lädt nicht hoch

Der Punkt, an dem Anhänge und Gastlinks zusammenstoßen: wer den Link hat, darf
schreiben, und schreiben hieße dann hochladen — ohne Konto, ohne Namen, bis die
Platte voll ist. Der Pflicht-Ablauf aus Blatt 09 begrenzt das zeitlich, nicht
mengenmäßig.

**Entschieden: über einen Link wird nicht hochgeladen.** Ein Kontingent wäre die
andere Antwort, und es ist die schlechtere: eine Zahl, die niemand pflegt, und
ein Gast, der beim Hochladen abgewiesen wird, ohne vorher zu wissen, dass es
eine Grenze gab. Wer hochladen soll, bekommt ein Konto.

Gäste **sehen** Anhänge. Lesen ist keine Menge.

### Der Papierkorb sagt, wie viel er hält

„Kein automatisches Leeren" (Abschnitt 8a) bleibt richtig: eine Frist, die von
selbst löscht, ist eine Löschung, die niemand angeordnet hat. Aber die
Begründung stand unter der Annahme, dass eine weggeworfene Aufgabe eine
Textzeile ist. Mit Anhängen liegt darin ein PDF von zwölf Megabyte, und der
Papierkorb wird ein Verzeichnis, das nur wächst.

**Ergänzung statt Umkehr: der Papierkorb nennt seine Größe**, je Eintrag und
gesamt. Eine Zahl, die man sieht, ist der ehrliche Ersatz für eine Frist, die
man nicht will.

### Die Sicherung wird zweiteilig

Bis jetzt ist der ganze Zustand von SOTE ein `pg_dump`. Mit Dateien liegt die
Hälfte auf einem Volume, und ein Datenbankabzug allein ist dann **kein**
Wiederherstellungspunkt mehr. Dazu gehört der Waisen-Sweep aus ADR-0109 —
Dateien ohne Zeile —, und dessen Lehre war, dass das Schema einen anderen Sweep
beschrieb als den, der gebraucht wurde. Also erst die Frage stellen, welche
Richtung verwaist, und dann den Sweep schreiben.

### Was geprüft wird, und wo

- **Typ und Größe serverseitig**, nicht nur im Browser. Eine Grenze, die nur der
  Browser kennt, ist keine.
- **Der Typ aus dem Inhalt**, nicht aus der Endung und nicht aus dem
  `Content-Type` der Anfrage: beides schreibt der Absender.
- **Ausgeliefert wird mit `Content-Disposition: attachment`** und
  `X-Content-Type-Options: nosniff`, außer bei Bildern, die inline gezeigt
  werden. Eine hochgeladene HTML-Datei, die im selben Ursprung wie die
  Anwendung geöffnet wird, ist der Sitzungskeks in fremder Hand.

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

## 10. Beschlossen am 2026-09-07

Die Liste der offenen Punkte ist durchgegangen. Was hier steht, ist entschieden
und braucht beim Bau keine zweite Runde.

**Datenmodell**

- **Status ist binär.** Offen und erledigt, nichts dazwischen. „In Arbeit" ist
  der Anfang von Projektmanagement, und ein dritter Wert braucht sofort eine
  Spalte, in der man ihn sieht. Zwischenstände sind Teilaufgaben.
- **Priorität: vier Stufen innen, drei außen.** Die vierte heißt über CalDAV
  „ohne Priorität" statt einer eigenen Zahl. Dann stimmt der Rückweg, und der
  Preis liegt innen, wo wir ihn kennen, statt in einem fremden Client.
- **Projekte gehören dem Arbeitsbereich, nicht der Person.** Wer geht, hinterlässt
  seine Zuweisungen **leer**; die Aufgaben erscheinen unter „ohne Zuständigen".
  Umhängen wäre eine Entscheidung, die die Software an unserer Stelle trifft.
- **Ein Projekt löschen** nimmt seine Aufgaben mit, als **ein** Eintrag im
  Papierkorb unter „Projekte". Wiederherstellen holt beides. Einzelne Aufgaben
  daraus sind nicht einzeln wiederherstellbar — sie bräuchten ein Ziel, das es
  nicht gibt.
- **Kein automatisches Leeren des Papierkorbs.** SONE hat keines (nachgesehen:
  `SONE_WORKSPACE_RETENTION_DAYS` gilt für gelöschte Workspaces, `archived_at`
  fasst niemand an), und eine Frist, die von selbst löscht, ist eine Löschung,
  die niemand angeordnet hat. Die Zeile zeigt das Alter, nicht eine Restzeit.

**Erfassung**

- **Die Zuweisung steht in der Erfassungszeile**, als `+name`. Sie war der
  einzige Grund, nach dem Anlegen noch etwas anfassen zu müssen, und das
  widerspricht dem Zweck des einen Feldes.

**Freigabe und Gäste**

- **„Ohne Ablauf" wird nicht angeboten.** Vorgabe 30 Tage, Höchstwert ein Jahr —
  dieselbe Grenze wie beim Zurückstellen in ADR-0075 und aus demselben Grund:
  eine Fähigkeit, die frei herumliegt, soll nicht unbegrenzt herumliegen. Wer
  länger braucht, verlängert.
- **Ein Gast sieht Namen, keine Personen.** An jeder Handlung steht, wer sie
  getan hat, auch bei anderen Gästen. Keine Mitgliederliste, keine Profile.
  „Wer hat das abgehakt" ist die Frage; „wer hat hier Zugriff" nicht.
- **Der Zähler „2 Gäste haben geschrieben" ist gestrichen.** Er beantwortete
  keine benennbare Frage, und nach ADR-0116 ist genau das der Fall, der später
  als „inkonsistent" gemeldet wird. Stattdessen steht dort, **wann zuletzt
  jemand über diesen Link geschrieben hat** — das beantwortet „lebt der noch",
  also die Frage, aus der man auf diesen Bildschirm kommt.

**Kopplung**

- **`people.manage` darf koppeln.** Die Kopplung sagt, wer Aufgaben lesen darf,
  ist also eine Aussage über den Zugriff von Personen. Seitenstufe `admin` wäre
  falsch: sie handelt über Dokumente, nicht über Leute.
- **Eins zu eins.** Ein gekoppelter Workspace, ein Projekt. Der Blockanker
  erlaubt technisch mehr, aber sobald eine Seite in ein Projekt schreiben kann,
  das die Kopplung nicht nennt, ist die Rechteaussage nicht mehr wahr. Wer zwei
  Projekte braucht, koppelt einen zweiten Workspace.
- **Trennen hinterlässt reinen Text.** Die Anzeigekopie verliert Id und
  Kästchen und wird eine gewöhnliche Liste im Dokument, mit einer Zeile darunter,
  woher sie kam. „Nicht mehr gekoppelt" als Dauerzustand wäre ein Block, der auf
  ewig auf etwas zeigt, das ihn nicht mehr kennt.

**Zahlen**

- **Zehn Minuten bis zur Erinnerungsmail**, als Einstellung. `0` heißt „sofort
  mailen", nicht „nie". **Die Variable existiert vorläufig nicht:** sie war
  gebaut und geprüft, während nichts Mail versendete — genau der Fehler aus
  ADR-0112, wo vierzehn Einstellungen den Container nie erreichten. Sie kommt
  mit dem Mailweg zurück, nicht davor. Eine Einstellung für eine Sache, die es
  nicht gibt, ist eine Zusage, die nichts einlöst.

## 10a. Was offen bleibt

1. **Die Benachrichtigungen ins Profil — zurückgestellt, nicht verworfen.** Es
   ist eine Änderung an **beiden** Produkten und braucht in SONE ein ADR, das
   ADR-0092 begründet umdreht: das Abzeichen liegt dort ausdrücklich auf der
   Glocke, weil es nicht auf einem Bedienelement sitzen darf, das ein Menü
   öffnet, in dem die Benachrichtigungen nicht liegen. Wandern sie ins Profil,
   liegen sie darin, und dieselbe Regel führt zur umgekehrten Platzierung. Für
   SOTE allein zu entscheiden hieße, von der gemeinsamen Leiste abzuweichen —
   der teuerste denkbare Grund dafür.

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

## 10b. Was das Gerippe zusätzlich festgelegt hat

Beim Bauen entschieden, weil es ohne Entscheidung keinen Code gibt:

- **Ein unbekanntes `#projekt` oder `+person` wird gemeldet, nicht erfunden.**
  Ein `#finanzen`, das stillschweigend ein Projekt anlegt, produziert
  Karteileichen; eines, das stillschweigend verschwindet, verliert, was jemand
  gemeint hat. Die Antwort auf `POST /api/tasks` trägt `unknownProject` und
  `unknownAssignees`, damit die Oberfläche fragen kann.
- **Ein zweites `#tag` in einer Zeile wird Schlagwort.** Eine Aufgabe hat ein
  Projekt; ein Zeichen, das erkennbar Syntax ist und trotzdem im Titel landet,
  sieht wie ein Fehler aus.
- **Ob eine Erinnerung existiert, steht in `planned_all_day`** und nicht in
  einem zweiten Schalter. „Morgen" ist ganztägig, „morgen 9 Uhr" nicht — das
  ist die Regel aus Abschnitt 9, als Spalte.
- **Der Anker einer kalenderfesten Wiederholung wandert beim Abhaken mit.**
  Sonst rechnet „jeden zweiten Dienstag" beim zweiten Mal von der falschen
  Woche aus.
- **Eine Frist wandert im gleichen Abstand mit** wie der geplante Tag.
- **Ein Fehler nennt einen maschinenlesbaren Grund** (`no_session`,
  `empty_line`, `not_a_member`, `no_route`). SONEs Regel aus ADR-0086: eine
  Oberfläche, die „ging nicht" anzeigt, kann nicht sagen, was zu tun ist.
- **Falsches Kennwort und unbekanntes Konto geben dieselbe Antwort** und
  brauchen dieselbe Zeit. Sonst ist die Anmeldemaske ein Verzeichnis, wer auf
  diesem Server ein Konto hat. Per Test gehalten.
- **Sitzungen liegen in der Datenbank**, nicht in einem signierten Keks: eine
  Abmeldung, die nur der Browser kennt, ist keine.
- **Das erste Konto entsteht über einen Einrichtungsschlüssel**, den der Server
  beim Start ins Protokoll wirft, solange es kein Konto gibt. Nicht über eine
  offene Maske: eine Maske, die es beim ersten Aufruf kann, kann es auch beim
  tausendsten, sobald die Bedingung „kein Konto" einmal wieder wahr wird — etwa
  weil jemand das letzte Konto löscht.
  - Der Schlüssel liegt **im Speicher** des Prozesses und nicht in der
    Datenbank: dort wäre er ein Geheimnis in jeder Sicherung (ADR-0058). Er
    verfällt beim Neustart und ist mit dem ersten Konto verbraucht.
  - **Geprüft wird zuerst die Datenbank, dann der Schlüssel.** Umgekehrt würde
    eine falsche Eingabe verraten, dass die Einrichtung noch offen ist. Und der
    Schlüssel im Speicher weiß nichts davon, was ein Skript oder eine zweite
    Instanz inzwischen getan hat.
  - **Eine Stelle legt an** (`bootstrap.ts`), benutzt vom Skript und vom
    Bildschirm. Zwei Umsetzungen von „das erste Konto anlegen" wären zwei
    Rollenlisten, und die eine hätte irgendwann eine Rolle, die die andere nicht
    hat.
  - Nach der Einrichtung ist die Route **410 mit Grund** und nicht 404: ein 404
    ließe offen, ob der Weg je existiert hat.
  - **Serialisiert mit einem Advisory Lock**, und die Prüfung auf „gibt es schon
    ein Konto" liegt **innerhalb** davon. Von SONE gelernt und nicht selbst
    gemerkt: dessen `bootstrapInstance` hat diesen Lock mit dem Kommentar
    „Serialise concurrent first-run attempts". Ohne ihn sehen zwei gleichzeitige
    Anfragen mit demselben Schlüssel und verschiedenen Adressen beide „kein
    Konto" und legen beide an — danach hat die Instanz zwei Eigentümer, von
    denen einer nicht eingeplant war.
  - **Konto, Arbeitsbereich, Rollen und Kennwort in einer Transaktion.** Ein
    Konto ohne Kennwort ist ein Konto, in das niemand kommt.
- **Die Detailspalte ändert, sie berichtet nicht.** `projekt`, `geplant`,
  `frist` und `priorität` waren fünf `<span>` — anlegen ging, ändern nicht, und
  ein Datum konnte man nur beim Tippen der ersten Zeile mitgeben. Gefunden
  nicht durch Nachdenken, sondern durch Anklicken im echten Browser.
  - **Eine Reihe, die etwas ändert, muss aussehen wie eine.** Knopf über die
    ganze Breite, derselbe Wechsel auf Hover wie bei den Aufgabenzeilen, rechts
    ein Zeichen, das die Klappe ankündigt — und das nur auf Hover und Fokus,
    weil vier ständig stehende Pfeile in einer Lesespalte vier Punkte Unruhe
    sind.
  - Die Beschriftung nennt **Feld und Wert**: „geplant: Mo, 14. Sept. —
    ändern". „Ändern" allein sagt einer Vorleseansage nicht, was sich ändert.
  - **Die Frist war nirgends setzbar** — nicht im Anfasser-Menü, nicht in der
    Spalte. Ein Feld, das die Oberfläche zeigt und nie füllen kann, ist eine
    Auskunft über etwas, das es für die Person nicht gibt. Immer ganztägig:
    eine Frist um 14:37 ist eine Verabredung.
  - **Ein freies Datum** neben den drei schnellen Angaben, mit `type="date"` —
    der eingebaute Kalender kennt Sprache, Woche und Tastatur der Person, ein
    selbstgebauter müsste das nachbilden, um schlechter zu sein. Der Wert wird
    als **lokaler** Tag gebaut: `new Date('2026-10-14')` ist Mitternacht UTC
    und in Berlin der 14. um 02:00.
  - **Die Klappe wächst nach links**, nur rechts verankert. Mit `left` und
    `right` klebt sie an der Breite der Reihe, und ein `min-width` darüber
    schiebt sie über den Rand — drei Pixel weit, gemessen im Browser.
- **Was nur im Bild auffällt, fällt nur im Bild auf.** Zwei Sachen dieser Art:
  „heute heute" (Angabe und Datum waren dasselbe Wort) und „Mi, 14. Okto" —
  Monatskürzel aus `slice(0, 4)`, was bei sieben von zwölf Monaten kein
  deutsches Kürzel trifft. Kürzel sind jetzt eine geprüfte Liste.
- **Eine Wanduhrzeit ohne Zeitzone ist keine Angabe.** Gemeldet: „morgen 9 Uhr"
  eingetippt, „morgen, 11:00" angezeigt. Der Parser läuft auf dem Server, der
  Container steht auf UTC, also baute er 09:00 UTC.
  - `views.ts` benannte den Grund selbst — „die Zeitzone gehört dem Browser" —
    aber der Browser schickte einen **Zeitpunkt** mit, keine **Zeitzone**. Ein
    Zeitpunkt sagt nicht, in welchem Tag jemand steht.
  - Die Zone kommt jetzt aus dem Browser und hängt an **jeder** Anfrage, an
    **einer** Stelle gelesen. Zwei Antworten auf „welche Zone" laufen beim
    ersten Gebrauch auseinander (dieselbe Regel wie bei der Suchabfrage in der
    URL).
  - **Geprüft statt geglaubt:** was die Laufzeit nicht als Zone erkennt, ist ein
    Tippfehler und wird zu UTC. Ohne Angabe bleibt alles UTC — ein alter
    Aufrufer merkt nichts.
  - **Die Uhr wird verschoben, nicht der Parser umgeschrieben.** Der rechnet
    durchgehend mit `getUTC*`; `now` geht als Wanduhrablesung hinein, jedes
    Ergebnis wird zurückgeschoben. Ein verschobenes `Date` ist kein Zeitpunkt,
    sondern eine Ablesung — daher `toWallClock`/`fromWallClock` und nicht
    `plus`/`minus`.
  - **Ein Tag ist nicht immer 24 Stunden lang.** An den Umstellungstagen 23 und
    25, also werden Anfang und Ende getrennt gerechnet und nicht eines aus dem
    anderen.
  - Zwei Randfälle, entschieden statt übersehen: die Stunde, die es nach der
    Umstellung nach vorn nicht gibt, **rutscht nach vorn**; die, die es doppelt
    gibt, nimmt das **frühere** Vorkommen — bei einer Erinnerung ist zu früh
    besser als zu spät. Mein erster Wurf tat hier das Gegenteil dessen, was
    zwanzig Zeilen weiter oben als Entscheidung stand; der Test fand den
    Widerspruch. Jetzt werden **beide** möglichen Versätze abgeklopft statt
    einmal geraten — zwölf Stunden vor und nach der gesuchten Zeit liegt
    garantiert je eine Seite jeder Umstellung.
  - Offen: eine Einstellung pro Person. Wer verreist, will die Zone zu Hause
    behalten, und für nächtliche Erinnerungen ist sie zwingend, weil dann kein
    Browser mitschickt.
- **Der Bildschirm gibt seine Herkunft mit.** Wer in einem Projekt tippt, meint
  dieses Projekt. Der Server wog das schon richtig ab — Herkunft als Vorgabe,
  `#projekt` gewinnt darüber — aber die Oberfläche schickte die Herkunft nicht
  mit, und die Aufgabe landete in Heute oder Irgendwann. Angelegt, aber nicht
  dort, wo man stand.
- **Projekte sind Ordner** (angeglichen an SONE, ADR-0023/0028). Unterprojekte,
  Zeichen, Palettenfarben, Zweige zuklappen.
  - **Eine gewählte Farbe ist ein Palettenname ODER ein Hex-Wert.** Vorher
    standen fünf Hex-Werte direkt in `ProjectTree.tsx`. Zwei Dinge waren daran
    falsch: ein Name gespeichert **folgt der Palette** (ändert die Palette,
    ändert sich jedes Projekt mit diesem Namen), und dieselben gesättigten
    Werte, die auf Weiß richtig aussehen, **glühen auf Schwarz** — als Token hat
    jede Farbe einen Wert pro Thema, als Hex-Wert hatte sie einen für beide.
  - **Ein Palettenname ist keine CSS-Farbe.** Roh in ein `style` geschrieben tat
    er in SONE für die acht Namen stillschweigend nichts — „die schlechtere
    Hälfte, weil das die sind, die man wählt". Alles geht über `colorValue()`.
  - Das Zeichen hat **dieselbe Form wie SONEs `pages.icon`** (`{icon,
    iconColor}` als jsonb), damit wer beide Systeme liest, nicht zwei Formen für
    eine Sache lernt. In **einer** Spalte, weil das Zeichen **eine** Wahl ist:
    zwei Spalten lassen den halben Zustand zu, in dem eine Farbe ohne Zeichen
    gespeichert ist und niemand weiß, ob das Absicht war.
  - **Der ganze Lucide-Satz, abgeleitet statt gelistet** — wie SONE. Meine
    erste Fassung hatte zwölf selbst gezeichnete Pfade; sie stimmten nicht
    (Aktentasche und Einkaufstasche waren bei 14 px nicht zu unterscheiden),
    und zwölf sind ohnehin eine Auswahl, die jemand einmal getroffen hat.
    SONEs Satz dazu: mit einem Filter im Wähler gibt es keinen Grund, für
    irgendwen zu wählen.
    - Die Umwandlung ist **in beide Richtungen verlustbehaftet**, also
      entscheidet der **Rundgang**: ein Feld im Gitter, das als Vorgabe
      gezeichnet wird, ist von einer echten Wahl nicht zu unterscheiden.
    - Ein Lucide-Zeichen ist ein **`forwardRef`-Bauteil, also ein Objekt und
      keine Funktion**. Eine Prüfung auf `typeof === 'function'` verwarf in SONE
      jedes einzelne — fünfzig Zeichen im Wähler, alle als dasselbe Blatt
      Papier, und das Wählen änderte nichts Sichtbares.
    - Kostet: 253 KB → 1,26 MB. SONEs Hauptbündel liegt bei 2 MB, also dieselbe
      Größenordnung. Der Satz liegt in einem **eigenen Brocken**, weil er sich
      fast nie ändert und der Rest bei jedem Commit.
    - **Die eine Stelle, an der ich SONE nicht genau abschreibe:** ohne
      Suchbegriff steht ein kurzer Anfang im Gitter und nicht der Satzanfang.
      Alphabetisch sortiert zeigt der nämlich hundertzwanzig Mal `align-…` und
      `alarm-…` — wer den Wähler öffnet, sieht eine Wand aus
      Ausrichtungssymbolen. Die Entscheidung bleibt unangetastet: sobald etwas
      getippt wird, gilt wieder der ganze Satz.
    - Was nicht auflöst, wird der **Anfangsbuchstabe** — wie SONEs
      `WorkspaceMark`. Ein Name, der nicht mehr auflöst, kostet ein Projekt sein
      Zeichen und nie seinen Platz im Baum.
  - **Der Name des Zeichens wird nicht geprüft**, nur begrenzt. Welche Zeichen
    es gibt, weiß die Oberfläche; eine Liste im Kern wäre eine zweite Wahrheit.
  - Beim Zuklappen wird die **Ausnahme** gemerkt, nicht der Normalfall: ein
    Baum, der zugeklappt beginnt, verbirgt genau die Unterprojekte, die man
    gerade angelegt hat.
- **Eine Zahl in der Zeile gehört nicht in ihren Namen.** Die Ansichtszeilen und
  die Projektzeilen hatten kein `aria-label`, ihr zugänglicher Name war also
  „Demnächst 6" und „Haus 3". Im Bild sieht man das nie. Jetzt trennt die
  Beschriftung beides („Demnächst, 6 offen"), und die Zahl ist `aria-hidden`.
- **Ein `height: 100%` braucht eine Kette, die oben ankommt.** `#root` fehlte
  darin, also war die Hülle so hoch wie ihr Inhalt. Sichtbar wurde das genau
  dort, wo es am schlechtesten aussieht: auf einem leeren „Heute" endete die
  Seitenleiste mitten im Fenster. Bei viel Inhalt sieht alles richtig aus —
  der Fehler zeigt sich beim ersten Blick eines neuen Kontos.
- **Ein Klappzettel in einem scrollenden Kasten wird an dessen Rand
  geschnitten.** `.panel-list` war inhaltshoch mit `overflow: auto`, also endete
  das Projektmenü hinter „Unterprojekt anlegen" — Zeichen und Farben standen im
  Markup und waren nicht zu sehen. `flex: 1` macht den Rahmen so hoch wie die
  Leiste. Offen bleibt „Zeile ganz unten in einer langen Liste": dann müsste
  der Zettel nach oben klappen.
- **Der Rahmen ist SONEs Rahmen.** Auf Wunsch: „Eigentlich der ganze Rahmen,
  damit die beiden Tools auch möglichst gleich aussehen."
  - `components/icons.tsx` ist **kopiert, nicht nachgezeichnet** — 72 Zeichen,
    24er Gitter, Strichbreite 1,5, `currentColor`. Ein nachgezeichneter Satz
    wäre ein zweiter Satz, der beim ersten neuen Zeichen auseinanderläuft; ein
    kopierter ist derselbe. SOTEs eigene 20er-Pfade mit Strichbreite 1,6 sind
    weg: „mixing a filled icon into a line set is visible immediately even to
    someone who could not say why" — zwei Gitter mischen sich ebenso sichtbar,
    nur subtiler.
  - **Zwei Sätze, zwei Zwecke:** `icons.tsx` ist der **Rahmen** (Schiene,
    Menüs, Knöpfe), Lucide ist die **Wahl der Person** (Projektzeichen). SONE
    trennt das genauso.
  - **Ein Vokabular für Farben.** Die acht Namen heißen jetzt wie in SONE
    (`grey`, `red`, …), nicht deutsch. Der Name ist ein gespeicherter Wert, und
    zwei Systeme, die dasselbe Blau meinen und es verschieden schreiben, können
    ihre Farben nicht vergleichen — spätestens wenn eine Aufgabe auf eine
    SONE-Seite zeigt. Migration 0007 hat das Gespeicherte umgeschrieben.
  - Die **hellen Werte sind SONEs**, Ziffer für Ziffer, und `grey` folgt wie
    dort der Textfarbe. Die **dunklen sind eigene** — der eine Punkt, an dem
    SOTE von SONEs Stylesheet abweicht, aber nicht von SONEs Entscheidung:
    ADR-0028 verlangt dort einen Wert pro Thema, SONEs `styles.css` hat nur
    einen `:root`-Satz. Der Widerspruch ist gemeldet; bis er dort aufgelöst
    ist, hält SOTE sich an den Record.
- **Ein Knopf, der nichts tut, ist schlimmer als kein Knopf.** Der Kontoknopf
  hing an `() => void 0`; `api.signOut` stand in der Datei und wurde von
  nirgendwo gerufen. **Abmelden ging überhaupt nicht** — keine halbe Funktion,
  sondern ein geöffneter Rechner in einem Büro. Und der Test dazu war grün: er
  suchte den Prop-Namen `onAccount` und sagte damit nichts darüber, ob es die
  Sache gibt.
- **Abwesend statt anwesend und verweigernd.** Im Kontomenü steht noch **keine**
  Einstellungszeile, weil es den Bildschirm nicht gibt. Ein Eintrag, der „gibt
  es nicht" antwortet, bringt Leute dazu, dem Menü zu misstrauen (SONEs
  ADR-0027). Sie kommt, wenn sie hinführt.
- **Einstellungen auf drei Ebenen** (Migration 0008, SONEs ADR-0124): Person,
  dann Arbeitsbereich über Instanz, dann das Gerät.
  - **Eine Tabelle für drei Ebenen.** Sie unterscheiden sich in genau einem
    Punkt — wessen Einstellung es ist. Drei Tabellen wären dreimal dasselbe
    Schema und drei Stellen für jedes neue Feld, und die Auflösung müsste
    dreimal woanders nachsehen.
  - **`system` ist eine Wahl und kein fehlender Wert.** Wer ausdrücklich „wie
    das Gerät" wählt, schlägt einen Arbeitsbereich, der dunkel sagt. Die
    vierte Antwort ist `null`: „wie die Ebene darüber".
  - **Was der Kern nicht kennt, bleibt liegen.** Geschrieben wird gelesen,
    ergänzt, zurückgeschrieben — eine ältere Fassung darf die Werte einer
    neueren nicht wegwerfen. Das wäre Datenverlust, der wie ein Speichern
    aussieht.
  - **Geprüft wird vor dem Schreiben:** ein ungültiger Wert in der Datenbank
    wäre still, ein abgelehnter Aufruf ist es nicht.
  - **Die Größen gehören dem Browser, das Schema nicht.** SONEs Begründung:
    was auf dem Telefon passt, ist auf einem 27-Zoll-Monitor falsch, und ein
    Abgleich machte die Einstellung des einen Geräts zum Problem des anderen.
    Eine Vorliebe für dunkel gehört der Person und reist mit.
  - Im Speicher liegt **eine Kopie der Antwort**, nicht die Antwort: das erste
    Zeichnen passiert vor der Sitzung, und wer dunkel liest, darf keine halbe
    Sekunde eine weiße Seite sehen.
  - **`data-theme` hat einen Schreiber**, auch beim Systemwert. Meine erste
    Fassung entfernte das Attribut bei `system` und verließ sich auf eine
    `prefers-color-scheme`-Regel — die es in SOTEs CSS nicht gibt. Das hätte
    jeden, der „wie das Gerät" wählt, ins Helle geschickt.
  - **Woher ein Wert kommt, steht dabei.** Ein Schalter, der „dunkel" zeigt,
    ohne zu sagen, dass der Arbeitsbereich das vorgibt, wird zur Frage, sobald
    man ihn ändert und nichts passiert.
  - Bei der Instanz gibt es **kein** „nichts gesagt": darüber steht nichts
    mehr, also hätte es dieselbe Wirkung wie „wie das Gerät" — zwei Knöpfe mit
    demselben Wort nebeneinander, im Bild aufgefallen.
- **Hooks stehen vor den frühen Rückgaben.** Der Abruf des Schemas stand hinter
  `if (me === undefined) return …`, lief also beim Anmeldebildschirm nicht und
  beim angemeldeten schon — React #310, weißer Bildschirm. Kein Test hat es
  gemerkt, weil keiner die Anwendung rendert.
- **Die Leiste: ein Zustand, nicht zwei** (`useSidebar`, aus SONE kopiert).
  Hier stand ein `drawer`-Flag, das nur unter 800 px etwas bedeutete — und das
  **nirgends auf `true` gesetzt wurde**. Die Schublade ließ sich gar nicht
  öffnen; auf dem Telefon war die Projektliste unerreichbar.
  - Der Unterschied zwischen den Layouts liegt in der **Vorgabe**, nicht im
    Zustand: als Spalte ist Zeigen die Vorgabe und Verbergen eine gemerkte
    Vorliebe; als Schublade ist Verborgen die einzig sinnvolle Vorgabe, und sie
    schließt beim Navigieren.
  - Ein zweites Flag hatte SONE schon: die Leiste kam beim Drehen eines Tablets
    von selbst zurück, und das liest sich, als hätte die Anwendung vergessen,
    was man ihr gesagt hat.
  - Die Breite steht als `--sote-panel` **am Dokument** und nicht in einem
    Prop: sie gehört zur Rasterregel, und die steht im Stylesheet.
  - Ausgeblendet heißt **keine Spalte**, nicht eine leere: eine Spalte mit
    Breite 0 lässt Rand und Schatten stehen, und die sieht man.
  - **Ein Griff, der zur Hälfte abgeschnitten ist, ist halb so breit.** Erste
    Fassung: fünf Pixel über die Kante hinaus, bei `overflow: hidden` der
    Leiste. Anfassbar blieben vier statt zehn — im Browser gemessen, bei x+2
    traf man den Griff, bei x+5 die Leiste dahinter.
- **Was beim Start über die Leitung geht, ist eine Entscheidung.** Gemeldet:
  „hängt teilweise sekunden". Gemessen: 1018 KB Zeichensatz auf **jedem**
  Laden, um in der Seitenleiste eine Handvoll Symbole zu zeichnen — 3,1 s bis
  zum ersten Inhalt bei vierfach gedrosseltem Prozessor.
  - Mein Fehler war der Kurzschluss **„SONE macht das, also passt es"**. SONE
    ist eine Notizanwendung, in der der Zeichenwähler mitten im Gegenstand
    sitzt; SOTE lädt ihn für eine Seitenleiste. Dieselbe Entscheidung, anderer
    Ort, anderer Preis.
  - Ein eigener Brocken für den Zwischenspeicher war **richtig gedacht und am
    falschen Ende**: `manualChunks` schreibt ihn per `modulepreload` ins HTML,
    also ging er trotzdem bei jedem Laden über die Leitung. Der dynamische
    Import baut den Brocken von selbst — ohne Vorladen.
  - Jetzt: 269 KB beim Start, 905 statt 3094 ms auf dem gedrosselten Tablet.
    Der Satz kommt, wenn ein Projekt wirklich ein Zeichen hat oder der Wähler
    aufgeht. Wer keine Zeichen vergibt, lädt ihn nie.
  - **Ein Umlauf, nicht zwei:** das Speichern in den Einstellungen holte danach
    die ganze Antwort neu. Auf einer entfernten Instanz sind das zwei
    Wartezeiten für eine Handlung; der Kern rechnet dasselbe Ergebnis aus der
    Antwort des Schreibens.
  - Festgehalten in `test/weight.test.ts` — als **Dateiinhalt**, nicht als
    Absicht: ein Kommentar über „nur bei Bedarf" ist beim nächsten `import` von
    oben still wieder falsch.
- **Ordner ordnen, Projekte halten** (Konzept 10d, Migration 0009). Drei Regeln
  liegen in der **Datenbank** und nicht nur im Code: ein CHECK („ein Projekt
  liegt immer in einem Ordner") und zwei Trigger („ein Projekt hält Aufgaben und
  keine Unterpunkte", „ein Ordner hält keine Aufgaben"). Eine Regel, die nur im
  Anwendungscode steht, kennt der nächste Schreibweg nicht.
  - **`#name` meint ein Projekt**, und wenn der Name einem **Ordner** gehört,
    ist das eine eigene Meldung (`folderProject`). Unbekannt heißt vertippt,
    dies heißt falsche Ebene gemeint — eine Meldung, die beides zusammenwirft,
    schickt jemanden auf die Suche nach einem Tippfehler, den es nicht gibt.
  - **Eine rekursive CTE in einer korrelierten Unterabfrage sieht die äußere
    Zeile nicht.** So stand die Pfadprüfung im Papierkorb zuerst in `ALIVE`:
    lief ohne Fehler, lieferte nie eine Zeile, und damit galt jede Aufgabe als
    lebendig — auch unter einem weggeworfenen Ordner. Die Rekursion liegt jetzt
    in `project_in_trash()`.
  - **Die Vorgabe für das Zeichen kommt aus dem Rahmensatz**, nicht aus Lucide.
    Mein erster Wurf setzte `'folder'`/`'list'` als Lucide-Namen ein — damit
    hätte jede Zeile im Baum den ganzen Satz nachgeladen und die 1018 KB wären
    durch die Hintertür wieder im Startpfad.
  - **Abwesend statt anwesend und verweigernd:** „Projekt anlegen" und
    „Unterordner anlegen" stehen nur im Menü eines **Ordners**. An einem
    Projekt wären sie ein Angebot, das die Datenbank ablehnt.
  - Ein Testhelfer (`test/support/tree.ts`) legt Ordner und Projekt in genau
    der Form an, die die Migration herstellt — damit Tests dieselbe Gestalt
    vorfinden wie eine migrierte Instanz und nicht eine aufgeräumtere.
- **Ein Knopf, der aussieht wie einer, ist fertig genug, um beim Durchsehen
  nicht aufzufallen.** Dreimal dasselbe Muster: der Kontoknopf (`() => void 0`),
  die Schublade (ein Flag, das nirgends auf `true` gesetzt wurde), der
  Workspace-Wechsler (Pfeil, kein `onClick`). Jedes einzelne fand nur ein Klick
  im Browser. Seit dem dritten Mal gibt es einen Wächter in `modes.test.ts`:
  jeder Knopf in den Rahmenbauteilen trägt ein `onClick`, und `() => void 0` ist
  als Muster verboten. Gröber als ein Klick, läuft aber bei jedem Commit — und
  hätte alle drei gefunden.
- **Ein Test, der Prosa prüft, prüft die falsche Sache.** Zweimal passiert:
  `/lucide/i` traf eine Kommentarzeile, und das Verbot `() => void 0` traf den
  Kommentar, der den alten Fehler beschreibt. Wer seine Fehler dokumentiert,
  wird sonst dafür bestraft. Beide Wächter entfernen jetzt erst die Kommentare.
- **Die Zeile zeigt den Pfad, nicht nur den Namen.** Seit der Trennung kann
  dasselbe Wort in zwei Ordnern stehen — die Migration erzeugt regelmäßig
  „Haus ▸ Haus". Zwei Ebenen, aus dem vorhandenen Baum gerechnet: eine zweite
  Quelle für denselben Pfad wären zwei Antworten auf eine Frage.
- **Eine Fläche bekommt eine Beziehung, keine Farbe** (aus SONEs ADR-0023).
  `#101010` auf der Schiene ist in beiden Themen schwarz — wer das setzt, gibt
  jedem, der im Dunkeln liest, eine schwarze Leiste auf schwarzer Seite.
  „Umgekehrt" ist das Argument in einem Wort: hell auf dunkel für den im hellen
  Thema, dunkel auf hell für den im dunklen, aus **einem** gespeicherten Wert.
  Nachgemessen: im hellen Thema `38,37,34`, im dunklen `244,241,234`.
  - **Drei Flächen, und die Seite ist keine davon.** Wer draußen in der Sonne
    sitzt, will hell — was auch ein Arbeitsbereich lieber hätte. Die Zeile über
    dem Inhalt ist auch nicht dabei: sie sitzt absichtlich auf der Seitenfläche.
  - **Abwesend ist die Vorgabe.** `follow` und `soft` werden als nichts
    gespeichert; ein gespeichertes `follow` wäre eine zweite Schreibweise für
    denselben Zustand, und zwei Schreibweisen laufen auseinander.
  - **Die Zuordnung „umgekehrt → diese Töne" steht im Stylesheet**, nicht im
    Kern: dort sind beide Themen ohnehin definiert. Gäbe es sie zweimal, gäbe
    es zwei Orte, an denen steht, was dunkel bedeutet.
  - **Das Aussehen wird anders aufgelöst als das Schema:** Arbeitsbereich über
    Instanz, und die **Person kommt nicht vor**. Sonst färbt jemand, der seine
    Schiene grün macht, die Schiene aller anderen mit. Gefüllt statt ersetzt,
    Feld für Feld — wer nur die Schiene setzt, behält die Ecken der Instanz.
  - Angewandt an `.app` und nicht an `<html>`: hell oder dunkel gehört dem
    **Dokument**, Flächen und Ecken der **Anwendung**. Ein `data-corners` an
    `<html>` träfe auch die Anmeldemaske, und die gehört keinem Arbeitsbereich.
  - **Attribute werden gesetzt UND aufgeräumt.** Nur zu setzen ist der Fehler,
    bei dem eine Einstellung sich nicht mehr zurücknehmen lässt — und den sieht
    man erst beim Zurücknehmen.
- **Drei Bereiche statt dreier Kästen auf einem Bildschirm** — SONEs
  Aufteilung: *die Einstellungen sind deine, ein Arbeitsbereich gehört allen
  darin, die Verwaltung gilt für jeden auf dem Server.*
  - Vorher lagen alle drei Ebenen auf einem Bildschirm, und die Überschrift
    jedes Kastens musste sagen, wen er angeht. Das war eine **Notlösung dafür,
    dass der Ort es nicht sagte** — wer sein Dunkelgrau sucht und dabei über
    die Farben eines Teams stolpert, hat den falschen Bereich gefunden.
  - **Die Verwaltung ist kein Modus.** Sie steht im Kontomenü und nicht in der
    Schiene, weil die Schiene die Liste der Orte ist, an denen man *arbeitet* —
    und ein Server ist kein Ort, an dem man arbeitet.
  - **Eine Zeichnung für drei Bereiche**, als Struktur und nicht als drei
    Verzweigungen im Markup: sie unterscheiden sich nur in Titel, Liste und
    Ziel, und drei fast gleiche Blöcke laufen auseinander.
  - „Aussehen" gibt es **zweimal** — für dich und für den Arbeitsbereich. Der
    Bereich entscheidet, welcher gemeint ist, statt zwei gleich benannte
    Abschnitte in einen Namensraum zu zwingen.
- **SONEs späte ADRs korrigieren die frühen — und zwei davon betrafen mich.**
  Gemeldet: „wir haben alte ADR bei sone teilweise später überarbeitet."
  - **ADR-0131 (korrigiert ADR-0122):** eine behandelte Fläche ist ein
    **kleines Schema**, nicht ein Grund plus eine Textfarbe. Ich hatte
    `background` und `color` gesetzt und dann von Hand nachgeflickt, was
    drinnen noch falsch aussah. SONEs Satz dazu trifft genau meine Tests:
    **„Two lists agreeing with each other is not a check."** Jetzt
    überschreibt jede Behandlung die semantischen Token auf der Fläche selbst
    — alles darin liest sie ohnehin, also folgt es ohne Liste.
    - Auf einer **Akzentfläche tauschen die beiden Plätze**: Akzent auf Akzent
      ist nichts.
    - Auf einer **umgekehrten Fläche gilt der Akzent des anderen Schemas** —
      sie ist dessen Grund, der in diesem steht.
  - **ADR-0135:** *Kontrast wird gerechnet, nicht geglaubt, und als Test
    gehalten.* In SOTE stand die Regel nicht einmal auf dem Papier. Der
    gerechnete Test fand beim ersten Lauf **zwei echte Fehler** — und in SONEs
    heller Palette liegen Orange (2,72), Gelb (2,51) und Grün (2,82) unter den
    3:1, die AA für Nichttext verlangt, gemessen auf der vertieften Fläche, wo
    die Ordnerzeichen stehen. SOTE hat dort die kleinsten Werte, die auf beiden
    Gründen reichen, als **Skalierung der Kanäle** (hält den Farbton exakt,
    ADR-0136). Die eine Stelle, an der SOTEs Palette bewusst nicht Ziffer für
    Ziffer SONEs ist.
- **Ein doppelter `case` im `switch` ist toter Code, den niemand meldet.** In
  `parseRoute` standen zwei `case 'workspaces'` — der alte gewann, der neue war
  tot, und `/workspaces/aussehen` landete beim Platzhalter. Weder Übersetzer
  noch Lint noch Test sagten etwas, und **mein Browser-Test fand es nicht, weil
  er geklickt hat**: ein Klick setzt den Zustand direkt, nur ein Neuladen geht
  durch `parseRoute`. Jetzt ein Rundgang über alle Adressen und ein Wächter
  gegen doppelte Fälle.
- **In CSS ist es ein Kreis, `--accent` im selben Block zu lesen und
  umzudefinieren.** Beide Werte werden ungültig, und ungültig heißt
  durchsichtig: der Grund der Schiene war `rgba(0,0,0,0)` und das Signet
  unsichtbar. Gelesen wird darum `--accent-base`, eine Kopie, die kein
  Flächenblock überschreibt.
- **Der Posteingang ist eine Frage an den Menschen, keine Ansicht über die
  Zeit.** Die Schnellerfassung zieht ihren Wert daraus, dass man nichts
  entscheiden muss, um etwas festzuhalten — also entstehen Aufgaben ohne
  Projekt, und die brauchen einen Ort, an dem man sie wiederfindet.
  - **Zwei verschiedene Dinge, vorher eins:** *ohne Ort* und *ohne Zeit*. Bis
    hierher lagen beide in Irgendwann, zusammen mit allem, was jemand
    ausdrücklich als „irgendwann" eingeordnet hat. Irgendwann heißt jetzt
    „ohne Zeit **und** einsortiert".
  - **Ein Datum schließt nicht aus.** Wer „Zahnarzt anrufen morgen" tippt, hat
    einen Zeitpunkt gesagt und keinen Ort — die Aufgabe steht in Demnächst
    **und** hier. Damit teilen die drei Zeit-Ansichten weiter ohne
    Überschneidung auf, und der Posteingang schneidet quer.
  - Ein leerer Posteingang ist ein **guter** Zustand, und der Satz sagt das:
    „Alles einsortiert." „Nichts hier" liest sich wie ein Mangel.
  - Eine **Teilaufgabe** steht nicht darin: sie erbt ihren Ort vom Elternteil,
    also ist nicht sie das, was jemand einsortieren muss.
- **Keine Gruppenüberschrift über der einzigen Gruppe** (SONEs ADR-0072, das
  ADR-0070 ändert): „a heading repeating it over the only group in the column
  says nothing." Der Titel steht im Kopf der Leiste, die Zeile darunter nennt
  den Geltungsbereich — und die verdient ihren Platz, weil sie die Tatsache
  ist, die auf dem Bildschirm stehen soll, wenn jemand etwas für alle ändert.
- **Backticks in einem SQL-Kommentar beenden das Template-Literal.** Der
  Übersetzer meldet dann eine fehlende Klammer irgendwo weiter unten. Zwei
  Zeichen, eine halbe Stunde Suche.
- **Ein Arbeitsbereich hat zwei Dinge zu färben, ein Projekt eines.** Beim
  Projektzeichen fehlt `titleColor`, und die Begründung stand dort: „eine Zeile
  in der Seitenleiste hat keinen eigenen Titel, der sich färben ließe." Beim
  Arbeitsbereich steht der Name im Wechsler, im Kopf der Leiste und in der
  Übersicht — daran erkennt man, dass die Begründung damals stimmte: die Form
  braucht das Feld erst dort, wo es etwas zu färben gibt.
  - Das Zeichen ist **nicht Teil des Themas** (`settings.look`): das Thema sagt,
    wie ein Arbeitsbereich aussieht, das Zeichen sagt, **welcher er ist**. Wer
    sein Thema zurücksetzt, will nicht sein Signet verlieren. Dieselbe Trennung
    zieht SONEs Kommentar an `workspaces.icon`.
  - Der Name speichert **beim Verlassen des Feldes**: bei jedem Tastendruck
    wären es zwanzig Umbenennungen für ein Wort, und jede gilt für alle
    Mitglieder.
  - Eine Route und nicht `/api/workspaces/:id`: sie liegt hinter der
    Mitgliedsprüfung, also ist „welcher" schon beantwortet. Ein zweiter Weg
    wäre ein zweiter Ort für dieselbe Rechteprüfung.
  - Die **Lücke von vorhin ist zu**: die Rolle in der Übersicht kam als fest
    eingetragenes „Eigentümer" und kommt jetzt aus `/api/me`.
- **Die Tönung: eine Farbe für die Möblierung, und der Rückfall ist der
  Grundton.** Das ist die Korrektur aus dem **Status** von SONEs ADR-0028, nicht
  aus seinem Text: der Rückfall war dort `transparent`, und `transparent` ist
  `rgb(0 0 0 / 0)` — eine Instanz ohne Tönung mischte also nicht *nichts* bei,
  sondern vierzehn Prozent von *gar nichts*. Jede Fläche kam leicht durchsichtig
  heraus, unsichtbar auf einer Spalte und unübersehbar auf der Schublade eines
  Telefons. Eine Farbe mit sich selbst gemischt ist sie selbst; ein Test rechnet
  das nach.
  - Die Tönung ist ein **Hex-Wert und kein Palettenname**: sie ist jemandes
    Hausfarbe, und ein Name soll der Palette folgen — die Tönung folgt
    niemandem.
  - **Eine Tönung ist ein Raum und kein Wert** (ADR-0135), also wird sie an
    ihren Ecken geprüft: volles Rot, Blau, Grün, Gelb, Schwarz, Weiß. Dabei
    fiel leiser Text auf 3,82:1 — `--text-muted` ist jetzt `#595750`, der
    hellste Wert, der gegen alle davon 4,5:1 hält. Gerechnet, nicht geschätzt.
  - **Die Tönung gehört an `<html>`, alles andere an die Hülle.** Die
    Ersetzung einer CSS-Eigenschaft passiert dort, wo sie **deklariert** ist:
    `--surface` steht in `:root` und liest `var(--tint, …)`, also sieht es eine
    Tönung an `.app` nicht. Im Browser blieb die Seitenleiste ihr Grundton,
    obwohl `--tint` sichtbar am Element stand.
- **Ein neues Feld wird an der Stelle vergessen, die entscheidet.** `tint` war
  im Typ, in `readLook` und in `lookAttributes` — und nicht in `resolveLook`.
  Der Server speicherte korrekt und antwortete mit `effective.look = {}`; alle
  Tests waren grün, weil sie die anderen drei Stellen prüften. Der Test dazu
  prüft jetzt **jedes Feld eines vollständig gesetzten Aussehens** und nicht
  „die, die ich kenne".
- **Die Schrift ist ein benanntes Paar und keine Familie.** SONEs Satz trägt
  die Entscheidung: eine eingetippte Schrift ist eine, die die Maschine der
  anderen vielleicht nicht hat — und wer sie eingetippt hat, sieht seine eigene
  und kann es nicht wissen. Vier Namen, und jeder Stapel endet in etwas, das
  die Maschine schon hat: ein Stapel, der auf dem Familiennamen endet, endet in
  dem, was der Browser entscheidet, und das ist meistens Times.
- **Zweimal dieselbe CSS-Regel, in zwei Gestalten.** Bei der Tönung war die
  **Deklaration** zu hoch (`--surface` steht in `:root` und sah eine Tönung an
  `.app` nicht). Bei der Schrift war die **Benutzung** zu hoch: `body {
  font-family: var(--sote-sans) }` löst am Body auf, also außerhalb von `.app`,
  und alles darin erbt die schon berechnete Familie und fragt nie wieder. Beide
  Male hing das Attribut sichtbar am Element und tat nichts.
- **Ein Test, der aus dem falschen Grund besteht, ist schlimmer als ein roter.**
  Meine Prüfung für „Wie das Gerät" suchte „system" — und die Vorgabe enthält
  schon `-apple-system`. Sie bestand, während die Schriftwahl gar nicht griff;
  nur weil die beiden Nachbarn zu Recht anschlugen, fiel es auf.
- **Ein Umschalter, der nur in eine Richtung schaltet, ist der vierte Fall
  desselben Musters.** Gemeldet: „Ich kann übrigens abgehakte Aufgaben nicht
  wieder eröffnen." Das Kästchen trug `aria-label` mit „wieder öffnen",
  `aria-pressed={done}` — und rief bei jedem Klick `complete`, das bei einer
  erledigten Aufgabe früh zurückkehrt. Vorher: Kontoknopf, Schublade,
  Workspace-Wechsler. Seit diesem Fall prüft ein Wächter die **Umkehrung**: wo
  eine Beschriftung zwei Zustände nennt, muss der Handler beide Richtungen
  kennen.
  - `DELETE` auf denselben Weg und nicht `POST` auf einen zweiten: Abhaken legt
    eine Erledigung an, Wiedereröffnen nimmt sie weg — dasselbe Ding, zwei
    Richtungen.
  - `completed_by` wird mitgelöscht: „von wem" ohne „wann" ist eine Auskunft
    über ein Ereignis, das nicht stattgefunden hat.
  - Die Zeile verschwindet nur beim **Abhaken** sofort. Beim Zurücknehmen bleibt
    sie stehen und verliert ihren Haken — sie geht nirgendwohin.
  - **Ein benanntes Loch:** hat das Abhaken einer wiederkehrenden Aufgabe einen
    Nachfolger angelegt, bleibt der stehen. Es gibt keine Spalte, die ihn mit
    dieser Erledigung verbindet, und ihn über den Titel zu erraten wäre
    schlimmer als ihn zu lassen.
- **Erledigtes lässt sich überall einblenden, und es rutscht in ein
  ausgegrautes Bündel unten.** Gemeldet als Vorschlag; vorher konnte das nur
  die Projektansicht, und die konnte es **immer**. Eine Ansicht, die etwas
  zeigt, was ihre Nachbarn verbergen, ist die Ungleichheit, um die es ging.
  - **Je Ansicht gemerkt, nicht einmal für alles:** „in diesem Projekt will ich
    sehen, was ich geschafft habe" und „in Heute will ich nur, was ansteht"
    sind zwei Antworten. Ein Schalter für alles würde bei jedem Setzen die
    andere überschreiben.
  - **Abwesend heißt „wie die Ansicht es ohnehin sagt"**, und die Vorgabe ist
    nicht überall dieselbe: ein Projekt beantwortet die Frage „was habe ich
    hier geschafft", eine Zeit-Ansicht nicht. Im Browser gemerkt, nicht am
    Konto (ADR-0124).
  - **Eine Abfrage, zwei Bündel.** Der Server liefert Erledigtes am Ende
    derselben Liste; getrennt wird in der Oberfläche. Zwei Abfragen hätten je
    eigene Sortierung, Grenze und Zeitpunkt — und zwei Listen, die zusammen
    eine sein sollen, laufen genau daran auseinander.
  - **Erledigtes ist nie überfällig.** Ohne diese Zeile wäre eine abgehakte
    Aufgabe von letzter Woche im Abschnitt „überfällig" gelandet — und
    „überfällig" ist eine Aufforderung.
  - **Die Zähler zählen weiter nur Offenes:** eine Zahl neben einer Liste, die
    man abarbeiten soll, sagt „so viel liegt an" und nicht „so viel war".
  - Ausgegraut über `opacity` und nicht über eine graue Textfarbe, damit
    Kästchen, Zeichen und Pfad gemeinsam zurücktreten und ihre Verhältnisse
    behalten. Lesbar bleibt es, weil man es lesen will, um es zu öffnen.
- **In einer Suche nennt man einen Namen, keinen Zustand.** Die Vorgabe der
  Abfrage ist darum `status: alles` und nicht `offen`. Wer „Dosen" tippt, sucht
  die Aufgabe; ob sie abgehakt ist, ist die Antwort und nicht die Frage. Eine
  Suche, die einen Treffer verbirgt, lügt **unbemerkt** — man sieht kein
  Ergebnis und schließt daraus, dass es die Sache nicht gibt. Einschränken geht
  weiter, und dann steht es sichtbar in der Abfrage (`status:offen`).
  - Kein Umschalter dafür: die Suche schränkt man **in der Abfrage** ein, und
    ein dritter Schalter für dieselbe Wahl wäre eine dritte Form derselben
    Frage.
- **Eine Entscheidung, die an drei Stellen richtig getroffen werden muss, wird
  an einer davon falsch getroffen.** Der Weg zurück fehlte nach dem Beheben
  weiter in der **Suche** und in der **Detailspalte**, weil ich ihn in
  `TaskList.tsx` eingebaut und den Wächter auf genau diese Datei geschrieben
  hatte. Jetzt gibt es `tasks/toggleDone.ts`, und der Wächter prüft, dass
  **niemand sonst** `api.complete` ruft — das erfasst auch den Bildschirm, den
  es noch nicht gibt.
- **Ich habe an der falschen Stelle gesucht.** Dass die Suche Erledigtes
  verbarg, stand nicht in `search.ts` — dort wird nur gefiltert, wenn die
  Abfrage einen Status **nennt**. Genannt hat ihn die Vorgabe in
  `parseTaskQuery`, eine Datei weiter.
- **Ein Attribut wiegt mehr als eine Klasse, und dagegen hilft kein
  Verschieben.** `.app { grid-template-columns: 1fr }` steht in der
  Schmal-Media-Query und wurde von `.app[data-sidebar="false"]` geschlagen —
  auf 390 px war der Inhalt **55 Pixel breit**, „Heute" auf zwei Buchstaben
  abgeschnitten, jede Zeile ein senkrechter Streifen. Bei `data-detail` war der
  Fehler **älter** als meine Umschaltung und niemandem aufgefallen, weil die
  Detailspalte auf dem Telefon ohnehin über allem liegt. Jede mehrspaltige
  Vorlage steht jetzt in einer `min-width`-Klammer, und ein Wächter prüft das
  (gegengeprüft: er schlägt an, wenn man den Fehler wieder einbaut).
- **Ein Bündel braucht eine Überschrift, wenn die Grenze sonst nicht zu sehen
  ist.** In den Listen ja — dort stehen zwanzig Zeilen. In der Detailspalte
  nicht: es sind drei, und die Beschriftung sagt schon „3 von 5". Eine zweite
  Überschrift in 340 Pixeln wäre mehr Aufbau als Inhalt.
  - Sortiert wird beim **Zeichnen** und nicht in der Antwort: die Reihenfolge
    der Teilaufgaben gehört ihrem Elternteil (sie lässt sich ziehen), und ein
    zweites Sortierkriterium im Server würde die gezogene Ordnung
    überschreiben, sobald jemand abhakt.
- **Zustände durchmessen, nicht Adressen.** Nach dem 55-Pixel-Fehler habe ich
  die ganze Oberfläche auf 390, 768 und 1320 px durchgemessen. Über **Adressen**
  war alles sauber — und trotzdem war etwas kaputt: das offene **Kontomenü**
  stand auf dem Telefon 180 Pixel außerhalb des Fensters (x=338 bis 570 bei
  390 px), man sah einen Streifen und konnte „Abmelden" nicht treffen.
  - Die Ursache war eine Regel, die für ihren **ersten Ort** richtig war: am
    Fuß der Schiene ist links Platz, also `left: 4px`. In der Fußleiste des
    Telefons sitzt dasselbe Konto ganz rechts.
  - **Und der Prüfer musste selbst geprüft werden:** „scrollt die Seite" hätte
    den Anlassfehler nicht gefunden, weil bei 55 px nichts hinausragte, sondern
    innen abgeschnitten wurde. Gegengeprüft mit künstlich wiederhergestellter
    Regel — der Prüfer meldet `h1 20<69`.
  - Das Werkzeug liegt als `scripts/measure-widths.mjs` im Baum; es braucht
    Server und Browser und läuft darum nicht in der CI.
- **Ankommen und die Marke drücken sind zwei Fragen** (SONEs ADR-0072). Die
  Marke führte in SOTE immer nach Heute, also tat sie von Heute aus **nichts** —
  der sechste Fall des Musters. Jetzt: Ankommen heißt die Landeeinstellung in
  voller Länge (auch „wo du zuletzt warst"), die Marke drücken heißt „irgendwohin,
  aber nicht hierher" — die Landeseite, und wenn man dort steht, das erste
  Projekt.
  - **Nur wenn keine Adresse gemeint war.** Wer einen Link auf ein Projekt
    öffnet, hat gesagt, wo er hin will; ihn auf seine Landeseite zu schicken
    macht jeden geteilten Link unbrauchbar.
  - **Die Person schlägt den Arbeitsbereich**, anders als beim Aussehen — und
    aus SONEs eigener Begründung (ADR-0032): wo jemand landet, ist die Wahl
    *einer* Person für ihre eigene Sitzung, und zwei Mitglieder haben
    verschiedene Antworten. Der Arbeitsbereich setzt nur eine Vorgabe. Die
    Instanz kommt nicht vor: „wo du landest" ist keine Servereinstellung.
  - **Einstellungen werden nicht als „zuletzt" gemerkt.** Wer beim Anmelden in
    seinen Farbeinstellungen landet, weil er dort zuletzt etwas gerichtet hat,
    ist an einem Ort, den er nicht gesucht hat.
  - **Ein Projekt, das es hier nicht gibt, ist kein Ort:** liegt die gemerkte Id
    nicht im geöffneten Arbeitsbereich, gilt der Rückfall. Ankommen soll nicht
    fehlschlagen.
  - **Abweichung von SONE, benannt:** dort gilt die persönliche Wahl je
    Arbeitsbereich, hier je Person — die Einstellungen liegen je Person und
    nicht je Paar. Sobald jemand in zwei Arbeitsbereichen verschieden landen
    will, ist das die Stelle, die sich ändern muss.
- **Ein Thema als Datei, und kein zweiter Weg hinein** (SONEs ADR-0125). Was
  aus einer Datei kommt, geht durch **dieselbe** Prüfung wie das Formular und
  der Server. Eine geladene Datei kann darum nichts, was man nicht auch tippen
  könnte — und genau das macht es unbedenklich, eine von einem Fremden
  anzunehmen. Deshalb gibt es **keine Route**: ein zweiter Endpunkt wäre eine
  zweite Stelle, an der ein Thema geprüft wird.
  - **Was keine Marke trägt, wird ganz abgelehnt.** Überall sonst gilt „Feld
    weglassen, Rest behalten", und dort ist es richtig, weil die Eingabe ein
    Formular ist. Hier ist sie eine **ausgewählte Datei**, und die falsche
    auszuwählen ist der gewöhnliche Fehler: aus den Angaben eines Urlaubsfotos
    würde ein `{}`, und das zu laden leerte das Aussehen still.
  - **Zwei Gründe, zwei Sätze:** „keine Datei dieser Art" gegen „eine Datei,
    aber kein Thema". Ein gemeinsamer Satz ließe jemanden nach einem
    Tippfehler suchen, wo er die falsche Datei erwischt hat.
  - **Die Fassungsnummer wird geschrieben und nicht gelesen.** Die Prüfung
    wirft ohnehin weg, was sie nicht kennt; auf eine Zahl zu verweigern machte
    eine verträgliche Datei ohne Gewinn zu einer Fehlermeldung.
  - **Eine Ausgabe sagt, was hier gesetzt ist — nicht, was hier zu sehen ist.**
    Wer das Aufgelöste ausgäbe, schriebe die Werte der Instanz in die Datei,
    als wären sie die des Arbeitsbereichs.
  - **Abweichung von SONE, begründet:** dort füllt das Laden ein Formular und
    „Speichern" schreibt. SOTE hat kein solches Formular — jeder Klick wirkt
    sofort. Ein Zwischenzustand nur für den Dateiweg wäre ein **zweites
    Bedienmodell in einem Bildschirm**; der Knopf heißt darum „Laden und
    übernehmen".
- **Zugang ist keine Einladung** (SONEs ADR-0073): ein **Konto** anzulegen ist
  Sache der Instanz, wer in einem **Arbeitsbereich** mitarbeitet Sache seines
  Eigentümers — und das ist eine Frage über Leute, die es schon gibt. Ein
  Formular, das beides täte, ließe einen Arbeitsbereich fremde Konten auf dem
  Server erzeugen.
  - **Gesucht wird, nicht getippt** (ADR-0119, das ADR-0073 hier überholt).
    Dessen Sorge war richtig, der Schluss zu stark: weil die Route „dieses
    Konto gibt es nicht" deutlich sagt, konnte derselbe Aufrufer jede Adresse
    ohnehin bestätigen. Das Adressfeld machte nur die ehrliche Frage — *ist das
    die richtige Person?* — vor dem Klick unbeantwortbar.
  - **Nichts unter zwei Zeichen**, und das ist der Unterschied zwischen
    *bestätigen* und *auflisten*. Die ehrliche Grenze: wer entschlossen ist,
    kann Präfixe abgehen; gewonnen ist, dass das Verzeichnis unbequem statt
    offen ist.
  - **Wer schon hier ist, wird mitgeliefert und markiert**, nicht gefiltert.
    Verborgen liest er sich als „gibt es nicht" — dieselbe Verwirrung von der
    anderen Seite.
  - **Hinzufügen ist nicht Befördern:** wer Mitglied ist, wird abgelehnt statt
    still umgestuft. Beides in einem Weg heißt, dass ein Verklicken jemandem
    Rechte gibt.
  - **Eigentümerschaft ist eine Spalte und kein Recht** (ADR-0102): sie steht
    als Wort da und nicht als Auswahl, und der **letzte Eigentümer kann nicht
    gehen** — ein Arbeitsbereich ohne Eigentümer lässt sich von innen nicht
    heilen.
  - Einladungen stehen als **Satz** da und nicht als Feld: ein Feld, das nichts
    tut, ist der Fehler, den SONE vierzehn Mal hatte (ADR-0112).
- **Die Instanz gehört keinem Arbeitsbereich** (Migration 0012). Vorher durfte
  Instanzeinstellungen ändern, wer irgendeinen Arbeitsbereich **besitzt** — also
  konnte jeder Eigentümer Vorgaben für alle anderen setzen. Die Grobheit stand
  seit ihrer Entstehung als Kommentar in `settings.ts` („das ist zu grob, und es
  steht hier statt in einem Bugtracker"), und dieser Bildschirm war der Moment,
  sie zu schließen.
  - Das Recht ist eine **Spalte am Konto**, keine Rolle in einer Tabelle: es
    gilt über alle Arbeitsbereiche, hat keine Stufen und gehört keinem — dieselbe
    Bauart wie `is_owner` (ADR-0102).
  - **Zwei Rechte, zwei Fragen:** ein Administrator verwaltet nicht automatisch
    fremde Arbeitsbereiche, und ein Eigentümer nicht die Instanz.
  - **Wer die Instanz eingerichtet hat, verwaltet sie**: die Migration setzt das
    älteste Konto. Niemanden zu setzen hätte den Server verwaist zurückgelassen
    — eine Migration, die eine Annahme trifft und sie hinschreibt, ist besser als
    eine, die niemandem mehr Zugriff lässt.
  - **Der letzte kann nicht gehen**, zweimal: kein letzter Administrator gibt
    sein Recht ab, keiner wird gelöscht. Die Prüfung **zählt** statt zu fragen
    „bist du das" — sonst wäre der gewöhnliche Weg, ein Recht abzugeben,
    verboten.
  - **Ein Konto, das noch mitarbeitet, wird nicht gelöscht.** Es zu löschen
    hieße zu entscheiden, was mit seinen Aufgaben passiert, und das ist eine
    Frage an den Arbeitsbereich. Bewusst unbequem: die bequeme Fassung ließe
    Aufgaben still verwaisen, und still ist bei Löschen das falsche Wort.
  - **„Verwaltung" fehlt im Menü, wenn man nicht verwaltet** — und `onAdmin` ist
    darum im Typ eine Möglichkeit und kein Flag daneben.
- **Ein Klappmenü in einem scrollenden Kasten ist immer abgeschnitten.** Das
  Zeilenmenü im Baum wächst nach links (das ⋮ steht rechts) und ragte über den
  linken Rand der Seitenleiste, die `overflow: hidden` hat, weil die Liste darin
  scrollt. Es liegt jetzt `fixed`, mit einer **berechenbaren** Breite
  (`min(312px, 100vw - 16px)`) und an **beiden** Rändern festgeklemmt — mit
  `min-width` hing die Stelle an einer Breite, die es beim Öffnen noch nicht gab.
- **Eine gemeinsame Klasse ist eine gemeinsame Entscheidung.** `.menu` teilen
  sich Baum und Aufgabenzeile; mein `fixed` für den Baum schob das Zeilenmenü
  250 Pixel aus dem Fenster. Der Ort, der etwas anderes braucht, bekommt einen
  eigenen Namen (`.menu.at-point`).
- **`position: absolute` ohne positionierten Vorfahren verankert sich irgendwo.**
  `.main-head` hatte kein `position: relative`, also lag „Erledigte einblenden"
  bei offener Detailspalte über deren „schließen" — ein fremder Knopf in einer
  fremden Spalte.
- **Der Breiten-Durchgang prüft jetzt vier Fragen**, und jede stammt aus einem
  gemeldeten Fehler: zu schmal, abgeschnitten, außerhalb, **überdeckt**. Die
  vierte kam dazu, weil die ersten drei die Überdeckung nicht sahen — und sie
  fand beim ersten Lauf zwei weitere Sachen, davon eine, die ich in derselben
  Runde selbst eingebaut hatte.
  - Die **Schublade ist ausgenommen**: unter 800 px liegt die Seitenleiste
    absichtlich über der Seite. Ein Prüfer, der Absicht als Fehler meldet,
    macht seine echten Befunde unglaubwürdig.
- **Eine Karte je Rolle, keine Zeile** (SONEs ADR-0119, Punkt 2, nach einer
  Meldung aus der Benutzung). Eine Rolle sagt **zwei** Dinge — was sie in den
  Projekten gibt und was sie im Arbeitsbereich verwaltet — dazu eine Zahl und ob
  sie änderbar ist. Vier Dinge auf einer Zeile brechen um.
  - Die **Zahl steht neben dem Namen**: sie beantwortet „darf ich das löschen",
    und genau dort stellt sich die Frage.
  - **Systemrollen stehen mit dabei**, nicht änderbar und mit Grund. Sie zu
    verbergen hieße, dass jemand `member` sucht und nicht findet, obwohl es das
    gibt — dieselbe Verwirrung wie ein gefiltertes Mitglied in der
    Personensuche.
  - Eine neue Rolle beginnt mit **Mitlesen und ohne Rechte**: ohne Stufe wäre
    sie ein Gast, den niemand gemeint hat, mit Rechten eine Vergabe, die
    niemand getroffen hat.
- **Vereinigung und Maximum, niemals Abzug** (SONEs ADR-0087, begründet in
  ADR-0026). Die wirksame Rolle einer Person ist die Vereinigung der Rechte und
  das Maximum der Stufen über ihre eigene Rolle und die aller ihrer Gruppen —
  weil **in eine Gruppe aufgenommen zu werden niemals wegnehmen darf, was
  jemand schon durfte.** Ein Modell, in dem Beitreten etwas nimmt, macht jede
  Gruppenmitgliedschaft zu einer Sache, die man vor dem Vergeben prüft.
  - Als **ein `OR` in einer Abfrage** und nicht als zwei Abfragen mit `||`
    darüber: zwei Abfragen sind zwei Zustände, und zwischen ihnen kann sich
    eine Mitgliedschaft ändern.
  - **Eine Gruppe ohne Rolle ist erlaubt** — sie ordnet dann nur, und „das sind
    die Leute vom Umzug" ist ein Zweck.
  - **Eine Gruppe wird gelöscht, auch mit Leuten darin** — anders als eine
    Rolle, und deshalb: ihre Rolle gab nur *dazu*, also bleibt jeder bei seiner
    eigenen. Bei einer Rolle wäre die stille Antwort „nichts" oder „alles".
  - `groups.manage` ist zurück, **im selben Commit wie seine Prüfungen** — das
    Versprechen aus Migration 0013, und der Wächter hat es eingefordert.
- **Beim Export `SELECT *`, bei Leuten aufzählen.** Für Inhaltstabellen soll ein
  neues Feld mitwandern, ohne dass jemand daran denkt; bei `users` ist es genau
  umgekehrt — was dazukommt, soll **nicht** automatisch in eine Datei wandern,
  die per Mail unterwegs ist. Nicht im Export: Kennwörter, Freigabe-Tokens,
  Sitzungen.
- **Einen Arbeitsbereich wirft sein Eigentümer weg, nicht ein Recht.** Eine
  Rolle könnte man aus Versehen mit dem Recht ausstatten; die Eigentümerspalte
  lässt sich nicht aus Versehen setzen. Der Name muss abgetippt werden — der
  einzige Ort mit dieser Hürde, weil ein Papierkorb für Arbeitsbereiche ein
  Papierkorb für alles wäre.
- **Keine Einstellung „wer ein Konto anlegen darf".** SOTE hat keinen Weg, sich
  selbst anzumelden — eine Einstellung dafür wäre der Fehler aus ADR-0112, nur
  von mir selbst gebaut.
- **Eine Vorauswahl ist eine Behauptung darüber, was jemand braucht.** Ich hatte
  im Zeichenwähler dreißig Zeichen vorausgewählt, weil ein alphabetisches
  Gitter mit einer Wand aus `a-arrow-…`, `alarm-…`, `align-…` beginnt. Markus
  hat das zurückgenommen („das war schon ok so"), und er hat recht: wer ein
  Projekt „Ausrichtung" nennt, will die Wand. Der Ärger, den ich vermeiden
  wollte, kostet einen Wisch; der, den ich verursachte, kostet das Erraten des
  richtigen Suchworts für ein Zeichen, dessen Namen man nicht kennt. Auch der
  Deckel von 120 Treffern ist weg.
  - **Die Antwort auf die Langsamkeit darf nichts weglassen.** 2080 Knöpfe
    kosteten gemessen 877 ms (1690 ms auf einem vierfach gedrosselten Gerät).
    `useProgressive` zeichnet den ganzen Satz in Schritten: erstes Bild 181 ms
    statt 877. Gedrosselt bleibt es bei ~1,3 s, und das ist **nicht** das
    Zeichnen, sondern das Auspacken des Zeichensatzes — der Preis dafür, den
    Satz überhaupt zu haben, einmal je Sitzung.
  - **Eine Optimierung, die sich nicht messen lässt, fliegt raus.** Ich hatte
    ein Anwärmen beim Zeigen eingebaut; mit 0/300/1500/3000 ms Zeigeabstand
    ergab es 894/623/1523/1385 ms — kein Trend, nur Rauschen. Wieder heraus.
## Aufträge, die später laufen

- **Eine Tabelle, kein zweiter Dienst.** SOTE wird selbst betrieben, in einem
  Prozess; ein eigener Läuferdienst wäre ein zweites Ding zum Ausrollen,
  Überwachen und Neustarten. Geholt wird mit `FOR UPDATE SKIP LOCKED`, also
  bleibt es auch mit mehreren Prozessen richtig.
- **Mindestens einmal, nicht genau einmal.** Stirbt der Prozess zwischen Arbeit
  und Quittung, läuft der Auftrag wieder. Genau einmal wäre nur mit einer
  Quittung *in derselben Transaktion wie die Arbeit* zu haben, und das geht
  nicht, sobald die Arbeit den Server verlässt (Mail). Jeder Bearbeiter muss
  mehrfaches Laufen aushalten — das ist die Bedingung, unter der er aufgerufen
  wird.
- **Nichts wird still weggeworfen.** Nach fünf Versuchen bleibt ein Auftrag
  liegen, mit seinem letzten Fehler, und steht unter „Wartung". Einer, der
  still verschwindet, ist einer, von dem der Betreiber nie erfährt, dass er
  nötig war. **Ein unbekannter Name ist ein Fehler**, kein Stillschweigen.
- **Der Versuch wird vor der Arbeit gezählt.** Danach zu zählen heißt: ein
  Auftrag, der den Prozess umbringt, wird beim Neustart erneut geholt, mit
  derselben Zahl — für immer.
- **`locked_at` ist eine Zeit und kein Flag**: ein Flag, das ein abgestürzter
  Prozess gesetzt hat, bleibt für immer gesetzt.
- **Der Schlüssel gilt nur für offene Aufträge**, und er wird beim **Holen**
  frei — nicht beim Quittieren. Er antwortet auf „wartet diese Arbeit schon?",
  und ein laufender Auftrag wartet nicht mehr. Nötig, weil ein Bearbeiter
  seinen Nachfolger einreiht, *während seine eigene Zeile noch läuft*. Der
  Preis, benannt: ein fehlgeschlagener Auftrag hält den Schlüssel nicht, also
  können zwei Zeilen derselben Arbeit liegen — tragbar, weil die Zusage
  ohnehin „mindestens einmal" ist.
- **Die Wiederholung liegt im Auftrag**, nicht in einem Zeitplan daneben: so
  gibt es genau einen Ort, an dem steht, wie oft etwas läuft.
- **Der Papierkorb leert sich nach dreißig Tagen** — gerechnet vom Wegwerfen,
  nicht vom Anlegen. Aufgaben vor Projekten, und ein Projekt bleibt, solange
  darunter etwas liegt, dessen Frist noch läuft: sonst holt jemand ein Projekt
  aus dem Korb und findet es leer.
- **Dreißig Tage sind eine Zahl und keine Einstellung.** Eine Einstellung für
  etwas, das niemand verlangt hat, ist eine Frage, die der Betreiber
  beantworten muss, ohne sie gestellt zu haben.

## Mail und Einladungen

- **Mail geht durch die Warteschlange, immer.** Eine Anfrage, die auf einen
  fremden Server wartet, hängt, wenn der fremde Server hängt — ein Mailserver
  ohne Antwort würde ein Einladen langsam machen. Und der Läufer bringt mit,
  was Mail braucht: Wiederversuche mit wachsendem Abstand, und ein Fehlschlag
  bleibt unter „Wartung" sichtbar.
- **Mindestens einmal heißt: eine Mail kann doppelt kommen.** Trotzdem richtig:
  die Gegenrichtung wäre eine Mail, die manchmal *nicht* kommt, und eine
  Einladung, die nicht ankommt, ist schlimmer als eine, die zweimal ankommt.
- **Nur Text, kein HTML.** Eine Mail von SOTE sagt einen Satz und trägt einen
  Link. HTML dazu wäre eine zweite Fassung desselben Inhalts, die auseinander-
  laufen kann.
- **Der Token reist nie in der Anfrage** (SONEs ADR-0126). Der Browser schickt
  eine **Adresse**, der Server baut den Link selbst — eine Route, die eine
  übergebene URL verschickt, wäre ein kleiner offener Verteiler mit dem Namen
  dieser Instanz auf dem Umschlag. In der API gibt es darum **keinen
  Parameter**, in dem ein Link stehen könnte.
- **Die eigene Adresse kommt aus `SOTE_BASE_URL`**, nicht aus der
  `Host`-Kopfzeile: die ist eine Angabe des Aufrufers, und wer sie fälscht,
  lässt diesen Server Einladungslinks auf einen fremden Namen verschicken. Fehlt
  sie, geht **keine** Mail — die Einladung gilt trotzdem und steht mit ihrem
  Link in der Liste. Der Vorgang ist eine Sache, die Mail eine andere.
- **Ein Ablauf ist bei Einladungen Pflicht**, anders als bei Freigaben: eine
  Freigabe ist ein Arbeitsmittel, das man absichtlich offen lässt, eine
  Einladung ein einmaliger Vorgang. Eine, die drei Jahre gilt, ist ein
  vergessenes Konto in Wartestellung.
- **Wer schon ein Konto hat, wird nicht eingeladen** — mit dem Hinweis, wo die
  richtige Frage steht („Leute"). Sonst wäre es ein Link, der beim Einlösen
  fehlschlägt: ein Fehler, der eine Woche später bei jemand anderem auftritt.
- **Die Adresse kommt aus der Einladung, nicht aus dem Formular**, sonst wäre
  ein Einladungslink ein Konto auf beliebigen Namen. Angezeigt wird sie
  trotzdem: wer einen Link öffnet, will wissen, für wen er gilt.
- **`seal`/`unseal` liegen in `secretbox.ts`**, seit es zwei Aufrufer gibt.
  Zwei Kopien derselben Verschlüsselung sind zwei Stellen, an denen ein
  Verfahren gewechselt werden müsste — und eine wird vergessen. Der
  Variablenname bleibt `SOTE_SHARE_KEY`: umbenennen hieße, einen laufenden
  Server beim nächsten Neustart ohne Schlüssel dastehen zu lassen.

## Erinnerungen

- **Ein Brief am Tag, nicht einer je Aufgabe.** Dreißig Mails am Tag heißen
  einen Filter im Postfach — und danach erinnert nichts mehr an nichts. Das ist
  auch die Antwort auf „wie oft": einmal täglich, zu einer Zeit, die die Person
  selbst wählt.
- **Genau einmal je Tag**, obwohl der Läufer „mindestens einmal" zusagt: Quittung
  und Mailauftrag entstehen **in derselben Transaktion**. Beides sind Zeilen in
  derselben Datenbank, also ist das Einreihen wirklich genau einmal. Das
  **Zustellen** bleibt „mindestens einmal", denn das verlässt den Server — und
  diese Grenze ist der Unterschied zwischen einer Zusage und einer Hoffnung.
- **Das Datum ist das der Person**, nicht UTC. Wer in Tokio um 8 Uhr erinnert
  wird, soll seinen Brief am japanischen Dienstag bekommen — sonst gibt es einen
  Tag mit zwei Briefen und einen ohne.
- **Ein Fenster, kein Zeitpunkt.** Der Tick läuft alle fünfzehn Minuten,
  geschickt wird, sobald die Zeit heute vorbei ist. Wer mittags neu startet,
  bekommt seinen 8-Uhr-Brief mittags: spät, aber nicht gar nicht, und nicht
  zweimal.
- **Aus, bis jemand ja sagt.** Wer sich anmeldet, hat nicht um Mail gebeten. Und
  eine Zeit, die keine ist, zählt als aus — nicht als Vorgabe.
- **Auch an einem leeren Tag kommt ein Brief.** Einer, der nur bei Arbeit kommt,
  ist einer, dessen Ausbleiben zweierlei heißen kann: nichts zu tun, oder SOTE
  ist kaputt.
- **Ohne Mailweg läuft der Bearbeiter nicht**, und das wird gesagt. Sonst
  verbrauchte er die Quittungen für Briefe, die niemand zustellt: nach einem Tag
  hätte jeder eine Quittung und niemand einen Brief.
- **Der Läufer nimmt einen Geltungsbereich** (`only`). Im Betrieb, damit Mail
  auf einem eigenen Prozess laufen kann; im Test, weil die Testdateien eine
  Datenbank teilen und `runOne` sonst den Auftrag einer anderen greift.
- **Die Servertests laufen nacheinander** (`--test-concurrency=1`): der
  Papierkorb-Bearbeiter löscht über alle Arbeitsbereiche, und während er
  aufräumt, schreiben andere Dateien dieselben Tabellen.

## Single-Sign-on

- **SSO meldet an, es lädt nicht ein.** Der Grundsatz, der hier schon gilt
  (SONEs ADR-0073): die Instanz lädt ein. Ein SSO, das Konten von selbst
  anlegt, hieße, dass jeder eines bekommt, der im Verzeichnis des Anbieters
  steht — und die Instanz hätte aufgehört zu entscheiden, wer hier existiert.
  Eine **Einladung** lässt sich mit SSO annehmen; wer nichts von beidem hat,
  bekommt einen Satz.
  - **Benannt statt versteckt:** in einer Firma, in der das Verzeichnis ohnehin
    die Wahrheit über die Belegschaft ist, ist die andere Entscheidung richtig.
    Dann wird eine Einstellung nötig, und der Kommentar in Migration 0018 ist
    die Stelle, an der sie beginnt.
- **Die Verknüpfung hängt am Subjekt, nicht an der Adresse.** Eine Adresse
  wechselt, ein Subjekt nicht. Beim ersten Anmelden wird über die Adresse
  gefunden und das Subjekt gemerkt — genau einmal. **Dieselbe Adresse mit einem
  anderen Subjekt wird abgelehnt:** hereinlassen hieße, ein Konto an den
  Nächsten weiterzugeben, der eine freigewordene Adresse bekommt.
- **Keine Prüfung der ID-Token-Signatur, und das ist eine Entscheidung.** Der
  Code wird **vom Server** getauscht, über TLS, mit dem Client-Geheimnis — was
  so zurückkommt, ist beglaubigt. Eine Signaturprüfung bräuchte JWKS,
  Schlüsseldrehung und Algorithmus-Ausschlüsse (`alg: none`, `HS256` mit dem
  öffentlichen Schlüssel als Geheimnis): lauter Ecken, an denen man es falsch
  macht. Sie wäre nötig, wenn ein **Browser** das Token mitbrächte.
- **`state` und PKCE liegen auf dem Server.** Ein `state`, den der Browser
  selbst mitbringt, schützt gegen nichts. Und er gilt **genau einmal**
  (`DELETE ... RETURNING`, nicht lesen-dann-löschen).
- **Nur ein Pfad wird gemerkt, keine URL.** Eine URL aus der Anfrage wäre eine
  offene Weiterleitung: wer sie setzt, schickt jemanden nach dem Anmelden auf
  eine fremde Seite, die aussieht wie diese.
- **Kein `http://`**, auch nicht „nur im Netz drinnen": über diese Verbindung
  geht das Client-Geheimnis. Eine Ausnahme für Testaufbauten ist eine, die
  jemand im Betrieb stehen lässt.
- **Ein Konto ohne Kennwort ist ein SSO-Konto.** Kein halber Zustand: `signIn`
  verbindet `users` mit `user_passwords` und findet es gar nicht, es gibt also
  kein Kennwort, das darauf passen könnte — auch kein leeres. Ein erfundenes
  wäre eines, das niemand kennt und niemand ändern kann.
- **Ein Anbieter, der nicht antwortet, ist keine Ausnahme**, sondern eine
  Auskunft auf der Anmeldemaske.

- **Compose gibt die Umgebung des Rechners nicht weiter.** SONEs Lehre, dort mit
  vierzehn Variablen — und der Kommentar dazu stand in *dieser*
  `docker-compose.yml`, während ich zehn neue Variablen baute und keine davon
  eintrug. Was in `.env` steht und dort nicht genannt ist, erreicht den
  Container nie: man füllt etwas aus, es wirkt nicht, und nichts sagt warum.
  - **Ein Grundsatz, an den sich niemand hält, ist ein Grundsatz mit einer
    Prüfung zu wenig.** `check-env-passed.mjs` hält jetzt **beide** Richtungen:
    jede gelesene Variable steht in Compose, und jede in Compose wird gelesen —
    die zweite Richtung ist derselbe Fehler von der anderen Seite (ADR-0112).
    Ausnahmen stehen mit Grund im Skript, sonst ist eine Ausnahmeliste eine
    Liste, auf die man Dinge schiebt.
  - **Und drei Stellen, nicht zwei.** `.env.example` hatte ich beim ersten
    Anlauf vergessen — Markus hat es gemeldet, und er hatte recht: das ist die
    Datei, die der Betreiber **kopiert**. Ein Wächter, der sie nicht kennt,
    lässt genau die Stelle offen, an der jemand nachsieht. Nicht umgekehrt
    geprüft: dort stehen auch Werte, die nur Compose selbst liest
    (`SOTE_IMAGE`), und `SOTE_DATABASE_URL` wird dort zusammengesetzt, weil
    eine URL mit dem Kennwort darin eine zweite Stelle wäre, an der es steht.
- **Eine Zahl, die von Hand gepflegt wird, lügt irgendwann.** Die README nannte
  die Testzahl zweimal im selben Abschnitt, mit zwei Werten (94 und 217), und
  beide waren falsch. Sie steht jetzt nirgends — `pnpm check` sagt sie.
- **Dokumentation verrottet leiser als Code.** In der README stand derselbe
  Abschnitt zweimal, die zweite Kopie eine ältere Fassung, und beide
  behaupteten „Einladungen gibt es noch nicht". Für jede Variable steht jetzt
  da, **was ohne sie passiert** — beim Einrichten die einzige Auskunft, die
  zählt.
- **„Leer" ist kein ungültiger Wert, sondern ein Zurücknehmen.** Die schmale
  Leiste auf „Vertieft" und zurück auf „Wie entworfen" antwortete *„look" nimmt
  diesen Wert nicht*: das Formular schickt dann `look: { surfaces: {} }`,
  `readLook` macht `{}`, und `readSettings` lässt ein leeres `look` weg — die
  Prüfung sah „Schlüssel fehlt in `kept`" und schloss auf einen ungültigen Wert.
  „Nichts gesetzt" und „nicht vorhanden" sind derselbe Zustand. Die Grenze hat
  einen eigenen Test: „leer" nimmt zurück, „Unsinn" wird weiter abgelehnt.
- **Was absolut zu einer Zeile sitzt, wandert mit ihr.** Die offene Zeile hatte
  `margin-left: -10px` samt `padding-left` — für den Inhalt hob sich das auf,
  für den absolut gesetzten **Anfasser** nicht: er wanderte nach links und
  klebte am Streifen. Der Streifen ist jetzt ein eigenes Element, das keinen
  Platz nimmt; damit gibt es keine Verschiebung zum Gegenrechnen, und eine
  Gegenrechnung wäre eine zweite Zahl, die zur ersten passen muss.
- **Ein `<input>` verschluckt Zeilenumbrüche.** Der Browser ersetzt sie durch
  Leerzeichen, also wurde aus drei eingefügten Zeilen eine Aufgabe
  „zeile 1 zeile 2 zeile 3" — still. Jetzt eine Aufgabe je Zeile, jede durch
  dieselbe Erfassung (`morgen 9 Uhr`, `#projekt`, `!!` gelten je Zeile).
  - **Was schon getippt war, bleibt stehen**: nicht mit der ersten eingefügten
    Zeile verschmolzen und nicht weggeworfen. Zusammenkleben wäre die einzige
    Variante, bei der etwas verlorengeht.
- **SONE ist der Maßstab, und zwar abgeschaut und nicht nachempfunden.** Markus'
  Korrektur: *„Ich glaube ich habe gesagt: So wie bei Sone. Nicht nicht wie bei
  Sone. Sone ist eigentlich bei allem der Maßstab. Schau dort ab."* Der
  Unterschied ist praktisch — SONEs `EntryMenu` hat eine Form, die ich mir nicht
  ausgedacht hätte: ein **Band** aus Zeichenknöpfen für das Häufige, darunter
  beschriftete Zeilen, dann das Aussehen, unten das Zerstörende.
  - Und die Begründung stand dort **gerechnet**: *„At 190px the five most-used
    actions were five rows of text and the menu ran most of the way down the
    sidebar. As a row of marks they take one row, and the width is what makes
    five of them fit."* Die Wörter überleben als `title` und `aria-label`.
  - **Teilen sitzt im Band**, weil man ein Projekt am Projekt freigibt. Es führt
    auf die Freigaben mit vorgewähltem Projekt und legt nicht still einen Link
    an: Recht und Ablauf sind eine Wahl.
  - **Der Sortierschlüssel wird in der Leiste gerechnet**, nicht im Server: nur
    sie weiß, zwischen welche zwei Nachbarn etwas soll. Und ein Schlüssel
    *dazwischen* statt „Plätze tauschen" — ein Tausch schreibt zwei Zeilen, und
    wenn die zweite scheitert, stehen zwei Knoten auf demselben Platz.
  - **Zwei Stellen gaben Projekte heraus, und ich pflegte eine.** `projectView`
    bekam `sortKey`, die Liste baut ihre Zeilen aber selbst — der Baum bekam
    keine Schlüssel, `siblings` verglich `undefined` mit `undefined`, und alle
    Verschieben-Knöpfe waren gesperrt.
- **Ein Arbeitsbereich kommt nie ohne seine Rollen.** `createWorkspaceIn` ist
  aus `createAccountIn` herausgezogen, weil es jetzt zwei Aufrufer gibt — die
  Einrichtung und „Neuer Arbeitsbereich". Die Begründung stand dort schon, als
  es einen gab: *zwei Umsetzungen wären zwei Rollenlisten.*
  - **Jedes Konto darf einen anlegen**, nicht nur der Administrator: ein
    Arbeitsbereich ist der Ort, an dem jemand seine eigene Arbeit führt, und ihn
    beantragen zu müssen macht aus einer Notiz einen Vorgang. Wer hier ein Konto
    hat, hat es bekommen (ADR-0073) — die Entscheidung ist schon getroffen.
  - **Der Wähler bekommt einen Fuß**, wie SONEs `switcher-footer`: ein Eintrag,
    der zu einem Namensfeld wird, kein Bildschirm für ein Wort. Und sonst
    nichts — *„this menu answers one question: which workspace."*
  - **Anlegen heißt hineinwechseln.** `loadMe` setzte sonst gleich wieder auf
    den ersten Bereich zurück: `POST 201`, Name in der Liste, und man stand im
    alten. Die Id wird dabei **geprüft und nicht geglaubt** — eine, die es nicht
    mehr gibt, wäre ein Bereich, in dem jede Anfrage fehlschlägt.
- **Das Aufgaben-Suchfeld steht nur, wo es Aufgaben gibt.** Es stand in jedem
  Bereich, auch in der Verwaltung, und suchte dort nichts. Ein Feld, das an
  einem Ort nichts findet, ist ein Feld, dem man an allen Orten misstraut. In
  den Workspace-Einstellungen steht stattdessen der **Wähler** — der Bereich
  handelt von Arbeitsbereichen, also ist Wechseln dort die häufige Handlung.
- **Eine Glocke und ein Posteingang sind zwei Dinge.** Die Glocke in der
  Schiene hieß „Posteingang" und zeigte Aufgaben ohne Projekt — das sind zwei
  Fragen, und eine Glocke beantwortet nur die zweite. Der Posteingang ist eine
  **Aufgabenansicht** und steht jetzt bei „Heute" und „Irgendwann";
  Benachrichtigungen sind, was *jemand anderes* getan hat.
  - **Die Zahlen kommen aus der Liste, die man schon hat** (SONEs `InboxPanel`:
    *„a menu that says Mentions without saying how many is a menu you have to
    click to learn anything from"*). Einmal geholt, Menü und Bildschirm zählen
    daraus — eine Abfrage je Ansicht wäre eine je Zahl, und die Zahlen kämen aus
    verschiedenen Augenblicken.
  - **Drei Achsen, in der Reihenfolge, in der man fragt:** ist etwas neu, welche
    Art, wo. Die letzte gibt es, weil eine Glocke über Arbeitsbereiche hinweg
    gilt und der Kopf keinen nennen kann — es gibt keine einzige Antwort.
  - **Nie über sich selbst**, und die Prüfung steht im **Schreibweg**: eine
    Zeile, die niemand sehen soll, soll nicht entstehen. Als Filter beim Lesen
    liefe sie in jeder Zählung mit, bis jemand den Filter vergisst.
  - **In derselben Transaktion wie das Ereignis.** Sonst gibt es einen Zustand,
    in dem jemand zuständig ist und nichts erfährt — oder eine Meldung über eine
    Zuweisung, die zurückgerollt wurde.
  - **Eine weggeworfene Aufgabe verschwindet aus der Liste, nicht aus der
    Datenbank:** der Papierkorb kann sie zurückholen, und dann soll die Meldung
    wieder da sein.
  - **Das Abzeichen hängt am Modus** (`badge: true`), nicht als Name in der
    Zeichnung. Mein erster Versuch schrieb `mode.id === 'notifications'` in die
    Schiene — der Wächter hat es gemeldet, denn das wäre eine zweite Liste
    neben `MODES`. Zwei Wächter standen dabei kurz gegeneinander: der ältere
    verlangte wörtlich `mode.id === 'inbox'`, also genau das Verbotene.
## Die Türklingel (live)

Übernommen aus SONE (`claude/live-aktualisierung.md`, dessen ADR-0093 bis
ADR-0100). Die Regeln dort sind teuer erarbeitet; ich habe sie nicht neu
erfunden.

- **Der Rahmen ist eine Türklingel, kein Brief.** Die Nutzlast nennt einen
  Arbeitsbereich und einen Scope, sonst nichts. Drei Gründe: eine NOTIFY-Nutzlast
  erreicht *jede* lauschende Instanz; eine Zahl auf der Leitung wäre eine zweite
  Antwort auf die Frage, die die Liste schon beantwortet; und bei einem Löschen
  ließe sich gar nicht sagen, wen es angeht.
- **Die Spaltenliste ist das Design.** Die Update-Trigger vergleichen
  vorher/nachher über genau die Spalten, die die betroffene Liste zeichnet. Die
  **Notiz** steht in keiner (sie lebt in der Detailspalte, die die Aufgabe schon
  offen hat), `updated_at` in keiner, und **„zuletzt benutzt" an einer Freigabe**
  in keiner — sonst läutet das Arbeiten eines Gasts die Liste des Eigentümers im
  Sekundentakt.
- **Für jede „läutet nicht"-Entscheidung gibt es einen Test für die
  Abwesenheit.** Sonst ist der ganze Aufwand mit der Spaltenliste unbelegt.
- **Statement-level über Transition Tables, immer**, plus die drei
  Postgres-Grenzen aus SONE: keine Spaltenliste und kein Mehrfach-Ereignis neben
  Transition Tables, und ein Statement, das nichts trifft, sendet nichts.
- **Eine lauschende Verbindung, außerhalb des Pools.** `LISTEN` bindet sie
  dauerhaft — aus dem Pool genommen käme sie nie zurück.
- **SSE und nicht WebSocket.** Eine Klingel geht in *eine* Richtung; ein
  WebSocket wäre der Aufbau ohne den Anlass. SONE hat einen, aber dort fließen
  Dokumentänderungen in beide Richtungen. `EventSource` bringt den Wiederaufbau
  mitgeliefert — und darum gibt es hier **kein** `close()` im Fehlerfall: das
  wäre die Klinke, die klemmt.
- **Gefiltert wird auf dem Server**, weil nur er den Zugang kennt. Der Preis,
  benannt: ein Gast erfährt, *dass* im Arbeitsbereich etwas passiert ist, auch
  wenn es ein anderes Projekt war — ein Zeitsignal.
- **Der Fokus bleibt.** Ein Push sagt, was passierte, *während man zuhörte*.
- **Ein offener Strom heißt, das Netz wird nie ruhig.** `waitUntil:
  'networkidle'` läuft seitdem in einen Timeout — 86 Prüfskripte und
  `measure-widths.mjs` sind auf `domcontentloaded` umgestellt, mit dem Grund im
  Werkzeug.
- **Eine Route hinter einer, die sie verschluckt, ist still.** Die Gast-Klingel
  lag hinter dem Zweig, der `/api/share/:token/…` abfängt: 404, im Browser ein
  stiller `EventSource`-Fehler. `check-routes-reachable.mjs` prüft das jetzt und
  nennt die verschluckende Zeile.

- **Eine Ansicht, zwei Türen: eine austauschbare Anbindung.** Die Detailspalte
  braucht vier Wege (lesen, ändern, Teilaufgabe, Kommentar); ein Mitglied ruft
  `/api/tasks/…`, ein Gast `/api/share/:token/tasks/…`. `DetailIO` mit
  `memberIO` und `guestIO` — sie zweimal zu bauen wäre zweimal derselbe
  Bildschirm, und der eine hätte irgendwann ein Feld, das der andere nicht hat.
  - **Und die Abbildung gehört dazu.** Mein Gast-Zweig gab erst die *innere*
    Form zurück (Daten statt ISO-Zeichenketten, `recurrence: undefined` statt
    `null`), die Spalte prüfte `!== null` und griff auf `.says` zu: JS-Fehler
    beim Gast, leere Spalte. `detailView` ist jetzt eine Stelle für beide — ich
    hatte die Regel im Kommentar darüber selbst geschrieben und einen Zweig
    weiter gebrochen.
  - **Lesen zuerst.** Die Schreibprüfung stand ganz oben in `/tasks/:id` und
    hätte jedem Lese-Link eine Detailspalte gegeben, die 403 sagt. Sie sitzt
    jetzt an jedem schreibenden Zweig.
  - **Ohne Schreibrecht sind die Felder abwesend, nicht deaktiviert** — die
    Notiz bleibt lesbar, denn ein Lese-Link soll Inhalt sehen. Ein Feld, in das
    man tippen kann und das dann ablehnt, war hier schon sechs Mal der Fehler.
  - **Ein Gast kommentiert als „über einen Link".** Ein CHECK aus Migration 0001
    verlangt genau eines von beiden — Konto **oder** Name; mit `author_id = NULL`
    allein bricht der Einfügeversuch.
- **Profilbilder: verkleinert im Browser, ohne Original.** SONEs ADR-0029, und
  für Profilbilder gilt dort die Abweichung, die hier die ganze Regel ist: ein
  Profilbild wird 22 Pixel breit gezeichnet, also ist ein Handyfoto mit
  viertausend Pixeln Speicher für einen Fall, der nicht vorkommt.
  - **Im Browser**, weil serverseitig eine Bildbibliothek im Container hieße —
    mit eigenen Sicherheitsausgaben und einem Bau, der sich je Architektur
    unterscheidet. Und das Netz trägt die große Datei einmal statt zweimal.
  - **Der Deckel steht an drei Stellen**, und das ist Absicht: die
    Verkleinerung im Browser ist eine *Zusage des Aufrufers*, die Route prüft
    sie, und der CHECK in Migration 0021 gilt auch für ein Skript. Die Route
    bricht **während** des Empfangs ab — ein Deckel, der erst nach dem Schaden
    gilt, ist keiner.
  - **Auch ein kleines Bild wird neu gezeichnet** (Abweichung von SONE): der
    Deckel gilt für *Bytes*, nicht für Pixel, und ein PNG mit 300 Pixeln kann
    ein Megabyte haben.
  - **JPEG, außer bei einem kleinen PNG.** SONE behält PNG, weil Text in einem
    Diagramm Höfe bekommt; ein Profilbild ist kein Diagramm. Die Ausnahme ist
    die Durchsichtigkeit — ein PNG mit Alpha würde als JPEG grau hinterlegt.
  - **In der Datenbank, nicht im Dateisystem**: ein Bild je Konto, wenige
    Kilobyte. Ein Volume wäre ein zweiter Ort, den die Sicherung kennen muss —
    genau daran ist SONEs ADR-0107 aufgelaufen. Bei Anhängen (Megabyte je
    Zeile) gilt das nicht mehr, und der Kommentar in der Migration ist die
    Stelle, an der die Entscheidung neu ansteht.
  - **Keine Platzhalterfigur, sondern Initialen**: wer keines hat, hat keines,
    und ein grauer Umriss eines Menschen ist eine Behauptung über jemanden.
  - **Ein Zähler in der Adresse** (`picStand`): die Adresse bleibt gleich, und
    `max-age` gilt auch für den, der das Bild gerade gewechselt hat.
- **Die Filter der Suche stehen in der Leiste.** SONEs ADR-0069, angewandt und
  nicht gebogen (`claude/suche-als-ort.md`): *eine Suche einzugrenzen ist
  Navigation innerhalb dieser Suche.* Sechs Facetten gab es, und der einzige Weg
  dorthin war, die Syntax zu kennen — *eine Suche, die Leute belohnt, die die
  Dokumentation gelesen haben, in einer Anwendung, deren übrige Bildschirme das
  nicht tun.*
  - **Die Abfrage steht in der Adresse**, nicht im Zustand: ein Text, drei
    Schreiber (das Feld über dem Baum, das Feld im Bildschirm, jedes
    Bedienelement). Eine Kopie wäre eine zweite Antwort auf „wonach wird
    gesucht", und die beiden liefen beim ersten Gebrauch auseinander.
  - **Der Freitext bleibt stehen.** `buildTaskQuery` ersetzt oder entfernt eine
    Facette und lässt den Text in Ruhe — niemand tippt gern in ein Feld, das
    sich selbst umschreibt. „Filter zurücknehmen" nimmt darum die Filter und
    nicht das Wort.
  - **Derselbe Klick nimmt zurück**: ein Filter, den man nur setzen kann,
    braucht einen zweiten Weg zum Entfernen — und der wäre die Syntax, die
    dieses Panel gerade ersetzt.
  - **Das Symbol in der Schiene heißt nicht „Suche starten", sondern ist der
    Weg zurück** zu einer Suche. Es zeigte auf eine Platzhalterseite, während es
    die Suche als Ort längst gab.
- **Es gibt zwei Panels: eines für den Bildschirm, eines für das Telefon.** Ein
  Prüfskript, das `.panel-list` ohne `.first()` benutzt, trifft zwei Knöpfe und
  bricht mit „strict mode violation" ab — kein Fehler in der Anwendung.
- **Das Menü der Freigaben, mit SONEs Begründung und einer anderen Achse.** Dort
  sind es *Links, von mir, für mich* — drei Arten von Freigabe. SOTE hat nur
  **eine** Art, einen Link; die Achse, die es hier gibt, ist der **Zustand**:
  aktiv, alle, nie benutzt, abgelaufen.
  - **„Nie benutzt" ist die nützlichste Zeile:** einen Link, den niemand
    geöffnet hat, kann man ohne Rückfrage zurückziehen — bei einem benutzten
    muss man jemanden fragen.
  - **Ein Abruf, zwei Leser.** Der Bildschirm lädt und meldet seine Liste nach
    oben; das Menü zählt daraus. Nach oben gemeldet und nicht oben geholt, weil
    das Laden dorthin gehört, wo angelegt und widerrufen wird — und ein zweiter
    Abruf wären zwei Zahlen aus verschiedenen Augenblicken.
- **Am falschen Element gemessen, dreimal in einer Sitzung.** Ein Klick auf der
  ganzen Seite statt in der Leiste; `.panel-list` ohne `.first()` (es gibt zwei
  Panels); und `main .set-row` statt `main tbody tr`, was die Formularzeilen
  traf und „nichts gefiltert" meldete, während die Liste sich geändert hatte.
  **Ein grüner Test ohne Gegenprobe ist eine Behauptung** — und eine
  Textersetzung ohne `assert` tut still nichts.
- **Eine neue Klasse für eine Zeile, die aussehen soll wie die daneben, ist eine
  zweite Antwort auf „wie sieht eine Zeile in der Leiste aus".** Für die drei
  neuen Panels hatte ich `panel-row` und `panel-group` erfunden und **nur** die
  `quiet`-Variante gestaltet — die Grundform gab es nie, also zeichneten sie
  nackte Knöpfe mit den Vorgaben des Browsers. Gemeldet als „in allen
  Seitenmenüs hast du die Texte einfach reingeklatscht ohne Style". Jetzt
  `p-item` und `group-label`: dieselbe Zeilenform wie im Baum (32 px, 14 px,
  gleiche Polster), gemessen in allen vier Panels.
- **Wo etwas hingehört, wird aufgezählt — nicht, wo es nicht hingehört.** Das
  Aufgaben-Suchfeld hing an `SECTION_NAV === null`, was Einstellungen und
  Verwaltung erfasste, aber nicht Benachrichtigungen, Freigaben, Papierkorb und
  die Suche selbst: über der Liste der Freigabelinks stand „Aufgaben
  durchsuchen". Mit einer Aufzählung der Orte, an die es gehört, erbt ein neuer
  Bereich kein Feld, das dort nichts findet.
## Anhänge

- **Rohe Bytes, kein Multipart** — dieselbe Bauart wie beim Profilbild. Der
  Name reist als `?name=`, weil der Körper die Datei *ist*. Die Größe wird
  **stückweise** geprüft und die Verbindung abgebrochen: erst alles einlesen
  und dann messen heißt, dass eine Datei von zwei Gigabyte zuerst im
  Arbeitsspeicher liegt.
- **`attachment` und `nosniff` beim Ausliefern.** Ohne das öffnet der Browser
  eine hochgeladene HTML-Datei *im Kontext dieser Anwendung* — und damit kommt
  sie an die Sitzung.
- **Ein echter Link zum Herunterladen**, kein `fetch`: der Browser lädt selbst,
  mit Fortschritt und Wiederaufnahme. Bytes in den Arbeitsspeicher zu holen, um
  sie als Blob anzubieten, wäre derselbe Weg mit mehr Schritten.
- **Das Feld ist ein `label`** mit verstecktem `input type=file` (wie beim
  Profilbild): ein `input[type=file]` sieht in jedem Browser anders aus, ein
  `label` sieht aus wie unsere Knöpfe. Und es leert sich nach dem Anhängen —
  sonst löst dieselbe Datei beim zweiten Mal kein `change` aus, und der Knopf
  scheint nichts zu tun.
- **Ohne `SOTE_FILES_DIR` erscheint das Feld nicht.** Der Server antwortet 501,
  und ein Feld, das darauf läuft, wäre eines, das nichts tut.

## Anhänge: Speicher und Zeilen

- **Die Bytes liegen im Dateisystem**, nicht in Postgres — wie SONEs `files`
  mit `storage_key`. Bei den Profilbildern ist `bytea` vertretbar (256 KB, eines
  je Konto); Anhänge sind beliebig viele und beliebig groß. **Die Folge, die man
  wissen muss: ein Datenbank-Abzug allein reicht nicht zum Wiederherstellen.**
  Steht in der Migration, in `.env.example` und am Datenträger in Compose.
- **Erst die Datei, dann die Zeile.** Bricht es dazwischen, liegt eine Datei
  ohne Zeile da — belegter Platz, sichtbar für niemanden. Die andere Reihenfolge
  gäbe eine Zeile ohne Datei, und die zeigt die Oberfläche als Anhang, den man
  nicht öffnen kann. **Von zwei unvollständigen Zuständen ist der stille der
  bessere.**
- **Autorisiert über die Aufgabe**, kein eigenes Recht: ein zweites
  Rechtesystem für Dateien wäre eines, das mit dem ersten uneins werden kann.
  Die Prüfung steht in der Abfrage (`AND workspace_id = $3`), nicht davor.
- **`bigint` kommt als Zeichenkette.** `size_bytes` wäre ohne `Number()` ein
  String in der Antwort gewesen — gefunden, weil der Test auf `7` prüft.
- **Zwei Wächter haben mich korrigiert:** die zwei neuen Env-Variablen fehlten
  in Compose und `.env.example`; und ich hatte den Datenträger **deklariert,
  aber nicht angehängt** — das Verzeichnis wäre nach jedem Neustart leer
  gewesen und die Zeilen zeigten auf nichts.
- **Eine Lüge im Code entfernt:** ich hatte in Kommentaren zweimal ein
  `aufraeumen()` versprochen, das es nicht gibt. Ein Aufräumer für verwaiste
  Dateien fehlt weiter — ein Test hält jetzt fest, dass die Datei beim Löschen
  der Aufgabe liegen bleibt.

## Erinnerungen je Aufgabe (Serverteil)

- **Bisher gab es eine Sorte:** eine Mail am Morgen mit dem Tagesüberblick
  (`reminders_sent`, ein Brief je Person und Tag). Das ist bei TickTick und
  Todoist das Kernmerkmal, und SOTE hatte die Hälfte.
- **Relativ gespeichert, nicht absolut.** Ein absoluter Zeitpunkt wäre nach
  jedem Verschieben falsch, und ein Programm, das nach dem Verschieben zur
  alten Zeit klingelt, ist eines, dem man nicht mehr glaubt. „30 Minuten vor
  nichts" gibt `undefined` und keinen Fehler: die Erinnerung wartet auf den
  Termin.
- **Quittung und Brief in EINER Transaktion**, Quittung zuerst mit `sent_at IS
  NULL` als Bedingung — laufen zwei Bearbeiter gleichzeitig, gewinnt einer.
  Nachgewiesen: zwei Durchgänge, ein Brief.
- **Eigene Routen statt eines Felds in `PATCH`:** eine Aufgabe hat mehrere
  Erinnerungen, und jede gehört *einer Person*. Ein Feld, das die Liste ganz
  ersetzt, würde die des Anderen wegnehmen. (Bei den Zuständigen ist die ganze
  Liste richtig — dort ist sie eine Aussage über die Aufgabe.)
- **`UNIQUE` mit NULL ist keine Sperre.** `UNIQUE (task_id, user_id,
  offset_minutes, at)` griff genau bei den relativen Erinnerungen nicht, weil
  `at` dort NULL ist und Postgres NULLs als verschieden hält. `NULLS NOT
  DISTINCT` war nötig — sonst Doppelbriefe für fast alle.
- **Zwei eigene Fehler beim Bauen:** ein **Backtick im SQL-Kommentar** beendet
  das Template-Literal (der Übersetzer meldete dann einen Klammerfehler zwanzig
  Zeilen weiter), und ich fragte `settings.value`/`.key` — die Tagesmail macht
  es längst richtig mit `data->>'zone'`.
- **Zwei Wächter haben mich korrigiert:** die Kopfzeile der Migration muss ihre
  Nummer nennen, und „diese Migration hat sich seit dem Lauf geändert" —
  richtig, ich hatte sie nach dem ersten Lauf angefasst.
- **Die Oberfläche ist eine LISTE, kein `FieldRow`.** Das Bauteil wählt *eine*
  Sache aus (Projekt, Priorität, Wiederholung); hier hängt man etwas an eine
  Liste an. Gesetzte Erinnerungen stehen als Pillen mit ihrem Weg zurück, die
  üblichen Vorläufe als Knopfreihe darunter — dieselbe Gestalt wie die Filter
  der Suche, weil es dieselbe Art Sache ist.
  - **Verschickte bleiben stehen, gedämpft:** eine Erinnerung, die verschwindet,
    sobald sie ihren Zweck erfüllt hat, lässt einen rätseln, ob sie kam.
  - **Wessen sie ist, steht dran** — sonst nimmt man eine fremde für die eigene
    und wundert sich, dass nichts kommt. Wegnehmen gibt es nur bei der eigenen,
    und der Server prüft es unabhängig davon.
  - Das Feld erscheint nur, wenn die Anbindung `addReminder` hat: beim Gast
    nicht, denn eine Erinnerung braucht ein Konto.

## Wiederholung und Zuständige sind änderbar

- **Beide waren halbe Versprechen:** setzbar nur beim Anlegen (`jeden Montag`,
  `+name` im Schnellerfasser), danach kein Weg mehr — kein Feld in `Patch`,
  keine Route. Spalten, Kern und Abhaken waren fertig.
- **Der Wechsel der Wiederholungsform muss die alten Spalten mitnehmen.**
  `recurrenceOf` liest die Kalenderregel zuerst; bliebe sie stehen, käme die
  Aufgabe weiter montags, obwohl „3 Tage nach Erledigung" dasteht.
- **Zuständige werden ganz gesetzt**, nicht als Zu-/Abgang: eine Liste, die man
  nur ergänzen kann, hat keinen Weg zurück. Geprüft gegen `workspace_members` —
  eine Id von außen schriebe eine Zuständigkeit, die niemand einsehen kann.
- **Die Gegenprobe steht jetzt** (482 Tests): Abhaken einer täglichen Aufgabe
  erzeugt genau eine offene Folge, mit Regel und Plan. Vorher unbewiesen.
- **Vier Fehlschläge, alle in meiner Prüfung, keiner im Code:** `memberships`
  statt `workspace_members` (das *war* echt, im Server, und der Test fand es);
  `closePool`/`createAccountIn`/`describe` geraten statt am Nachbartest
  abgelesen; `complete(pool, id, ws, ich)` statt `(pool, id, userId, at)`;
  `detail` mit vier statt drei Parametern (nur `tsc` fand es, `tsx` nicht); und
  **vier Aufgaben mit demselben Titel**, sodass ich eine andere prüfte als
  geklickt. Dazu `canWrite` statt `darfSchreiben` — das Feld war immer gesperrt,
  und im Bild sieht ein gesperrtes Feld aus wie ein ruhiges.

## Gestaltung: SONE ist der Maßstab, wörtlich

- **Der Befund:** SONE hat 156 Gestaltungsvariablen, SOTE hatte 80, und **nur
  fünf** hießen gleich. Die Werte stimmten weitgehend (Archivo, JetBrains Mono,
  15 px, Radien 2/4 px) — aber jedes Bauteil war mit einem eigenen Vokabular
  und harten Pixelzahlen neu gestaltet. Das sah in jedem Bereich ein bisschen
  anders aus und zusammen wie eine andere Anwendung. Gemeldet: *„Vor allem
  alles Optische hätte ich gerne identisch."*
- **Aliase zuerst, dann Fläche für Fläche.** SONEs Namen (`--sone-space-*`,
  `--sone-text-*`, `--sone-control*`, `--surface-*`, `--text-*`, `--border-*`,
  `--sone-shadow-*`) zeigen auf SOTEs Werte. Mit gleichen Namen lässt sich
  SONEs CSS **wörtlich** einsetzen — danach sind es dieselben Pixel, nicht
  ähnliche. Ein Alias bricht nichts; die alten Namen werden am Ende Aliase der
  neuen.
- **Fläche 1, das Menü in der Leiste:** SONEs `panel-menu-group`,
  `panel-menu-item`, `panel-menu-label`, `panel-menu-count`, `sidebar-label`
  kopiert (Zeilen 1027–1078 und 6101–6117 dort). Alle vier Panels gemessen: 32
  px, `0 8px`, 14,4 px (= 0,9 rem, SONEs Wert), Radius 2 px.
- **Fläche 2, die Baumzeile:** SONEs `tree-row`, `tree-twisty`, `tree-link`,
  `entry-more`, `sidebar-section-head/-toggle/-add`, `sidebar-empty` kopiert.
  Gemessen: Zeitansichten 32 px, Baumzeilen 34 px, **eine** Schriftgröße
  (14,4 px) in der ganzen Leiste. Zwei Funde dabei, beide SONEs ADRs:
  - **`⋮` hatte `opacity: 0`** und erschien erst beim Hover — ein Element, das
    erst beim Hover erscheint, existiert auf einem Telefon nicht (ADR-0016).
    SONE: 0.35, gedämpft statt verborgen.
  - **Das `+` steht im Abschnittskopf** neben „Projekte", nicht als Zeile unter
    der Liste — immer gezeichnet, aus demselben Grund.
  - Klappen dreht **ein** Zeichen statt zwei zu tauschen: zwei Zeichen springen.
- **Fläche 3, der Panel-Kopf:** SONEs `sidebar-head`, `panel-title`,
  `panel-scope`. Vorher war der Titel eine Spalte mit dem Scope *darin*; bei
  SONE ist er eine Zeile und der Scope steht darunter. Vier Köpfe gemessen:
  14,4 px / 600, Scope 12 px mit 0,08 em Sperrung.
- **Fläche 4, das Zeilenmenü:** SONEs `entry-menu` (Zeilen 4712–4843 dort)
  samt Aussehen-Klassen: 232 px, `surface-overlay`, `shadow-lg`, Zeichenraster
  auf 9 rem gedeckelt, runde Farbfelder in fünf Spalten, `destructive` unten.
  Eine **benannte Abweichung**: die Position bleibt `fixed` (`.at-point`), weil
  SOTEs Baum in einem scrollenden Kasten steht und ein Klappmenü dort immer
  abgeschnitten ist (Commit d71772f). Und „gewählt" ist `aria-current="true"`
  statt `.current` — dieselbe Regel, ein Selektor, der auch dem Vorleser etwas
  sagt.
  - **Ein spezifischerer Selektor gewann still:** `.menu.at-point` setzte 312 px
    und eigene Fläche, also blieb SONEs Regel auf `.menu` wirkungslos. Gefunden
    nur durch Messen — die Funktionsprüfung war grün.
- **Fläche 5, das Kontomenü:** SONEs `sidebar-footer`, `sidebar-account`,
  `sidebar-avatar`, `sidebar-account-menu` und die `.rail-account`-Anpassung
  für die Schiene — bei SONE ist es *ein* Bauteil an zwei Orten. 200 px, öffnet
  in der Schiene nach rechts, in der Fußleiste nach oben. Der Kopf mit Name und
  Adresse fiel weg: SONEs Menü hat keinen, und eine Zeile, die wiederholt, was
  der Knopf schon sagt, überliest man.
  - **Ein Wächter prüfte einen Namen statt die Regel** (`.footbar
    .account-menu`, `right: 4px`). Die Regel — in der Fußleiste von rechts
    verankert, darf schmaler werden — gilt weiter; er prüft sie jetzt am neuen
    Selektor mit logischen Eigenschaften.
- **Fläche 6, der Workspace-Wähler:** SONEs `switcher-*` (Knopf, Name, Pfeil,
  Menü an die Spalte gepinnt, Einträge 1,6 × `control-lg`, Fuß mit
  `workspace-create`). Der Pfeil ist SONEs Rechts-Chevron, um 90° gedreht — mit
  dem Zeichen ▾ zeigte dieselbe Drehung nach *links*.
- **Fläche 7, die Einstellungen:** SONEs `settings-card`, `settings-row`,
  `settings-row-label` (fett, Hinweis darunter), `settings-note`,
  `settings-heading`, `settings-actions`, `settings-nav-*` — in zwölf Dateien
  die Klassen umgestellt. Gemessen: Karte 16 px Polster / 4 px Radius, Zeile 8
  px, Beschriftung 550, Navigation 34 px / 14,4 px.
  - **7b, erledigt:** 15 Hinweise sind in die Beschriftung gewandert (SONEs
    `<b>Wort</b><span>Hinweis</span>`); Zustandsmeldungen in Bedingungen blieben
    in der Spalte — der Verschieber hatte eine herausgerissen. Zwei Funde:
    **die Bedienspalte darf nicht unter ihren Inhalt** (SOTEs Hinweise sind zwei
    Sätze, SONEs einer; bei langer Grundbreite der Beschriftung wurde die Spalte
    von 154 auf 102 px gedrückt), und **unter 620 px stapelt die Zeile**, SONEs
    Regel wörtlich.
  - **Spezifität, zum zweiten Mal:** SONEs `.settings-row > :not(.settings-row-label)`
    richtet die Bedienspalte rechts aus und schlägt eine einzelne Klasse. Drei
    Zeilen Hinweistext standen rechtsbündig unter einem Knopf.
- **Vier gemeldete Fehler, eine Sitzung:**
  - **Der Akzent galt für alle Bereiche.** `api.settings()` und
    `api.patchSettings()` schickten keinen `?workspace=`; der Server nahm den
    ersten. „Arbeitsbereich" hieß in Wahrheit immer derselbe — und das konnte
    niemandem auffallen, solange es einen gab. Jede andere Route bekam ihn.
  - **Der Wähler sprang nach Heute.** Jetzt bleibt der Ort, wenn er im nächsten
    Bereich existiert; nur ein Projekt existiert dort nicht.
  - **Die Schiene ist SONEs** (`icon-rail`: 44 px Kacheln, Zeichen 1,2 em, hell
    auf `surface-chrome`, Akzentstrich über das mittlere Halbe). SOTEs
    Flächen-Behandlung bleibt, und die Flächenblöcke setzen jetzt **auch SONEs
    Namen** (`--text-primary`, `--surface-hover`, `--border-*`) — sonst liest
    eine übernommene Regel auf einer umgekehrten Fläche die Farben der Seite.
    Genau so kam „der Hover im Profil ist schwarz" zustande.
  - **Name und Adresse im Kontomenü bleiben** — Markus findet sie praktisch,
    und sie sind ein Vorschlag für SONE. In SONEs Maßen gezeichnet.
- **Fläche 8, Knöpfe und Felder:** SONEs Grundstil wörtlich (Zeilen 723–860
  dort). *Three weights of button, and no more* — Rahmen, `primary`, `quiet`,
  dazu `destructive`; `.btn` statt `button.btn`, weil SOTE drei Elemente als
  Knopf zeichnet (`button`, `a`, `label`). Felder sind eine Fläche
  (`surface-sunken`, 44 px); SOTEs vier Felder mit eigener Gestalt
  (Schnellerfassung, Baumsuche, Umbenennen, Zeichensuche) sind ausgenommen,
  weil sie in SONE Gegenstücke mit eigenen Regeln haben. `select.target` und
  `.settings-row-value select` hielten noch 32/34 px — eigene Regeln, die die
  globale schlugen; jetzt leer. `primary` heißt „Hauptsache", nicht „breit":
  volle Breite nur in Anmelde- und Einrichtungskarte.
- **Der Wächter `check-styles`**, zwei Fragen aus dieser Angleichung:
  - **Jede Klasse im Markup hat eine Regel.** Die nackten Panels und die vier
    gelöschten Tabellenregeln waren dieselbe Frage. Beim ersten Lauf fand er
    acht — vier davon (`ws-table`, `ws-here`, `ws-dot`, `ws-preview`) hatte
    **ich** bei Fläche 6 mit gelöscht: mein Regex für die `.ws-*`-Regeln des
    Wählers traf alles mit diesem Anfang. Vier Bildschirme ohne
    Tabellengestalt, und niemand hat es gesehen.
  - **Harte Pixel wachsen nicht** — eine Sperrklinke auf `font-size`, `padding`,
    `gap`, `margin`, `min-height` in px. Die Grenze zieht nur nach unten nach,
    von Hand. Er griff sofort: an den Regeln, die ich gerade zurückgeholt hatte
    — also nicht zurückkopiert, sondern auf die Skala gesetzt.
  - Und beim Zurückholen hatte ich `ws-preview` einen Rahmen **erfunden**; die
    alte Regel war eine Zeile mit Lücke. Nachgesehen in 489e3f3, nicht aus dem
    Gedächtnis.
- **Drei falsche Sätze im Bild gefunden**, alle „gibt es noch nicht" über
  Dinge, die es längst gibt: Einladungen (People), Rollen setzen
  (WorkspaceMark), weitere Arbeitsbereiche (Overview). Ein Satz, der einen
  Zustand beschreibt, veraltet leiser als Code — der Code fällt beim Bauen um,
  der Satz nicht.
- **Fläche 9, die Verwaltungslisten:** SONEs `admin-table`-Gestalt (Rahmen,
  `surface-chrome`, Radius, 8 px Zeilen, Linie dazwischen, `admin-name` 500,
  `admin-meta` mono-xs, **keine Kopfzeile**) auf sechs Bildschirmen. **Eine
  benannte Abweichung:** SOTE zeichnet die Liste als `<table>`, SONE als
  Flex-Zeilen; sechs Bildschirme umzubauen ist eine eigene Runde, und was hier
  gleich ist, sind die Pixel. Die Kopfzeilen fielen weg: eine Beschriftung über
  zwei Spalten, die man am Inhalt erkennt, ist eine Beschriftung für nichts.
- **Fläche 10, Formularfelder und die Anmeldekarte:** SONEs `.field`
  (Beschriftung ist ein **Wort in Textschrift**, Text-sm/550 — SOTEs war eine
  Mono-Beschriftung in 10,5 px, wie eine Ortsangabe) und SONEs `.centered` /
  `.card`: 24 rem, gestapelt, **ohne Rahmen und ohne Schatten**. Die Ruhe kommt
  vom leeren Raum darum, nicht von einer Umrandung. Die Überschrift trägt
  dieselbe Schrift wie ein Abschnittstitel — zwei Größen für dieselbe Ebene sind
  zwei Handschriften.
  - **Im Bild gefunden:** `.field + .field` setzt den Abstand nur *zwischen*
    Feldern, also klebte der Anmelden-Knopf am Kennwortfeld. Jetzt auch nach dem
    letzten.
  - SONEs `.dialog*` gibt es hier nicht: SOTE hat keine schwebenden Dialoge —
    Anmelden, Einrichtung, Einladung annehmen und der Gast-Bildschirm sind
    ganze Bildschirme. Der Block kommt, wenn der erste Dialog kommt.
- **Fläche 11, der Gast-Bildschirm und EINE Überschriftgröße.** Es gab drei
  Zahlen für dieselbe Ebene — 27 px im Hauptkopf, 26 px in Einstellungen und
  beim Gast, 1,6 rem in der Anmeldekarte —, dazu zwei Sperrungen (−0,02 und
  −0,01 em). Alle meinen den Titel dessen, was man offen hat; **drei Zahlen
  dafür sind drei Handschriften.** Jetzt überall SONEs 1,6 rem / 300 / −0,02 em,
  gemessen identisch in Hauptkopf und Gast-Bildschirm. Der Gast hat kein
  Gegenstück in SONE, also nicht kopiert, sondern auf die Skala gesetzt.
- **Fläche 12, die Abschnittsnavigation trägt nur den Namen.** SONEs
  `SectionNav` zeigt keinen Hinweis in der Zeile, und der Grund steht dort:
  *„A line of explanation under each entry made every one three lines tall, and
  a navigation that has to be read is a page about the navigation."* SOTE zeigte
  ihn daneben, und bei 272 px Spalte brachen zwei Zeilen um (42 px statt 34,
  gemessen). Der Hinweis bleibt als `title` und in der Vorleseansage — er ist
  nicht falsch, er gehört nur nicht in die Zeile. 17 Zeilen über drei Bereiche
  jetzt einzeilig.
- **Fläche 13, die Filter der Suche sind Pillen.** Gemeldet: *„Da steht nach
  wie vor einfach Text untereinander. Status hat ja nur 2 Möglichkeiten, kann
  man da nicht nebeneinander 2 schöne Buttons setzen … damit man nicht erst
  alles lesen muss."* **Der Fehler war die Wahl des Bauteils:**
  `panel-menu-item` ist eine Zeile für einen ORT, an den man geht — ein Filter
  ist keiner, er ist ein Schalter. SONEs `search-facet-tag` (Pillen mit
  `aria-pressed`, in einer Reihe unter der Beschriftung) ist die Antwort, und
  sie stand die ganze Zeit da. Gemessen: Status 2 in einer Zeile, Frist 3,
  Priorität 4 auf zwei, Projekt 2.
  - **„Filter zurücknehmen" bleibt eine Zeile:** ein Bedienelement in der
    Gestalt seiner Nachbarn, das etwas anderes tut, ist die Sorte Fehler, die
    man erst beim Klicken merkt.
  - Der Wächter meldete SONEs eigene `gap: 5px` — eine Zahl neben der Skala.
    Space-2 (4 px) ist die Stelle in der Reihe.
- **Zwei Fehler beim Wechsel des Arbeitsbereichs:**
  - **Der Ladeeffekt hatte `[]`** — geladen wurde einmal, nie beim Wechsel. Und
    der Schaden war größer als eine falsche Anzeige: `save` baut die neue Ebene
    aus `data.levels` auf, also aus dem Stand des **Vorgängers**. Wer dann
    irgendetwas anderes einstellte, schrieb dessen Akzentfarbe in diesen
    Bereich. **Ein stehengebliebener Stand, aus dem geschrieben wird, ist kein
    Anzeigefehler, sondern Datenverlust.** `data` wird beim Wechsel
    zurückgesetzt, sonst zeigt die Maske kurz die alten Werte — und ein Klick in
    diesem Augenblick schreibt sie fest.
  - **Nach dem Neuladen war man wieder im ersten Bereich.** SONEs
    `LAST_WORKSPACE_KEY` in `localStorage`, samt der Reihenfolge (mitgegeben →
    gemerkt → erster) und der Prüfung auf Mitgliedschaft; beim Abmelden
    weggeräumt, wie in SONE.
- **Die Seite ist WEISS, die Leisten sind Papier.** Gemeldet: *„Der eigentliche
  Content-Bereich ist bei SONE eigentlich weiß und hebt sich von den Leisten
  ab."* SOTE hatte überall `#faf8f4` — also keine Grenze zwischen dem, was man
  liest, und dem, was die Anwendung sagt. SONEs Begründung: *„The writing
  surface. White in light, the darkest surface in dark — either way the thing
  you are reading, with the furniture a step away from it."* Der Kontrast-Test
  prüft die Palette gegen `page` und ist auf Weiß strenger — und grün.
- **Zwei Fehler aus meinen eigenen Regeln:**
  - **Der Zeichenwähler war einspaltig.** Nicht das Raster war schuld, sondern
    `align-items: flex-end` aus Fläche 7b: das presst jedes Kind auf seine
    Mindestbreite, und ein `repeat(auto-fill, …)` ist dann eine Spalte. Zeilen
    mit einem Raster stapeln jetzt (wie bei SONE steht „SYMBOL" *über* dem
    Raster): 187 px → 654 px, 6 → 21 Zeichen je Zeile.
  - **`setEigen((v) => … e.currentTarget.value …)`** — die Aktualisierungs­funktion
    läuft *später*, und dann ist `currentTarget` `null`. Den Wert zuerst lesen.
    Sichtbar nur, weil das Prüfskript auf `pageerror` hört; die Farbe wurde
    trotzdem gesetzt, also hätte man es im Bild nicht gemerkt.
- **Eine eigene Farbe für Symbol und Name.** Der Kern konnte es die ganze Zeit
  (`ChosenColor = PaletteName | '#…'`, `colorValue` gibt Hex durch) — nur die
  Oberfläche bot es nicht an. **Eine Möglichkeit, die im Kern steht und nirgends
  anklickbar ist, gibt es für niemanden.**
- **Fläche 15, Schrift und Form haben eine eigene Karte.** SONEs Trennung, und
  dort mit derselben Meldung begründet: *„Schrift Design kann gerne alleine
  stehen, aber die Oberfläche, Tönung, Akzent-Farbe gehört da nicht hin"* —
  *„the surfaces and the type scale have nothing to do with each other."* Die
  Ecken gehen mit der Schrift: beide sind die **Form** der Oberfläche, nicht
  ihre Färbung. Und die Auswahlknöpfe tragen jetzt SONEs Maß (34 px, Text-sm)
  statt eigener 32/13 px.
  - **Zwei Regeln für einen Zustand sind eine zu viel:** der gewählte Knopf
    hatte eine zweite Regel mit voller Akzentfläche und `--accent-on`. Nach der
    Angleichung gewann teils die eine, teils die andere — im Bild stand heller
    Text auf heller Fläche, unlesbar.
- **Fläche 14, die Verwaltungslisten sind Zeilen.** SONEs `admin-list` /
  `admin-row` / `-main` / `-actions` in sechs Bildschirmen, sieben Listen.
  **Eine Tabelle behauptet, ihre Spalten seien vergleichbar** — ein Name, ein
  Häkchen, eine Zahl und ein Knopf sind es nicht. Die Spaltenwörter wandern ins
  Beiwerk: „Mitarbeiten · noch nie benutzt · ohne Ablauf" ist eine Zeile statt
  dreier Überschriften für drei Wörter.
  - **Zweimal derselbe Fehler in einer Runde:** ein JSX-Kommentar direkt nach
    `? (` — dort steht ein Ausdruck, und `{/* … */}` ist ein Kind. Beim zweiten
    Mal hätte ich es wissen müssen.
  - **Und zweimal derselbe veraltete Satz:** „eine Einladung per Mail gibt es
    noch nicht" stand in People *und* in Accounts. Beim ersten Fund habe ich nur
    die eine Stelle berichtigt, statt nach der Formulierung zu suchen.
- **Noch offen (alt):**
  Einstellungen (`settings-card`, `settings-row`, `section-nav`), Knöpfe und
  Felder, Dialoge — und zuletzt ein Wächter gegen harte Pixelwerte, wo eine
  Skala existiert.
- **Der Token-Wächter liest nur den ersten `:root`.** Meine Aliase standen in
  einem zweiten und galten als „nur im Dunkeln deklariert". Sie gehören in den
  ersten — nicht der Wächter zu mir.

- **`pnpm check` ist genau das, was die CI fährt.** Erst standen die Prüfungen
  einzeln in der Workflow-Datei, und `pnpm -r typecheck` scheiterte dort — in
  einem frischen Klon gibt es kein `dist`, und `@sote/core` zeigt mit `types`
  und `main` darauf. Lokal fiel es nicht auf, weil `dist` vom letzten Bau dalag.
  **Die Bauordnung gehört ins Skript und nicht in die CI-Datei**, sonst gibt es
  zwei Listen von Prüfungen, und man merkt es an der Stelle, an der sie gleich
  sein sollten.
- **Eine gelaufene Migration wird nicht bearbeitet.** Der Läufer merkt sich den
  sha256 und wirft, wenn eine Datei sich seit dem Lauf geändert hat.
- **Migrationen laufen einer nach dem anderen, über einen Advisory Lock.**
  Gefunden in der CI: `pnpm -r test` fährt die Testdateien parallel, jede ruft
  `migrate` auf, und mehrere führten 0001 gleichzeitig aus — Postgres antwortet
  mit `duplicate key value violates unique constraint
  "pg_type_typname_nsp_index"`, weil `CREATE TYPE` und `CREATE EXTENSION IF NOT
  EXISTS` gegen Nebenläufigkeit nicht sicher sind: `IF NOT EXISTS` prüft vorher
  und schreibt danach. **Und es ist kein Testproblem — zwei Container, die
  gleichzeitig starten, migrieren gleichzeitig.** Der Lock gehört darum in den
  Läufer und nicht in ein Testskript.
- **Eine erledigungsbezogene Wiederholung liegt vor ihrem ersten Abhaken unter
  „Irgendwann".** Damit ist der offene Punkt von vorhin beantwortet: sie ist
  nicht unsichtbar, sondern ungeplant — sonst könnte niemand sie abhaken, und
  ohne Abhaken entsteht kein Termin. Als Test festgehalten.
- **Eine Stelle entscheidet, was eine Ansicht bedeutet** (`views.ts`), und die
  Zähler im Panel lesen dieselben Bedingungen wie die Listen, in **einer**
  Abfrage. Drei Runden für drei Zahlen sind drei Zeitpunkte, und dann zeigt das
  Panel eine Summe, die es nie gegeben hat.
- **Nur „Heute" trennt überfällig ab.** In „Demnächst" wäre der Abschnitt leer,
  in einem Projekt beantwortet er eine Frage, die dort nicht gestellt wird.
- **Ein Projekt zeigt auch Erledigtes, aber unten.** „Was habe ich hier
  geschafft" ist eine Frage für diesen Bildschirm und nicht für „Heute".
- **`PATCH` ändert genau die genannten Felder.** Ein fehlender Schlüssel heißt
  „nicht angefasst", `null` heißt „leeren". Geprüft wird die Anwesenheit des
  Schlüssels und nicht die Wahrheit des Werts — sonst nimmt ein Menü beim Setzen
  eines Datums die Priorität mit.
### Die Suche (Abschnitt 5s Modus, jetzt gebaut)

- **Die Abfrage ist ein String, und dieser String ist die Wahrheit.** Drei
  Schreiber — das Feld über dem Baum, das Feld im Bildschirm, jeder Chip —, und
  alle lesen ihn aus der URL. Kein Bedienelement setzt `projekt:` selbst
  zusammen; das tut `buildTaskQuery` in `core`, neben dem Parser (SONEs Lösung
  aus `claude/suche-als-ort.md`).
- **Tippen ersetzt, Abschicken schiebt** (`replaceState` gegen `pushState`): ein
  Tastendruck ist kein Ort, zu dem man zurückgeht.
- **Das Feld über dem Baum ist der Eingang.** Es war ein Knopf, der einen
  Bildschirm öffnet, dessen erstes Bedienelement ein Feld ist — eine Tür vor
  einer Tür. Das Symbol in der Schiene ist der Weg **zurück** zu einer Suche.
- **Der leere Bildschirm zeigt das Vokabular**, anklickbar. Eine Suche, die
  belohnt, wer die Dokumentation gelesen hat, gehört nicht in eine Anwendung,
  deren übrige Bildschirme das nicht tun.
- **Präfix ODER gestemmt, je Wort.** Nachgemessen: `:*` schaltet die Stemmung
  ab — `to_tsquery('german','dosen:*')` ergibt `'dosen':*` und trifft den
  gestemmten Vektor `'dos'` nicht. Präfix braucht man beim Tippen, Stemmung bei
  einer fertigen Abfrage; keins von beiden allein genügt. Also wird jedes Wort
  zu `(wort:* | wort)`.
- **Zwei Wörter verengen, zwei Schlagwörter auch.** Wer eine Auswahl will, sucht
  zweimal.
- **Offen ist die Vorgabe.** Wer sucht, sucht meistens etwas zu tun.
  Weggeworfenes wird nie gefunden, auch nicht mit `status:alles`.
- **Ein Doppelpunkt, der keine bekannte Facette ist, bleibt Text.** Eine
  Abfrage, die bei „12:30" nichts findet, wäre schlechter als eine, die danach
  sucht. Aber **das Zeichen wird vor dem Doppelpunkt geprüft**: `+guest:lars`
  ist eine Zuweisung an einen Gast und keine Facette namens `+guest`. Die erste
  Fassung prüfte umgekehrt, und die Suche nach einem Gast fand nichts.
- **„Mehr als das Limit" wird als solches gemeldet**, nicht als ungefähre Zahl.
- **Offen:** die Textsuche-Konfiguration ist fest `german`. Eine englische
  Aufgabe wird nach deutschen Regeln gestemmt, und Komposita werden nicht
  zerlegt — „dosen" findet „Dose", aber nicht „Netzwerkdosen". Eine
  Konfiguration pro Arbeitsbereich wäre richtiger und würde den Index
  vervielfachen.

- **Ein Projektname ist in seinem Geschwisterkreis eindeutig** (Migration
  0004, partieller Unique-Index über `(workspace_id, parent_id, lower(name))`
  mit `NULLS NOT DISTINCT`, nur für lebende Projekte). Grund ist `#name` in der
  Schnellerfassung: zwei Projekte gleichen Namens an derselben Stelle würden
  sie zum Raten zwingen.
- **Aber derselbe Name unter verschiedenen Eltern ist erlaubt** — „Kabel" unter
  „Haus" und unter „Büro" sind zwei verschiedene Dinge. Dass `#kabel` dann
  mehrdeutig ist, **meldet die Erfassung** (`ambiguousProject`); der Index kann
  es nicht entscheiden, weil beide Namen berechtigt sind. Vier verschiedene
  Nachrichten also: unbekanntes Projekt, mehrdeutiges Projekt, unbekannte
  Person, mehrdeutige Person — und keine davon heißt „ging nicht".
- **Ein Projekt kann nicht sein eigener Nachfahre werden.** Geprüft mit einer
  rekursiven Abfrage vor dem Umhängen. Ohne diese Prüfung wären das Projekt
  und alles darunter aus dem Baum verschwunden, aber noch in der Datenbank —
  und keine Abfrage über den Baum würde je enden.
- **Umhängen gibt einen neuen Sortierschlüssel**: neuer Geschwisterkreis, neuer
  Schlüsselraum, und der alte Schlüssel könnte dort belegt sein.
- **Projektfarben sind eine Liste, kein Farbwähler.** Freie Werte erzeugen
  Projekte, die sich vom Akzent nicht unterscheiden lassen, und niemand sieht
  beim Wählen, dass das passiert ist. Serverseitig auf `#rrggbb` geprüft, damit
  kein beliebiger String ins Stylesheet gelangt.
- **Die Projektliste kommt in Baumreihenfolge und trägt ihre Tiefe.** Die erste
  Fassung sortierte global nach Sortierschlüssel, also standen Unterprojekte
  vor ihren Eltern; die Oberfläche lag trotzdem richtig, weil ein globaler Sort
  die Reihenfolge innerhalb jedes Geschwisterkreises erhält. Eine Liste, deren
  Reihenfolge nur zufällig brauchbar ist, lädt den nächsten Aufrufer zum Fehler
  ein.
- **Umbenennen passiert in der Zeile**, nicht in einem Dialog: ein Dialog wäre
  ein zweiter Ort für denselben Namen, und man müsste ihn schließen, um zu
  sehen, was man getippt hat.
- **Eine Teilaufgabe erbt Projekt und Arbeitsbereich vom Elternteil**, nicht
  aus der Anfrage: eine Teilaufgabe in einem anderen Projekt als ihre Aufgabe
  wäre in zwei Listen zu Hause, und „wo gehört das hin" hätte zwei Antworten.
- **Eine Ebene tief.** Eine Teilaufgabe bekommt keine Teilaufgaben. Beliebig
  tiefe Bäume in einer Liste sind der Anfang von Projektmanagement, und die
  Oberfläche könnte sie nicht ruhig zeigen.
- **Die Projektansicht zeigt nur die obersten Zeilen**, die Teilaufgaben stehen
  in der Detailspalte. Beides zu zeigen hieße, dieselbe Sache zweimal in einer
  Liste zu haben, mit zwei Kästchen, die dasselbe meinen. In den
  Zeit-Ansichten ist es umgekehrt: dort steht eine Teilaufgabe, **weil** sie
  ein eigenes Datum hat — und genau das ist der Grund für echte Teilaufgaben
  statt Checklistenpunkte.
- **`+vorname` genügt.** Gesucht wird über vier Schreibweisen (voller Name,
  Adresse, erster Vorname, Teil vor dem @), weil niemand `+Markus Thiel` tippt:
  ein Leerzeichen beendet das Zeichen. **Passen mehrere, wird nicht geraten** —
  die Aufgabe bleibt ohne Zuständigen, und die Antwort trägt
  `ambiguousAssignees`. Das ist eine andere Nachricht als „gibt es hier nicht",
  und eine von zwei Personen still auszuwählen wäre schlimmer als keine: die
  Aufgabe hätte einen Zuständigen, der nichts davon weiß.
- **Titel und Notiz schreiben beim Verlassen des Feldes**, nicht bei jedem
  Tastendruck. Ein Feld, das pro Zeichen eine Runde dreht, hakt bei schlechter
  Verbindung — und die Notiz ist der eine Ort, an dem jemand länger tippt.
- **Ein Projekt im Papierkorb nimmt seine Aufgaben aus allen Ansichten mit**,
  und sie tragen dafür **kein eigenes `trashed_at`**: dass ihr Projekt im
  Papierkorb liegt, genügt. Damit gibt es keinen Zustand, in dem die Aufgaben
  zurück sind und das Projekt nicht — und im Papierkorb steht ein Eintrag, der
  sagt, wie viele mitkommen. Ohne diese Bedingung blieben die Aufgaben in Heute
  stehen, während das Projekt aus dem Panel verschwunden ist, und niemand fände
  den Ort, an dem man sie loswird.
- **Eine einzeln weggeworfene Aufgabe braucht ein Ziel, wenn ihr Projekt
  inzwischen selbst im Papierkorb liegt** (`needs_target`, 409). Sonst wäre sie
  zurückgeholt und trotzdem unsichtbar, und das ist der eine Ausgang, den ein
  Zurück-Knopf nicht haben darf. Der Eintrag sagt es vorher, statt die
  Ablehnung erst beim Klicken zu zeigen.
- **Zurückgeholt wird ans Ende der Zielliste**, nicht an die alte Stelle: die
  Lücke ist längst zu, und ein alter Schlüssel kollidiert mit dem Index.
- **Endgültig löschen geht nur aus dem Papierkorb.** Kein Weg führt an ihm
  vorbei.
- **`keyAtEnd` zählt weggeworfene Zeilen mit.** Gefunden von den
  Papierkorb-Tests: die erste Fassung filterte `trashed_at IS NULL`, der
  Unique-Index aus 0003 kennt aber keinen Papierkorb — ein Projekt, aus dem
  einmal etwas weggeworfen wurde, nahm keine neue Aufgabe mehr an. **Die Lehre
  ist allgemeiner als der Fall: eine Abfrage, die einen Schlüssel für einen
  Index rechnet, muss denselben Umfang haben wie der Index.**
- **Eine Ansicht steht in der URL** (`/`, `/demnaechst`, `/irgendwann`,
  `/p/<id>`). Eine Ansicht ist ein Ort, also verlinkbar und mit dem
  Zurück-Knopf erreichbar; eine Kopie im Komponentenzustand wäre eine zweite
  Antwort auf „wo bin ich" (SONE, `claude/suche-als-ort.md`). Ein unbekannter
  Pfad ist Heute und kein Fehlerbildschirm — wer einen alten Link öffnet, will
  nicht wissen, dass er alt ist. Eine Projekt-Id, die keine uuid ist, wird gar
  nicht an den Server gegeben.
- **Ein Bildschirm für alle vier Ansichten.** Was sich unterscheidet, sind
  Überschrift, Abschnitte und ob man ziehen darf.
- **Gezogen wird nur, wo die Reihenfolge etwas bedeutet** — in einem Projekt.
  In „Heute" ist nach Priorität und Zeit sortiert; eine Zeile dort zu ziehen
  würde einen Schlüssel setzen, den niemand sieht.
- **Ziehen hat eine Tastaturfassung** (Alt und Pfeiltaste). Eine Reihenfolge,
  die man nur mit der Maus ändern kann, ist eine, die manche nicht ändern
  können. Und die Nachbarrechnung liegt in einer reinen Funktion
  (`reorder.ts`), weil ein Fehler darin unsichtbar bleibt — die Reihe hat
  hinterher ja *irgendeine* Reihenfolge. Ein Test prüft für jede Kombination
  von Ausgangs- und Zielstelle, dass die gezeigte Vorschau und die gemeldeten
  Nachbarn dieselbe Reihenfolge ergeben.
- **Nach einem fehlgeschlagenen Verschieben wird neu geladen**, nicht
  zurückgerechnet. Eine selbst gerechnete Rücknahme wäre eine zweite Antwort
  auf „wie stehen die Zeilen".
- **Ein widersprüchlicher Auftrag ist 409 mit Grund, kein 500.** Vertauschte
  Nachbarn, leerer Titel, fünfte Priorität: der Aufrufer hat etwas
  Widersprüchliches geschickt, nicht der Server etwas falsch gemacht.

---

## 10c. Was SOTE aus SONEs Umgebung **nicht** braucht

Festgehalten, weil die Frage sonst wiederkommt — und weil jede dieser Zeilen
eine Entscheidung ist und nicht eine Lücke:

- **Kein `SECRET_KEY`.** Sitzungen und Freigabelinks tragen einen Zufallswert,
  die Datenbank hält nur seinen sha256. Ohne Signatur braucht es keinen
  Schlüssel — und keinen, dessen Verlust alle Sitzungen entwertet. Sollte
  irgendwann etwas signiert werden müssen, ist das eine bewusste Änderung und
  keine nachgeholte Selbstverständlichkeit.
- **Kein Speicher-Backend, keine Uploadgrenze.** SOTE hat keine Dateien.
- **`PUBLIC_URL` noch nicht.** Gebraucht wird sie, sobald etwas eine absolute
  URL erzeugt: Erinnerungsmail, Freigabelink, der Rückverweis für SONE. Solange
  nichts davon existiert, würde sie nur dastehen.
- **Der Host-Port richtet sich an der Anlage aus, nicht an der Beispieldatei.**
  Vorgabe 32901, im Nachbarfeld von SONEs 32900. Die erste Fassung nahm 3001
  „weil SONE 3000 nimmt" — das ist der Wert im Repo und nicht der, auf dem SONE
  läuft.

---

## 10d. Ordner statt Projekte — die Grundform, neu geschnitten

**Status: gebaut** (Migration 0009). Aufgeschrieben vor dem Bau, weil bei
einer Änderung an der Grundform eine halbe Stunde Nachdenken billiger ist als
die Migration danach.

### Der Anlass

Gemeldet, beim Durchsehen von SONEs Seitenleiste: *„andererseits frage ich mich,
wieso wir nicht auch mit Ordnern arbeiten anstatt Projekte. Dann könnte man das
ganze komplett übernehmen. Seiten wären dann die eigentlichen Projekte bzw.
Aufgabenlisten."*

### Was heute falsch ist, unabhängig von SONE

**Ein Projekt ist zwei Dinge gleichzeitig:** ein Behälter (es hat
Unterprojekte) und eine Liste (es hält Aufgaben). Die Vermischung kostet an
mehreren Stellen, und jede davon steht schon im Code:

- Das Zeilenmenü bietet „Unterprojekt anlegen" **und** die Zeile ist ein Ziel
  für Aufgaben — zwei Bedeutungen an einem Gegenstand.
- Die Projektansicht muss `parent_id IS NULL` filtern, damit Teilaufgaben nicht
  doppelt erscheinen.
- `#name` in der Schnellerfassung meint ein Projekt, das auch ein reiner
  Behälter sein kann. Eine Aufgabe in einem Behälter ist ein Zustand, den
  niemand gemeint hat.

**Todoist macht es so, Things nicht.** Dort sind Bereiche Behälter und Projekte
Listen. Der Maßstab dieses Produkts ist „Todoist bei der Erfassung, Things beim
Gefühl" — und beim Gefühl gewinnt die Trennung.

SONE hat dieselbe Trennung, und der Kommentar an `pages.kind` sagt sie in fünf
Wörtern: *„Folders organise, pages hold writing."*

### Die neue Form

Drei Ebenen, und jede tut genau eine Sache:

| | tut | verschachtelt | hält |
|---|---|---|---|
| **Ordner** | ordnen | ja, beliebig tief | Ordner und Listen |
| **Liste** | halten | nein | Aufgaben |
| **Aufgabe** | die Sache | eine Ebene (Teilaufgabe) | — |

**Eine Tabelle, wie in SONE.** `projects` bekommt eine Spalte `kind IN
('folder', 'list')` statt einer zweiten Tabelle. Ein Baum, ein
Sortierschlüsselraum, ein Papierkorb — und der bestehende Baumcode bleibt
weitgehend, wie er ist. Zwei Tabellen wären zwei Sortierungen, die man beim
Verschieben zwischen ihnen aufeinander abbilden müsste.

**Eine Liste verschachtelt nicht.** Das ist die ganze Entscheidung. Wer eine
Liste in eine Liste stecken will, will einen Ordner.

### Was daraus folgt, und was ich entschieden hätte

1. **`#name` meint eine Liste.** Ein Ordner ist kein Ziel für Aufgaben. Die
   vier Meldungen der Schnellerfassung bekommen eine fünfte: „das ist ein
   Ordner, keine Liste" — unbekannt und mehrdeutig reichen dann nicht mehr, weil
   *gefunden, aber falsche Art* ein eigener Fall ist.

2. **Aufgaben dürfen ohne Liste sein.** Das ist der Posteingang, und den gibt es
   in der Schiene schon. Der Alternative — jede Aufgabe braucht eine Liste — steht
   entgegen, dass die Schnellerfassung ihren Wert daraus zieht, dass man nichts
   entscheiden muss, um etwas festzuhalten.

3. **Die Zeit-Ansichten bleiben, wie sie sind.** Heute, Demnächst und Irgendwann
   schneiden quer durch alles und zeigen zu jeder Aufgabe ihre Liste. Sie kennen
   Ordner nicht — ein Ordner hat keine Aufgaben.

4. **Name eindeutig im Geschwisterkreis, über beide Arten hinweg.** Ein Ordner
   „Haus" und eine Liste „Haus" nebeneinander sind zwei Zeilen mit demselben
   Namen an derselben Stelle. Der bestehende Unique-Index (Migration 0004)
   deckt das schon ab, sobald beide in derselben Tabelle stehen.

5. **Der Papierkorb muss zwei Ebenen tief greifen.** Heute prüft `ALIVE`, ob das
   Projekt der Aufgabe im Korb liegt. Künftig kann der **Ordner über der Liste**
   im Korb liegen. Das ist die technisch heikelste Stelle der Umstellung, und
   sie ist keine Zeile: `NOT EXISTS (Projekt im Korb)` wird zu einer Prüfung
   entlang des Pfades.

6. **Zeichen und Farbe haben beide Arten**, in derselben Form (`{icon,
   iconColor}`). Ein Ordner ohne Zeichen ist ein Ordnersymbol, eine Liste ohne
   Zeichen ein Listensymbol — die Vorgabe unterscheidet die Arten, ohne dass
   jemand etwas wählen muss. Das ist SONEs Regel für Ordner und Seiten.

### Die Migration, und warum sie eine Entscheidung enthält

Jedes bestehende Projekt wird zu genau einem von beiden. Drei Fälle sind
eindeutig, einer nicht:

Alle vier Fälle haben **dieselbe Form**: aus einem Projekt wird ein **Ordner**
mit dem Namen, und wo Aufgaben hingen, entsteht darunter ein gleichnamiges
**Projekt**, in das sie umziehen.

- **Nur Aufgaben** → Ordner + Projekt darin.
- **Aufgaben und Kinder** → Ordner + Projekt darin; die Kinder bleiben Kinder
  des Ordners.
- **Nur Kinder** → Ordner.
- **Leer** → Ordner.

**Der letzte Fall stand hier zuerst anders** („leer → Liste, ein leeres Blatt
ist häufiger eine gerade angelegte Liste"), und das war falsch, sobald Punkt 3
entschieden war: ein leeres Projekt ganz oben *kann* keine Liste sein, es
bräuchte einen Ordner über sich. Und für ein leeres Blatt gibt es ohnehin kein
Zeugnis, wofür es gedacht war. Ein Ordner kann später ein Projekt bekommen; ein
Projekt kann später keine Kinder bekommen. Die Umwandlung, die offen bleibt,
ist die richtige.

Der letzte Fall ist der, der eine Entscheidung enthält, und ich schreibe die
Alternative dazu: man könnte die Aufgaben auch in den Posteingang schieben. Das
wäre datenerhaltend und trotzdem falsch — sie hatten einen Ort, und der Ort war
gemeint. Eine Liste gleichen Namens ist die Übersetzung, die am wenigsten
behauptet.

### Was ich dabei nicht verspreche

- **Verschieben zwischen den Arten** (eine Liste zu einem Ordner machen) ist
  nicht vorgesehen. Wer das will, legt einen Ordner an und zieht die Liste
  hinein. Eine Umwandlung, die Aufgaben mitnimmt, hätte dieselbe Frage wie der
  vierte Migrationsfall — nur ohne die Ruhe, sie einmal zu beantworten.
- **Rollen und Rechte je Ordner** kommen nicht mit. Heute gilt alles pro
  Arbeitsbereich, und das bleibt so, bis es einen Grund gibt.

### Entschieden

1. **Ein Projekt mit Aufgaben und Kindern wird aufgeteilt** (nicht: Aufgaben in
   den Posteingang).
2. **Die Liste heißt weiter „Projekt", der Behälter heißt „Ordner".** Damit
   ändert sich für niemanden ein Wort, und die neue Ebene heißt, wie sie in
   SONE heißt.
3. **Ein Projekt liegt immer in einem Ordner.** Wörtlich: *„Bei SONE haben wir
   Seiten nur in Ordnern. Ohne Ordner geht nichts. Aber darunter kann beides
   liegen, untergeordnet und Aufgaben."* Also: ganz oben nur Ordner; unter einem
   Ordner beides — weitere Ordner **und** Projekte.

### Was Punkt 3 für die Migration bedeutet

Der Fall, der dadurch erst entsteht: ein heutiges Projekt **ganz oben, nur mit
Aufgaben**. Es wird ein Projekt, und ein Projekt braucht einen Ordner über sich.
Also entsteht einer — mit demselben Namen, demselben Zeichen und demselben
Platz, und das Projekt darin heißt ebenso.

Das liest sich einen Moment lang doppelt („Haus ▸ Haus"), und die Alternative
ist schlechter: ein Sammelordner „Projekte", in den alles wandert, erfindet eine
Ordnung, die niemand gewählt hat. Ein Ordner, der genau eine Sache enthält und
so heißt wie sie, behauptet nichts — und wer ihn nicht will, benennt oder
verschiebt, was er ohnehin wollte.

Damit haben **alle vier** Migrationsfälle dieselbe Form: aus einem Projekt wird
ein Ordner mit dem Namen, und die Aufgaben ziehen in ein gleichnamiges Projekt
darin. Nur wo es keine Aufgaben gibt, entfällt das Projekt.

## 10e. Freigaben — ein Link auf ein Projekt

**Status: gebaut** (Migration 0011, `shares.ts`, `shareRoutes.ts`, `/f/:token`).
Aufgeschrieben vor dem Bau, weil eine Rechtefläche der eine Ort ist, an dem ein
Irrtum nicht nur hässlich, sondern gefährlich ist.

### Was aus SONEs ADRs mitkommt

Drei Entscheidungen, und alle drei sind älter als dieser Abschnitt:

- **Zugang ist keine Einladung** (ADR-0073). Ein Konto anzulegen ist Sache der
  Instanz; wer in einem Arbeitsbereich mitarbeiten darf, ist Sache seines
  Eigentümers. Ein Formular, das beides tut, lässt einen Arbeitsbereich fremde
  Konten auf dem Server erzeugen.
- **Der Link behält den Link** (ADR-0113). Man kann ihn wieder anzeigen. Ein
  Link, den man nur einmal sieht, führt dazu, dass jemand einen zweiten anlegt
  und den ersten zu widerrufen vergisst — die vergessene Freigabe ist der
  eigentliche Schaden.
- **Der Token reist nie in der Anfrage** (ADR-0126). Sobald es einen Mailweg
  gibt: eine Route, die eine übergebene URL verschickt, ist ein kleiner
  offener Verteiler mit dem Namen dieser Instanz auf dem Umschlag.

Dazu die Regel, die heute schon drei Mal die Antwort war (ADR-0087, 0110, 0113)
und die ich in dieser Sitzung selbst zweimal gebrochen habe: **ein Parameter,
den jeder Aufrufer richtig berechnen muss, ist ein Parameter, den ein Aufrufer
falsch berechnet.** Für Freigaben heißt das: die Sichtbarkeitsbedingung fragt
selbst nach dem Zugang und bekommt ihn nicht übergeben.

### Wo SOTE bewusst abweicht

In SONE ist **ein Gast ein Mitglied** (ADR-0110) — weil Rechte dort an Seiten
hängen und eine Erlaubnis ohne Mitgliedschaft eine Zeile wäre, die nicht weiß,
ob die Person noch da ist.

SOTE hat keine Rechte je Projekt: alles gilt je Arbeitsbereich. Ein Gast wäre
hier also entweder ein Mitglied mit Zugriff auf **alles** — das ist keine
Freigabe, das ist eine Einladung — oder etwas, das SOTE noch nicht hat.

**Vorschlag: eine Freigabe ist ein Token, kein Konto.** Sie hängt an genau
einem Projekt und trägt ihr Recht selbst. Damit ist sie kein Mitglied, und die
Frage „ist die Person noch da" stellt sich nicht: es gibt keine Person, es gibt
einen Link, und den widerruft man.

Das ist ein echter Unterschied zu SONE, und der Preis steht dazu: ein Gast hat
keinen Namen. Wer etwas ändert, erscheint als „über einen Link" und nicht als
jemand. Bei einer Notizanwendung mit Kommentaren wäre das zu wenig; bei einer
Aufgabenliste, die man jemandem hinhält, reicht es — und die Alternative wäre,
Konten für Leute anzulegen, die keines wollen.

### Die Form

| | |
|---|---|
| **Woran** | genau ein Projekt. Kein Ordner: ein Ordner ist kein Ort, an dem Aufgaben stehen. |
| **Was** | `read` oder `edit`. Zwei Stufen, keine Matrix. |
| **Wie lange** | unbegrenzt oder mit Ablauf. Ein Ablauf ist die Freigabe, die sich selbst aufräumt. |
| **Wer** | angelegt von einem Mitglied, das im Arbeitsbereich schreiben darf. |

**`edit` heißt: abhaken, anlegen, Titel und Datum ändern.** Nicht: das Projekt
umbenennen, es löschen, andere Projekte sehen, Leute sehen. Die Grenze ist
nicht „was ist gefährlich", sondern **was gehört zum Projekt** — wer eine Liste
abarbeiten soll, braucht die Liste und nichts darüber.

### Was daraus folgt, und was ich entschieden hätte

1. **Der Bildschirm einer Freigabe hat keine Schiene.** Es gibt keine anderen
   Orte, also auch keine Liste davon. Ein Rahmen mit fünf Bereichen, von denen
   vier „nicht für dich" antworten, ist schlimmer als kein Rahmen.

2. **Das Token steht in der Adresse, nicht in einem Kopf.** Ein Link muss sich
   weitergeben lassen, sonst ist er keiner. Der Preis: er steht im Verlauf des
   Browsers und in jedem Protokoll, das URLs mitschreibt — deshalb ist der
   Widerruf die wichtigste Funktion und nicht ein Nachtrag.

3. **Gespeichert wird der Token verschlüsselt, nicht gehasht.** Ein Hash wäre
   sicherer und würde ADR-0113 brechen: man könnte ihn nicht wieder anzeigen.
   Die Abwägung geht hier gegen den Hash, weil der wahrscheinlichere Schaden
   die *vergessene* Freigabe ist und nicht die gelesene Datenbank — wer die
   Datenbank liest, hat die Aufgaben auch ohne Token.
   **Das ist der Punkt, an dem ich am unsichersten bin**, und er steht als
   Frage unten.

4. **Der Widerruf ist sofort und endgültig.** Kein Papierkorb für Freigaben:
   „widerrufen, aber wiederherstellbar" heißt, der Link geht noch.

5. **Eine Liste dessen, was hinausgegeben ist**, unter „Freigaben" in der
   Schiene — mit Projekt, Recht, Ablauf, wann zuletzt benutzt. „Zuletzt
   benutzt" ist die Spalte, die eine vergessene Freigabe sichtbar macht.

6. **Die Bedingung fragt selbst.** Eine Funktion `accessTo(projectId, viewer)`,
   und `viewer` ist entweder ein Konto oder ein Token. Kein Aufrufer bekommt
   ein `mayEdit` übergeben.

### Was ich dabei nicht verspreche

- **Kein Mailweg.** Den Link verschickt, wer ihn kopiert. Sobald es einen
  Mailweg gibt, gilt ADR-0126 — und dann verschickt der Server einen Link, den
  er selbst baut, und nicht einen, den der Browser ihm gibt.
- **Kein Kommentieren, keine Namen.** Ein Gast ist niemand.
- **Keine Freigabe eines Ordners** und keine des ganzen Arbeitsbereichs. Das
  Zweite ist eine Einladung und gehört zu „Leute".

### Beim Bauen dazugekommen

- **Der Schlüssel liegt in der Umgebung** (`SOTE_SHARE_KEY`), nicht in der
  Datenbank. Das stand in der Abwägung nicht drin und ist der Punkt, an dem sie
  gekippt wäre: läge er neben den Tokens, die er schützt, wäre die
  Verschlüsselung Theater. So ist sagbar, wogegen sie schützt — gegen
  Sicherungen, Auszüge, Protokolle — und wogegen nicht.
- **Ohne Schlüssel gibt es keine Freigaben, und der Bildschirm nennt den Grund
  samt Befehl.** Nicht still keine (ADR-0112).
- **Ein geratener Token bekommt immer denselben Satz.** Anders als ADR-0073s
  „no such account is said plainly": dort fragt jemand, der schon wissen darf,
  wer im Arbeitsbereich ist. Hier fragt ein Fremder.
- **Eine Id in der Adresse ist eine Behauptung, nicht eine Auskunft.** Jede
  Aufgabe wird gegen das Projekt der Freigabe geprüft, Teilaufgaben über ihren
  Elternteil.
- **Der Platzhalter der Schnellerfassung ist ein Versprechen.** Er nannte
  `#haus`, und über eine Freigabe gilt `#projekt` nicht — im Bild stand eine
  Anleitung für etwas, das der Server absichtlich ignoriert.

### Entschieden (war offen)

1. **Verschlüsselt**, wie SONE. Verschlüsselt heißt: der Link lässt sich
   wieder anzeigen (SONEs ADR-0113), und ein Schlüssel in der Umgebung kann
   alle Freigaben aufdecken. Gehasht heißt: sicherer, aber „einmal kopieren
   oder neu anlegen" — und neu angelegte Links, deren Vorgänger noch gilt, sind
   genau der Schaden, um den es geht.
2. **Ein Gast löscht nicht**: der Papierkorb ist ein Ort des Arbeitsbereichs.
3. **Der Ablauf ist freiwillig, mit einem Vorschlag** — eine Pflicht macht
   Leute erfinderisch (ein Jahr), ein Vorschlag macht ihn zur Gewohnheit.

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
