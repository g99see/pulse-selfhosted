# syntax=docker/dockerfile:1
# Контекст сборки — корень монорепо (нужен pnpm-workspace.yaml и packages/shared).
FROM node:22-alpine AS base
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
WORKDIR /app/apps/api
EXPOSE 3001
# Миграции применяются при старте (ТЗ §10: обновления с автомиграциями).
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
