// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Готовые шаблоны HTML-страницы профиля (ТЗ §3.8): визитка, портфолио,
 * вишлист и «моя цель» — для тех, кто не пишет код.
 *
 * Каждый шаблон — самодостаточная строка HTML с инлайновыми стилями и без
 * внешних зависимостей: их отдаёт пользовательский домен в iframe с
 * `sandbox="allow-scripts"` (без доступа к cookie и данным основного сайта).
 * Русский текст здесь допустим — это .ts-файл общего пакета, а не .tsx.
 *
 * Модуль также даёт удобную обёртку `auditHtmlTemplate` над канонической
 * автопроверкой `checkHtmlPage` из ./html-page: ей пользуются unit-тесты
 * шаблонов и живой предпросмотр в редакторе.
 */
import {
  checkHtmlPage,
  htmlByteLength,
  HTML_PAGE_MAX_BYTES,
  type HtmlCheckCode,
} from './html-page';

/** Максимальный размер пользовательской страницы (ТЗ §3.8) — 2 МБ. */
export const HTML_TEMPLATE_MAX_BYTES = HTML_PAGE_MAX_BYTES;

/** Идентификаторы готовых шаблонов. */
export type HtmlTemplateId = 'business-card' | 'portfolio' | 'wishlist' | 'my-goal';

export interface HtmlTemplate {
  id: HtmlTemplateId;
  /** Короткое имя для интерфейса (ru). */
  name: string;
  /** Описание для выбора шаблона (ru). */
  description: string;
  /** Самодостаточная HTML-строка страницы. */
  html: string;
}

