# Фаза 1.6 — PWA, темы, локали и дизайн-система

Реализация ТЗ §6 (доступность WCAG 2.1 AA и локализация), §7 (PWA через Serwist)
и §8 (дизайн: палитра, Manrope/Inter, скругления, анимации, навигация).

## Что появилось

### Тема — светлая, тёмная и системная (§8)

- `src/lib/theme.ts` — чистая логика: `resolveTheme`, `parseThemeMode`,
  `nextThemeMode`, `themeInitScript`, `themeCookie`. Покрыта `test/theme.test.ts`
  (10 тестов), сам inline-скрипт исполняется с заглушками DOM — проверяется
  поведение, а не совпадение строки.
- `src/components/theme-provider.tsx` — `ThemeProvider` + `useTheme`; выбор
  хранится в cookie `puls_theme` и localStorage, системная тема слушается через
  `matchMedia`, класс `.dark` ставится на `<html>`.
- `src/components/theme-toggle.tsx` — радиогруппа «Светлая / Тёмная / Системная»,
  доступна с клавиатуры (визуально скрытые `input` с `focus-within`-кольцом).
- Мигания нет: inline-скрипт в `<head>` ставит тему до первой отрисовки, а сервер
  дополнительно отдаёт `class="dark"`, если так решил cookie.
- Переключатели есть на лендинге (публично) и в `/app/profile`.

### Локализация ru/en (§6)

- `src/lib/locale.ts` — чистая логика выбора локали: cookie `puls_locale` →
  локаль профиля → `Accept-Language` (с весами `q`) → `ru`.
- `src/components/locale-provider.tsx` — `LocaleProvider` + `useT`, смена языка
  пишет cookie и обновляет `<html lang>`.
- `src/lib/locale-server.ts` — локаль запроса для серверных компонентов
  (корневой layout, `generateMetadata`, лендинг, манифест).
- `src/lib/format.ts` — даты, числа и суммы по локали через `Intl`.
- Переведены все экраны: лендинг, регистрация, вход, подтверждение email,
  онбординг, кабинет, офлайн-страница. Тест `test/no-hardcoded-text.test.ts`
  падает, если в `src/app` или `src/components` появляется русская строка вне
  комментария, — тексты обязаны идти через `t()`.

### PWA через Serwist (§7)

- `src/sw.ts` — service worker: `defaultCache` для статики, предкеш офлайн-
  страницы, фолбэк `/offline` для навигационных запросов.
- Собирается только в production: `next.config.mjs` отключает Serwist при
  `NODE_ENV !== 'production'`, чтобы dev-режим не боролся с HMR.
- `src/app/manifest.ts` — `/manifest.webmanifest`: имя, `short_name`, описание,
  `standalone`, цвета тем, локаль, иконки 192 / 512 / maskable.
- Иконки: SVG в `public/icons`, PNG собирает `pnpm --filter @puls/web icons:build`
  локальным `rsvg-convert` (librsvg). Платные и внешние сервисы не используются.
- Метатеги iOS 16.4+: `apple-mobile-web-app-capable`, `-status-bar-style`,
  `-title`, `apple-touch-icon` 180×180.
- Кнопка «Установить» (`beforeinstallprompt` + `appinstalled`) — в `/app/profile`;
  если браузер события не даёт (iOS Safari), показывается подсказка.

### Дизайн-система (§6, §8)

- Шрифты self-hosted: `next/font/local` + woff2 из `@fontsource-variable`
  (`pnpm --filter @puls/web fonts:sync` кладёт файлы в `public/fonts`).
  Кириллица и латиница — отдельные сабсеты с `unicode-range`; ссылок на
  `fonts.googleapis.com` в `layout.tsx` больше нет, внешних запросов нет.
- `src/lib/palette.ts` + `src/lib/contrast.ts` — палитра как данные и расчёт
  контраста по WCAG. `test/contrast.test.ts` требует ≥ 4.5:1 для всех пар
  «текст на фоне» в обеих темах и ≥ 3:1 для кольца фокуса, а также сверяет
  значения CSS-переменных `globals.css` с TS-палитрой (расхождение = красный тест).
- Текстовые варианты цветов: `--puls-*-text` и `--puls-on-primary` — брендовые
  заливки (`#2BA889`, `#F2A25C`, `#E5484D`) в светлой теме как текст AA не
  проходят, поэтому для текста используются затемнённые оттенки.
- Токены скруглений (16 / 12 / 999 px), длительности 150–250 мс, фокус-кольца,
  `prefers-reduced-motion`, skip-link «К основному содержимому».

## Проверка

```bash
pnpm --filter @puls/web test        # 48 unit-тестов (8 файлов)
pnpm --filter @puls/web typecheck   # чисто
pnpm --filter @puls/web lint        # чисто
pnpm build                          # shared + api + web
pnpm e2e                            # 13 тестов: auth, финансы, smoke, pwa
pnpm license:check                  # 223 production-зависимости, все совместимы
```

### Lighthouse (production-сборка, chromium из ~/.cache/ms-playwright)

| Страница | Performance | Accessibility | Best Practices |
| --- | --- | --- | --- |
| `/` | 97 | 100 | 100 |
| `/login` | 95 | 100 | 100 |

Метрики: FCP 0.8 с, LCP 2.0–2.1 с, TBT 140–230 мс, CLS 0.

## Ограничения текущей реализации

- Навигация кабинета (нижняя на мобильном, боковая на десктопе) существует с
  Фазы 1.1; вкладка «Статистика» пока заглушка, «Профиль» ведёт в настройки.
- Пуш-уведомления (Web Push с VAPID) в эту итерацию не входят — только
  установка приложения и офлайн-страница.
- Manifest отдаётся динамически (локаль берётся из запроса), поэтому сервис-воркер
  кеширует статику, а не сам манифест.
