// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Resvg } from '@resvg/resvg-js';
import {
  SHARE_CARD_SIZES,
  isShareAchievementCode,
  renderShareCard,
  todayKeyInTimezone,
  type ShareCardData,
  type ShareCardFormat,
  type ShareCardQuery,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { GoalsService } from '../goals/goals.service';
import { AchievementsService } from '../achievements/achievements.service';
import { StatsService } from '../stats/stats.service';

export interface BuiltShareCard {
  data: ShareCardData;
  format: ShareCardFormat;
  svg: string;
}

/**
 * Карточка «Поделиться результатом» (ТЗ §3.7, сценарий 2): собирает данные из
 * существующих сервисов (цели, достижения/стрики, статистика) и рендерит SVG.
 * Суммы по умолчанию скрыты — показываются проценты. PNG растеризуется
 * @resvg/resvg-js (MPL-2.0, совместима с AGPL).
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
    private readonly achievements: AchievementsService,
    private readonly stats: StatsService,
  ) {}

  /** Собирает карточку по типу из данных текущего пользователя. */
  async buildCard(userId: string, query: ShareCardQuery): Promise<BuiltShareCard> {
    const data = await this.buildData(userId, query);
    const svg = renderShareCard(data, {
      locale: query.locale,
      format: query.format,
      showAmounts: query.amounts === 1,
    });
    return { data, format: query.format, svg };
  }

  /** Растеризует SVG в PNG (ТЗ §3.7: файл для Instagram/Telegram). */
  toPng(svg: string, format: ShareCardFormat): Buffer {
    const { width } = SHARE_CARD_SIZES[format];
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { loadSystemFonts: true },
    });
    return resvg.render().asPng();
  }

  private async buildData(userId: string, query: ShareCardQuery): Promise<ShareCardData> {
    switch (query.type) {
      case 'goal_progress':
        return this.goalData(userId, query.id);
      case 'checkin_streak':
        return this.streakData(userId);
      case 'achievement':
        return this.achievementData(userId, query.id);
      case 'avg_mood':
        return this.moodData(userId);
    }
  }

  private async goalData(userId: string, id?: string): Promise<ShareCardData> {
    if (!id) {
      throw httpError(400, 'missing_id', 'Укажите цель');
    }
    // Чужая цель не видна: GoalsService.resolveOwned отдаёт 404.
    const goal = await this.goals.get(userId, id);
    return {
      type: 'goal_progress',
      title: goal.title,
      percent: goal.percent,
      savedAmount: goal.savedAmount,
      targetAmount: goal.targetAmount,
      currency: goal.currency,
    };
  }

  private async streakData(userId: string): Promise<ShareCardData> {
    const streak = await this.achievements.streak(userId);
    return {
      type: 'checkin_streak',
      current: streak.current,
      longest: streak.longest,
      checkedToday: streak.checkedToday,
    };
  }

  private async achievementData(userId: string, id?: string): Promise<ShareCardData> {
    if (!id) {
      throw httpError(400, 'missing_id', 'Укажите достижение');
    }
    if (!isShareAchievementCode(id)) {
      throw httpError(404, 'achievement_not_found', 'Достижение не найдено');
    }
    const earned = await this.prisma.userAchievement.findFirst({
      where: { userId, code: id },
      select: { earnedAt: true },
    });
    if (!earned) {
      throw httpError(404, 'achievement_not_found', 'Достижение не найдено');
    }
    return {
      type: 'achievement',
      code: id,
      earnedAt: earned.earnedAt.toISOString(),
    };
  }

  private async moodData(userId: string): Promise<ShareCardData> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const month = todayKeyInTimezone(user.timezone).slice(0, 7);
    const calendar = await this.stats.moodCalendar(userId, month);
    const checkins = calendar.days.filter((day) => day.mood !== null).length;
    return { type: 'avg_mood', average: calendar.average, checkins, month };
  }
}
