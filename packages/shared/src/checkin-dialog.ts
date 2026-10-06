// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Многошаговый чек-ин как канально-независимый конечный автомат (ТЗ v2 §4):
 * настроение → энергия → стресс → сон → теги → заметка. Логика чистая — без БД,
 * сети и форматирования под конкретный мессенджер. Канал (Telegram, Discord…)
 * лишь отрисовывает `prompt` кнопками и присылает события `action` / `text`;
 * состояние между сообщениями хранится в таблице CheckInDraft.
 *
 * Идентификаторы действий (`ci:<шаг>:<значение>`) короче 64 байт — влезают в
 * callback_data Telegram и custom_id Discord.
 */
import {
  CHECKIN_TAG_SUGGESTIONS,
  CheckInInputSchema,
  type CheckInInput,
  type CheckInSlot,
} from './checkin';
import { normalizeTag, parseMoodArg } from './checkin-parser';
import { MOOD_EMOJI, type Mood } from './mood';

export const CHECKIN_DIALOG_STEPS = ['mood', 'energy', 'stress', 'sleep', 'tags', 'note'] as const;
export type CheckInDialogStep = (typeof CHECKIN_DIALOG_STEPS)[number];

/** Сколько живёт черновик без ответов, минут. */
export const CHECKIN_DRAFT_TTL_MINUTES = 30;

/** Префикс действий диалога — по нему канал отличает свои кнопки от чужих. */
export const CHECKIN_ACTION_PREFIX = 'ci:';

/** Кнопки сна: 9 означает «9 и больше». */
export const SLEEP_BUTTON_HOURS = [4, 5, 6, 7, 8, 9] as const;

/** Накопленные ответы (JSON в CheckInDraft.data). */
export interface CheckInDraftData {
  mood?: number;
  energy?: number;
  stress?: number;
  sleepHours?: number;
  tags: string[];
  note?: string;
  slot?: CheckInSlot;
}

export interface CheckInDialogState {
  step: CheckInDialogStep;
  data: CheckInDraftData;
}

export interface DialogButton {
  label: string;
  /** Строка действия, возвращается каналом как событие `action`. */
  action: string;
}

/** Что показать пользователю: шаг, нумерованный вопрос и ряды кнопок. */
export interface DialogPrompt {
  step: CheckInDialogStep;
  /** Порядковый номер шага (1…6) и общее число — для «Шаг 2/6». */
  index: number;
  total: number;
  question: string;
  rows: DialogButton[][];
  /** Ждёт ли шаг свободный текст (сон, теги, заметка). */
  acceptsText: boolean;
}

export type DialogEvent = { type: 'action'; action: string } | { type: 'text'; text: string };

export type DialogResult =
  /** Диалог продолжается: сохранить state и показать prompt. */
  | { kind: 'prompt'; state: CheckInDialogState; prompt: DialogPrompt }
  /** Событие не распознано: состояние то же, prompt повторить. */
  | { kind: 'ignored'; state: CheckInDialogState; prompt: DialogPrompt }
  /** Все шаги пройдены: сохранить запись и удалить черновик. */
  | { kind: 'done'; input: CheckInInput }
  /** Пользователь отменил диалог. */
  | { kind: 'cancelled' };

export const CHECKIN_DIALOG_QUESTIONS: Record<CheckInDialogStep, string> = {
  mood: 'Как ты себя чувствуешь?',
  energy: 'Сколько энергии? (1 — совсем нет, 5 — полно)',
  stress: 'Уровень стресса? (1 — спокойно, 5 — на пределе)',
  sleep: 'Сколько часов ты спал(а)? Выбери кнопку или напиши число, например 7.5',
  tags: 'Что повлияло на день? Отметь теги или напиши свои, затем «Готово»',
  note: 'Заметка к дню — напиши одним сообщением или пропусти',
};

export const CHECKIN_DIALOG_LABELS = {
  skip: 'Пропустить',
  finish: 'Сохранить сейчас',
  done: 'Готово',
  cancel: 'Отмена',
  sleepMore: '9+',
} as const;

export function checkinAction(
  step: CheckInDialogStep | 'tag' | 'cancel' | 'finish',
  value: string,
): string {
  return `${CHECKIN_ACTION_PREFIX}${step}:${value}`;
}

/** Действие принадлежит диалогу чек-ина? */
export function isCheckinAction(action: string): boolean {
  return action.startsWith(CHECKIN_ACTION_PREFIX);
}

