#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Запуск «Пульса» без Docker: API (:3001) и web (:3000) как обычные процессы
# с PID-файлами и логами. Альтернатива systemd-юнитам для ручного запуска.
#
#   scripts/dev-run.sh start|stop|status|restart|logs [api|web]
#
# Окружение берётся из окружения процесса; если DATABASE_URL не задан —
# подхватывается ~/.config/puls/env (формат KEY=value или export KEY=value).
#
# Логи и PID: ~/.local/state/puls/
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/puls"
LOG_DIR="$STATE_DIR"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

mkdir -p "$STATE_DIR"

# --- выбор Node: системный node может не подходить под нативные модули
# (argon2, Prisma). Ищем подходящий интерпретатор явно (nvm, затем PATH).
detect_node() {
  local candidates=()
  # nvm: текущая версия из alias, затем любые установленные (от новых к старым).
  if [ -s "$HOME/.nvm/alias/default" ]; then
    local alias
    alias="$(cat "$HOME/.nvm/alias/default")"
    [ -x "$HOME/.nvm/versions/node/$alias/bin/node" ] && candidates+=("$HOME/.nvm/versions/node/$alias/bin/node")
  fi
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local d
    while IFS= read -r d; do
      candidates+=("$HOME/.nvm/versions/node/$d/bin/node")
    done < <(ls -1 "$HOME/.nvm/versions/node" | sort -Vr)
  fi

  local node
  for node in "${candidates[@]}"; do
    [ -x "$node" ] || continue
    # Нативные модули (argon2) должны загружаться этим интерпретатором.
    if (cd "$REPO_ROOT/apps/api" && "$node" -e "require('argon2'); require('@prisma/client')" >/dev/null 2>&1); then
      echo "$node"
      return 0
    fi
  done
  # Последний шанс — node из PATH.
  if command -v node >/dev/null 2>&1; then echo "$(command -v node)"; return 0; fi
  return 1
}

NODE_BIN="$(detect_node)" || {
  echo "Не найден рабочий Node (>=20, совместимый с нативными модулями)." >&2
  exit 1
}

load_env() {
  # Промышленное окружение, если задано явно, не трогаем.
  if [ -n "${DATABASE_URL:-}" ]; then return 0; fi
  local file raw key val
  for file in "$HOME/.config/puls/env"; do
    [ -f "$file" ] || continue
    while IFS= read -r raw || [ -n "$raw" ]; do
      raw="${raw#"${raw%%[![:space:]]*}"}"
      case "$raw" in ''|\#*) continue ;; esac
      raw="${raw#export }"
      key="${raw%%=*}"
      val="${raw#*=}"
      [ -n "$key" ] || continue
      # Не перетираем переменные, заданные вызывающим окружением.
      if [ -z "${!key+x}" ]; then
        val="${val%\"}"; val="${val#\"}"
        val="${val%\'}"; val="${val#\'}"
        export "$key=$val"
      fi
    done < "$file"
  done
}

configure_env() {
  load_env
  export API_PORT
  # NODE_ENV намеренно не задаём: `next build`/`next start` сами выставляют
  # production, а API без NODE_ENV=production остаётся в dev-режиме (dev-ключ
  # SecretBox, не-secure cookie на http — то, что нужно локальному демо).
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:$API_PORT}"
  export API_INTERNAL_URL="${API_INTERNAL_URL:-http://localhost:$API_PORT}"
  export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:$WEB_PORT}"
}

api_pid_file="$STATE_DIR/api.pid"
web_pid_file="$STATE_DIR/web.pid"
api_log="$LOG_DIR/api.log"
web_log="$LOG_DIR/web.log"

is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_build() {
  local need_api=0 need_web=0
  [ -f "$REPO_ROOT/apps/api/dist/main.js" ] || need_api=1
  # Пересобираем API, если исходники новее сборки.
  if [ "$need_api" -eq 0 ] && [ -n "$(find "$REPO_ROOT/apps/api/src" "$REPO_ROOT/packages/shared/src" -newer "$REPO_ROOT/apps/api/dist/main.js" -print -quit 2>/dev/null)" ]; then
    need_api=1
  fi

  # Web: сборка нужна, если нет .next или исходники новее.
  [ -f "$REPO_ROOT/apps/web/.next/BUILD_ID" ] || need_web=1
  if [ "$need_web" -eq 0 ] && [ -n "$(find "$REPO_ROOT/apps/web/src" "$REPO_ROOT/packages/shared/src" -newer "$REPO_ROOT/apps/web/.next/BUILD_ID" -print -quit 2>/dev/null)" ]; then
    need_web=1
  fi

  if [ "$need_api" -eq 1 ]; then
    echo "→ Сборка API и shared..."
    ( cd "$REPO_ROOT" && PATH="$(dirname "$NODE_BIN"):$PATH" pnpm --filter @puls/shared build && PATH="$(dirname "$NODE_BIN"):$PATH" pnpm --filter @puls/api build ) || return 1
  fi
  if [ "$need_web" -eq 1 ]; then
    echo "→ Сборка web..."
    ( cd "$REPO_ROOT" && PATH="$(dirname "$NODE_BIN"):$PATH" pnpm --filter @puls/shared build && PATH="$(dirname "$NODE_BIN"):$PATH" pnpm --filter @puls/web build ) || return 1
  fi
}

