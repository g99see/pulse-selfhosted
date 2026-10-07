# syntax=docker/dockerfile:1
# Контекст сборки — корень монорепо (нужен pnpm-workspace.yaml и packages/shared).
FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache openssl
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @puls/shared build \
  && pnpm --filter @puls/api build

FROM base AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache openssl curl
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/data ./apps/api/data
WORKDIR /app/apps/api
# pnpm не линкует транзитивные зависимости в apps/api/node_modules, а код API
# импортирует express напрямую (json-парсер в app.setup.ts, типы Request/
# Response в контроллерах). Node ищет модули только в node_modules вверх по
# дереву, поэтому чистый образ падал с MODULE_NOT_FOUND: express. Приватный
# hoisted-store pnpm (.pnpm/node_modules) делает транзитивные зависимости
# резолвимыми и не требует правок package.json/lockfile.
ENV NODE_PATH=/app/node_modules/.pnpm/node_modules
EXPOSE 3001
# Миграции применяются при старте (ТЗ §10: обновления с автомиграциями).
# Вызываем prisma напрямую из node_modules: `pnpm exec` в runtime тянет pnpm
# через corepack из сети и падает без pnpm-workspace.yaml.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