/** Начальное состояние. Если настроение известно (`/mood 4`, кнопка из напоминания), шаг mood пропускается. */
export function startCheckinDialog(options: {
  mood?: number;
  slot?: CheckInSlot;
}): CheckInDialogState {
  const data: CheckInDraftData = { tags: [] };
  if (options.slot) data.slot = options.slot;
  if (options.mood !== undefined && parseMoodArg(String(options.mood)) !== null) {
    data.mood = options.mood;
    return { step: 'energy', data };
  }
  return { step: 'mood', data };
}

const scaleRow = (step: 'mood' | 'energy' | 'stress'): DialogButton[] =>
  [1, 2, 3, 4, 5].map((value) => ({
    label: step === 'mood' ? MOOD_EMOJI[value as Mood] : String(value),
    action: checkinAction(step, String(value)),
  }));

const skipRow = (step: CheckInDialogStep): DialogButton[] => [
  { label: CHECKIN_DIALOG_LABELS.skip, action: checkinAction(step, 'skip') },
];

/** Описание шага по текущему состоянию (выбранные теги помечаются ✓). */
export function describeCheckinStep(state: CheckInDialogState): DialogPrompt {
  const step = state.step;
  const base = {
    step,
    index: CHECKIN_DIALOG_STEPS.indexOf(step) + 1,
    total: CHECKIN_DIALOG_STEPS.length,
    question: CHECKIN_DIALOG_QUESTIONS[step],
  };

  switch (step) {
    case 'mood':
      return {
        ...base,
        rows: [scaleRow('mood'), [cancelButton()]],
        acceptsText: true,
      };
    case 'energy':
    case 'stress':
      return { ...base, rows: [scaleRow(step), skipRow(step), finishRow()], acceptsText: true };
    case 'sleep':
      return {
        ...base,
        rows: [
          SLEEP_BUTTON_HOURS.map((hours) => ({
            label: hours === 9 ? CHECKIN_DIALOG_LABELS.sleepMore : String(hours),
            action: checkinAction('sleep', String(hours)),
          })),
          skipRow('sleep'),
          finishRow(),
        ],
        acceptsText: true,
      };
    case 'tags': {
      const selected = new Set(state.data.tags);
      const tagButtons = CHECKIN_TAG_SUGGESTIONS.map((tag, position) => ({
        label: `${selected.has(tag) ? '✓ ' : ''}${tag}`,
        action: checkinAction('tag', String(position)),
      }));
      return {
        ...base,
        rows: [
          tagButtons,
          [{ label: CHECKIN_DIALOG_LABELS.done, action: checkinAction('tags', 'done') }],
          finishRow(),
        ],
        acceptsText: true,
      };
    }
    case 'note':
      return { ...base, rows: [skipRow('note'), finishRow()], acceptsText: true };
  }
}

function finishRow(): DialogButton[] {
  return [{ label: CHECKIN_DIALOG_LABELS.finish, action: checkinAction('finish', '1') }];
}

function cancelButton(): DialogButton {
  return { label: CHECKIN_DIALOG_LABELS.cancel, action: checkinAction('cancel', '1') };
}

function nextStep(step: CheckInDialogStep): CheckInDialogStep | null {
  const index = CHECKIN_DIALOG_STEPS.indexOf(step);
  return CHECKIN_DIALOG_STEPS[index + 1] ?? null;
}

function advance(state: CheckInDialogState, data: CheckInDraftData): DialogResult {
  const step = nextStep(state.step);
  if (step === null) return finish(data);
  const next: CheckInDialogState = { step, data };
  return { kind: 'prompt', state: next, prompt: describeCheckinStep(next) };
}

function stay(state: CheckInDialogState, data: CheckInDraftData = state.data): DialogResult {
  const next: CheckInDialogState = { step: state.step, data };
  return { kind: 'prompt', state: next, prompt: describeCheckinStep(next) };
}

function ignored(state: CheckInDialogState): DialogResult {
  return { kind: 'ignored', state, prompt: describeCheckinStep(state) };
}

function finish(data: CheckInDraftData): DialogResult {
  const parsed = CheckInInputSchema.safeParse({
    mood: data.mood,
    energy: data.energy,
    stress: data.stress,
    sleepHours: data.sleepHours,
    tags: data.tags,
    note: data.note,
    slot: data.slot,
  });
  // Без настроения (его требует схема) вернуться на первый шаг.
  if (!parsed.success) {
    const restart: CheckInDialogState = { step: 'mood', data };
    return { kind: 'prompt', state: restart, prompt: describeCheckinStep(restart) };
  }
  return { kind: 'done', input: parsed.data };
}

function scaleValue(raw: string): number | null {
  return parseMoodArg(raw);
}

function sleepValue(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 24 ? value : null;
}

function withTag(data: CheckInDraftData, tag: string): CheckInDraftData {
  const tags = data.tags.includes(tag)
    ? data.tags.filter((item) => item !== tag)
    : [...data.tags, tag].slice(0, 20);
  return { ...data, tags };
}

