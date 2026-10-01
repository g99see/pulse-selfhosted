#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Пользователи «Пульса» из консоли сервера: добавить, сбросить пароль, сделать
# администратором, сменить режим регистрации. Работает с запущенной установкой
# (docker compose), запускать на сервере:
#
#   sudo /opt/puls/scripts/users.sh help
#
# Сама логика — scripts/users.cjs; она выполняется внутри контейнера api,
# где уже есть доступ к базе и те же библиотеки, что у сайта.
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx api; then
  echo 'Ошибка: контейнер api не запущен. Запустите: cd '"$ROOT_DIR"' && docker compose up -d' >&2
  exit 1
fi

exec docker compose exec -T -w /app/apps/api api node - "$@" < "$ROOT_DIR/scripts/users.cjs"
