#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Обновление «Пульса» одной командой (ТЗ §10: «миграции с проверкой перед
# обновлением»). Порядок: бэкап → подтягивание/сборка образов → перезапуск.
# Миграции Prisma применяет контейнер api при старте (CMD Dockerfile).
#
#   scripts/upgrade.sh
#
# SKIP_BACKUP=1 — пропустить шаг резервной копии (не рекомендуется).
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

# Код: если каталог — git-репозиторий, подтягиваем свежую версию (только fast-forward).
if [ -d "$ROOT_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  echo '==> Шаг 0/3: git pull --ff-only'
  git -C "$ROOT_DIR" pull --ff-only
fi

if [ "${SKIP_BACKUP:-0}" = '1' ]; then
  echo '==> Шаг 1/3: резервная копия пропущена (SKIP_BACKUP=1)'
else
  echo '==> Шаг 1/3: резервная копия перед обновлением'
  bash scripts/backup.sh
fi

echo '==> Шаг 2/3: обновляю образы'
# Сторонние образы (postgres, valkey, caddy) — pull; api и web собираются из
# исходников. Раньше build запускался только при ошибке pull, а pull для
# сервисов со `build:` молча успешен — новый код в образы не попадал.
docker compose pull --ignore-buildable || echo '    pull сторонних образов не удался — продолжаю с локальными'
docker compose build api web

echo '==> Шаг 3/3: применяю обновление'
docker compose up -d --remove-orphans

echo
echo 'Готово. Миграции Prisma применены контейнером api при старте.'
docker compose ps
