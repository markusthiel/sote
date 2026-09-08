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