wait_for_health() {
  local url="http://localhost:$API_PORT/health"
  local i=0
  while [ "$i" -lt 60 ]; do
    if curl -sf -m 2 "$url" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

start_one() {
  local which="$1"
  if [ "$which" = "api" ]; then
    if is_running "$api_pid_file"; then echo "API уже запущен (pid $(cat "$api_pid_file"))."; return 0; fi
    echo "→ Старт API (: $API_PORT)"
    ( cd "$REPO_ROOT/apps/api" && nohup "$NODE_BIN" dist/main.js >>"$api_log" 2>&1 & echo $! > "$api_pid_file" )
    if wait_for_health; then
      echo "API готов: http://localhost:$API_PORT/health (pid $(cat "$api_pid_file"))"
    else
      echo "API не ответил на /health за 60 c — смотри $api_log" >&2
      return 1
    fi
  else
    if is_running "$web_pid_file"; then echo "web уже запущен (pid $(cat "$web_pid_file"))."; return 0; fi
    echo "→ Старт web (: $WEB_PORT)"
    ( cd "$REPO_ROOT/apps/web" && nohup "$NODE_BIN" node_modules/next/dist/bin/next start --port "$WEB_PORT" >>"$web_log" 2>&1 & echo $! > "$web_pid_file" )
    local i=0
    while [ "$i" -lt 60 ]; do
      if curl -sf -m 2 "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
        echo "Web готов: http://localhost:$WEB_PORT (pid $(cat "$web_pid_file"))"
        return 0
      fi
      i=$((i + 1)); sleep 1
    done
    echo "web не ответил за 60 c — смотри $web_log" >&2
    return 1
  fi
}

stop_one() {
  local which="$1" pid_file="$2"
  if ! is_running "$pid_file"; then
    echo "$which не запущен."
    rm -f "$pid_file"
    return 0
  fi
  local pid
  pid="$(cat "$pid_file")"
  echo "→ Останов $which (pid $pid)"
  kill "$pid" 2>/dev/null || true
  local i=0
  while [ "$i" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do sleep 0.5; i=$((i + 1)); done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

cmd_status() {
  for pair in "api:$api_pid_file:$API_PORT" "web:$web_pid_file:$WEB_PORT"; do
    local name pid_file port pid state
    IFS=':' read -r name pid_file port <<< "$pair"
    if is_running "$pid_file"; then
      pid="$(cat "$pid_file")"
      state="работает (pid $pid)"
    else
      state="остановлен"
    fi
    local health="-"
    if curl -sf -m 2 "http://localhost:$port/health" >/dev/null 2>&1; then health="OK"; fi
    if [ "$name" = "web" ] && curl -sf -m 2 "http://localhost:$port/" >/dev/null 2>&1; then health="OK"; fi
    printf '%-4s :%s  %s  health=%s\n' "$name" "$port" "$state" "$health"
  done
}

case "${1:-}" in
  start)
    configure_env
    echo "Node: $NODE_BIN"
    ensure_build || { echo "Сборка не удалась." >&2; exit 1; }
    start_one api
    start_one web
    cmd_status
    ;;
  stop)
    target="${2:-both}"
    [ "$target" = "both" ] || [ "$target" = "web" ] || [ "$target" = "api" ] || { echo "stop [api|web]" >&2; exit 1; }
    if [ "$target" = "both" ] || [ "$target" = "api" ]; then stop_one api "$api_pid_file"; fi
    if [ "$target" = "both" ] || [ "$target" = "web" ]; then stop_one web "$web_pid_file"; fi
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    configure_env
    cmd_status
    ;;
  logs)
    which="${2:-both}"
    if [ "$which" = "api" ] || [ "$which" = "both" ]; then
      echo "=== $api_log ==="; tail -n 40 "$api_log" 2>/dev/null || echo "(нет лога)"
    fi
    if [ "$which" = "web" ] || [ "$which" = "both" ]; then
      echo "=== $web_log ==="; tail -n 40 "$web_log" 2>/dev/null || echo "(нет лога)"
    fi
    ;;
  build)
    configure_env
    echo "Node: $NODE_BIN"
    ( cd "$REPO_ROOT" && rm -f apps/api/dist/main.js apps/web/.next/BUILD_ID )
    ensure_build
    ;;
  *)
    echo "Использование: $0 start|stop|status|restart|logs|build [api|web]" >&2
    exit 1
    ;;
esac
