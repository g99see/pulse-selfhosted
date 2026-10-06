#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Автоустановщик «Пульса» одной командой (Debian/Ubuntu, root).
#
#   curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/master/scripts/install.sh \
#     | sudo bash -s -- --domain puls.example.com --email me@example.com
#
#   sudo bash install.sh --http            # локальная сеть, http://<IP сервера>
#
# Скрипт идемпотентен: повторный запуск обновляет код и пересобирает стек,
# существующий .env (секреты) не трогает. `--help` — список опций.
set -euo pipefail
# umask 077 включается точечно (.env, файл с паролем) — код репозитория должен быть читаем.

REPO_DEFAULT='https://github.com/g99see/pulse-selfhosted.git'

DOMAIN=''
ACME_EMAIL=''
HTTP_MODE=0
HOST_IP=''
INSTALL_DIR='/opt/puls'
REPO="$REPO_DEFAULT"
BRANCH='master'
ADMIN_EMAIL=''
# 'admin' зарезервирован схемой nicknameSchema (RESERVED_NICKNAMES) — API отклонит его.
ADMIN_NICK='owner'
NON_INTERACTIVE=0
NO_ADMIN=0
DRY_RUN=0
SMTP_URL_OPT=''
REGISTRATION=''
MODE_SET=0
CRED_FILE='/root/puls-credentials.txt'
LOG_FILE='/var/log/puls-install.log'

if [ -t 1 ]; then
  C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
else
  C_B=''; C_G=''; C_Y=''; C_R=''; C_0=''
fi

step() { printf '%s==>%s %s%s%s\n' "$C_G" "$C_0" "$C_B" "$*" "$C_0"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die() { printf '%s[ошибка]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Автоустановщик «Пульса»: Docker + Caddy + PostgreSQL + Valkey + API + Web.

Использование:
  curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/master/scripts/install.sh \
    | sudo bash -s -- [опции]
  sudo bash install.sh [опции]

Режим HTTPS (домен, сертификаты Let's Encrypt через Caddy):
  --domain D             основной домен (DNS A/AAAA должен вести на сервер)
  --email E              почта для Let's Encrypt

Режим HTTP (локальная сеть, без домена):
  --http                 сайт на :80
  --host IP              адрес сервера (по умолчанию — основной IPv4)

Общие опции:
  --dir PATH             каталог установки (по умолчанию /opt/puls)
  --repo URL             git-репозиторий (по умолчанию GitHub g99see/pulse-selfhosted)
  --branch NAME          ветка (по умолчанию master)
  --admin-email E        почта первого администратора
  --admin-nickname N     ник администратора (по умолчанию owner; admin зарезервирован)
  --no-admin             не создавать администратора (пройдёте мастер в браузере)
  --smtp-url URL         SMTP для писем (smtp://user:pass@host:587); без него письма
                         подтверждения не уходят, регистрация переводится в «invite»
  --registration MODE    режим регистрации: open | invite | closed
                         (по умолчанию: open при SMTP, invite без SMTP)
  -y, --non-interactive  не задавать вопросов
  --dry-run              только показать план, ничего не менять (root не нужен)
  -h, --help             эта справка

Без опций режима в интерактивном терминале установщик спросит, какой режим нужен.
EOF
}

# ---------- разбор аргументов ----------
need_val() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "Опция $1 требует значение"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) need_val "$@"; DOMAIN="$2"; MODE_SET=1; shift 2 ;;
    --email) need_val "$@"; ACME_EMAIL="$2"; shift 2 ;;
    --http) HTTP_MODE=1; MODE_SET=1; shift ;;
    --host) need_val "$@"; HOST_IP="$2"; shift 2 ;;
    --dir) need_val "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --repo) need_val "$@"; REPO="$2"; shift 2 ;;
    --branch) need_val "$@"; BRANCH="$2"; shift 2 ;;
    --admin-email) need_val "$@"; ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-nickname) need_val "$@"; ADMIN_NICK="$2"; shift 2 ;;
    --smtp-url) need_val "$@"; SMTP_URL_OPT="$2"; shift 2 ;;
    --registration) need_val "$@"; REGISTRATION="$2"; shift 2 ;;
    --non-interactive|-y) NON_INTERACTIVE=1; shift ;;
    --no-admin) NO_ADMIN=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Неизвестная опция: $1" ;;
  esac
done

