# SOTE — ein Abbild.
#
# Zwei Stufen: bauen mit den Entwicklungsabhängigkeiten, laufen ohne sie. Die
# Migrationen wandern als SQL mit und werden beim Start ausgeführt — eine
# Migration, die von Hand angestoßen werden muss, wird irgendwann vergessen.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/editor/package.json packages/editor/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# Ohne Fallback: `|| pnpm install` würde ein veraltetes Lockfile stillschweigend
# umgehen, und dann baut das Abbild mit anderen Abhängigkeiten als die Tests
# gelaufen sind. Scheitert es hier, ist das Lockfile nicht eingecheckt.
RUN pnpm install --frozen-lockfile
COPY packages ./packages
# Reihenfolge: core zuerst, weil alle anderen daraus lesen; dann der Editor,
# weil die Oberfläche ihn einbindet und `dist` dafür dastehen muss.
RUN pnpm --filter @sote/core build \
 && pnpm --filter @sote/editor build \
 && pnpm --filter @sote/server build \
 && pnpm --filter @sote/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# **Alle vier** package.json, auch die der Oberfläche und des Editors, obwohl
# von beiden nur Gebautes gebraucht wird (und vom Editor nicht einmal das: die
# Oberfläche bündelt ihn): `--frozen-lockfile` vergleicht das Lockfile mit dem gesamten
# Workspace, und ein fehlendes Paket macht daraus einen Fehler „lockfile is not
# up to date". Der Preis ist, dass React im Laufzeit-Abbild landet, ohne dort
# gebraucht zu werden — bekannt und in Kauf genommen; `pnpm deploy` wäre die
# Alternative und ist heikler als der gewonnene Platz.
COPY packages/core/package.json packages/core/
COPY packages/editor/package.json packages/editor/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY packages/server/migrations packages/server/migrations
# Der Healthcheck aus compose ruft diese Datei im Container auf. Ohne sie
# scheitert er, Docker startet den Container neu, und der Grund steht nirgends
# außer in einer Zeile „Cannot find module".
COPY docker/healthcheck.mjs docker/healthcheck.mjs

# Das Verzeichnis für Anhänge, mit dem richtigen Eigentümer.
#
# Docker legt ein leeres benanntes Volume mit den Rechten des Pfades an, den es
# im Abbild überdeckt. Gibt es den Pfad dort nicht, gehört der Einhängepunkt
# root — und der Server bekommt beim ersten Anhang ein `EACCES` aus `mkdir`.
# Die Oberfläche sagt dann nur „Hochladen ging nicht", und im Protokoll steht
# eine Zeile, die niemand sucht.
#
# Das deckt NEUE Volumes ab. Für schon vorhandene und für Bind-Mounts greift es
# nicht — dafür gibt es den Einstiegspunkt.
#
# su-exec gibt die Rechte im Einstiegspunkt ab, ohne einen root-Prozess
# zurückzulassen; warum der Container überhaupt als root beginnt, steht in
# docker/entrypoint.sh.
RUN apk add --no-cache su-exec \
 && mkdir -p /data/files \
 && chown -R node:node /data

COPY --chown=node:node docker/entrypoint.sh docker/entrypoint.sh

# Bewusst KEIN `USER node`.
#
# Der Einstiegspunkt beginnt als root, macht das Datenverzeichnis benutzbar —
# der einzige Weg, ein vorhandenes Volume oder einen Bind-Mount zu behandeln,
# deren Eigentümerschaft nicht aus dem Abbild kommt — und übergibt dann an den
# Server als uid 1000. Kein root-Prozess überlebt diese Übergabe.
#
# Was zählt, ist der Benutzer, unter dem der Server ENDET, nicht der, den das
# Abbild erklärt: ein Abbild mit `USER` lässt sich immer noch mit `--user 0`
# starten. Deshalb prüft scripts/verify-image.sh den laufenden Container.
EXPOSE 8080
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["node", "packages/server/dist/main.js"]
