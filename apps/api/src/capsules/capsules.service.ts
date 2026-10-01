// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Капсулы времени (ТЗ §4, P2): создание письма себе, чтение списка и открытие.
 * Тело письма шифруется SecretBox (ТЗ §6) и не отдаётся API, пока не наступил
 * open_at; снимок статистики за период [created_at, open_at] собирается в момент
 * открытия. Все операции — только по своему userId.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildCapsuleSnapshot,
  capsuleOpenAtError,
  capsulePresetOpenAt,
  dayKeyInTimezone,
  isCapsuleOpen,
  type CapsuleCreateInput,
  type CapsuleDetailDto,
  type CapsuleSnapshot,
  type CapsuleSummaryDto,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { SecretBoxService } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

/** Строка капсулы, как её отдаёт Prisma. */
export interface CapsuleRow {
  id: string;
  userId: string;
  title: string;
  bodyEncrypted: string;
  snapshot: unknown;
  openAt: Date;
  openedAt: Date | null;
  createdAt: Date;
}

/** Дата-колонка @db.Date: UTC-полночь дня «YYYY-MM-DD». */
function dateOnly(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

@Injectable()
export class CapsulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
  ) {}

  /** Создаёт капсулу; срок открытия — пресет или точная дата (ТЗ §4). */
  async create(
    userId: string,
    input: CapsuleCreateInput,
    now: Date = new Date(),
  ): Promise<CapsuleDetailDto> {
    const openAt = input.preset ? capsulePresetOpenAt(input.preset, now) : new Date(input.openAt!);

    if (Number.isNaN(openAt.getTime())) {
      throw httpError(400, 'invalid_open_at', 'Некорректная дата открытия');
    }
    const error = capsuleOpenAtError(openAt, now);
    if (error === 'too_soon') {
      throw httpError(400, 'capsule_too_soon', 'Капсулу нельзя открыть раньше, чем через сутки');
    }
    if (error === 'too_far') {
      throw httpError(400, 'capsule_too_far', 'Капсулу нельзя открыть позже, чем через десять лет');
    }
    if (!this.secretBox.available) {
      throw httpError(
        503,
        'capsules_unavailable',
        'Капсулы недоступны: не задан APP_ENCRYPTION_KEY',
      );
    }

    const row = await this.prisma.timeCapsule.create({
      data: {
        userId,
        title: input.title,
        bodyEncrypted: this.secretBox.encrypt(input.body),
        openAt,
      },
    });

    return this.toDetail(row as CapsuleRow, now);
  }

  /** Список капсул пользователя: только метаданные, тело не отдаётся. */
  async list(userId: string, now: Date = new Date()): Promise<CapsuleSummaryDto[]> {
    const rows = await this.prisma.timeCapsule.findMany({
      where: { userId },
      orderBy: { openAt: 'asc' },
    });
    return rows.map((row) => this.toSummary(row as CapsuleRow, now));
  }

  /** Капсула владельца: до открытия — метаданные, после — письмо и статистика. */
  async detail(userId: string, id: string, now: Date = new Date()): Promise<CapsuleDetailDto> {
    const row = await this.requireOwned(userId, id);
    return this.toDetail(row, now);
  }

  /** Удаляет капсулу владельца; чужую или отсутствующую — 404. */
  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.timeCapsule.delete({ where: { id } });
  }

  /**
   * Только для dev/e2e: делает капсулу открытой здесь и сейчас, чтобы проверить
   * чтение расшифрованного письма без ожидания. В production эндпоинт скрыт.
   */
  async openNow(userId: string, id: string, now: Date = new Date()): Promise<CapsuleDetailDto> {
    const row = await this.requireOwned(userId, id);
    const opened = await this.prisma.timeCapsule.update({
      where: { id: row.id },
      data: { openAt: now },
    });
    return this.toDetail(opened as CapsuleRow, now);
  }

  /**
   * Снимок статистики за период [created_at, open_at]: траты, доходы, среднее
   * настроение, чек-ины и состояние целей. Используется и при чтении, и
   * планировщиком при переходе через open_at.
   */
  async snapshotFor(row: CapsuleRow): Promise<CapsuleSnapshot> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: row.userId },
      select: { timezone: true },
    });
    const timezone = user.timezone;
    const fromDay = dayKeyInTimezone(row.createdAt, timezone);
    const toDay = dayKeyInTimezone(row.openAt, timezone);

    const [transactions, checkIns, goals] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          userId: row.userId,
          type: { in: ['expense', 'income'] },
          date: { gte: dateOnly(fromDay), lte: dateOnly(toDay) },
        },
        select: { type: true, amountBase: true },
      }),
      this.prisma.checkIn.findMany({
        where: { userId: row.userId, createdAt: { gte: row.createdAt, lte: row.openAt } },
        select: { mood: true },
      }),
      this.prisma.goal.findMany({
        where: { userId: row.userId },
        select: { title: true, targetAmount: true, savedAmount: true },
      }),
    ]);

    return buildCapsuleSnapshot({
      from: row.createdAt.toISOString(),
      to: row.openAt.toISOString(),
      transactions: transactions.map((transaction) => ({
        type: transaction.type as 'expense' | 'income',
        amount: Number(transaction.amountBase),
      })),
      moods: checkIns.map((checkIn) => checkIn.mood),
      goals: goals.map((goal) => ({
        title: goal.title,
        targetAmount: Number(goal.targetAmount),
        savedAmount: Number(goal.savedAmount),
      })),
    });
  }

  private async requireOwned(userId: string, id: string): Promise<CapsuleRow> {
    const row = await this.prisma.timeCapsule.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw httpError(404, 'capsule_not_found', 'Капсула не найдена');
    }
    return row as CapsuleRow;
  }

  private toSummary(row: CapsuleRow, now: Date): CapsuleSummaryDto {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      openAt: row.openAt.toISOString(),
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      open: isCapsuleOpen(row.openAt, now),
    };
  }

  private async toDetail(row: CapsuleRow, now: Date): Promise<CapsuleDetailDto> {
    const summary = this.toSummary(row, now);
    if (!summary.open) {
      // Пока капсула закрыта, тело и статистику не отдаём (ТЗ §4).
      return { ...summary, body: null, snapshot: null };
    }

    const snapshot = await this.ensureSnapshot(row);
    return { ...summary, body: this.decryptBody(row), snapshot };
  }

  private decryptBody(row: CapsuleRow): string {
    if (!this.secretBox.available) {
      throw httpError(
        503,
        'capsules_unavailable',
        'Капсулы недоступны: не задан APP_ENCRYPTION_KEY',
      );
    }
    try {
      return this.secretBox.decrypt(row.bodyEncrypted);
    } catch {
      throw httpError(500, 'capsule_corrupt', 'Не удалось прочитать письмо капсулы');
    }
  }

  /** Возвращает сохранённый снимок, а при его отсутствии собирает и сохраняет. */
  private async ensureSnapshot(row: CapsuleRow): Promise<CapsuleSnapshot> {
    if (row.snapshot !== null && row.snapshot !== undefined) {
      return row.snapshot as CapsuleSnapshot;
    }
    const snapshot = await this.snapshotFor(row);
    try {
      await this.prisma.timeCapsule.update({
        where: { id: row.id },
        data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
    } catch {
      // Снимок могли сохранить параллельно — читателю он уже собран.
    }
    return snapshot;
  }
}