case "$REGISTRATION" in ''|open|invite|closed) ;; *) die "--registration: open | invite | closed" ;; esac
# Те же правила, что у API (packages/shared/src/auth.ts): 3–32 символа, латиница,
# цифры, дефис, подчёркивание; служебные имена зарезервированы.
ADMIN_NICK=$(printf '%s' "$ADMIN_NICK" | tr '[:upper:]' '[:lower:]')
[[ "$ADMIN_NICK" =~ ^[a-z0-9_-]{3,32}$ ]] || die '--admin-nickname: 3–32 символа, латиница, цифры, - и _'
case "$ADMIN_NICK" in
  admin|api|app|assets|favicon|health|help|login|logout|me|onboarding|register|robots|sessions|settings|signin|signup|static|support|user|users|verify-email|www)
    die "--admin-nickname: «$ADMIN_NICK» зарезервирован, выберите другой" ;;
esac
if [ "$HTTP_MODE" = 1 ] && [ -n "$DOMAIN" ]; then die 'Нельзя одновременно --http и --domain'; fi

# ---------- интерактив ----------
have_tty() { [ "$NON_INTERACTIVE" = 0 ] && [ -r /dev/tty ] && ( : </dev/tty ) 2>/dev/null; }
ask() { # ask "вопрос" "по умолчанию" -> stdout
  local q="$1" def="${2:-}" ans=''
  if have_tty; then
    if [ -n "$def" ]; then printf '%s [%s]: ' "$q" "$def" >/dev/tty; else printf '%s: ' "$q" >/dev/tty; fi
    IFS= read -r ans </dev/tty || ans=''
  fi
  printf '%s' "${ans:-$def}"
}

detect_ip() {
  local ip=''
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  printf '%s' "$ip"
}

if [ "$MODE_SET" = 0 ]; then
  # Повторный запуск без опций: берём режим из существующего .env.
  if [ -f "$INSTALL_DIR/.env" ] && grep -q '^CADDYFILE=' "$INSTALL_DIR/.env" 2>/dev/null; then
    if grep -q '^CADDYFILE=Caddyfile.http' "$INSTALL_DIR/.env"; then
      HTTP_MODE=1
      HOST_IP=${HOST_IP:-$(sed -n 's#^PUBLIC_ORIGIN=http://\([^:/]*\).*#\1#p' "$INSTALL_DIR/.env" | head -n1)}
    else
      DOMAIN=$(sed -n 's/^DOMAIN=//p' "$INSTALL_DIR/.env" | head -n1)
      ACME_EMAIL=${ACME_EMAIL:-$(sed -n 's/^ACME_EMAIL=//p' "$INSTALL_DIR/.env" | head -n1)}
    fi
    MODE_SET=1
    info "Режим взят из существующего $INSTALL_DIR/.env"
  elif have_tty; then
    echo 'Выберите режим установки:'
    echo '  1) HTTPS с доменом (Let'"'"'s Encrypt)'
    echo '  2) HTTP в локальной сети по IP (без домена)'
    choice=$(ask 'Режим' '2')
    if [ "$choice" = 1 ]; then
      DOMAIN=$(ask 'Основной домен (например puls.example.com)' '')
    else
      HTTP_MODE=1
    fi
    MODE_SET=1
  else
    HTTP_MODE=1
    warn 'Режим не указан и нет терминала — использую --http (локальная сеть).'
  fi
fi

if [ "$HTTP_MODE" = 1 ]; then
  [ -n "$HOST_IP" ] || HOST_IP=$(detect_ip)
  if [ -z "$HOST_IP" ]; then
    HOST_IP=$(ask 'Не удалось определить IP сервера. Введите адрес' '')
  fi
  [ -n "$HOST_IP" ] || die 'Не удалось определить адрес сервера: укажите --host IP'
  PUBLIC_ORIGIN="http://${HOST_IP}"
  CADDYFILE='Caddyfile.http'
  COOKIE_SECURE='false'
  DOMAIN_ENV='localhost'
  ACME_EMAIL=${ACME_EMAIL:-admin@example.com}
  PORTS=(80)
  MAIN_URL="$PUBLIC_ORIGIN"
