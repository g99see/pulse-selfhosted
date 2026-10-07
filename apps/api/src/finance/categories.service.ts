// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import {
  STANDARD_CATEGORIES,
  orderCategoryTree,
  type CategoryCreateInput,
  type CategoryDto,
  type CategoryUpdateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';

/** Порядок стандартных категорий: родители объявлены раньше детей (ТЗ v2 §8). */
const STANDARD_ORDER: ReadonlyMap<string, number> = new Map(
  STANDARD_CATEGORIES.map((category, index) => [category.id, index]),
);

/** Ключ стандартной категории → стабильный id строки (для parent_id). */
const STANDARD_ID_BY_KEY: ReadonlyMap<string, string> = new Map(
  STANDARD_CATEGORIES.map((category) => [category.key, category.id]),
);

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    kind: category.kind === 'income' ? 'income' : 'expense',
    isSystem: category.isSystem,
    key: category.key ?? null,
    parentId: category.parentId ?? null,
  };
}

/**
 * Категории (ТЗ v2 §8): дерево стандартных категорий (30 верхних + 33
 * подкатегории) плюс свои категории пользователя с созданием, переименованием,
 * иконкой, цветом, объединением и удалением. Системные категории только для чтения.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Засеивает стандартные категории идемпотентно по стабильному id: обновляет
   * название/иконку/цвет/родителя, не задевая свои категории пользователей.
   */
  async ensureSystemCategories(): Promise<void> {
    await this.prisma.$transaction(
      STANDARD_CATEGORIES.map((category) =>
        this.prisma.category.upsert({
          where: { id: category.id },
          update: {
            name: category.name,
            icon: category.icon,
            color: category.color,
            kind: category.kind,
            isSystem: true,
            key: category.key,
            parentId: category.parent ? (STANDARD_ID_BY_KEY.get(category.parent) ?? null) : null,
          },
          create: {
            id: category.id,
            name: category.name,
            icon: category.icon,
            color: category.color,
            kind: category.kind,
            isSystem: true,
            key: category.key,
            parentId: category.parent ? (STANDARD_ID_BY_KEY.get(category.parent) ?? null) : null,
          },
        }),
      ),
    );
  }

  /** Системные категории в порядке набора, свои — следом по алфавиту, дерево. */
  async list(userId: string): Promise<CategoryDto[]> {
    await this.ensureSystemCategories();

    const categories = await this.prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }] },
    });

    const own = categories.filter((category) => category.userId !== null);
    const system = categories.filter((category) => category.userId === null);
    system.sort((a, b) => (STANDARD_ORDER.get(a.id) ?? 999) - (STANDARD_ORDER.get(b.id) ?? 999));
    own.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return orderCategoryTree([...system, ...own]).map(({ depth: _depth, ...category }) =>
      toCategoryDto(category),
    );
  }

  /** Проверяет, что категория доступна пользователю (системная или своя). */
  async resolveOwned(userId: string, categoryId: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
    });
    if (!category) {
      throw httpError(404, 'category_not_found', 'Категория не найдена');
    }
    return category;
  }

  async create(userId: string, input: CategoryCreateInput): Promise<CategoryDto> {
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.resolveOwned(userId, input.parentId);
      parentId = parent.id;
    }
    const category = await this.prisma.category.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind,
        icon: input.icon,
        color: input.color,
        isSystem: false,
        parentId,
      },
    });
    return toCategoryDto(category);
  }

  async update(userId: string, id: string, input: CategoryUpdateInput): Promise<CategoryDto> {
    const existing = await this.findOwn(userId, id);

    let parentId: string | null | undefined;
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        parentId = null;
      } else {
        if (input.parentId === existing.id) {
          throw httpError(
            400,
            'category_parent_self',
            'Категория не может быть родителем самой себе',
          );
        }
        const parent = await this.resolveOwned(userId, input.parentId);
        parentId = parent.id;
      }
    }

    const category = await this.prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      },
    });
    return toCategoryDto(category);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwn(userId, id);
    // Свои подкатегории не удаляем каскадом: они станут верхним уровнем.
    await this.prisma.category.updateMany({
      where: { userId, parentId: existing.id },
      data: { parentId: null },
    });
    await this.prisma.category.delete({ where: { id: existing.id } });
  }

  /**
   * Объединяет свою категорию с целевой (ТЗ §8): операции, бюджеты, повторяющиеся
   * платежи и личные магазины переносятся на цель, исходная категория удаляется.
   * История не теряется.
   */
  async merge(userId: string, sourceId: string, targetId: string): Promise<CategoryDto> {
    const source = await this.findOwn(userId, sourceId);
    const target = await this.resolveOwned(userId, targetId);
    if (source.id === target.id) {
      throw httpError(400, 'category_merge_self', 'Нельзя объединить категорию с самой собой');
    }

    // Бюджеты уникальны по (user_id, category_id, month): коллизии убираем до переноса.
    const [sourceBudgets, targetBudgets] = await Promise.all([
      this.prisma.budget.findMany({ where: { userId, categoryId: source.id } }),
      this.prisma.budget.findMany({ where: { userId, categoryId: target.id } }),
    ]);
    const targetMonths = new Set(targetBudgets.map((budget) => budget.month));
    const colliding = sourceBudgets.filter((budget) => targetMonths.has(budget.month));

    await this.prisma.$transaction([
      this.prisma.transaction.updateMany({
        where: { userId, categoryId: source.id },
        data: { categoryId: target.id },
      }),
      this.prisma.recurringPayment.updateMany({
        where: { userId, categoryId: source.id },
        data: { categoryId: target.id },
      }),
      this.prisma.userMerchant.updateMany({
        where: { userId, categoryId: source.id },
        data: { categoryId: target.id },
      }),
      this.prisma.budget.deleteMany({
        where: { id: { in: colliding.map((budget) => budget.id) } },
      }),
      this.prisma.budget.updateMany({
        where: { userId, categoryId: source.id },
        data: { categoryId: target.id },
      }),
      this.prisma.category.updateMany({
        where: { userId, parentId: source.id },
        data: { parentId: target.id },
      }),
      this.prisma.category.delete({ where: { id: source.id } }),
    ]);

    return toCategoryDto(target);
  }

  /** Возвращает свою категорию; системную править нельзя (403), чужую не видно (404). */
  private async findOwn(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || (category.userId !== null && category.userId !== userId)) {
      throw httpError(404, 'category_not_found', 'Категория не найдена');
    }
    if (category.isSystem) {
      throw httpError(403, 'system_category', 'Системную категорию нельзя изменить');
    }
    return category;
  }

  /** id категории по стабильному ключу стандартного набора (для импорта). */
  async categoryIdByKey(key: string): Promise<string | null> {
    const category = await this.prisma.category.findFirst({
      where: { userId: null, key },
      select: { id: true },
    });
    return category?.id ?? null;
  }
}