const BUSINESS_CARD = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Визитка</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .card { width: 100%; max-width: 420px; background: #1e293b; border-radius: 20px; padding: 32px; box-shadow: 0 20px 45px rgba(0,0,0,.35); }
  .avatar { width: 72px; height: 72px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 20px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .role { margin: 0 0 20px; color: #94a3b8; }
  p.bio { margin: 0 0 24px; line-height: 1.6; color: #cbd5e1; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  li a { color: #a5b4fc; text-decoration: none; }
  li a:hover { text-decoration: underline; }
  .label { display: inline-block; width: 84px; color: #64748b; }
</style>
</head>
<body>
  <main class="card">
    <div class="avatar" aria-hidden="true">🙂</div>
    <h1>Имя Фамилия</h1>
    <p class="role">Продуктовый дизайнер</p>
    <p class="bio">Коротко о себе: чем занимаюсь, чем могу быть полезен и как со мной связаться.</p>
    <ul>
      <li><span class="label">Почта</span><a href="mailto:hello@example.com">hello@example.com</a></li>
      <li><span class="label">Телефон</span><a href="tel:+10000000000">+1 000 000-00-00</a></li>
      <li><span class="label">Сайт</span><a href="https://example.com" rel="noopener noreferrer" target="_blank">example.com</a></li>
    </ul>
  </main>
</body>
</html>`;

const PORTFOLIO = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Портфолио</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
  header { padding: 48px 24px 24px; max-width: 900px; margin: 0 auto; }
  h1 { margin: 0 0 8px; font-size: 34px; }
  header p { margin: 0; color: #475569; }
  .grid { max-width: 900px; margin: 0 auto; padding: 24px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  article { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; }
  article h2 { margin: 0 0 8px; font-size: 18px; }
  article p { margin: 0 0 14px; color: #475569; line-height: 1.5; }
  .tag { display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
  footer { max-width: 900px; margin: 0 auto; padding: 24px; color: #64748b; font-size: 14px; }
  a { color: #4338ca; }
</style>
</head>
<body>
  <header>
    <h1>Портфолио</h1>
    <p>Избранные проекты и работы. Замените тексты на свои.</p>
  </header>
  <section class="grid">
    <article>
      <h2>Проект «Альфа»</h2>
      <p>Что это было, какую задачу решали и какой получился результат.</p>
      <span class="tag">Дизайн</span>
    </article>
    <article>
      <h2>Проект «Бета»</h2>
      <p>Небольшое описание проекта, роль в команде и ссылка на результат.</p>
      <span class="tag">Разработка</span>
    </article>
    <article>
      <h2>Проект «Гамма»</h2>
      <p>Ещё одна работа — можно показать галерею, отзыв или кейс.</p>
      <span class="tag">Исследование</span>
    </article>
    <article>
      <h2>Проект «Дельта»</h2>
      <p>Открытый проект или pet-идея, которую хочется показать.</p>
      <span class="tag">Пет-проект</span>
    </article>
  </section>
  <footer>Связаться: <a href="mailto:hello@example.com">hello@example.com</a></footer>
</body>
</html>`;

const WISHLIST = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вишлист</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #fff7ed; color: #431407; padding: 32px 16px; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { margin: 0 0 6px; font-size: 30px; }
  .hint { margin: 0 0 24px; color: #9a3412; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  li { background: #fff; border: 1px solid #fed7aa; border-radius: 14px; padding: 16px 18px; display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .title { font-weight: 600; }
  .note { display: block; color: #7c2d12; font-size: 14px; margin-top: 4px; }
  .price { color: #c2410c; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
</head>
<body>
  <main>
    <h1>Мой вишлист</h1>
    <p class="hint">Список желаний — с ценами и заметками. Наведите порядок под себя.</p>
    <ul>
      <li><span><span class="title">Электронная книга</span><span class="note">С диагональю 7", для чтения в дороге</span></span><span class="price">12 000 ₽</span></li>
      <li><span><span class="title">Рюкзак для ноутбука</span><span class="note">Водоотталкивающий, 20 л</span></span><span class="price">6 500 ₽</span></li>
      <li><span><span class="title">Настольная лампа</span><span class="note">Тёплый свет, регулировка яркости</span></span><span class="price">3 900 ₽</span></li>
      <li><span><span class="title">Подписка на курс</span><span class="note">Годовой доступ</span></span><span class="price">20 000 ₽</span></li>
    </ul>
  </main>
</body>
</html>`;

const MY_GOAL = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Моя цель</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #052e2b; color: #d1fae5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  main { width: 100%; max-width: 460px; background: #064e3b; border-radius: 20px; padding: 32px; box-shadow: 0 20px 45px rgba(0,0,0,.35); }
  h1 { margin: 0 0 6px; font-size: 26px; }
  .sub { margin: 0 0 24px; color: #6ee7b7; }
  .bar { height: 14px; border-radius: 999px; background: #022c22; overflow: hidden; margin: 12px 0 8px; }
  .fill { height: 100%; width: 42%; background: #34d399; border-radius: 999px; }
  .row { display: flex; justify-content: space-between; color: #a7f3d0; font-variant-numeric: tabular-nums; }
  .facts { margin: 24px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; color: #d1fae5; }
  .facts b { color: #fff; }
</style>
</head>
<body>
  <main>
    <h1>Накопить на мечту</h1>
    <p class="sub">Каждый шаг приближает к цели — меняйте цифры и текст.</p>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" aria-label="Прогресс цели"><div class="fill"></div></div>
    <div class="row"><span>Накоплено: 42 000 ₽</span><span>42%</span></div>
    <ul class="facts">
      <li>Цель: <b>100 000 ₽</b></li>
      <li>Осталось: <b>58 000 ₽</b></li>
      <li>Взнос в месяц: <b>7 250 ₽</b></li>
      <li>Срок: <b>декабрь 2026</b></li>
    </ul>
  </main>
</body>
</html>`;

/** Готовые шаблоны в порядке показа в интерфейсе (ТЗ §3.8). */
export const HTML_TEMPLATES: readonly HtmlTemplate[] = [
  {
    id: 'business-card',
    name: 'Визитка',
    description: 'Имя, занятие и контакты — одна аккуратная карточка.',
    html: BUSINESS_CARD,
  },
  {
    id: 'portfolio',
    name: 'Портфолио',
    description: 'Сетка проектов и работ с коротким описанием.',
    html: PORTFOLIO,
  },
  {
    id: 'wishlist',
    name: 'Вишлист',
    description: 'Список желаний с ценами и заметками.',
    html: WISHLIST,
  },
  {
    id: 'my-goal',
    name: 'Моя цель',
    description: 'Цель накоплений с прогрессом и сроком.',
    html: MY_GOAL,
  },
] as const;

/** Шаблон по идентификатору; undefined — если такого нет. */
export function getHtmlTemplate(id: string): HtmlTemplate | undefined {
  return HTML_TEMPLATES.find((template) => template.id === id);
}

/** Коды проблем автопроверки безопасности (ТЗ §3.8). */
export type HtmlSafetyIssueCode = HtmlCheckCode | 'too_large' | 'empty';

export interface HtmlSafetyReport {
  /** true — если публикацию ничего не блокирует. */
  ok: boolean;
  /** Размер в байтах (UTF-8). */
  bytes: number;
  /** Ошибки: блокируют публикацию. */
  issues: HtmlSafetyIssueCode[];
  /** Замечания, которые показываем, но не блокируем. */
  warnings: string[];
}

/**
 * Автопроверка HTML страницы для предпросмотра в редакторе (ТЗ §3.8):
 * надстройка над канонической `checkHtmlPage`, добавляющая проверку размера
 * и пустой строки. Домен песочницы по умолчанию `usercontent.localhost`.
 */
export function auditHtmlTemplate(
  html: string,
  sandboxDomain = 'usercontent.localhost',
): HtmlSafetyReport {
  const bytes = htmlByteLength(html);
  const reasons = checkHtmlPage(html, { sandboxDomain }).reasons;

  const issues: HtmlSafetyIssueCode[] = reasons
    .filter((reason) => reason.severity === 'blocked')
    .map((reason) => reason.code);
  const warnings = reasons
    .filter((reason) => reason.severity === 'flagged')
    .map((reason) => reason.message);

  if (html.trim() === '' || bytes === 0) issues.unshift('empty');
  if (bytes > HTML_TEMPLATE_MAX_BYTES) issues.unshift('too_large');

  return { ok: issues.length === 0, bytes, issues: [...new Set(issues)], warnings };
}
