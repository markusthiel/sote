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
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# Ohne Fallback: `|| pnpm install` würde ein veraltetes Lockfile stillschweigend
# umgehen, und dann baut das Abbild mit anderen Abhängigkeiten als die Tests
# gelaufen sind. Scheitert es hier, ist das Lockfile nicht eingecheckt.
RUN pnpm install --frozen-lockfile
COPY packages ./packages
# Reihenfolge: core zuerst, weil Server und Oberfläche daraus lesen.
RUN pnpm --filter @sote/core build \
 && pnpm --filter @sote/server build \
 && pnpm --filter @sote/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# **Alle drei** package.json, auch die der Oberfläche, obwohl davon nur `dist`
# gebraucht wird: `--frozen-lockfile` vergleicht das Lockfile mit dem gesamten
# Workspace, und ein fehlendes Paket macht daraus einen Fehler „lockfile is not
# up to date". Der Preis ist, dass React im Laufzeit-Abbild landet, ohne dort
# gebraucht zu werden — bekannt und in Kauf genommen; `pnpm deploy` wäre die
# Alternative und ist heikler als der gewonnene Platz.
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY packages/server/migrations packages/server/migrations

# Nicht als root. Der Workflow misst das nach dem Bauen, weil eine Zeile im
# Dockerfile noch keine Messung ist.
USER node
EXPOSE 8080
CMD ["node", "packages/server/dist/main.js"]
