# Фаза 3 — «Поделиться результатом» (ТЗ §3.7, §4 P1, §5 сценарий 2)

Кнопка «Поделиться результатом» генерирует картинку-карточку с прогрессом для
Instagram/Telegram. Реализация без клиентской отрисовки вручную: чистый
SVG-генератор в `@puls/shared`, API отдаёт SVG и растеризует PNG, web делится
файлом через Web Share API (с fallback на скачивание и ссылку Telegram).

## Что сделано

- **`packages/shared/src/share-card.ts`** — чистая функция `renderShareCard(data, options)`
  без нативных зависимостей и побочных эффектов:
  - типы карточек: `goal_progress` (процент/сумма), `checkin_streak`, `achievement`, `avg_mood`;
  - форматы: `story` 1080×1920 и `square` 1080×1080 (`SHARE_CARD_SIZES`);
  - **суммы по умолчанию скрыты** — показываются проценты (ТЗ §3.7); суммы
    включаются опцией `showAmounts` / query-параметром `amounts=1`;
  - экранирование пользовательского текста (`escapeXml`) — название цели не
    может вставить разметку;
  - подписи ru/en по параметру `locale`;
  - темы `light`/`dark` на дизайн-токенах ТЗ §8.
- **API** (`apps/api/src/share`) под `SessionGuard`:
  - `GET /api/share/card?type=&id=&format=&locale=&amounts=` → `image/svg+xml`;
  - `GET /api/share/card.png?…` → `image/png` (растеризация `@resvg/resvg-js`);
  - данные берутся из существующих сервисов: `GoalsService` (цели),
    `AchievementsService` (стрик), `StatsService` (среднее настроение за месяц,
    месяц в часовом поясе пользователя), достижения — из `user_achievements`.
  - всё по текущему пользователю: чужая цель отдаёт 404, без сессии — 401.
- **Web** (`apps/web`):
  - `components/share-button.tsx` — кнопка и шторка предпросмотра: переключатель
    формата Story/Square, предпросмотр PNG, «Поделиться» (Web Share API с файлом),
    «Скачать PNG», «Открыть в Telegram» (`t.me/share/url`);
  - `lib/share-client.ts` — получение PNG под cookie-сессией;
  - встроено точечно: карточка каждой цели на `/goals` и карточки стрика и
    полученных достижений на `/achievements`;
  - строки только в `lib/i18n.ts` (`share.*`, ru и en с одинаковым набором ключей).
- **Тесты**:
  - unit `packages/shared/test/share-card.test.ts` — процент, экранирование,
    форматы, скрытие сумм, подписи ru/en;
  - интеграционные `apps/api/test/share.integration.test.ts` — SVG/PNG,
    изоляция (чужую цель нельзя, 404), суммы скрыты по умолчанию, PNG-сигнатура;
  - e2e `apps/web/e2e/share.spec.ts` — кнопка открывает предпросмотр и файл
    скачивается.

## Лицензии

`@resvg/resvg-js@2.6.2` распространяется под **MPL-2.0** — совместимо с
AGPL-3.0-or-later и уже входит в список допустимых лицензий `scripts/check-licenses.mjs`.
`pnpm license:check` проходит. Пакет везёт готовые платформенные prebuilds
(без сборки нативно), поэтому не требует `allowBuilds` в `pnpm-workspace.yaml`.

## Fallback растеризации

Если растеризация на сервере недоступна (нет системных шрифтов в slim-образе или
зависимость вырезана), web уже готов работать с SVG: серверный эндпоинт `/card`
отдаёт `image/svg+xml`, а PNG при необходимости получается из него на клиенте
через `canvas`. Основной путь — серверный PNG; клиентский canvas — запасной.

## Приватность

`SessionGuard` ограничивает доступ данными текущего пользователя, поэтому карточка
всегда строится из собственных данных. По умолчанию — проценты; режим показа
сумм (`amounts=1`) соответствует `ProfileCard.mode = amount` из блока A
(по умолчанию в профиле — `percent`, ТЗ §3.7).

## Команды

```bash
pnpm --filter @puls/shared test
pnpm --filter @puls/api test        # интеграционные (нужен PostgreSQL, схема puls_test)
pnpm --filter @puls/web e2e -- share.spec.ts
pnpm license:check
```
