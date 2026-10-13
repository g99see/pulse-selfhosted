#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# «Пульс» — установщик в LXC-контейнер Proxmox VE (запускать НА хосте PVE, root).
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/main/deploy/proxmox/puls-lxc.sh)"
#
# Скрипт создаёт НЕпривилегированный LXC (Debian 12/13, features nesting=1,keyctl=1 —
# обязательны для Docker), ставит Docker + Compose, кладёт исходники «Пульса»,
# генерирует .env с секретами, поднимает стек и ждёт healthcheck. Идемпотентен:
# повторный запуск не пересоздаёт контейнер.
#
# Переопределяется переменными окружения (CTID, CT_HOSTNAME, CT_RAM, ...) или флагами.
#   --update    — обновить стек внутри контейнера (scripts/upgrade.sh)
#   --uninstall — остановить и удалить контейнер
#   --help      — все опции
set -euo pipefail

# ------------------------- значения по умолчанию -------------------------
# Всё ниже можно переопределить переменной окружения или флагом командной строки.
CTID="${CTID:-}"                       # пусто — следующий свободный
CT_HOSTNAME="${CT_HOSTNAME:-puls}"
CT_CORES="${CT_CORES:-2}"
CT_RAM="${CT_RAM:-2048}"               # МБ (2048–4096)
CT_SWAP="${CT_SWAP:-512}"
CT_DISK="${CT_DISK:-16}"               # ГБ
CT_STORAGE="${CT_STORAGE:-}"           # пусто — автоопределение (lvmthin)
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_IP="${CT_IP:-}"                     # статический адрес "192.168.1.50/24" (пусто — DHCP)
CT_GW="${CT_GW:-}"                     # шлюз для статики
CT_NAMESERVER="${CT_NAMESERVER:-1.1.1.1}"
CT_PASSWORD="${CT_PASSWORD:-}"         # пароль root в контейнере (пусто — без пароля)
SSH_PUBKEY="${SSH_PUBKEY:-}"           # открытый ключ root (файл или строка)
TEMPLATE="${TEMPLATE:-}"               # шаблон pveam (пусто — авто)
REPO_URL="${REPO_URL:-https://github.com/g99see/pulse-selfhosted.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SOURCE_TARBALL="${SOURCE_TARBALL:-}"   # локальный .tar.gz исходников (GitHub недоступен)
APP_DIR="${APP_DIR:-/opt/puls}"
TS_SERVE="${TS_SERVE:-0}"              # 1 — включить tailscale serve (HTTPS)
TS_HOSTNAME="${TS_HOSTNAME:-puls}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NICK="${ADMIN_NICK:-owner}"
ASSUME_YES="${ASSUME_YES:-0}"
ACTION="${ACTION:-install}"            # install | update | uninstall | plan

if [ -t 1 ]; then
  C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
else
  C_B=''; C_G=''; C_Y=''; C_R=''; C_0=''
