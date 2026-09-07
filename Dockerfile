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
RUN pnpm install --frozen-lockfile || pnpm install
COPY packages ./packages
RUN pnpm -r build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY packages/server/migrations packages/server/migrations

# Nicht als root.
USER node
EXPOSE 8080
CMD ["node", "packages/server/dist/main.js"]
