// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тексты ответов Telegram-бота (ТЗ §3.6, §4). Чистые функции: собирают строку
 * по данным, ничего не отправляют. Язык бота — русский, как и интерфейс по
 * умолчанию.
 */
import {
  formatMoney,
  isCurrency,
  summarizeCheckin,
  type CheckInDto,
  type DialogPrompt,
  type StatsDayResponse,
  type TransactionDto,
} from '@puls/shared';

/** Подсказка, если чат ещё не привязан к аккаунту (ТЗ §6: изоляция). */
export function linkRequiredText(): string {
  return [
    'Этот чат не привязан к аккаунту «Пульс».',
    '',
    'Откройте настройки на сайте → «Telegram» → «Подключить Telegram» и нажмите кнопку —',
    'ссылка привязки откроется сама. Вводить коды вручную не нужно.',
  ].join('\n');
}

/** Ответ на /start без токена. */
export function startHintText(): string {
  return [
    'Привет! Я бот «Пульса» — помогу вести траты и чек-ины прямо из чата.',
    '',
    'Чтобы привязать чат, нажмите «Подключить Telegram» в настройках на сайте.',
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
    '/checkin — чек-ин: настроение, энергия, стресс, сон, теги, заметка',
    '/mood 4 — быстро записать настроение',
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

/** Токен привязки не найден или недействителен. */
export function invalidTokenText(): string {
  return 'Ссылка привязки не подошла: она могла истечь или уже использоваться. Нажмите «Подключить Telegram» в настройках ещё раз.';
}

/** Токен привязки просрочен (TTL 10 минут). */
export function expiredTokenText(): string {
  return 'Ссылка привязки истекла (10 минут). Нажмите «Подключить Telegram» в настройках ещё раз.';
}

/** Токен привязки уже использован. */
export function usedTokenText(): string {
  return 'Эта ссылка привязки уже использована. Нажмите «Подключить Telegram» в настройках ещё раз.';
}

/**
 * Ссылка сброса или установки пароля (v3 §7): приходит по команде /password,
 * либо сама — пользователю без пароля, который раньше входил через Telegram.
 */
export function passwordLinkText(url: string, setup: boolean): string {
  return [
    setup
      ? 'Вход через Telegram в «Пульсе» отключён: теперь вход по логину и паролю. Задайте их по ссылке:'
      : 'Ссылка для нового пароля «Пульса»:',
    url,
    '',
    setup
      ? 'Ссылка одноразовая и действует 24 часа. Если вы её не запрашивали — проигнорируйте сообщение.'
      : 'Ссылка одноразовая и действует 30 минут. Если вы её не запрашивали — проигнорируйте сообщение.',
  ].join('\n');
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

/** Текст шага диалога: «Шаг 2/6» и вопрос. */
export function dialogPromptText(prompt: DialogPrompt): string {
  return `Шаг ${prompt.index}/${prompt.total}\n${prompt.question}`;
}

const SUMMARY_LABELS: Record<string, string> = {
  mood: '🙂 Настроение',
  energy: '⚡ Энергия',
  stress: '😬 Стресс',
  sleepHours: '😴 Сон, ч',
  water: '💧 Вода',
  steps: '👟 Шаги',
  tags: '🏷 Теги',
  note: '📝 Заметка',
};

/** Итог сохранённого чек-ина: все заполненные поля. */
export function checkinSummaryText(checkIn: CheckInDto): string {
  const lines = summarizeCheckin(checkIn).map(
    (line) => `${SUMMARY_LABELS[line.field] ?? line.field}: ${line.value}`,
  );
  return ['✅ Чек-ин сохранён', '', ...lines].join('\n');
}

export function dialogCancelledText(): string {
  return 'Чек-ин отменён. Начать заново — /checkin';
}

export function dialogExpiredText(): string {
  return 'Этот чек-ин уже закрыт или истёк. Начать заново — /checkin';
}

export function checkinLineErrorText(error: 'empty' | 'mood' | 'value', field?: string): string {
  if (error === 'value') {
    const name = field ? ` (${SUMMARY_LABELS[field] ?? field})` : '';
    return `Не получилось разобрать значение${name}. Шкалы 1–5, сон 0–24 часа.\n${checkinLineHint()}`;
  }
  return `Первым укажи настроение 1–5.\n${checkinLineHint()}`;
}

export function checkinLineHint(): string {
  return 'Пример: /checkin 4 энергия 3 стресс 2 сон 7.5 #спорт заметка';
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
    '/checkin — пошаговый чек-ин кнопками (энергия, стресс, сон, теги, заметка — по желанию)',
    '/checkin 4 энергия 3 стресс 2 сон 7.5 #спорт заметка — всё одной строкой',
    '/mood 4 — только настроение, одной командой',
    '/spent 12 кофе — записать трату (категория подберётся сама)',
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

/** Ответ на /spent: трата, категория и остаток бюджета категории (если он есть). */
export function spentSavedText(
  transaction: TransactionDto,
  budget: { limit: number; spent: number; categoryName: string } | null,
): string {
  const lines = [transactionSavedText(transaction)];
  if (!transaction.categoryName) lines.push('Категория не определена — можно поменять на сайте.');
  if (budget) {
    const left = budget.limit - budget.spent;
    lines.push(
      left >= 0
        ? `Бюджет «${budget.categoryName}»: осталось ${money(left, transaction.currency)} из ${money(budget.limit, transaction.currency)}`
        : `Бюджет «${budget.categoryName}» превышен на ${money(-left, transaction.currency)}`,
    );
  }
  return lines.join('\n');
}

/** /spent без суммы. */
export function spentUsageText(): string {
  return 'Укажите сумму и описание: /spent 12 кофе';
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
  const extra: string[] = [];
  if (day.avgEnergy !== null) extra.push(`⚡ Энергия: ${day.avgEnergy.toFixed(1)}/5`);
  if (day.avgStress !== null) extra.push(`😬 Стресс: ${day.avgStress.toFixed(1)}/5`);
  if (day.avgSleep !== null) extra.push(`😴 Сон: ${day.avgSleep.toFixed(1)} ч`);
  return [
    `📊 Сегодня, ${day.day}`,
    '',
    `💸 Потрачено: ${money(day.spent, day.currency)}`,
    `💰 Получено: ${money(day.earned, day.currency)}`,
    `🙂 Настроение: ${mood} (чек-инов: ${day.checkins})`,
    ...extra,
  ].join('\n');
}

/** Безопасное форматирование суммы: неизвестная валюта — как рубли. */
function money(amount: number, currency: string): string {
  return formatMoney(amount, isCurrency(currency) ? currency : 'RUB');
}