fi
step() { printf '%s==>%s %s%s%s\n' "$C_G" "$C_0" "$C_B" "$*" "$C_0"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die()  { printf '%s[ошибка]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
«Пульс» в LXC Proxmox VE. Запускать на хосте PVE от root.

  bash -c "$(curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/main/deploy/proxmox/puls-lxc.sh)"

Опции:
  --ctid ID            ID контейнера (по умолчанию — следующий свободный)
  --hostname NAME      имя хоста контейнера (puls)
  --cores N            ядра (2)
  --ram МБ             память (2048; рекомендуется 2048–4096)
  --disk ГБ            размер диска (16)
  --storage NAME       хранилище rootfs (авто: lvmthin)
  --bridge BR          сетевой мост (vmbr0)
  --ip CIDR            статический адрес, напр. 192.168.1.50/24 (без него — DHCP)
  --gw GW              шлюз для статического адреса
  --nameserver NS      DNS внутри контейнера (1.1.1.1; resolv.conf от PVE бывает битым)
  --password PASS      пароль root в контейнере
  --ssh-key FILE|STR   открытый SSH-ключ root
  --template NAME      шаблон pveam (авто: debian-13-standard)
  --repo URL           git-репозиторий (https://github.com/g99see/pulse-selfhosted.git)
  --branch NAME        ветка (main)
  --tarball PATH       локальный .tar.gz исходников вместо git clone
                       (когда GitHub недоступен; также SOURCE_TARBALL)
  --dir PATH           каталог установки внутри контейнера (/opt/puls)
  --tailscale          включить tailscale serve (HTTPS .ts.net) — интерактивно
  --admin-email E      почта первого администратора
  --admin-nickname N   ник администратора (owner; admin зарезервирован)
  --update             обновить уже установленный стек (пропускает создание)
  --uninstall          остановить и удалить контейнер
  --plan               показать план, ничего не менять
  -y, --yes            не задавать вопросов
  -h, --help           эта справка
EOF
}

# ------------------------- разбор аргументов -------------------------
need_val() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "Опция $1 требует значение"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ctid) need_val "$@"; CTID="$2"; shift 2 ;;
    --hostname) need_val "$@"; CT_HOSTNAME="$2"; shift 2 ;;
    --cores) need_val "$@"; CT_CORES="$2"; shift 2 ;;
    --ram) need_val "$@"; CT_RAM="$2"; shift 2 ;;
    --disk) need_val "$@"; CT_DISK="$2"; shift 2 ;;
    --storage) need_val "$@"; CT_STORAGE="$2"; shift 2 ;;
    --bridge) need_val "$@"; CT_BRIDGE="$2"; shift 2 ;;
    --ip) need_val "$@"; CT_IP="$2"; shift 2 ;;
    --gw) need_val "$@"; CT_GW="$2"; shift 2 ;;
    --dhcp) CT_IP=''; shift ;;
    --nameserver) need_val "$@"; CT_NAMESERVER="$2"; shift 2 ;;
    --password) need_val "$@"; CT_PASSWORD="$2"; shift 2 ;;
    --ssh-key) need_val "$@"; SSH_PUBKEY="$2"; shift 2 ;;
    --template) need_val "$@"; TEMPLATE="$2"; shift 2 ;;
    --repo) need_val "$@"; REPO_URL="$2"; shift 2 ;;
    --branch) need_val "$@"; REPO_BRANCH="$2"; shift 2 ;;
    --tarball) need_val "$@"; SOURCE_TARBALL="$2"; shift 2 ;;
    --dir) need_val "$@"; APP_DIR="$2"; shift 2 ;;
    --tailscale) TS_SERVE=1; shift ;;
    --admin-email) need_val "$@"; ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-nickname) need_val "$@"; ADMIN_NICK="$2"; shift 2 ;;
    --update) ACTION=update; shift ;;
    --uninstall) ACTION=uninstall; shift ;;
    --plan|--dry-run) ACTION=plan; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Неизвестная опция: $1" ;;
  esac
done

# ------------------------- интерактив -------------------------
have_tty() { [ "$ASSUME_YES" = 0 ] && [ -r /dev/tty ] && ( : </dev/tty ) 2>/dev/null; }
ask() { # ask "вопрос" "по умолчанию" -> stdout
  local q="$1" def="${2:-}" ans=''
  if have_tty; then
    if [ -n "$def" ]; then printf '%s [%s]: ' "$q" "$def" >/dev/tty; else printf '%s: ' "$q" >/dev/tty; fi
    IFS= read -r ans </dev/tty || ans=''
  fi
  printf '%s' "${ans:-$def}"
}

# ======================= вспомогательные функции PVE =======================
require_pve() {
  command -v pct >/dev/null 2>&1 || die 'Не найден pct — запускайте на хосте Proxmox VE.'
  command -v pvesm >/dev/null 2>&1 || die 'Не найден pvesm — запускайте на хосте Proxmox VE.'
}

find_next_ctid() {
  local id=''
  id=$(pvesh get /cluster/nextid 2>/dev/null || true)
  if ! printf '%s' "$id" | grep -qE '^[0-9]+$'; then
    # Резервный перебор от 100.
    id=100
    while pct status "$id" >/dev/null 2>&1; do id=$((id + 1)); done
  fi
  printf '%s' "$id"
}

detect_storage() {
  local s=''
  s=$(pvesm status -content images 2>/dev/null | awk 'NR>1 && $2=="lvmthin"{print $1; exit}')
  [ -n "$s" ] || s=$(pvesm status -content images 2>/dev/null | awk 'NR>1{print $1; exit}')
  printf '%s' "$s"
}

