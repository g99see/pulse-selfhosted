# «Пульс» в LXC Proxmox VE · Pulse in a Proxmox VE LXC

Установка «Пульса» одной командой в непривилегированный LXC-контейнер Proxmox VE.
One-line install of Pulse into an unprivileged Proxmox VE LXC container.

---

## Русский

### Одной командой (на хосте Proxmox VE, от root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/main/deploy/proxmox/puls-lxc.sh)"
```

Скрипт спросит подтверждение (если есть терминал) и проверит, что вы на хосте PVE.

### Что делает скрипт

1. Находит следующий свободный CTID, хранилище (`lvmthin`, напр. `local-lvm`) и шаблон Debian (`pveam`).
2. Создаёт **непривилегированный** LXC: Debian 12/13, `cores=2`, `ram=2048–4096`, диск `16 ГБ`,
   `features nesting=1,keyctl=1` (обязательны для Docker), мост `vmbr0`, DHCP или статический IP.
3. Запускает контейнер, ждёт сеть, ставит зависимости и Docker + плагин Compose.
4. Кладёт исходники «Пульса» (`git clone` репозитория или локальный архив, см. ниже).
5. Генерирует `APP_DIR/.env` со случайными `POSTGRES_PASSWORD`, `APP_ENCRYPTION_KEY`,
   `CORS_ORIGIN`/`PUBLIC_ORIGIN` по адресу контейнера (права `600`).
6. Выполняет `docker compose up -d`, ждёт healthcheck, создаёт первого администратора
   и печатает URL, логин и путь к файлу с паролем.

Контейнер создаётся один раз: повторный запуск с тем же `--ctid` стек не пересоздаёт.

### Требования

- **Proxmox VE 8/9**, запуск от `root` на самом хосте PVE (не внутри контейнера).
- Интернет на хосте PVE: `pveam` (шаблон), Docker Hub, `get.docker.com`, реестр npm.
- Свободно ≥ 8 ГБ на хранилище образов; рекомендуется ≥ 4 ГБ RAM для сборки образов.
- Мост `vmbr0` (или задайте другой через `--bridge`).

### Опции (кратко)

```
--ctid ID --hostname NAME --cores N --ram МБ --disk ГБ --storage NAME
--bridge BR --ip CIDR --gw GW --nameserver NS --password PASS --ssh-key KEY
--template NAME --repo URL --branch NAME --tarball PATH --dir PATH
--tailscale --admin-email E --admin-nickname N
--update  --uninstall  --plan  -y  --help
```

Каждую переменную можно задать через окружение (`CTID=... CT_RAM=4096 bash ...`).

### DNS внутри контейнера

`resolv.conf` контейнера, унаследованный от PVE, часто бывает нерабочим. Скрипт **всегда
прописывает** `nameserver 1.1.1.1` (меняется через `--nameserver`). Если сеть всё равно
не поднимается — проверьте мост и шлюз, задайте статический адрес:

```bash
bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ip 192.168.1.50/24 --gw 192.168.1.1
```

### Установка из локального архива (GitHub недоступен)

Если контейнер/хост не видит GitHub, соберите архив исходников и передайте его скрипту:

```bash
git archive --format=tar.gz -o /root/puls-src.tar.gz HEAD
# архив уже на хосте PVE:
bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ctid 499 --tarball /root/puls-src.tar.gz --ram 4096
# либо через окружение: SOURCE_TARBALL=/root/puls-src.tar.gz ...
```

### HTTPS через Tailscale (необязательно)

```bash
... puls-lxc.sh -- --tailscale
```

Скрипт добавит `/dev/net/tun` в контейнер и поставит Tailscale. Авторизуйтесь (выведет ссылку):

```bash
pct exec <CTID> -- tailscale up --hostname=puls
pct exec <CTID> -- tailscale serve --bg --https=443 http://127.0.0.1:8081
```

Затем впишите `EXTRA_ORIGINS=https://puls.<ваша-сеть>.ts.net` в `/opt/puls/.env` внутри
контейнера и перезапустите Caddy:

```bash
pct exec <CTID> -- bash -c 'cd /opt/puls && docker compose up -d caddy'
```

Сайт остаётся доступен и по `http://<IP>` — оба адреса работают одновременно.

### Бэкапы, обновление, удаление

- **Бэкапы:** сервис `backup` пишет дампы PostgreSQL в `/opt/puls/backups` **внутри контейнера**
  ежедневно (хранится 7 копий, настраивается в `.env`). Хотите хранить их на хосте — сделайте
  bind-mount каталога контейнера на хранилище PVE.
- **Обновление:**
  ```bash
  bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ctid <CTID> --update
  # или: pct exec <CTID> -- bash -c 'cd /opt/puls && bash scripts/upgrade.sh'
  ```
- **Удаление (все данные безвозвратно):**
  ```bash
  bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ctid <CTID> --uninstall
  ```

### Диагностика

