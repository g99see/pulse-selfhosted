// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тексты ответов Telegram-бота (ТЗ §3.6, §4). Чистые функции: собирают строку
 * по данным, ничего не отправляют. Язык бота — русский, как и интерфейс по
 * умолчанию.
 */
import { formatMoney, isCurrency, type StatsDayResponse, type TransactionDto } from '@puls/shared';

/** Подсказка, если чат ещё не привязан к аккаунту (ТЗ §6: изоляция). */
export function linkRequiredText(): string {
  return [
    'Этот чат не привязан к аккаунту «Пульс».',
    '',
    'Откройте настройки на сайте → «Telegram» → «Привязать Telegram», получите код и пришлите:',
    '/start ВАШ-КОД',
  ].join('\n');
}

/** Ответ на /start без кода. */
export function startHintText(): string {
  return [
    'Привет! Я бот «Пульса» — помогу вести траты и чек-ины прямо из чата.',
    '',
    'Чтобы привязать чат, откройте настройки на сайте и отправьте /start с кодом.',
    'Что уже умею — /help',
  ].join('\n');
}

/** Успешная привязка чата. */
export function linkedText(username?: string | null): string {
  const who = username ? ` (${username})` : '';
  return [
    `Готово! Чат${who} привязан к аккаунту «Пульс».`,
    '',
    'Что дальше:',
    '/checkin — отметить настроение',
    '«кофе 250» — записать трату',
    '/today — траты и настроение за день',
    '/help — все команды',
  ].join('\n');
}

/** Чат уже привязан к этому же аккаунту. */
export function alreadyLinkedText(): string {
  return 'Этот чат уже привязан к аккаунту «Пульс». Команды под рукой: /help';
}

/** Чат привязан к другому аккаунту. */
export function chatTakenText(): string {
  return [
    'Этот чат уже привязан к другому аккаунту «Пульс».',
    'Сначала отвяжите чат в настройках того аккаунта.',
  ].join('\n');
}

/** Код привязки не найден, истёк или уже использован. */
export function invalidCodeText(): string {
  return 'Код не подошёл: он мог истечь (10 минут) или уже использоваться. Получите новый код в настройках.';
}

/** Отвязка чата. */
export function unlinkedText(): string {
  return 'Чат отвязан от аккаунта «Пульс». Привязать снова можно в настройках.';
}

/** Вопрос чек-ина с кнопками настроения (ТЗ §3.3). */
export function checkinQuestionText(): string {
  return 'Как ты себя чувствуешь?';
}

export function checkinSavedText(mood: number): string {
  return `Записал настроение: ${mood}/5. Спасибо!`;
}

/** Неизвестная команда или текст. */
export function unknownText(): string {
  return [
    'Не понял сообщение. Попробуйте:',
    '/checkin — чек-ин',
    '«кофе 250» — трата',
    '/today — итоги дня',
    '/help — все команды',
  ].join('\n');
}

/** Полная справка по командам. */
export function helpText(): string {
  return [
    'Я бот «Пульса». Умею:',
    '',
    '/checkin — отметить настроение кнопками 1–5',
    '/today — траты и среднее настроение за сегодня',
    '«кофе 250» или «зарплата +80000» — записать транзакцию одной строкой',
    '/unlink — отвязать чат',
    '/help — эта справка',
  ].join('\n');
}

/** Запись создана; к сообщению добавляется кнопка «Отменить». */
export function transactionSavedText(transaction: TransactionDto): string {
  const kind = transaction.type === 'income' ? 'доход' : 'трата';
  const category = transaction.categoryName ? `, ${transaction.categoryName}` : '';
  return `Записал! ${kind}: ${money(transaction.amount, transaction.currency)}${category} — «${
    transaction.comment ?? ''
  }»`;
}

export function transactionCancelledText(transaction: TransactionSummary): string {
  return `Отменил запись «${transaction.comment ?? ''}» на ${money(
    transaction.amount,
    transaction.currency,
  )}.`;
}

/** Минимум полей транзакции для текста отмены; TransactionDto ему соответствует. */
export interface TransactionSummary {
  comment: string | null;
  amount: number;
  currency: string;
}

/** Не удалось разобрать текст — данных для транзакции не хватило. */
export function transactionFailedText(): string {
  return 'Не получилось записать. Пришлите строкой, например: «кофе 250» или «зарплата +80000».';
}

/** У пользователя ещё нет ни одного счёта. */
export function noAccountText(): string {
  return 'Сначала создайте счёт в разделе «Финансы» на сайте — тогда запишу трату.';
}

/** Нечего отменять: транзакция не найдена или уже удалена. */
export function undoMissingText(): string {
  return 'Нечего отменять: запись не найдена.';
}

/** Итоги дня из раздела статистики (ТЗ §3.4). */
export function todayText(day: StatsDayResponse): string {
  const mood = day.avgMood === null ? 'нет данных' : `${day.avgMood.toFixed(1)}/5`;
  return [
    `📊 Сегодня, ${day.day}`,
    '',
    `💸 Потрачено: ${money(day.spent, day.currency)}`,
    `💰 Получено: ${money(day.earned, day.currency)}`,
    `🙂 Настроение: ${mood} (чек-инов: ${day.checkins})`,
  ].join('\n');
}

/** Безопасное форматирование суммы: неизвестная валюта — как рубли. */
function money(amount: number, currency: string): string {
  return formatMoney(amount, isCurrency(currency) ? currency : 'RUB');
}
