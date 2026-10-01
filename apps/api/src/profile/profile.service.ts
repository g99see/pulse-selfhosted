// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { Profile as ProfileRow, ProfileCard as ProfileCardRow } from '@prisma/client';
import {
  canViewProfile,
  filterVisibleCards,
  goalProgress,
  resolveCardMode,
  sanitizeCardHtml,
  type OwnProfileDto,
  type ProfileCardData,
  type ProfileCardDto,
  type ProfileCardType,
  type ProfileUpdateInput,
  type ProfileVisibility,
  type PublicProfileDto,
} from '@puls/shared';
import { GoalsService } from '../goals/goals.service';
import { AchievementsService } from '../achievements/achievements.service';
import { StatsService } from '../stats/stats.service';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { isSubscriber } from './subscriptions';

/** Порядок карточек по умолчанию (ТЗ §3.7). */
const DEFAULT_CARD_ORDER: readonly ProfileCardType[] = [
  'savings',
  'checkin_streak',
  'avg_mood',
  'achievements',
  'goals',
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Карточка профиля → DTO с разрешённым режимом показа. */
function toCardDto(card: ProfileCardRow, data: ProfileCardData): ProfileCardDto {
  return {
    type: card.type as ProfileCardType,
    visibility: card.visibility as ProfileVisibility,
    mode: resolveCardMode(card.type as ProfileCardType, card.mode as 'percent' | 'amount'),
    title: card.title,
    data,
  };
}

/**
 * Публичный профиль (ТЗ §3.7): свой профиль под редактором и публичный
 * просмотр по никнейму с фильтрацией карточек по приватности и подписке.
 * Данные карточек берутся из существующих сервисов (цели, достижения,
 * статистика) — здесь только сборка DTO.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
    private readonly achievements: AchievementsService,
    private readonly stats: StatsService,
  ) {}

  /** Свой профиль; при первом обращении создаёт строку и карточки по умолчанию. */
  async getOwn(userId: string): Promise<OwnProfileDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const profile = await this.ensureProfile(userId);
    await this.ensureDefaultCards(userId);

    const rows = await this.prisma.profileCard.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { type: 'asc' }],
    });

    const cards = await this.buildCards(userId, rows);
    return {
      nickname: user.nickname,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      profileVisibility: user.profileVisibility as ProfileVisibility,
      cards,
    };
  }

  /** PUT /api/profile: описание профиля и полный набор карточек. */
  async update(userId: string, input: ProfileUpdateInput): Promise<OwnProfileDto> {
    await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        bio: input.bio ?? null,
        avatarUrl: input.avatarUrl ?? null,
        coverUrl: input.coverUrl ?? null,
      },
      update: {
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
      },
    });

    if (input.cards !== undefined) {
      await this.replaceCards(userId, input.cards);
    }

    return this.getOwn(userId);
  }

  /**
   * Публичный профиль по никнейму. Виден, только если профиль пользователя
   * публичный либо смотрящий — владелец/подписчик. Карточки фильтруются:
   * private не отдаётся никому, subscribers — только подписчику и владельцу.
   */
  async getPublic(nickname: string, viewerId?: string | null): Promise<PublicProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { nickname } });
    if (!user) {
      throw httpError(404, 'profile_not_found', 'Профиль не найден');
    }

    const isOwner = viewerId === user.id;
    const subscriber = await isSubscriber(this.prisma, viewerId, user.id);
    const profileVisibility = user.profileVisibility as ProfileVisibility;

    if (!canViewProfile(profileVisibility, { isOwner, isSubscriber: subscriber })) {
      // Не раскрываем существование закрытого профиля.
      throw httpError(404, 'profile_not_found', 'Профиль не найден');
    }

    const profile = await this.prisma.profile.findUnique({ where: { userId: user.id } });
    const rows = await this.prisma.profileCard.findMany({
      where: { userId: user.id },
      orderBy: [{ position: 'asc' }, { type: 'asc' }],
    });

    const visible = filterVisibleCards(
      rows as Array<ProfileCardRow & { visibility: ProfileVisibility }>,
      { isOwner, isSubscriber: subscriber },
    );
    const cards = await this.buildCards(user.id, visible);

    return {
      nickname: user.nickname,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      coverUrl: profile?.coverUrl ?? null,
      cards,
    };
  }

  /** Строит данные для набора карточек, переиспользуя сервисы домена. */
  private async buildCards(userId: string, rows: readonly ProfileCardRow[]): Promise<ProfileCardDto[]> {
    if (rows.length === 0) return [];

    const [goals, streak, achievements, report] = await Promise.all([
      this.goals.list(userId),
      this.achievements.streak(userId),
      this.achievements.list(userId),
      this.stats.report(userId, 'month'),
    ]);

    return rows.map((card) => {
      const type = card.type as ProfileCardType;
      const mode = resolveCardMode(type, card.mode as 'percent' | 'amount');
      let data: ProfileCardData;

      switch (type) {
        case 'savings': {
          const target = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
          const saved = goals.reduce((sum, goal) => sum + goal.savedAmount, 0);
          data = {
            kind: 'savings',
            percent: goalProgress(saved, target),
            amount: mode === 'amount' ? round2(saved) : null,
            currency: goals[0]?.currency ?? 'RUB',
          };
          break;
        }
        case 'checkin_streak':
          data = { kind: 'checkin_streak', current: streak.current, longest: streak.longest };
          break;
        case 'avg_mood':
          data = { kind: 'avg_mood', average: report.avgMood };
          break;
        case 'achievements':
          data = {
            kind: 'achievements',
            earned: achievements.achievements.filter((item) => item.earned).length,
            total: achievements.achievements.length,
          };
          break;
        case 'goals':
          data = {
            kind: 'goals',
            goals: goals.map((goal) => ({
              id: goal.id,
              title: goal.title,
              percent: goal.percent,
              amount: mode === 'amount' ? goal.savedAmount : null,
            })),
          };
          break;
        case 'html_page':
        default:
          data = { kind: 'html_page', html: sanitizeCardHtml(card.html ?? '') };
          break;
      }

      return toCardDto(card, data);
    });
  }

  /** Полная замена набора карточек: чужие типы удаляются, position — по порядку. */
  private async replaceCards(
    userId: string,
    cards: ProfileUpdateInput['cards'],
  ): Promise<void> {
    const list = cards ?? [];
    const types = list.map((card) => card.type);

    await this.prisma.profileCard.deleteMany({
      where: { userId, type: { notIn: types } },
    });

    for (const [index, card] of list.entries()) {
      const mode = resolveCardMode(card.type, card.mode);
      const html = card.type === 'html_page' ? sanitizeCardHtml(card.html ?? '') : null;
      await this.prisma.profileCard.upsert({
        where: { userId_type: { userId, type: card.type } },
        create: {
          userId,
          type: card.type,
          visibility: card.visibility,
          mode,
          title: card.title ?? null,
          html,
          position: index,
        },
        update: {
          visibility: card.visibility,
          mode,
          title: card.title ?? null,
          html,
          position: index,
        },
      });
    }
  }

  /** Гарантирует строку профиля (пустую), чтобы её можно было редактировать. */
  private async ensureProfile(userId: string): Promise<ProfileRow> {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /** Карточки по умолчанию: скрытые, с процентами (приватность превыше всего). */
  private async ensureDefaultCards(userId: string): Promise<void> {
    const existing = await this.prisma.profileCard.count({ where: { userId } });
    if (existing > 0) return;

    await this.prisma.profileCard.createMany({
      data: DEFAULT_CARD_ORDER.map((type, index) => ({
        userId,
        type,
        visibility: 'private',
        mode: 'percent',
        position: index,
      })),
      skipDuplicates: true,
    });
  }
}
