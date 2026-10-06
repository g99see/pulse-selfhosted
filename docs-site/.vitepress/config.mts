// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitepress';

// Документация «Пульса» (ТЗ §10): self-hosting, переменные окружения, API.
// Основной язык — русский; структура готова к добавлению локали `en`.
export default defineConfig({
  lang: 'ru-RU',
  title: 'Пульс',
  description:
    'Документация self-hosted сервиса «Пульс»: установка, настройка, использование, AI-помощник, открытый API.',
  // Тёмная тема по умолчанию, но переключатель остаётся доступен.
  appearance: 'dark',
  cleanUrls: true,
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#5B5BD6' }]],
  themeConfig: {
    siteTitle: 'Пульс',
    nav: [
      { text: 'Руководство', link: '/guide/installation', activeMatch: '^/guide/' },
      { text: 'Что нового', link: '/roadmap', activeMatch: '^/roadmap' },
      { text: 'AI-помощник', link: '/ai/', activeMatch: '^/ai/' },
      { text: 'Семья', link: '/family/', activeMatch: '^/family/' },
      { text: 'API', link: '/api/', activeMatch: '^/api/' },
      { text: 'Администрирование', link: '/admin/', activeMatch: '^/admin/' },
      { text: 'Разработчикам', link: '/dev/', activeMatch: '^/dev/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Начало',
          items: [
            { text: 'Пошагово для новичков', link: '/guide/quick-start' },
            { text: 'Установка за 15 минут', link: '/guide/installation' },
            { text: 'Настройка (.env)', link: '/guide/configuration' },
          ],
        },
        {
          text: 'Использование',
          items: [
            { text: 'Финансы', link: '/guide/usage/finance' },
            { text: 'Чек-ины самочувствия', link: '/guide/usage/checkins' },
            { text: 'Цели', link: '/guide/usage/goals' },
            { text: 'Импорт и экспорт', link: '/guide/usage/import-export' },
            { text: 'Сверка со счётом банка', link: '/guide/usage/reconciliation' },
            { text: 'Статистика и рекомендации', link: '/guide/usage/stats-insights' },
            { text: 'Уведомления', link: '/guide/usage/notifications' },
            { text: 'Telegram-бот', link: '/guide/usage/telegram' },
            { text: 'Привычки', link: '/guide/usage/habits' },
            { text: 'Челленджи', link: '/guide/usage/challenges' },
            { text: 'Капсула времени', link: '/guide/usage/capsules' },
            { text: 'Год в цифрах', link: '/guide/usage/wrapped' },
            { text: 'Режим «Тишина»', link: '/guide/usage/quiet-mode' },
            { text: 'Голосовой чек-ин', link: '/guide/usage/voice-checkin' },
            { text: 'Виджет цели', link: '/guide/usage/goal-widget' },
            { text: 'Безопасность и 2FA', link: '/guide/usage/security-2fa' },
            { text: 'Профиль и лента', link: '/guide/usage/profile-social' },
            { text: 'HTML-страница и шаблоны', link: '/guide/usage/html-page' },
          ],
        },
      ],
      '/ai/': [{ text: 'AI-помощник', items: [{ text: 'Обзор', link: '/ai/' }] }],
      '/family/': [{ text: 'Семейный режим', items: [{ text: 'Обзор', link: '/family/' }] }],
      '/api/': [{ text: 'Открытый API', items: [{ text: 'Обзор', link: '/api/' }] }],
      '/admin/': [{ text: 'Администрирование', items: [{ text: 'Обзор', link: '/admin/' }] }],
      '/ops/': [
        {
          text: 'Эксплуатация',
          items: [
            { text: 'Бэкапы и откат миграций', link: '/ops/backup' },
            { text: 'Администрирование', link: '/admin/' },
          ],
        },
      ],
      '/security/': [{ text: 'Безопасность', items: [{ text: 'Обзор', link: '/security/' }] }],
      '/dev/': [
        {
          text: 'Разработчикам',
          items: [
            { text: 'Обзор', link: '/dev/' },
            { text: 'Архитектура', link: '/dev/architecture' },
            { text: 'Как внести вклад', link: '/dev/contributing' },
          ],
        },
      ],
      '/': [
        {
          text: 'Начало',
          items: [
            { text: 'Введение и возможности', link: '/' },
            { text: 'Что нового и дорожная карта', link: '/roadmap' },
            { text: 'Пошагово для новичков', link: '/guide/quick-start' },
            { text: 'Установка за 15 минут', link: '/guide/installation' },
            { text: 'Настройка (.env)', link: '/guide/configuration' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
          modal: {
            noResultsText: 'Ничего не найдено',
            resetButtonTitle: 'Сбросить',
            footer: { selectText: 'выбрать', navigateText: 'перейти', closeText: 'закрыть' },
          },
        },
      },
    },
    outline: { label: 'На этой странице', level: [2, 3] },
    docFooter: { prev: 'Назад', next: 'Вперёд' },
    darkModeSwitchLabel: 'Тема',
    sidebarMenuLabel: 'Меню',
    returnToTopLabel: 'Наверх',
    lastUpdated: { text: 'Обновлено' },
    footer: {
      message: 'Код распространяется по лицензии AGPL-3.0-or-later.',
      copyright: 'Проект «Пульс»',
    },
  },
});
