# syntax=docker/dockerfile:1
# Контекст сборки — корень монорепо (Next.js standalone в pnpm-воркспейсе).
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=/
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Origin песочницы для режима http (пусто — берётся абсолютный адрес из API).
ARG NEXT_PUBLIC_SANDBOX_URL=
ENV NEXT_PUBLIC_SANDBOX_URL=$NEXT_PUBLIC_SANDBOX_URL
ARG NEXT_PUBLIC_SANDBOX_URLS=
ENV NEXT_PUBLIC_SANDBOX_URLS=$NEXT_PUBLIC_SANDBOX_URLS
ENV NEXT_TELEMETRY_DISABLED=1
# Включает output: 'standalone' в next.config.mjs (см. комментарий там).
ENV BUILD_STANDALONE=1
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @puls/shared build \
  && pnpm --filter @puls/web build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