ensure_template() {
  local avail=''
  if [ -n "$TEMPLATE" ]; then info "Шаблон (задан): $TEMPLATE"; return 0; fi
  TEMPLATE=$(pveam list local 2>/dev/null | awk '/debian-13-standard/{print $1; exit}')
  [ -n "$TEMPLATE" ] || TEMPLATE=$(pveam list local 2>/dev/null | awk '/debian-12-standard/{print $1; exit}')
  [ -n "$TEMPLATE" ] || TEMPLATE=$(pveam list local 2>/dev/null | awk '/debian-.*-standard/{print $1; exit}')
  if [ -z "$TEMPLATE" ]; then
    step 'Шаблон Debian не найден локально — скачиваю'
    pveam update >/dev/null 2>&1 || true
    avail=$(pveam available --section system 2>/dev/null | awk '/debian-13-standard/{print $2; exit}')
    [ -n "$avail" ] || avail=$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/{print $2; exit}')
    [ -n "$avail" ] || die 'Не удалось найти шаблон Debian в pveam.'
    pveam download local "$avail" >/dev/null 2>&1 || die "pveam download local $avail не удался"
    TEMPLATE="local:vztmpl/$avail"
  fi
  info "Шаблон: $TEMPLATE"
}

ct_ip_addr() { # → адрес контейнера (без маски)
  local raw=''
  if [ -n "$CT_IP" ]; then printf '%s' "${CT_IP%%/*}"; return; fi
  raw=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | head -n1)
  printf '%s' "${raw%%/*}"
}

wait_network() {
  local deadline=$(( $(date +%s) + 90 )) ip
  step 'Жду сеть в контейнере'
  while :; do
    ip=$(ct_ip_addr)
    if [ -n "$ip" ] && pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1'; then
      info "Сеть готова: $ip"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      warn "Сеть не поднялась (IP=${ip:-нет}). Проверьте мост $CT_BRIDGE и DNS."
      return 1
    fi
    sleep 3
  done
}

# ======================= действия =======================
do_plan() {
  step 'План (--plan, ничего не изменяется)'
  info "Действие:        $ACTION"
  info "Контейнер:       ID=${CTID:-<следующий>} имя=${CT_HOSTNAME} unprivileged, nesting=1,keyctl=1"
  info "Ресурсы:         cores=${CT_CORES} ram=${CT_RAM}МБ swap=${CT_SWAP}МБ disk=${CT_DISK}ГБ"
  info "Хранилище:       ${CT_STORAGE:-<авто: lvmthin>}"
  if [ -n "$CT_IP" ]; then
    info "Сеть:            статика ${CT_IP} gw=${CT_GW:-?} bridge=${CT_BRIDGE}"
  else
    info "Сеть:            DHCP bridge=${CT_BRIDGE}"
  fi
  info "DNS:             $CT_NAMESERVER"
  info "Источник:        ${SOURCE_TARBALL:-$REPO_URL ($REPO_BRANCH)}"
  info "Каталог:         $APP_DIR"
  info "Tailscale serve: $([ "$TS_SERVE" = 1 ] && echo да || echo нет)"
  info 'Шаги: pveam template → pct create → pct start → apt (curl git openssl)'
  info '      → Docker (get.docker.com) → исходники → .env → docker compose up -d'
  info '      → ожидание healthcheck → первый администратор → вывод URL'
}

do_update() {
  [ -n "$CTID" ] || die 'Для --update укажите --ctid ID'
  pct status "$CTID" >/dev/null 2>&1 || die "Контейнер $CTID не найден"
  step "Обновляю «Пульс» в CT $CTID"
  pct exec "$CTID" -- bash -c "cd '$APP_DIR' && bash scripts/upgrade.sh"
  step 'Обновление завершено'
}

do_uninstall() {
  [ -n "$CTID" ] || die 'Для --uninstall укажите --ctid ID'
  pct status "$CTID" >/dev/null 2>&1 || die "Контейнер $CTID не найден"
  local name
  name=$(pct config "$CTID" 2>/dev/null | awk -F': ' '/^hostname/{print $2}')
  if [ "$ASSUME_YES" = 0 ]; then
    local ans
    ans=$(ask "Удалить контейнер $CTID ($name) со ВСЕМИ данными? введите yes" '')
    [ "$ans" = yes ] || die 'Отменено.'
  fi
  step "Удаляю контейнер $CTID"
  pct stop "$CTID" >/dev/null 2>&1 || warn 'pct stop не удался (уже остановлен?)'
  pct destroy "$CTID" >/dev/null 2>&1 || die "pct destroy $CTID не удался"
  step "Контейнер $CTID удалён"
}