else
  if [ -z "$DOMAIN" ]; then DOMAIN=$(ask 'Основной домен (например puls.example.com)' ''); fi
  [ -n "$DOMAIN" ] || die 'Для режима HTTPS нужен --domain (или используйте --http)'
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Некорректный домен: $DOMAIN"
  if [ -z "$ACME_EMAIL" ]; then ACME_EMAIL=$(ask 'Почта для Let'"'"'s Encrypt' "${ADMIN_EMAIL}"); fi
  [ -n "$ACME_EMAIL" ] || die 'Для режима HTTPS нужен --email (почта для Let'"'"'s Encrypt)'
  PUBLIC_ORIGIN="https://${DOMAIN}"
  CADDYFILE='Caddyfile'
  COOKIE_SECURE='true'
  DOMAIN_ENV="$DOMAIN"
  PORTS=(80 443)
  MAIN_URL="$PUBLIC_ORIGIN"
fi

if [ -z "$ADMIN_EMAIL" ] && [ "$NO_ADMIN" = 0 ]; then
  if [ "$HTTP_MODE" = 1 ]; then def_mail='admin@puls.local'; else def_mail="admin@${DOMAIN}"; fi
  ADMIN_EMAIL=$(ask 'Почта первого администратора' "$def_mail")
  ADMIN_EMAIL=${ADMIN_EMAIL:-$def_mail}
fi

# ---------- dry-run ----------
if [ "$DRY_RUN" = 1 ]; then
  step 'План установки (--dry-run, ничего не изменяется)'
  info "Режим:            $([ "$HTTP_MODE" = 1 ] && echo "HTTP (локальная сеть, Caddyfile.http)" || echo "HTTPS (Let's Encrypt, Caddyfile)")"
  info "Каталог:          $INSTALL_DIR"
  info "Репозиторий:      $REPO (ветка $BRANCH)"
  info "Адрес сайта:      $MAIN_URL"
  if [ "$HTTP_MODE" != 1 ]; then
    info "Почта ACME:       $ACME_EMAIL"
  fi
  info "Порты (проверка): ${PORTS[*]}"
  info 'Шаги: проверки → apt (curl git openssl iproute2) → Docker (если нет) → git clone/pull'
  info '      → .env (только при первой установке) → docker compose up -d --build'
  info '      → ожидание health → создание администратора'
  if [ "$NO_ADMIN" = 1 ]; then
    info 'Администратор:    не создаётся (--no-admin)'
  else
    info "Администратор:    $ADMIN_EMAIL / $ADMIN_NICK; пароль → $CRED_FILE"
  fi
  info "SMTP:             ${SMTP_URL_OPT:+задан}${SMTP_URL_OPT:-нет (регистрация → ${REGISTRATION:-invite})}"
  exit 0
fi

# ---------- проверки окружения ----------
[ "$(id -u)" = 0 ] || die 'Запустите от root: sudo bash install.sh ...'

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
: >>"$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/puls-install.log"
info "Подробный лог сборки: $LOG_FILE"

step 'Проверяю систему'
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*) info "ОС: ${PRETTY_NAME:-$ID}" ;;
    *) warn "ОС ${PRETTY_NAME:-неизвестна} не Debian/Ubuntu: установка пакетов может не сработать." ;;
  esac
else
  warn 'Не найден /etc/os-release — не могу определить ОС.'
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|aarch64|arm64) info "Архитектура: $ARCH" ;;
  *) warn "Архитектура $ARCH не проверялась; образы node/postgres/caddy могут быть недоступны." ;;
esac

MEM_KB=$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
SWAP_KB=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
info "RAM: $((MEM_KB / 1024)) МБ, swap: $((SWAP_KB / 1024)) МБ"
if [ "$((MEM_KB + SWAP_KB))" -lt 1900000 ]; then
  warn 'Для сборки нужно около 2 ГБ памяти (RAM + swap). Добавьте swap, иначе сборка может упасть:'
  warn '  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile'
fi

mkdir -p "$INSTALL_DIR"
FREE_KB=$(df -Pk "$INSTALL_DIR" | awk 'NR==2{print $4}')
info "Свободно на диске: $((FREE_KB / 1024)) МБ"
[ "$FREE_KB" -ge 8000000 ] || die 'Нужно минимум 8 ГБ свободного места (образы Docker и сборка).'

# ---------- пакеты и Docker ----------
step 'Устанавливаю зависимости (ca-certificates curl git openssl iproute2)'
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >>"$LOG_FILE" 2>&1 || warn 'apt-get update завершился с ошибкой (см. лог), продолжаю.'
  apt-get install -y -qq ca-certificates curl git openssl iproute2 >>"$LOG_FILE" 2>&1 \
    || die "Не удалось установить пакеты через apt. См. $LOG_FILE"
else
  for c in curl git openssl; do command -v "$c" >/dev/null 2>&1 || die "Нет apt-get и не найден $c — установите вручную."; done
