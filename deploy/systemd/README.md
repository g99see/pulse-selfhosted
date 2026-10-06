# Автозапуск «Пульса» (systemd user units)

Юниты поднимают API (`:3001`) и web (`:3000`) как пользовательские сервисы
systemd. С включённым lingering они стартуют **после перезагрузки без входа в
систему** — то, что нужно для постоянной работы демо.

Платное не требуется: только systemd пользователя, Postgres и Valkey в Docker.

## Что установить

| Файл | Назначение |
|---|---|
| `puls-api.service` | API NestJS (`node dist/main.js`, порт 3001) |
| `puls-web.service` | Next.js (`next start`, порт 3000) |

## Установка

```bash
# 1. Окружение с секретами (права 600). Создаётся один раз:
#    задайте DATABASE_URL, REDIS_URL и прочие переменные (формат KEY=value).
mkdir -p ~/.config/puls
cp .env.example ~/.config/puls/env   # затем заполните значения
chmod 600 ~/.config/puls/env

# 2. Сборка приложения (один раз и после обновлений кода):
~/projects/puls/scripts/dev-run.sh build

# 3. Сам юнит(ы):
cp ~/projects/puls/deploy/systemd/puls-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now puls-api.service puls-web.service

# 4. Запуск без входа в систему (нужен root один раз):
sudo loginctl enable-linger "$USER"
```

## Проверка

```bash
systemctl --user status puls-api.service puls-web.service
curl -s localhost:3001/health      # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/   # 200
journalctl --user -u puls-api -n 50
```

## Формат `~/.config/puls/env`

`EnvironmentFile` читает строки `KEY=value` (без `export`). Нужны как минимум:

```ini
DATABASE_URL=postgresql://пользователь:пароль@ХОСТ:5432/puls?schema=public
REDIS_URL=redis://ХОСТ:6379
API_PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
API_INTERNAL_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:3000
```

Секреты в этот файл не коммитятся: он лежит вне репозитория и с правами `600`.

## Про Node

Юниты запускают Node явным путём — Node 24 из nvm
(`~/.nvm/versions/node/v24.18.0/bin/node`). Системный `/usr/bin/node` (v20) не
подходит: нативные модули (`argon2`, `@resvg/resvg-js`) собраны под Node ≥ 20 и
на v20 падают. Если nvm обновит версию, поправьте `ExecStart` в юнитах
(`dev-run.sh` выбирает Node автоматически).

## Если порты 3000/3001 заняты

```bash
ss -ltnp | grep -E ':3000|:3001'
```

Если порт держит посторонний процесс — остановите его (`systemctl --user stop
puls-api`/`puls-web` либо `kill <pid>`); запускать два процесса на одном порту
нельзя. Контейнеры Docker с чужими root-процессами на этих портах не слушают,
их трогать не нужно.