| Симптом | Причина и решение |
| --- | --- |
| `Не найден pct` | Скрипт запущен не на хосте PVE. Запускайте на самом Proxmox. |
| Docker не стартует внутри CT | Не включены `nesting=1,keyctl=1`. Проверьте: `pct config <CTID>` — строка `features`. |
| Контейнер без сети | Битый `resolv.conf` / неверный мост. Задайте `--nameserver 1.1.1.1`, проверьте `vmbr0`. |
| `apt-get install` падает | Нет DNS или нет интернета на хосте. Проверьте `getent hosts deb.debian.org` в CT. |
| Сборка падает по памяти | Дайте ≥ 4 ГБ RAM: `--ram 4096`. |
| Healthcheck не проходит | Смотрите логи: `pct exec <CTID> -- bash -c 'cd /opt/puls && docker compose logs --tail 100'`. |
| Порт 80 занят | Внутри CT занят маловероятно; проверьте, не проброшен ли уже сервис на хосте. |

---

## English

### One-liner (on the Proxmox VE host, as root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/g99see/pulse-selfhosted/main/deploy/proxmox/puls-lxc.sh)"
```

### What it does

1. Picks the next free CTID, an image storage (`lvmthin`, e.g. `local-lvm`) and a Debian template via `pveam`.
2. Creates an **unprivileged** LXC: Debian 12/13, `cores=2`, `ram=2048–4096`, `disk=16G`,
   `features nesting=1,keyctl=1` (required for Docker), bridge `vmbr0`, DHCP or static IP.
3. Starts it, waits for the network, installs dependencies and Docker + the Compose plugin.
4. Fetches the source (`git clone` of the repo, or a local tarball — see below).
5. Generates `APP_DIR/.env` with random `POSTGRES_PASSWORD`, `APP_ENCRYPTION_KEY` and the
   container-IP `PUBLIC_ORIGIN` (mode `600`).
6. Runs `docker compose up -d`, waits for healthchecks, creates the first admin and prints
   the URL, login and the credentials file path.

Re-running with the same `--ctid` does not recreate the container.

### Requirements

- **Proxmox VE 8/9**, run as `root` on the PVE host itself (not inside a container).
- Internet on the PVE host: `pveam` (template), Docker Hub, `get.docker.com`, npm registry.
- ≥ 8 GB free on the image storage; ≥ 4 GB RAM recommended for image builds.
- Bridge `vmbr0` (override with `--bridge`).

### Options

```
--ctid ID --hostname NAME --cores N --ram MB --disk GB --storage NAME
--bridge BR --ip CIDR --gw GW --nameserver NS --password PASS --ssh-key KEY
--template NAME --repo URL --branch NAME --tarball PATH --dir PATH
--tailscale --admin-email E --admin-nickname N
--update  --uninstall  --plan  -y  --help
```

Every value is also an environment override (`CTID=... CT_RAM=4096 bash ...`).

### Container DNS

The container `resolv.conf` inherited from PVE is often broken. The script **always** writes
`nameserver 1.1.1.1` (change with `--nameserver`). For a fixed address:

```bash
bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ip 192.168.1.50/24 --gw 192.168.1.1
```

### Install from a local tarball (no GitHub access)

```bash
git archive --format=tar.gz -o /root/puls-src.tar.gz HEAD   # tarball already on the PVE host
bash -c "$(curl -fsSL .../puls-lxc.sh)" -- --ctid 499 --tarball /root/puls-src.tar.gz --ram 4096
```

### HTTPS via Tailscale (optional)

```bash
... puls-lxc.sh -- --tailscale
pct exec <CTID> -- tailscale up --hostname=puls
pct exec <CTID> -- tailscale serve --bg --https=443 http://127.0.0.1:8081
```

Then set `EXTRA_ORIGINS=https://puls.<your-tailnet>.ts.net` in `/opt/puls/.env` inside the CT and
`docker compose up -d caddy`. The site stays reachable over `http://<IP>` too.

### Backups, update, removal

- **Backups:** the `backup` service writes PostgreSQL dumps to `/opt/puls/backups` **inside the
  container**, once a day (7 kept by default, configurable in `.env`).
- **Update:** `... puls-lxc.sh -- --ctid <CTID> --update`
- **Remove (all data lost):** `... puls-lxc.sh -- --ctid <CTID> --uninstall`

### Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `pct not found` | Not running on the PVE host. Run it on Proxmox itself. |
| Docker won't start in CT | `nesting=1,keyctl=1` missing. Check `pct config <CTID>` (`features`). |
| Container has no network | Broken `resolv.conf` / wrong bridge. Set `--nameserver 1.1.1.1`, check `vmbr0`. |
| `apt-get install` fails | No DNS/internet. Test `getent hosts deb.debian.org` inside the CT. |
| Build runs out of memory | Give more RAM: `--ram 4096`. |
| Healthcheck never passes | Logs: `pct exec <CTID> -- bash -c 'cd /opt/puls && docker compose logs --tail 100'`. |

---

## Лицензия / License

AGPL-3.0-or-later — см. [LICENSE](../../LICENSE).
