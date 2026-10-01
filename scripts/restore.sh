#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Восстановление «Пульса» из архива, созданного scripts/backup.sh
# (ТЗ §6, §10: «восстановление одной командой»).
#
#   scripts/restore.sh backups/backup-20261001T120000Z.tar.gz
#
# Перед восстановлением сверяется версия схемы: миграция Prisma из архива
# сравнивается с последней применённой в целевой БД. Если база ушла вперёд
# (или разошлась), восстановление останавливается, пока не передан --force.
# Флаг --migrate после восстановления накатывает миграции текущего образа.
#
# Режимы (как у backup.sh): local — pg_restore напрямую по PGHOST;
# compose — через `docker compose exec postgres`. Задаётся RESTORE_MODE.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

PGUSER=${PGUSER:-puls}
RESTORE_MODE=${RESTORE_MODE:-}
RESTORE_FORCE=${RESTORE_FORCE:-0}
RUN_MIGRATIONS=0

log() { printf '[restore] %s\n' "$*"; }
fail() {
  printf '[restore] ОШИБКА: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Использование: scripts/restore.sh <архив.tar.gz> [--force] [--migrate]

  --force    восстановить, даже если версия схемы в БД не совпадает с архивом
  --migrate  после восстановления применить миграции текущего образа
             (prisma migrate deploy в контейнере api)

Переменные: PGDATABASE (по умолчанию из метаданных архива), PGHOST/PGPORT/
PGUSER/PGPASSWORD, RESTORE_MODE (local|compose), COMPOSE_PROJECT.
EOF
}

archive=''
for arg in "$@"; do
  case "$arg" in
    --force) RESTORE_FORCE=1 ;;
    --migrate) RUN_MIGRATIONS=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      usage
      fail "неизвестный флаг: $arg"
      ;;
    *)
      [ -z "$archive" ] || fail 'можно указать только один архив'
      archive=$arg
      ;;
  esac
done

[ -n "$archive" ] || {
  usage
  exit 1
}
[ -f "$archive" ] || fail "архив не найден: $archive"

compose() {
  if [ -n "${COMPOSE_PROJECT:-}" ]; then
    docker compose -p "$COMPOSE_PROJECT" "$@"
  else
    docker compose "$@"
  fi
}

detect_mode() {
  [ -n "$RESTORE_MODE" ] && return 0
  if command -v pg_restore >/dev/null 2>&1 && [ -n "${PGHOST:-}" ]; then
    RESTORE_MODE=local
  else
    RESTORE_MODE=compose
  fi
}

psql_value() {
  if [ "$RESTORE_MODE" = local ]; then
    psql -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" 2>/dev/null || true
  else
    compose exec -T postgres psql -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" 2>/dev/null || true
  fi
}

restore_from_stdin() {
  if [ "$RESTORE_MODE" = local ]; then
    pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGDATABASE" -U "$PGUSER"
  else
    compose exec -T postgres pg_restore -U "$PGUSER" -d "$PGDATABASE" \
      --clean --if-exists --no-owner --no-privileges
  fi
}

work=$(mktemp -d)
cleanup() { rm -rf "$work"; }
trap cleanup EXIT INT TERM

log "распаковываю $archive"
tar -xzf "$archive" -C "$work" || fail 'не удалось распаковать архив'
[ -f "$work/dump.pgc" ] || fail 'в архиве нет dump.pgc'
[ -f "$work/metadata.json" ] || fail 'в архиве нет metadata.json'

meta_migration=$(sed -n 's/.*"migration": *"\([^"]*\)".*/\1/p' "$work/metadata.json" | head -n 1)
[ -n "$meta_migration" ] || meta_migration='none'
meta_database=$(sed -n 's/.*"database": *"\([^"]*\)".*/\1/p' "$work/metadata.json" | head -n 1)
meta_created=$(sed -n 's/.*"createdAt": *"\([^"]*\)".*/\1/p' "$work/metadata.json" | head -n 1)

PGDATABASE=${PGDATABASE:-${meta_database:-puls}}
export PGDATABASE
detect_mode

log "архив от ${meta_created:-?}, схема: $meta_migration, БД: $PGDATABASE (режим: $RESTORE_MODE)"

current_migration=$(psql_value \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")
[ -n "$current_migration" ] || current_migration='none'

if [ "$RESTORE_FORCE" != '1' ] && [ "$current_migration" != "$meta_migration" ]; then
  if [ "$meta_migration" != 'none' ] && [ "$current_migration" != 'none' ]; then
    fail "версия схемы в БД ($current_migration) не совпадает с архивом ($meta_migration).
       Накатите миграции командой \`pnpm db:deploy\` или повторите с --force."
  fi
fi

log 'восстанавливаю данные (pg_restore --clean --if-exists)'
if ! restore_from_stdin <"$work/dump.pgc"; then
  log 'pg_restore завершился с предупреждениями — проверьте вывод выше'
fi

tables=$(psql_value "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
log "готово: таблиц в public — ${tables:-?}"

if [ "$RUN_MIGRATIONS" = '1' ]; then
  log 'применяю миграции текущего образа (prisma migrate deploy)'
  if [ "$RESTORE_MODE" = local ]; then
    (cd "$ROOT_DIR/apps/api" && ./node_modules/.bin/prisma migrate deploy) ||
      fail 'миграции не применились'
  else
    compose run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy ||
      fail 'миграции не применились'
  fi
fi
