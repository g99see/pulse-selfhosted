#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Резервная копия «Пульса» (ТЗ §6, §10): дамп PostgreSQL в custom-формате
# (`pg_dump -Fc`) + метаданные с версией схемы в архив tar.gz, затем ротация
# старых архивов. Скрипт работает в двух режимах:
#
#   * local   — внутри контейнера `backup` (или на хосте с клиентом PostgreSQL):
#               дамп снимается напрямую через pg_dump по PGHOST;
#   * compose — на хосте без psql: дамп снимается через
#               `docker compose exec postgres`;
#
# Режим задаётся переменной BACKUP_MODE (local|compose) либо определяется
# автоматически: если доступны pg_dump и PGHOST — local, иначе compose.
#
# Настройки: BACKUP_DIR (по умолчанию ./backups), BACKUP_KEEP (7),
# BACKUP_PREFIX (backup), PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE,
# COMPOSE_PROJECT (для отдельного compose-проекта), APP_VERSION.
#
# Запуск по расписанию: `backup.sh --daemon` — цикл с паузой
# BACKUP_INTERVAL_HOURS (по умолчанию 24) часов; после успешного бэкапа
# создаётся маркер $BACKUP_DIR/.last-success для healthcheck сервиса.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
BACKUP_KEEP=${BACKUP_KEEP:-7}
BACKUP_PREFIX=${BACKUP_PREFIX:-backup}
PGDATABASE=${PGDATABASE:-puls}
PGUSER=${PGUSER:-puls}
PGPORT=${PGPORT:-5432}
BACKUP_MODE=${BACKUP_MODE:-}

log() { printf '[backup] %s\n' "$*"; }
fail() {
  printf '[backup] ОШИБКА: %s\n' "$*" >&2
  exit 1
}

detect_mode() {
  [ -n "$BACKUP_MODE" ] && return 0
  if command -v pg_dump >/dev/null 2>&1 && [ -n "${PGHOST:-}" ]; then
    BACKUP_MODE=local
  else
    BACKUP_MODE=compose
  fi
}

compose() {
  if [ -n "${COMPOSE_PROJECT:-}" ]; then
    docker compose -p "$COMPOSE_PROJECT" "$@"
  else
    docker compose "$@"
  fi
}

# Пишет дамп в custom-формате в stdout.
dump_to_stdout() {
  if [ "$BACKUP_MODE" = local ]; then
    pg_dump --format=custom --no-owner --no-privileges
  else
    compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDATABASE" \
      --format=custom --no-owner --no-privileges
  fi
}

# Одно значение из БД (или пустая строка, если запрос не удался).
psql_value() {
  if [ "$BACKUP_MODE" = local ]; then
    psql -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" 2>/dev/null || true
  else
    compose exec -T postgres psql -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" 2>/dev/null || true
  fi
}

rotate() {
  # Оставляем BACKUP_KEEP самых новых архивов, остальные удаляем.
  count=0
  for archive in $(ls -1t "$BACKUP_DIR"/"$BACKUP_PREFIX"-*.tar.gz 2>/dev/null); do
    count=$((count + 1))
    if [ "$count" -gt "$BACKUP_KEEP" ]; then
      log "ротация: удаляю $(basename "$archive")"
      rm -f "$archive"
    fi
  done
}

backup_once() {
  mkdir -p "$BACKUP_DIR"

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name="$BACKUP_PREFIX-$stamp"
  work="$BACKUP_DIR/.work-$name"
  rm -rf "$work"
  mkdir -p "$work"

  log "снимаю дамп $PGDATABASE (режим: $BACKUP_MODE)"
  if ! dump_to_stdout >"$work/dump.pgc"; then
    rm -rf "$work"
    fail 'pg_dump завершился с ошибкой — архив не создан'
  fi
  [ -s "$work/dump.pgc" ] || {
    rm -rf "$work"
    fail 'дамп пуст — архив не создан'
  }

  migration=$(psql_value \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")
  [ -n "$migration" ] || migration='none'
  pg_version=$(psql_value 'SHOW server_version')
  [ -n "$pg_version" ] || pg_version='unknown'

  cat >"$work/metadata.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "$PGDATABASE",
  "migration": "$migration",
  "pgVersion": "$pg_version",
  "appVersion": "${APP_VERSION:-0.1.0}"
}
EOF

  archive="$BACKUP_DIR/$name.tar.gz"
  tar -czf "$archive" -C "$work" dump.pgc metadata.json
  rm -rf "$work"
  touch "$BACKUP_DIR/.last-success"

  log "готово: $archive (миграция схемы: $migration)"
  rotate
}

run_daemon() {
  interval_h=${BACKUP_INTERVAL_HOURS:-24}
  interval_s=$((interval_h * 3600))
  log "сервис бэкапа запущен: интервал ${interval_h}ч, храним $BACKUP_KEEP архив(ов)"
  while true; do
    if backup_once; then
      log "следующий бэкап через ${interval_h}ч"
    else
      log "бэкап не удался — повтор через ${interval_h}ч"
    fi
    sleep "$interval_s"
  done
}

# Проверка свежести последнего успешного бэкапа (healthcheck сервиса backup):
# маркер существует и не старше двух интервалов.
run_healthcheck() {
  marker="$BACKUP_DIR/.last-success"
  if [ ! -f "$marker" ]; then
    echo "[backup] healthcheck: маркера $marker нет"
    return 1
  fi
  now=$(date +%s)
  mtime=$(stat -c %Y "$marker" 2>/dev/null || stat -f %m "$marker")
  max_age=$((${BACKUP_INTERVAL_HOURS:-24} * 7200))
  age=$((now - mtime))
  if [ "$age" -ge "$max_age" ]; then
    echo "[backup] healthcheck: бэкап устарел ($age с назад)"
    return 1
  fi
  echo "[backup] healthcheck: бэкап свежий ($age с назад)"
}

detect_mode
case "${1:-}" in
  --daemon) run_daemon ;;
  --healthcheck) run_healthcheck ;;
  *) backup_once ;;
esac
