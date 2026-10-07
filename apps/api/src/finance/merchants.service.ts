// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { UserMerchant } from '@prisma/client';
import {
  matchMerchant,
  matchMerchantWithPriority,
  normalizeMerchantText,
  searchMerchants,
  type MerchantEntry,
  type MerchantEntryWithSource,
  type MerchantMatchMethod,
  type UnmatchedTransactionDto,
  type UserStoreCreateInput,
  type UserStoreDto,
  type UserStoreUpdateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

interface WorldFile {
  version: number;
  updated: string;
  merchants: MerchantEntry[];
}

/** Приготовленный к сопоставлению набор: свои, общая база и карта id магазинов. */
interface MerchantIndex {
  own: MerchantEntry[];
  world: MerchantEntry[];
}

/**
 * Справочник мировых магазинов и автоопределение операций (ТЗ v2 §9).
 *
 * Общая база — файл данных `data/merchants.json`, обновляется без изменения кода.
 * Личные магазины пользователя живут в БД и имеют приоритет над общей базой.
 */
@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);
  private worldCache: MerchantEntry[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /* ----- Общая база магазинов (файл данных) ----- */

  /** Путь к файлу справочника: рядом с dist/data или apps/api/data. */
  private resolveDataFile(): string {
    const candidates = [
      process.env.MERCHANTS_FILE,
      join(__dirname, '..', 'data', 'merchants.json'),
      join(__dirname, '..', '..', 'data', 'merchants.json'),
      join(process.cwd(), 'data', 'merchants.json'),
      join(process.cwd(), 'apps', 'api', 'data', 'merchants.json'),
    ].filter((candidate): candidate is string => typeof candidate === 'string');
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error('Справочник магазинов не найден (data/merchants.json)');
  }

  /** Загружает и кеширует общую базу магазинов. */
  worldEntries(): MerchantEntry[] {
    if (this.worldCache) return this.worldCache;
    const file = this.resolveDataFile();
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as WorldFile;
    const merchants = Array.isArray(parsed.merchants) ? parsed.merchants : [];
    this.logger.log(`Справочник магазинов загружен: ${merchants.length} записей (${file})`);
    this.worldCache = merchants;
    return merchants;
  }

  /* ----- Личные магазины пользователя (БД) ----- */

  /** Личные магазины в виде записей справочника (id — стабильный id строки). */
  async ownEntries(userId: string): Promise<MerchantEntry[]> {
    const rows = await this.prisma.userMerchant.findMany({ where: { userId } });
    return rows.map((row) => this.toEntry(row));
  }

  private toEntry(row: UserMerchant): MerchantEntry {
    return {
      id: row.id,
      name: row.name,
      aliases: [row.name],
      patterns: row.pattern ? [row.pattern] : undefined,
      defaultCategory: row.categoryId,
    };
  }

  /** Карта «ключ стандартной категории → id строки» для категории по умолчанию. */
  private async keyToId(): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({
      where: { userId: null, key: { not: null } },
      select: { id: true, key: true },
    });
    return new Map(rows.flatMap((row) => (row.key ? [[row.key, row.id] as const] : [])));
  }

  /** Индекс для сопоставления: свои магазины + общая база с реальными категориями. */
  private async buildIndex(userId: string): Promise<MerchantIndex> {
    const [own, world, keys] = await Promise.all([
      this.ownEntries(userId),
      Promise.resolve(this.worldEntries()),
      this.keyToId(),
    ]);
    return {
      own,
      world: world.map((entry) => ({
        ...entry,
        defaultCategory: keys.get(entry.defaultCategory) ?? entry.defaultCategory,
      })),
    };
  }

  /**
   * Распознаёт магазин по строке выписки: своя база приоритетнее общей (ТЗ §9).
   * @returns категория, магазин и способ совпадения либо null.
   */
  async recognize(
    userId: string,
    description: string,
    index?: MerchantIndex,
  ): Promise<{
    merchantId: string;
    name: string;
    categoryId: string;
    source: 'world' | 'user';
    method: MerchantMatchMethod;
  } | null> {
    const prepared = index ?? (await this.buildIndex(userId));
    const match = matchMerchantWithPriority(description, prepared.own, prepared.world);
    if (!match) return null;
    const categoryId = match.entry.defaultCategory;
    if (!categoryId) return null;
    return {
      merchantId: match.entry.id,
      name: match.entry.name,
      categoryId,
      source: match.entry.source,
      method: match.method,
    };
  }

  /** Индекс для пакетного распознавания при импорте (одна загрузка на выгрузку). */
  async prepare(userId: string): Promise<MerchantIndex> {
    return this.buildIndex(userId);
  }

  /** Пакетное распознавание строк выписки (для импорта). */
  recognizeBatch(
    index: MerchantIndex,
    description: string,
  ): {
    merchantId: string;
    name: string;
    categoryId: string;
    source: string;
    method: string;
  } | null {
    const match = matchMerchantWithPriority(description, index.own, index.world);
    if (!match || !match.entry.defaultCategory) return null;
    return {
      merchantId: match.entry.id,
      name: match.entry.name,
      categoryId: match.entry.defaultCategory,
      source: match.entry.source,
      method: match.method,
    };
  }

  /** Поиск в общей базе (подсказки в «Добавить магазин»). */
  search(query: string, limit = 20): MerchantEntryWithSource[] {
    const world = this.worldEntries().map((entry) => ({ ...entry, source: 'world' as const }));
    return searchMerchants(query, world, limit);
  }

  /* ----- CRUD личных магазинов ----- */

  async listOwn(userId: string): Promise<UserStoreDto[]> {
    const rows = await this.prisma.userMerchant.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) =>
      this.toDto(row, row.category.name, row.category.icon, row.category.color),
    );
  }

  private toDto(
    row: UserMerchant,
    categoryName: string,
    categoryIcon: string,
    categoryColor: string,
  ): UserStoreDto {
    return {
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      categoryName,
      categoryIcon,
      categoryColor,
      pattern: row.pattern ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Создаёт личный магазин. Если `applyToSimilar`, проставляет категорию всем
   * похожим операциям без категории — прошлым (ТЗ §9); будущие распознаются
   * автоматически при следующем импорте, т.к. своя база приоритетнее.
   */
  async createOwn(
    userId: string,
    input: UserStoreCreateInput,
  ): Promise<{ store: UserStoreDto; applied: number }> {
    await this.categories.resolveOwned(userId, input.categoryId);
    const created = await this.prisma.userMerchant.create({
      data: {
        userId,
        name: input.name,
        categoryId: input.categoryId,
        pattern: input.pattern && input.pattern.trim() !== '' ? input.pattern.trim() : null,
      },
    });
    const applied = input.applyToSimilar
      ? await this.applyToSimilar(userId, this.toEntry(created), created.categoryId)
      : 0;
    const category = await this.categories.resolveOwned(userId, created.categoryId);
    return {
      store: this.toDto(created, category.name, category.icon, category.color),
      applied,
    };
  }

  async updateOwn(userId: string, id: string, input: UserStoreUpdateInput): Promise<UserStoreDto> {
    const existing = await this.findOwn(userId, id);
    if (input.categoryId !== undefined) {
      await this.categories.resolveOwned(userId, input.categoryId);
    }
    const updated = await this.prisma.userMerchant.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.pattern !== undefined
          ? { pattern: input.pattern && input.pattern.trim() !== '' ? input.pattern.trim() : null }
          : {}),
      },
    });
    const category = await this.categories.resolveOwned(userId, updated.categoryId);
    return this.toDto(updated, category.name, category.icon, category.color);
  }

  async removeOwn(userId: string, id: string): Promise<void> {
    const existing = await this.findOwn(userId, id);
    await this.prisma.userMerchant.delete({ where: { id: existing.id } });
  }

  private async findOwn(userId: string, id: string): Promise<UserMerchant> {
    const row = await this.prisma.userMerchant.findFirst({ where: { id, userId } });
    if (!row) throw httpError(404, 'store_not_found', 'Магазин не найден');
    return row;
  }

  /**
   * Применяет магазин к похожим операциям без категории (прошлым). Категорию
   * пользователя не перезаписываем — берём только операции без категории.
   */
  private async applyToSimilar(
    userId: string,
    entry: MerchantEntry,
    categoryId: string,
  ): Promise<number> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId, categoryId: null, type: { in: ['expense', 'income'] } },
      select: { id: true, comment: true },
    });
    const ids = rows
      .filter((row) => row.comment && matchMerchant(row.comment, [{ ...entry, source: 'user' }]))
      .map((row) => row.id);
    if (ids.length === 0) return 0;
    const result = await this.prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { categoryId },
    });
    return result.count;
  }

  /* ----- Очередь «Требует внимания» (ТЗ §9) ----- */

  /** Операции без категории (расход/доход) с подсказкой магазина, если есть. */
  async unmatched(userId: string, limit: number): Promise<UnmatchedTransactionDto[]> {
    const [rows, index] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, categoryId: null, type: { in: ['expense', 'income'] } },
        include: { account: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
      this.buildIndex(userId),
    ]);
    return rows.map((row) => {
      const match = this.recognizeBatch(index, row.comment ?? row.account.name);
      return {
        id: row.id,
        accountId: row.accountId,
        accountName: row.account.name,
        date: row.date.toISOString().slice(0, 10),
        amount: Number(row.amount),
        currency: row.currency,
        type: row.type === 'income' ? 'income' : 'expense',
        description: row.comment,
        suggestion: match
          ? {
              merchantId: match.merchantId,
              name: match.name,
              categoryId: match.categoryId,
              categoryKey: normalizeMerchantText(match.name),
              method: match.method as MerchantMatchMethod,
            }
          : null,
      } satisfies UnmatchedTransactionDto;
    });
  }

  /** Сколько операций без категории (для бейджа «Требует внимания»). */
  async unmatchedCount(userId: string): Promise<number> {
    return this.prisma.transaction.count({
      where: { userId, categoryId: null, type: { in: ['expense', 'income'] } },
    });
  }
}