fi

step 'Проверяю Docker'
if docker compose version >/dev/null 2>&1; then
  info "Docker уже установлен: $(docker --version)"
else
  info 'Устанавливаю Docker через get.docker.com (1–3 минуты)...'
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh || die 'Не удалось скачать get.docker.com'
  sh /tmp/get-docker.sh >>"$LOG_FILE" 2>&1 || die "Установка Docker не удалась. См. $LOG_FILE"
  rm -f /tmp/get-docker.sh
  docker compose version >/dev/null 2>&1 || die 'Плагин «docker compose» не установился.'
fi
systemctl enable --now docker >>"$LOG_FILE" 2>&1 || warn 'Не удалось включить службу docker через systemctl (в контейнере это нормально).'
docker info >/dev/null 2>&1 || die 'Демон Docker не отвечает. В Proxmox LXC включите features: nesting=1,keyctl=1.'

# ---------- код ----------
step "Получаю код в $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH" >>"$LOG_FILE" 2>&1 || warn 'git fetch не удался'
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH" >>"$LOG_FILE" 2>&1 || true
  git -C "$INSTALL_DIR" pull --ff-only --quiet >>"$LOG_FILE" 2>&1 \
    || die "git pull --ff-only не удался (локальные изменения?). См. $LOG_FILE"
  info 'Репозиторий обновлён (git pull --ff-only)'
elif [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  git clone --quiet --branch "$BRANCH" "$REPO" "$INSTALL_DIR" >>"$LOG_FILE" 2>&1 \
    || die "git clone не удался: $REPO ($BRANCH). См. $LOG_FILE"
  info 'Репозиторий склонирован'
else
  die "$INSTALL_DIR не пуст и не является git-репозиторием. Укажите другой --dir."
fi
cd "$INSTALL_DIR"
[ -f docker-compose.yml ] && [ -f .env.example ] || die 'В репозитории нет docker-compose.yml / .env.example'
[ -f "$CADDYFILE" ] || die "В репозитории нет $CADDYFILE (устаревшая ветка?)"

# ---------- .env ----------
# set_env KEY VALUE — заменяет или добавляет строку KEY=VALUE (значение не показываем).
set_env() {
  local key="$1" val="$2" tmp
  tmp=$(mktemp)
  grep -v "^${key}=" .env >"$tmp" || true
  printf '%s=%s\n' "$key" "$val" >>"$tmp"
  cat "$tmp" >.env
  rm -f "$tmp"
}
get_env() { sed -n "s/^$1=//p" .env | head -n1; }
rand_alnum() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }

if [ -f .env ]; then
  step 'Найден .env — секреты и настройки сохраняю без изменений'
else
  step 'Генерирую .env'
  ( umask 077; cp .env.example .env )
  chmod 600 .env
  PG_PASS=$(rand_alnum 32)
  set_env POSTGRES_PASSWORD "$PG_PASS"
  set_env DATABASE_URL "postgresql://puls:${PG_PASS}@postgres:5432/puls?schema=public"
  set_env REDIS_URL 'redis://valkey:6379'
  set_env APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  set_env NODE_ENV production
  set_env DOMAIN "$DOMAIN_ENV"
  set_env ACME_EMAIL "$ACME_EMAIL"
  set_env PUBLIC_ORIGIN "$PUBLIC_ORIGIN"
  # "/" — браузер ходит в API на том же origin (работает по LAN и по Tailscale).
  set_env PUBLIC_API_URL "/"
  set_env NEXT_PUBLIC_API_URL "/"
  set_env CORS_ORIGIN "$PUBLIC_ORIGIN"
  set_env COOKIE_SECURE "$COOKIE_SECURE"
  set_env CADDYFILE "$CADDYFILE"
  set_env SMTP_URL "$SMTP_URL_OPT"
  chmod 600 .env
  info '.env создан (chmod 600)'
fi

# Актуальные значения для сводки и проверок (из .env, а не из аргументов).
CADDYFILE=$(get_env CADDYFILE); CADDYFILE=${CADDYFILE:-Caddyfile}
if [ "$CADDYFILE" = 'Caddyfile.http' ]; then
  HTTP_MODE=1
  PUBLIC_ORIGIN=$(get_env PUBLIC_ORIGIN)
  PORTS=(80)
else
  HTTP_MODE=0
  PUBLIC_ORIGIN=$(get_env PUBLIC_ORIGIN)
  PORTS=(80 443)
