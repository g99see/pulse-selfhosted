// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  CHALLENGE_MAX_PARTICIPANTS,
  canViewChallenge,
  challengeCheckedToday,
  challengeCurrentStreak,
  challengeDayNumber,
  challengeEndDate,
  challengeHeldDays,
  challengeLeaderboard,
  challengeProgressPercent,
  isDayInChallenge,
  toUtcDay,
  type ChallengeCheckInput,
  type ChallengeCreateInput,
  type ChallengeDto,
  type ChallengeInviteCandidateDto,
  type ChallengeInviteInput,
  type ChallengeJoinInput,
  type ChallengeKind,
  type ChallengeLeaderboardDto,
  type ChallengeParticipantDto,
  type ChallengeUpdateInput,
  type ChallengeVisibility,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { isFollowing } from '../social/is-following';

type ChallengeWithRelations = Prisma.ChallengeGetPayload<{
  include: {
    owner: { select: { id: true; nickname: true } };
    participants: { include: { user: { select: { id: true; nickname: true } } } };
  };
}>;

type CheckRow = { date: Date; ok: boolean };

/**
 * Челленджи (ТЗ §4, P2): «30 дней без доставки», «Неделя без импульсных
 * покупок» и свои испытания. Ведущий создаёт челлендж и получает код
 * приглашения; друзья вступают по коду или по приглашению из подписок.
 * Прогресс — дни выдержки и серия по ежедневным отметкам (для
 * kind = streak_checkin считается автоматически по чек-инам).
 *
 * Приватность: приватные данные участников не раскрываются — в рейтинг и
 * состав идут только никнеймы и счёт. Рейтинг и состав видят только участники
 * (видимость private|friends|public решает, кто вообще видит челлендж).
 */
@Injectable()
export class ChallengesService {
  constructor(private readonly prisma: PrismaService) {}

  /** UTC-полночь сегодня или указанного дня (колонка @db.Date). */
  private dayOnly(value?: string | null): Date | null {
    if (!value) return toUtcDay(new Date());
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return toUtcDay(parsed);
  }

