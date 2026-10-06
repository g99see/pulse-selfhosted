#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Откат одной миграции схемы (ТЗ v2 §8). Порядок действий:
#   1. проверка: миграция применена и более поздних применённых миграций нет
#      (откатывать можно только последнюю — иначе порядок down.sql нарушится);
#   2. резервная копия через scripts/backup.sh;
#   3. применение <миграция>/down.sql одной транзакцией через
#      `docker compose exec postgres psql`;
#   4. `prisma migrate resolve --rolled-back <миграция>` — Prisma снова считает
#      её неприменённой, и следующий `migrate deploy` накатит её заново.
#      Prisma разрешает --rolled-back только для миграции в состоянии «failed»
#      (finished_at IS NULL), поэтому в той же транзакции, что и down.sql,
#      скрипт сбрасывает finished_at у записи об этой миграции.
#
# Использование: scripts/migrate-rollback.sh <имя-каталога-миграции> [--yes] [--force]
#   --yes    не спрашивать подтверждение
#   --force  разрешить откат, даже если применены более поздние миграции
#
# Настройки: PGUSER (puls), PGDATABASE (puls), COMPOSE_PROJECT, SKIP_BACKUP=1
# (только для тестов; в бою бэкап обязателен).
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
MIGRATIONS_DIR=${MIGRATIONS_DIR:-"$ROOT_DIR/apps/api/prisma/migrations"}
PGUSER=${PGUSER:-puls}
PGDATABASE=${PGDATABASE:-puls}

log() { printf '[rollback] %s\n' "$*"; }
fail() {
  printf '[rollback] ОШИБКА: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Использование: scripts/migrate-rollback.sh <имя-каталога-миграции> [--yes] [--force]
Пример:        scripts/migrate-rollback.sh 20261006140000_reconciliation
USAGE
}

compose() {
  if [ -n "${COMPOSE_PROJECT:-}" ]; then
    docker compose -p "$COMPOSE_PROJECT" "$@"
  else
    docker compose "$@"
  fi
}

psql_db() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDATABASE" "$@"
}

MIGRATION=''
ASSUME_YES=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) fail "неизвестный флаг: $arg" ;;
    *) [ -z "$MIGRATION" ] && MIGRATION=$arg || fail 'нужен ровно один аргумент — имя миграции' ;;
  esac
done

[ -n "$MIGRATION" ] || {
  usage >&2
  exit 2
}

# Имя каталога — только то, что бывает у миграций Prisma: защита от «../» и инъекций в SQL.
case "$MIGRATION" in
  *[!A-Za-z0-9_]*) fail "недопустимое имя миграции: $MIGRATION" ;;
esac

DOWN_SQL="$MIGRATIONS_DIR/$MIGRATION/down.sql"
[ -d "$MIGRATIONS_DIR/$MIGRATION" ] || fail "каталог миграции не найден: $MIGRATIONS_DIR/$MIGRATION"
[ -f "$DOWN_SQL" ] || fail "у миграции нет down.sql: $DOWN_SQL"

# 1. Миграция применена, и она последняя из применённых.
applied=$(psql_db -tAc "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL") ||
  fail 'не удалось прочитать _prisma_migrations (запущен ли postgres?)'
[ "$(printf '%s' "$applied" | tr -d '[:space:]')" = 1 ] ||
  fail "миграция $MIGRATION не применена — откатывать нечего"

later=$(psql_db -tAc "SELECT migration_name FROM _prisma_migrations WHERE migration_name > '$MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name") ||
  fail 'не удалось проверить более поздние миграции'
if [ -n "$later" ] && [ "$FORCE" != 1 ]; then
  printf '[rollback] Сначала откатите более поздние миграции (от новых к старым):\n%s\n' "$later" >&2
  fail 'или повторите с --force, если уверены в независимости миграций'
fi

if [ "$ASSUME_YES" != 1 ]; then
  printf '[rollback] Откатить %s? Данные удаляемых колонок и таблиц будут потеряны. [y/N] ' "$MIGRATION"
  read -r answer
  case "$answer" in
    y | Y | yes) ;;
    *) fail 'отменено' ;;
  esac
fi

# 2. Резервная копия — обязательна.
if [ "${SKIP_BACKUP:-0}" = 1 ]; then
  log 'SKIP_BACKUP=1 — бэкап пропущен'
else
  [ -f "$SCRIPT_DIR/backup.sh" ] || fail 'scripts/backup.sh не найден — без бэкапа откат запрещён'
  log 'снимаю резервную копию перед откатом'
  sh "$SCRIPT_DIR/backup.sh" || fail 'бэкап не удался — откат не выполнен'
fi

# 3. down.sql и пометка «откачена» — одной транзакцией: при ошибке БД остаётся как была.
# Пометку ставим тем же SQL, что делает `prisma migrate resolve --rolled-back`
# (rolled_back_at = now()): prisma CLI в контейнере api смотрит в свой DATABASE_URL,
# а не в $PGDATABASE, и мог бы пометить не ту базу; к тому же resolve принимает
# только упавшие миграции (P3012).
log "применяю $MIGRATION/down.sql"
{
  cat "$DOWN_SQL"
  printf '\n'
  printf "UPDATE _prisma_migrations SET rolled_back_at = now(), logs = 'rolled back by scripts/migrate-rollback.sh' WHERE migration_name = '%s' AND rolled_back_at IS NULL;\n" "$MIGRATION"
} | psql_db -v ON_ERROR_STOP=1 --single-transaction ||
  fail 'down.sql завершился с ошибкой — транзакция отменена, схема не изменена'

log "готово: $MIGRATION откачена. Следующий prisma migrate deploy накатит её заново."