/** Шаг автомата: событие применяется к состоянию. */
export function stepCheckinDialog(state: CheckInDialogState, event: DialogEvent): DialogResult {
  if (event.type === 'action') return applyAction(state, event.action);
  return applyText(state, event.text.trim());
}

function applyAction(state: CheckInDialogState, action: string): DialogResult {
  if (!isCheckinAction(action)) return ignored(state);
  const [, kind, value = ''] = action.split(':');

  if (kind === 'cancel') return { kind: 'cancelled' };
  // «Сохранить сейчас»: записать то, что успели ответить (настроение обязательно).
  if (kind === 'finish') return state.data.mood === undefined ? ignored(state) : finish(state.data);

  // Нажатия на кнопки прошлых шагов (старое сообщение) не должны ломать диалог.
  if (kind === 'tag') {
    if (state.step !== 'tags') return ignored(state);
    const tag = CHECKIN_TAG_SUGGESTIONS[Number(value)];
    return tag ? stay(state, withTag(state.data, tag)) : ignored(state);
  }
  if (kind === 'tags') {
    return state.step === 'tags' && value === 'done' ? advance(state, state.data) : ignored(state);
  }
  if (kind !== state.step) return ignored(state);

  if (value === 'skip') {
    return state.step === 'mood' ? ignored(state) : advance(state, state.data);
  }

  switch (state.step) {
    case 'mood': {
      const mood = scaleValue(value);
      return mood === null ? ignored(state) : advance(state, { ...state.data, mood });
    }
    case 'energy':
    case 'stress': {
      const level = scaleValue(value);
      return level === null
        ? ignored(state)
        : advance(state, { ...state.data, [state.step]: level });
    }
    case 'sleep': {
      const hours = sleepValue(value);
      return hours === null ? ignored(state) : advance(state, { ...state.data, sleepHours: hours });
    }
    default:
      return ignored(state);
  }
}

function applyText(state: CheckInDialogState, text: string): DialogResult {
  if (text.length === 0) return ignored(state);

  switch (state.step) {
    case 'mood':
    case 'energy':
    case 'stress': {
      const level = scaleValue(text);
      if (level === null) return ignored(state);
      const key = state.step === 'mood' ? 'mood' : state.step;
      return advance(state, { ...state.data, [key]: level });
    }
    case 'sleep': {
      const hours = sleepValue(text);
      return hours === null ? ignored(state) : advance(state, { ...state.data, sleepHours: hours });
    }
    case 'tags': {
      // «готово» / «done» завершает шаг, всё остальное — свои теги через пробел, запятую, #.
      if (/^(готово|done|ok|ок)$/i.test(text)) return advance(state, state.data);
      let data = state.data;
      for (const raw of text.split(/[\s,;]+/)) {
        const tag = normalizeTag(raw);
        if (tag.length > 0 && !data.tags.includes(tag)) data = withTag(data, tag);
      }
      return stay(state, data);
    }
    case 'note':
      return advance(state, { ...state.data, note: text.slice(0, 2000) });
  }
}

/** Есть ли что показывать в итоговом сообщении — вспомогательный список «поле: значение». */
export interface CheckInSummaryLine {
  field: 'mood' | 'energy' | 'stress' | 'sleepHours' | 'water' | 'steps' | 'tags' | 'note';
  value: string;
}

/** Заполненные поля записи в порядке показа — канал сам подписывает их на своём языке. */
export function summarizeCheckin(input: {
  mood: number;
  energy?: number | null;
  stress?: number | null;
  sleepHours?: number | null;
  water?: number | null;
  steps?: number | null;
  tags?: readonly string[];
  note?: string | null;
}): CheckInSummaryLine[] {
  const lines: CheckInSummaryLine[] = [
    { field: 'mood', value: `${MOOD_EMOJI[input.mood as Mood] ?? ''} ${input.mood}/5`.trim() },
  ];
  if (input.energy != null) lines.push({ field: 'energy', value: `${input.energy}/5` });
  if (input.stress != null) lines.push({ field: 'stress', value: `${input.stress}/5` });
  if (input.sleepHours != null) lines.push({ field: 'sleepHours', value: `${input.sleepHours}` });
  if (input.water != null) lines.push({ field: 'water', value: `${input.water}` });
  if (input.steps != null) lines.push({ field: 'steps', value: `${input.steps}` });
  if (input.tags && input.tags.length > 0) {
    lines.push({ field: 'tags', value: input.tags.map((tag) => `#${tag}`).join(' ') });
  }
  if (input.note) lines.push({ field: 'note', value: input.note });
  return lines;
}
