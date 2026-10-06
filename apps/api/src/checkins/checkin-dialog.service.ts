// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Хранение и применение многошагового чек-ина (ТЗ v2 §4). Канально-независимый
 * слой: Telegram (и позже Discord) передают сюда события «кнопка» / «текст» и
 * получают описание следующего шага. Логика переходов — чистая, в
 * @puls/shared/checkin-dialog; здесь только черновик в БД (CheckInDraft, TTL
 * 30 минут) и итоговое сохранение единой записью чек-ина.
 */
import { Injectable } from '@nestjs/common';
import {
  CHECKIN_DRAFT_TTL_MINUTES,
  parseCheckinLine,
  startCheckinDialog,
  stepCheckinDialog,
  describeCheckinStep,
  type CheckInDialogState,
  type CheckInDialogStep,
  type CheckInDraftData,
  type CheckInDto,
  type CheckInLineResult,
  type CheckInSlot,
  type DialogEvent,
  type DialogPrompt,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CheckinsService } from './checkins.service';

export type DialogOutcome =
  /** Показать prompt (шаг сохранён). */
  | { kind: 'prompt'; prompt: DialogPrompt }
  /** Событие не подошло шагу — повторить prompt. */
  | { kind: 'ignored'; prompt: DialogPrompt }
  /** Запись сохранена; черновик удалён. */
  | { kind: 'done'; checkIn: CheckInDto }
  | { kind: 'cancelled' }
  /** Активного черновика нет (истёк или не начат). */
  | { kind: 'none' };

/** Провал дня по локальному часу пользователя: утро до 12, день до 18, вечер после. */
export function slotForUserHour(now: Date, timezone: string): CheckInSlot {
  let hour = 12;
  try {
    hour =
      Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' })
          .formatToParts(now)
          .find((part) => part.type === 'hour')?.value,
      ) || 0;
  } catch {
    hour = now.getUTCHours();
  }
  if (hour < 12) return 'morning';
  if (hour < 18) return 'day';
  return 'evening';
}

@Injectable()
export class CheckinDialogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkins: CheckinsService,
  ) {}

  /** Есть ли живой (не истёкший) черновик в канале. */
  async hasActive(userId: string, channel: string): Promise<boolean> {
    const draft = await this.prisma.checkInDraft.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    return draft !== null && draft.expiresAt.getTime() > Date.now();
  }

  /** Начинает диалог заново (прежний черновик заменяется). */
  async start(
    userId: string,
    channel: string,
    options: { mood?: number } = {},
  ): Promise<DialogPrompt> {
    await this.flushExpired(userId, channel);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const state = startCheckinDialog({
      mood: options.mood,
      slot: slotForUserHour(new Date(), user?.timezone ?? 'UTC'),
    });
    await this.save(userId, channel, state);
    return describeCheckinStep(state);
  }

  /** Применяет событие к активному черновику. */
  async handle(userId: string, channel: string, event: DialogEvent): Promise<DialogOutcome> {
    const draft = await this.prisma.checkInDraft.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    if (!draft) return { kind: 'none' };
    if (draft.expiresAt.getTime() <= Date.now()) {
      await this.flushExpired(userId, channel);
      return { kind: 'none' };
    }

    const state: CheckInDialogState = {
      step: draft.step as CheckInDialogStep,
      data: normalizeData(draft.data),
    };
    const result = stepCheckinDialog(state, event);

    switch (result.kind) {
      case 'cancelled':
        await this.remove(userId, channel);
        return { kind: 'cancelled' };
      case 'done': {
        await this.remove(userId, channel);
        const checkIn = await this.checkins.create(userId, result.input);
        return { kind: 'done', checkIn };
      }
      case 'ignored':
        return { kind: 'ignored', prompt: result.prompt };
      case 'prompt':
        await this.save(userId, channel, result.state);
        return { kind: 'prompt', prompt: result.prompt };
    }
  }

  /** Быстрая форма одной строкой: `4 энергия 3 стресс 2 сон 7.5 #спорт заметка`. */
  async saveLine(
    userId: string,
    text: string,
  ): Promise<{ ok: true; checkIn: CheckInDto } | Extract<CheckInLineResult, { ok: false }>> {
    const parsed = parseCheckinLine(text);
    if (!parsed.ok) return parsed;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const checkIn = await this.checkins.create(userId, {
      ...parsed.input,
      slot: slotForUserHour(new Date(), user?.timezone ?? 'UTC'),
    });
    return { ok: true, checkIn };
  }

  /**
   * Брошенный диалог не теряет настроение: истёкший черновик с оценкой
   * сохраняется как обычный чек-ин (с тем, что успели ответить).
   */
  private async flushExpired(userId: string, channel: string): Promise<void> {
    const draft = await this.prisma.checkInDraft.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    if (!draft || draft.expiresAt.getTime() > Date.now()) return;
    await this.remove(userId, channel);

    const data = normalizeData(draft.data);
    if (data.mood === undefined) return;
    await this.checkins
      .create(userId, {
        mood: data.mood,
        energy: data.energy,
        stress: data.stress,
        sleepHours: data.sleepHours,
        water: data.water,
        steps: data.steps,
        tags: data.tags,
        note: data.note,
        slot: data.slot,
        occurredAt: draft.createdAt.toISOString(),
      })
      .catch(() => undefined);
  }

  private async save(userId: string, channel: string, state: CheckInDialogState): Promise<void> {
    const expiresAt = new Date(Date.now() + CHECKIN_DRAFT_TTL_MINUTES * 60_000);
    const data = state.data as unknown as object;
    await this.prisma.checkInDraft.upsert({
      where: { userId_channel: { userId, channel } },
      create: { userId, channel, step: state.step, data, expiresAt },
      update: { step: state.step, data, expiresAt },
    });
  }

  private async remove(userId: string, channel: string): Promise<void> {
    await this.prisma.checkInDraft.deleteMany({ where: { userId, channel } });
  }
}

function normalizeData(value: unknown): CheckInDraftData {
  const record = (
    value !== null && typeof value === 'object' ? value : {}
  ) as Partial<CheckInDraftData>;
  return { ...record, tags: Array.isArray(record.tags) ? record.tags : [] };
}