fi
MAIN_URL="$PUBLIC_ORIGIN"
SMTP_NOW=$(get_env SMTP_URL)

# ---------- порты ----------
step "Проверяю порты: ${PORTS[*]}"
OWN_CADDY=''
OWN_CADDY=$(docker compose ps -q caddy 2>/dev/null || true)
for p in "${PORTS[@]}"; do
  if ss -ltn 2>/dev/null | awk -v p=":$p" '$4 ~ p"$" {f=1} END{exit !f}'; then
    if [ -n "$OWN_CADDY" ]; then
      info "Порт $p занят нашим контейнером caddy — это нормально (повторный запуск)"
    else
      ss -ltnp 2>/dev/null | awk -v p=":$p" '$4 ~ p"$"' >&2 || true
      die "Порт $p уже занят другим процессом. Освободите его или задайте HTTP_PORT/HTTPS_PORT/CADDY_BIND в $INSTALL_DIR/.env и повторите."
    fi
  fi
done

# ---------- сборка и запуск ----------
step 'Собираю и запускаю стек (первая сборка — 10–20 минут)'
BUILD_LOG=$(mktemp)
docker compose up -d --build >"$BUILD_LOG" 2>&1 &
UP_PID=$!
T0=$(date +%s)
while kill -0 "$UP_PID" 2>/dev/null; do
  sleep 15
  kill -0 "$UP_PID" 2>/dev/null || break
  last=$(tail -n 1 "$BUILD_LOG" | tr -d '\r' | cut -c1-100)
  info "[$(( $(date +%s) - T0 )) c] ${last:-сборка идёт...}"
done
if ! wait "$UP_PID"; then
  cat "$BUILD_LOG" >>"$LOG_FILE"
  tail -n 40 "$BUILD_LOG" >&2
  docker compose logs --tail 80 api web caddy >&2 || true
  die "docker compose up не удался. Полный вывод: $LOG_FILE"
fi
cat "$BUILD_LOG" >>"$LOG_FILE"; rm -f "$BUILD_LOG"
info 'Контейнеры запущены, жду готовности...'

health_of() { # имя сервиса -> running/healthy статус
  local id; id=$(docker compose ps -q "$1" 2>/dev/null | head -n1)
  [ -n "$id" ] || { echo 'absent'; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo 'unknown'
}

DEADLINE=$(( $(date +%s) + 1200 ))
while :; do
  st_api=$(health_of api); st_web=$(health_of web); st_caddy=$(health_of caddy)
  if [ "$st_api" = healthy ] && [ "$st_web" = healthy ]; then
    if [ "$HTTP_MODE" = 1 ]; then
      code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1/health 2>/dev/null || echo 000)
    else
      code=$(curl -s -o /dev/null -m 5 -H "Host: $(get_env DOMAIN)" -w '%{http_code}' http://127.0.0.1/health 2>/dev/null || echo 000)
    fi
    # HTTP-режим: 200 напрямую. HTTPS-режим: Caddy отвечает редиректом 308 на http://.
    if [ "$code" = 200 ] || [ "$code" = 308 ] || [ "$code" = 301 ]; then
      info "api: $st_api, web: $st_web, caddy: $st_caddy, HTTP $code"
      break
    fi
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    warn "Таймаут ожидания: api=$st_api web=$st_web caddy=$st_caddy"
    docker compose logs --tail 80 api web caddy >&2 || true
    die 'Сервисы не стали здоровыми за 20 минут.'
  fi
  case "$st_api$st_web" in *unhealthy*|*exited*|*dead*)
    warn "Проблема: api=$st_api web=$st_web caddy=$st_caddy"
    docker compose logs --tail 80 api web caddy >&2 || true
    die 'Сервис завершился с ошибкой.' ;;
  esac
  info "api: $st_api, web: $st_web, caddy: $st_caddy — жду..."
  sleep 10
done

# ---------- первый администратор ----------
ADMIN_STATE='skipped'
if [ "$NO_ADMIN" = 0 ]; then
  step 'Создаю первого администратора'
  # Запросы идут из контейнера api на localhost:3001: работает до выпуска сертификата
  # и без DNS. CSRF double-submit: GET /api/auth/csrf → cookie puls_csrf + заголовок.
  SETUP_JS='