  private async generateInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `CH-${randomBytes(6).toString('hex').toUpperCase()}`;
      const clash = await this.prisma.challenge.findUnique({ where: { inviteCode: code } });
      if (!clash) return code;
    }
    throw httpError(500, 'invite_code_failed', 'Не удалось создать код приглашения');
  }

  private loadChallenge(id: string): Promise<ChallengeWithRelations | null> {
    return this.prisma.challenge.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, nickname: true } },
        participants: {
          include: { user: { select: { id: true, nickname: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  private isParticipant(challenge: ChallengeWithRelations, userId: string): boolean {
    return challenge.participants.some((participant) => participant.userId === userId);
  }

  /** Челлендж, видимый зрителю; иначе 404 (не раскрываем существование). */
  private async requireVisible(userId: string, id: string): Promise<ChallengeWithRelations> {
    const challenge = await this.loadChallenge(id);
    if (!challenge) throw httpError(404, 'challenge_not_found', 'Челлендж не найден');

    const participant = this.isParticipant(challenge, userId);
    const follower = participant
      ? false
      : await isFollowing(this.prisma, userId, challenge.ownerId);
    if (!canViewChallenge(challenge.visibility as ChallengeVisibility, participant, follower)) {
      throw httpError(404, 'challenge_not_found', 'Челлендж не найден');
    }
    return challenge;
  }

  /** Участник челленджа либо 404 (состав и рейтинг — только для участников). */
  private async requireParticipant(userId: string, id: string): Promise<ChallengeWithRelations> {
    const challenge = await this.loadChallenge(id);
    if (!challenge || !this.isParticipant(challenge, userId)) {
      throw httpError(404, 'challenge_not_found', 'Челлендж не найден');
    }
    return challenge;
  }

  /** Ведущий челленджа либо 403. */
  private async requireOwner(userId: string, id: string): Promise<ChallengeWithRelations> {
    const challenge = await this.loadChallenge(id);
    if (!challenge) throw httpError(404, 'challenge_not_found', 'Челлендж не найден');
    if (challenge.ownerId !== userId) {
      throw httpError(403, 'challenge_forbidden', 'Действие доступно только ведущему');
    }
    return challenge;
  }

  private participantDto(
    participant: ChallengeWithRelations['participants'][number],
  ): ChallengeParticipantDto {
    return {
      userId: participant.userId,
      nickname: participant.user.nickname,
      joinedAt: participant.joinedAt.toISOString(),
    };
  }

  /** Модель + отметки зрителя → DTO с прогрессом, составом и статусом участия. */
  private toDto(
    challenge: ChallengeWithRelations,
    userId: string,
    viewerChecks: ReadonlyArray<CheckRow>,
    from: Date = new Date(),
  ): ChallengeDto {
    const heldDays = challengeHeldDays(challenge.startDate, challenge.durationDays, viewerChecks);
    const isParticipating = this.isParticipant(challenge, userId);
    return {
      id: challenge.id,
      title: challenge.title,
      kind: challenge.kind as ChallengeKind,
      durationDays: challenge.durationDays,
      startDate: challenge.startDate.toISOString(),
      endDate: challengeEndDate(challenge.startDate, challenge.durationDays).toISOString(),
      visibility: challenge.visibility as ChallengeVisibility,
      inviteCode: challenge.inviteCode,
      ownerId: challenge.ownerId,
      ownerNickname: challenge.owner.nickname,
      isOwner: challenge.ownerId === userId,
      isParticipating,
      participantsCount: challenge.participants.length,
      heldDays,
      currentStreak: challengeCurrentStreak(viewerChecks, from),
      percent: challengeProgressPercent(heldDays, challenge.durationDays),
      dayNumber: challengeDayNumber(challenge.startDate, challenge.durationDays, from),
      checkedToday: challengeCheckedToday(viewerChecks, from),
      participants: challenge.participants.map((participant) => this.participantDto(participant)),
      createdAt: challenge.createdAt.toISOString(),
    };
  }

  /** Отметки пользователя по конкретному челленджу. */
  private viewerChecks(challengeId: string, userId: string): Promise<CheckRow[]> {
    return this.prisma.challengeCheck.findMany({
      where: { challengeId, userId },
      select: { date: true, ok: true },
    });
  }

  /** GET /api/challenges: мои челленджи (веду и участвую) с прогрессом. */
  async list(userId: string): Promise<ChallengeDto[]> {
    const challenges = await this.prisma.challenge.findMany({
      where: { OR: [{ ownerId: userId }, { participants: { some: { userId } } }] },
      include: {
        owner: { select: { id: true, nickname: true } },
        participants: {
          include: { user: { select: { id: true, nickname: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (challenges.length === 0) return [];

    const checks = await this.prisma.challengeCheck.findMany({
      where: { userId, challengeId: { in: challenges.map((challenge) => challenge.id) } },
      select: { challengeId: true, date: true, ok: true },
    });
    const byChallenge = new Map<string, CheckRow[]>();
    for (const check of checks) {
      const list = byChallenge.get(check.challengeId) ?? [];
      list.push({ date: check.date, ok: check.ok });
      byChallenge.set(check.challengeId, list);
    }
    return challenges.map((challenge) =>
      this.toDto(challenge, userId, byChallenge.get(challenge.id) ?? []),
    );
  }

  /** GET /api/challenges/:id: челлендж с учётом видимости. */
  async get(userId: string, id: string): Promise<ChallengeDto> {
    const challenge = await this.requireVisible(userId, id);
    const checks = this.isParticipant(challenge, userId) ? await this.viewerChecks(id, userId) : [];
    return this.toDto(challenge, userId, checks);
  }

  /** POST /api/challenges: ведущий создаёт челлендж и сразу вступает сам. */
  async create(userId: string, input: ChallengeCreateInput): Promise<ChallengeDto> {
    const startDate = this.dayOnly(input.startDate);
    if (!startDate) throw httpError(400, 'invalid_start_date', 'Некорректная дата старта');

    const challenge = await this.prisma.challenge.create({
      data: {
        ownerId: userId,
        title: input.title,
        kind: input.kind,
        durationDays: input.durationDays,
        startDate,
        visibility: input.visibility,
        inviteCode: await this.generateInviteCode(),
        participants: { create: { userId } },
      },
      include: {
        owner: { select: { id: true, nickname: true } },
        participants: {
          include: { user: { select: { id: true, nickname: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    return this.toDto(challenge, userId, []);
  }

  /** PUT /api/challenges/:id: ведущий правит название и видимость. */
  async update(userId: string, id: string, input: ChallengeUpdateInput): Promise<ChallengeDto> {
    await this.requireOwner(userId, id);
    const challenge = await this.prisma.challenge.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      },
      include: {
        owner: { select: { id: true, nickname: true } },
        participants: {
          include: { user: { select: { id: true, nickname: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    return this.toDto(challenge, userId, await this.viewerChecks(id, userId));
  }

  /** DELETE /api/challenges/:id: ведущий удаляет челлендж вместе с отметками. */
  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.challenge.deleteMany({ where: { id, ownerId: userId } });
    if (result.count === 0) throw httpError(404, 'challenge_not_found', 'Челлендж не найден');
  }

  /**
   * POST /api/challenges/join: вступить по коду приглашения (идемпотентно).
   * Код — открытый, ведущий передаёт его друзьям; участия одного пользователя
   * в одном челлендже достаточно.
   */
  async join(userId: string, input: ChallengeJoinInput): Promise<ChallengeDto> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { inviteCode: input.code.trim().toUpperCase() },
    });
    if (!challenge) throw httpError(404, 'invite_not_found', 'Приглашение не найдено');

    const existing = await this.prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: challenge.id, userId } },
    });
    if (!existing) {
      const count = await this.prisma.challengeParticipant.count({
        where: { challengeId: challenge.id },
      });
      if (count >= CHALLENGE_MAX_PARTICIPANTS) {
        throw httpError(409, 'challenge_full', 'В челлендже уже максимум участников');
      }
      await this.prisma.challengeParticipant
        .create({ data: { challengeId: challenge.id, userId } })
        .catch((error: unknown) => {
          // Гонка вступлений: если параллельно уже вступили — не ошибка.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        });
    }
    return this.get(userId, challenge.id);
  }

  /**
   * POST /api/challenges/:id/check: отметка «держусь» на день (одна на день,
   * upsert). Для kind = streak_checkin серия и прогресс считаются по этим
   * отметкам автоматически. День должен попадать в окно челленджа.
   */
  async check(userId: string, id: string, input: ChallengeCheckInput): Promise<ChallengeDto> {
    const challenge = await this.requireParticipant(userId, id);
    const date = this.dayOnly(input.date);
    if (!date) throw httpError(400, 'invalid_date', 'Некорректная дата отметки');
    if (!isDayInChallenge(challenge.startDate, challenge.durationDays, date)) {
      throw httpError(400, 'date_out_of_range', 'Этот день вне окна челленджа');
    }

    await this.prisma.challengeCheck.upsert({
      where: { challengeId_userId_date: { challengeId: id, userId, date } },
      create: { challengeId: id, userId, date, ok: input.ok },
      update: { ok: input.ok },
    });
    return this.get(userId, id);
  }

  /**
   * GET /api/challenges/:id/leaderboard: рейтинг участников — только никнеймы
   * и счёт (дни выдержки). Виден только участникам челленджа.
   */
  async leaderboard(userId: string, id: string): Promise<ChallengeLeaderboardDto> {
    const challenge = await this.requireParticipant(userId, id);
    const checks = await this.prisma.challengeCheck.findMany({
      where: { challengeId: id },
      select: { userId: true, date: true, ok: true },
    });
    const byUser = new Map<string, CheckRow[]>();
    for (const check of checks) {
      const list = byUser.get(check.userId) ?? [];
      list.push({ date: check.date, ok: check.ok });
      byUser.set(check.userId, list);
    }

    const entries = challengeLeaderboard(
      challenge.participants.map((participant) => ({
        userId: participant.userId,
        nickname: participant.user.nickname,
        joinedAt: participant.joinedAt,
        checks: byUser.get(participant.userId) ?? [],
      })),
      challenge.startDate,
      challenge.durationDays,
    );
    return { challengeId: id, entries };
  }

  /** GET /api/challenges/:id/invite-candidates: подписки, которых можно позвать. */
  async inviteCandidates(userId: string, id: string): Promise<ChallengeInviteCandidateDto[]> {
    const challenge = await this.requireOwner(userId, id);
    const participantIds = new Set(challenge.participants.map((participant) => participant.userId));
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { following: { select: { id: true, nickname: true } } },
    });
    return following
      .map((row) => row.following)
      .filter((user) => !participantIds.has(user.id))
      .map((user) => ({ userId: user.id, nickname: user.nickname }));
  }

  /**
   * POST /api/challenges/:id/invite: позвать друга из подписок (ТЗ §4).
   * Ведущий может пригласить только того, на кого сам подписан; повторное
   * приглашение идемпотентно.
   */
  async invite(userId: string, id: string, input: ChallengeInviteInput): Promise<ChallengeDto> {
    const challenge = await this.requireOwner(userId, id);
    const target = await this.prisma.user.findUnique({
      where: { nickname: input.nickname },
      select: { id: true },
    });
    if (!target) throw httpError(404, 'user_not_found', 'Пользователь не найден');
    if (!(await isFollowing(this.prisma, userId, target.id))) {
      throw httpError(403, 'not_following', 'Приглашать можно только тех, на кого вы подписаны');
    }

    const existing = await this.prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: id, userId: target.id } },
    });
    if (!existing) {
      if (challenge.participants.length >= CHALLENGE_MAX_PARTICIPANTS) {
        throw httpError(409, 'challenge_full', 'В челлендже уже максимум участников');
      }
      await this.prisma.challengeParticipant
        .create({ data: { challengeId: id, userId: target.id } })
        .catch((error: unknown) => {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        });
    }
    return this.get(userId, id);
  }
}
