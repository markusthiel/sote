#!/bin/sh
# SOTE starten.
#
# Zwei Dinge, in dieser Reihenfolge: das Verzeichnis für Anhänge benutzbar
# machen, dann den Server als unprivilegierten Benutzer übernehmen lassen.
# Die Migrationen laufen im Server selbst (`main.ts`) und brauchen hier
# keinen eigenen Schritt.
#
# ## Warum das als root beginnt
#
# Der Server darf nicht als root laufen, und er tut es nicht — die letzte
# Zeile wechselt auf uid 1000 und bleibt dort. Die Augenblicke davor
# brauchen aber Rechte, aus zwei Gründen:
#
#  - Ein eingehängtes Host-Verzeichnis behält die Eigentümerschaft des
#    Hosts. Docker überträgt die Rechte aus dem Abbild nur in ein FRISCHES
#    benanntes Volume und nie in einen Bind-Mount.
#  - Ein bereits vorhandenes benanntes Volume behält ebenfalls seine alte
#    Eigentümerschaft. Wer SOTE aktualisiert, hat genau so eines — und das
#    `chown` im Dockerfile greift dort nicht.
#
# Beides führte zu demselben Bild: der Upload scheiterte mit „Hochladen
# ging nicht", und um den Grund zu finden, musste man ein Containerlog
# lesen. Der Container richtet jetzt, was er richten kann, und sagt es,
# wenn er es nicht kann.
#
# ## Warum das keine Aufweichung ist
#
# `su-exec` ERSETZT die Shell, statt einen Prozess abzuzweigen: nach der
# Übergabe existiert kein root-Prozess mehr, zu dem sich etwas
# hocharbeiten könnte. Fehlt `su-exec`, schlägt `exec` fehl und der
# Container endet — er fällt NICHT darauf zurück, den Server als root zu
# starten. Genau dieses Verhalten im Fehlerfall ist der Punkt.
#
# Wer root im Container gar nicht will, setzt `user:` in Compose. Dieses
# Skript merkt dann, dass es nicht root ist, und startet direkt durch —
# die Verzeichnisse müssen für diesen Benutzer aber schon beschreibbar
# sein.

set -e

FILES_DIR="${SOTE_FILES_DIR:-/data/files}"
RUN_AS_UID=1000
RUN_AS_GID=1000

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$FILES_DIR" 2>/dev/null || true

  # Nur wenn es tatsächlich falsch ist. Ein rekursives chown über ein
  # großes Anhangverzeichnis bei jedem Neustart kostet bei einer
  # gewachsenen Instanz Minuten, ohne etwas zu ändern.
  owner="$(stat -c '%u' "$FILES_DIR" 2>/dev/null || echo unbekannt)"
  if [ "$owner" != "$RUN_AS_UID" ]; then
    echo "SOTE: $FILES_DIR gehört uid $owner; übernehme es für uid $RUN_AS_UID"
    if ! chown -R "$RUN_AS_UID:$RUN_AS_GID" "$FILES_DIR" 2>/dev/null; then
      # Ein schreibgeschützter Mount oder ein Dateisystem ohne
      # Eigentümerschaft (manche Netzfreigaben). Deutlich gesagt, statt
      # später als fehlgeschlagener Upload aufzutauchen.
      echo "SOTE: konnte die Eigentümerschaft von $FILES_DIR nicht ändern." >&2
      echo "SOTE: Anhänge scheitern, solange es für uid $RUN_AS_UID nicht beschreibbar ist." >&2
    fi
  fi
else
  echo "SOTE: läuft als uid $(id -u); lasse die Verzeichnisrechte unberührt"
fi

# Das Kommando kommt aus `CMD` und wird hier NICHT fest eingebaut.
#
# Zwei Gründe. Erstens ist es die übliche Form, und wer `docker run … sh`
# aufruft, erwartet eine Shell und nicht den Server. Zweitens — und das
# ist der praktische — lässt sich so messen, als welcher Benutzer der
# Prozess am Ende läuft: `docker run … id -u` durchläuft denselben
# Einstiegspunkt und antwortet mit der Kennung, die auch der Server hätte.
# Genau das prüft der Arbeitsablauf nach dem Bauen.
if [ "$(id -u)" = "0" ]; then
  # exec, damit die Shell ersetzt wird: es bleibt kein root-Prozess übrig.
  exec su-exec "$RUN_AS_UID:$RUN_AS_GID" "$@"
else
  exec "$@"
fi