do_install() {
  [ "$(id -u)" = 0 ] || die 'Запустите от root (или через sudo).'
  require_pve

  if [ -n "$CTID" ] && pct status "$CTID" >/dev/null 2>&1; then
    step "Контейнер $CTID уже существует — использую его (идемпотентно)"
  else
    [ -n "$CTID" ] || CTID=$(find_next_ctid)
    [ -n "$CT_STORAGE" ] || CT_STORAGE=$(detect_storage)
    [ -n "$CT_STORAGE" ] || die 'Не найдено хранилище с content=images. Укажите --storage.'
    ensure_template

    # Сеть: статика требует шлюз.
    local netip='dhcp'
    if [ -n "$CT_IP" ]; then
      [ -n "$CT_GW" ] || die 'Со статическим --ip нужен --gw (шлюз).'
      netip="${CT_IP},gw=${CT_GW}"
    fi

    step "Создаю LXC $CTID ($CT_HOSTNAME) — unprivileged, nesting=1,keyctl=1"
    info "cores=$CT_CORES ram=${CT_RAM}МБ disk=${CT_DISK}ГБ storage=$CT_STORAGE bridge=$CT_BRIDGE ip=$netip"
    # shellcheck disable=SC2054  # значения вида nesting=1,keyctl=1 — это один аргумент, не список
    local -a PCT_ARGS=(
      "$CTID" "$TEMPLATE"
      --hostname "$CT_HOSTNAME"
      --cores "$CT_CORES"
      --memory "$CT_RAM"
      --swap "$CT_SWAP"
      --rootfs "${CT_STORAGE}:${CT_DISK}"
      --net0 "name=eth0,bridge=${CT_BRIDGE},ip=${netip},type=veth"
      --nameserver "$CT_NAMESERVER"
      --ostype debian
      --arch amd64
      --unprivileged 1
      --features nesting=1,keyctl=1
      --onboot 1
      --description 'Пульс (pulse-selfhosted): финансы и самочувствие, Docker Compose'
    )
    if [ -n "$CT_PASSWORD" ]; then PCT_ARGS+=( --password "$CT_PASSWORD" ); fi
    if [ -n "$SSH_PUBKEY" ]; then PCT_ARGS+=( --ssh-public-keys "$SSH_PUBKEY" ); fi
    pct create "${PCT_ARGS[@]}" || die 'pct create не удался'

    # Tailscale нужен /dev/net/tun (Фаза 4, ТЗ §6). Добавляем до запуска.
    if [ "$TS_SERVE" = 1 ]; then
      step 'Пробрасываю /dev/net/tun в контейнер (для Tailscale)'
      {
        echo 'lxc.cgroup2.devices.allow: c 10:200 rwm'
        echo 'lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file'
      } >>"/etc/pve/lxc/${CTID}.conf"
    fi

    step "Запускаю контейнер $CTID"
    pct start "$CTID" || die "pct start $CTID не удался"
  fi

  # Идемпотентность: если контейнер уже был — storage/template не нужны, но сеть
  # всё равно нужна. Для DHCP-контейнера запрашиваем адрес заново ниже.
  if ! pct status "$CTID" 2>/dev/null | grep -q running; then
    step "Запускаю контейнер $CTID"
    pct start "$CTID" || die "pct start $CTID не удался"
  fi

  # DNS от PVE иногда ломает resolv.conf — пишем явно.
  pct exec "$CTID" -- bash -c "printf 'nameserver %s\n' '$CT_NAMESERVER' > /etc/resolv.conf" 2>/dev/null || true

  wait_network || warn 'Продолжаю, несмотря на проблемы с сетью.'

  step 'Ставлю зависимости в контейнере (curl git openssl iproute2 ca-certificates)'
  pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq curl git openssl iproute2 ca-certificates >/dev/null" \
    || die 'apt-get install не удался — проверьте DNS и сеть.'

  local ctip
  ctip=$(ct_ip_addr)
  [ -n "$ctip" ] || ctip=$(ask 'Не удалось определить IP контейнера. Введите адрес' '')
  [ -n "$ctip" ] || die 'Не удалось определить IP контейнера.'

  # Доп. флаги для install.sh
  local -a INSTALL_ARGS=( --http --host "$ctip" --dir "$APP_DIR" --admin-nickname "$ADMIN_NICK" -y )
  if [ -n "$ADMIN_EMAIL" ]; then INSTALL_ARGS+=( --admin-email "$ADMIN_EMAIL" ); fi

  if [ -n "$SOURCE_TARBALL" ]; then
    [ -f "$SOURCE_TARBALL" ] || die "Архив не найден: $SOURCE_TARBALL"
    step "Передаю архив исходников в контейнер"
    pct push "$CTID" "$SOURCE_TARBALL" /root/puls-src.tar.gz --perms 600 || die 'pct push не удался'
    # Извлекаем install.sh из архива как «загрузчик» и запускаем с --tarball.
    pct exec "$CTID" -- bash -c 'rm -rf /tmp/puls-boot && mkdir -p /tmp/puls-boot && tar -xzf /root/puls-src.tar.gz -C /tmp/puls-boot' \
      || die 'Не удалось распаковать архив в контейнере'
    local boot
    boot=$(pct exec "$CTID" -- bash -c 'find /tmp/puls-boot -type f -path "*/scripts/install.sh" | head -n1')
    [ -n "$boot" ] || die 'В архиве нет scripts/install.sh'
    step 'Запускаю установщик «Пульса» внутри контейнера'
    pct exec "$CTID" -- bash -c "$(printf 'bash %q' "$boot") --tarball /root/puls-src.tar.gz $(printf '%q ' "${INSTALL_ARGS[@]}")"
  else
    step "Клонирую исходники в контейнере ($REPO_URL, ветка $REPO_BRANCH)"
    pct exec "$CTID" -- bash -c "git clone --quiet --branch '$REPO_BRANCH' '$REPO_URL' '$APP_DIR'" \
      || die "git clone не удался: $REPO_URL ($REPO_BRANCH)"
    step 'Запускаю установщик «Пульса» внутри контейнера'
    pct exec "$CTID" -- bash -c "$(printf 'bash %q/scripts/install.sh' "$APP_DIR") $(printf '%q ' "${INSTALL_ARGS[@]}")"
  fi

  # --- Tailscale serve (необязательно) ---
  if [ "$TS_SERVE" = 1 ]; then
    step 'Настраиваю Tailscale serve (HTTPS)'
    pct exec "$CTID" -- bash -c 'command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh' || warn 'Установка Tailscale не удалась'
    warn 'Выполните в контейнере вручную (нужна авторизация):'
    info "  pct exec $CTID -- tailscale up --hostname=$TS_HOSTNAME"
    info "  pct exec $CTID -- tailscale serve --bg --https=443 http://127.0.0.1:8081"
    info "Затем впишите EXTRA_ORIGINS=https://${TS_HOSTNAME}.<tailnet>.ts.net в $APP_DIR/.env и:"
    info "  pct exec $CTID -- bash -c 'cd $APP_DIR && docker compose up -d caddy'"
  fi

  # --- Итог ---
  local creds=''
  creds=$(pct exec "$CTID" -- bash -c "cat /root/puls-credentials.txt 2>/dev/null" || true)
  echo
  step 'Готово'
  info "Сайт:            http://${ctip}"
  info "Контейнер:       CT $CTID ($CT_HOSTNAME), вход: pct enter $CTID"
  info "Каталог:         $APP_DIR (внутри CT), конфигурация: $APP_DIR/.env"
  info 'Обновление:      bash puls-lxc.sh --ctid '"$CTID"' --update'
  info 'Удаление:        bash puls-lxc.sh --ctid '"$CTID"' --uninstall'
  info "Бэкапы:          $APP_DIR/backups (внутри CT, ежедневно)"
  info "Логи:            pct exec $CTID -- bash -c 'cd $APP_DIR && docker compose logs -f --tail 100'"
  if [ -n "$creds" ]; then
    echo
    step 'Первый администратор (сохранено в /root/puls-credentials.txt внутри CT)'
    printf '%s\n' "$creds" | sed 's/^/    /'
  else
    warn 'Администратор не создан автоматически — откройте мастер: http://'"$ctip"'/setup'
  fi
}

case "$ACTION" in
  plan) do_plan ;;
  update) do_update ;;
  uninstall) do_uninstall ;;
  install) do_install ;;
  *) die "Неизвестное действие: $ACTION" ;;
esac