const fs = require("fs");
const inp = JSON.parse(fs.readFileSync(0, "utf8"));
const base = "http://127.0.0.1:3001/api";
(async () => {
  const st = await (await fetch(base + "/setup/status")).json();
  if (!st.needsSetup) { console.log("ALREADY"); return; }
  const r = await fetch(base + "/auth/csrf");
  const { csrfToken } = await r.json();
  const res = await fetch(base + "/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken, cookie: "puls_csrf=" + csrfToken },
    body: JSON.stringify({ email: inp.email, password: inp.password, nickname: inp.nickname, locale: "ru" }),
  });
  console.log(res.status === 201 ? "CREATED" : "FAILED " + res.status + " " + (await res.text()).slice(0, 300));
})().catch((e) => { console.log("FAILED " + e.message); });
'
  ADMIN_PASS=$(rand_alnum 24)
  RESULT=$(printf '{"email":"%s","password":"%s","nickname":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASS" "$ADMIN_NICK" \
    | docker compose exec -T api node -e "$SETUP_JS" 2>>"$LOG_FILE" | tail -n 1 || true)
  case "$RESULT" in
    CREATED)
      ADMIN_STATE='created'
      (
        umask 077
        {
        echo "Пульс — первый администратор"
        echo "URL:      $MAIN_URL"
        echo "Email:    $ADMIN_EMAIL"
        echo "Никнейм:  $ADMIN_NICK"
        echo "Пароль:   $ADMIN_PASS"
        echo "Создано:  $(date -Is)"
        } >"$CRED_FILE"
      )
      chmod 600 "$CRED_FILE"
      info "Администратор создан: $ADMIN_EMAIL (данные для входа: $CRED_FILE)"
      # Без SMTP письма подтверждения не уходят — ограничиваем саморегистрацию.
      MODE_WANTED="$REGISTRATION"
      [ -n "$MODE_WANTED" ] || { [ -n "$SMTP_NOW" ] || MODE_WANTED='invite'; }
      if [ -n "$MODE_WANTED" ] && [ "$MODE_WANTED" != open ]; then
        PGU=$(get_env POSTGRES_USER); PGD=$(get_env POSTGRES_DB)
        if docker compose exec -T postgres psql -q -U "${PGU:-puls}" -d "${PGD:-puls}" \
          -c "UPDATE instance_settings SET registration_mode='${MODE_WANTED}' WHERE id='instance'" >>"$LOG_FILE" 2>&1; then
          info "Режим регистрации: $MODE_WANTED"
        else
          warn "Не удалось выставить режим регистрации $MODE_WANTED — сделайте это в админке."
        fi
      fi
      ;;
    ALREADY)
      ADMIN_STATE='exists'
      info 'Мастер первого запуска уже пройден — администратор существует, пароль не меняю.'
      ;;
    *)
      ADMIN_STATE='failed'
      warn "Не удалось создать администратора: ${RESULT:-нет ответа}. Пройдите мастер в браузере: $MAIN_URL/setup"
      ;;
  esac
fi

# ---------- итог ----------
echo
step 'Готово'
info "Сайт:           $MAIN_URL"
if [ "$HTTP_MODE" = 1 ]; then
  info 'Режим http: без шифрования, только для доверенной локальной сети.'
else
  info 'Сертификат Let'"'"'s Encrypt выпускается при первом обращении, до минуты'
fi
case "$ADMIN_STATE" in
  created) info "Администратор:  $ADMIN_EMAIL, пароль — в $CRED_FILE (chmod 600)" ;;
  exists)  info 'Администратор:  уже был создан ранее' ;;
  failed)  info "Администратор:  не создан — откройте $MAIN_URL/setup" ;;
esac
if [ -z "$SMTP_NOW" ]; then
  warn 'SMTP не настроен: письма подтверждения не отправляются, новые пользователи не смогут'
  warn 'подтвердить email. Регистрация ограничена (invite): профили создаёт администратор'
  warn "  командой $INSTALL_DIR/scripts/users.sh add. Чтобы включить почту, задайте SMTP_URL в .env и выполните"
  warn "  cd $INSTALL_DIR && docker compose up -d api"
fi
info "Новый профиль:  sudo $INSTALL_DIR/scripts/users.sh add <email> <ник>   (все команды: users.sh help)"
info "Обновление:     cd $INSTALL_DIR && sudo bash scripts/upgrade.sh"
info "Бэкапы:         $INSTALL_DIR/backups (ежедневно, хранится 7 копий)"
info "Логи:           cd $INSTALL_DIR && docker compose logs -f --tail 100 api web caddy"
info "Конфигурация:   $INSTALL_DIR/.env (chmod 600)"
