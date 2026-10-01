// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { SYSTEM_CATEGORIES, type CategoryCreateInput, type CategoryDto, type CategoryUpdateInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';

/** Стабильные id системных категорий — совпадают с сидом в миграции. */
const SYSTEM_IDS: Record<string, string> = {
  Еда: 'sys-food',
  Транспорт: 'sys-transport',
  Жильё: 'sys-housing',
  Развлечения: 'sys-entertainment',
  Здоровье: 'sys-health',
  Подписки: 'sys-subscriptions',
  Покупки: 'sys-shopping',
  Связь: 'sys-connectivity',
  Прочее: 'sys-other',
  Зарплата: 'sys-salary',
  'Прочий доход': 'sys-other-income',
};

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    kind: category.kind === 'income' ? 'income' : 'expense',
    isSystem: category.isSystem,
  };
}

/** Категории (ТЗ §3.2): системные + свои с иконкой и цветом. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Системные категории нужны для транзакций; создаём, если БД пуста. */
  async ensureSystemCategories(): Promise<void> {
    await this.prisma.$transaction(
      SYSTEM_CATEGORIES.map((category) =>
        this.prisma.category.upsert({
          where: { id: SYSTEM_IDS[category.name] ?? `sys-${category.name}` },
          update: {},
          create: {
            id: SYSTEM_IDS[category.name] ?? `sys-${category.name}`,
            name: category.name,
            icon: category.icon,
            color: category.color,
            kind: category.kind,
            isSystem: true,
          },
        }),
      ),
    );
  }

  async list(userId: string): Promise<CategoryDto[]> {
    await this.ensureSystemCategories();

    const categories = await this.prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });

    return categories.map(toCategoryDto);
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
    const category = await this.prisma.category.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind,
        icon: input.icon,
        color: input.color,
        isSystem: false,
      },
    });
    return toCategoryDto(category);
  }

  async update(userId: string, id: string, input: CategoryUpdateInput): Promise<CategoryDto> {
    const existing = await this.findOwn(userId, id);
    const category = await this.prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });
    return toCategoryDto(category);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwn(userId, id);
    await this.prisma.category.delete({ where: { id: existing.id } });
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
}
