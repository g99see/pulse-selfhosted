// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Установка и сброс пароля по одноразовой ссылке (v3 §7): токен живёт 30 минут,
 * в БД только SHA-256. Ссылку присылает письмо (если у пользователя есть почта),
 * либо бот Telegram/Discord по команде /password, либо — для пользователей без
 * пароля (раньше входили только через Telegram) — бот при первом сообщении.
 */
import { Injectable } from '@nestjs/common';
import type { PasswordTokenInfo } from '@puls/shared';
import { nicknameSchema } from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './tokens';

export const PASSWORD_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Ссылка «задайте логин и пароль» для бывших Telegram-пользователей живёт сутки. */
export const PASSWORD_SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type PasswordTokenPurpose = 'reset' | 'setup';

export interface PasswordLink {
  url: string;
  expiresAt: Date;
  ttlSeconds: number;
}

@Injectable()
export class PasswordResetService {
  private readonly webAppUrl = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  /** Создаёт токен (старые неиспользованные гасятся) и возвращает ссылку. */
  async issue(userId: string, purpose: PasswordTokenPurpose): Promise<PasswordLink> {
    const token = generateToken();
    const ttlMs = purpose === 'setup' ? PASSWORD_SETUP_TOKEN_TTL_MS : PASSWORD_TOKEN_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.$transaction([
      this.prisma.passwordToken.deleteMany({ where: { userId } }),
      this.prisma.passwordToken.create({
        data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
      }),
    ]);
    return {
      url: `${this.webAppUrl}/reset-password?token=${token}`,
      expiresAt,
      ttlSeconds: Math.round(ttlMs / 1000),
    };
  }

  /**
   * Письмо со ссылкой сброса по логину или почте. Ничего не раскрывает:
   * вызывающий всегда отвечает одинаково, даже если пользователя или почты нет.
   */
  async requestByMail(login: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login }, { nickname: login }] },
    });
    if (!user || !user.email) return;
    const link = await this.issue(user.id, user.passwordHash ? 'reset' : 'setup');
    await this.mail.sendPasswordReset(user.email, link.url);
  }

  async info(token: string): Promise<PasswordTokenInfo> {
    const record = await this.find(token);
    if (!record) return { valid: false, purpose: null, nickname: null };
    return {
      valid: true,
      purpose: record.purpose === 'setup' ? 'setup' : 'reset',
      nickname: record.user.nickname,
    };
  }

  /**
   * Ставит новый пароль, гасит токен и завершает все сессии пользователя.
   * Для токена установки можно сразу задать логин (должен быть свободен).
   */
  async consume(token: string, password: string, nickname?: string): Promise<{ userId: string }> {
    const record = await this.find(token);
    if (!record) throw httpError(400, 'invalid_token', 'Ссылка недействительна или устарела');

    let newNickname: string | undefined;
    if (nickname && nickname !== record.user.nickname) {
      if (record.purpose !== 'setup') {
        throw httpError(400, 'nickname_change_not_allowed', 'Логин меняется только при установке');
      }
      const parsed = nicknameSchema.safeParse(nickname);
      if (!parsed.success) throw httpError(400, 'invalid_nickname', 'Недопустимый логин');
      const taken = await this.prisma.user.findUnique({ where: { nickname: parsed.data } });
      if (taken) throw httpError(409, 'nickname_taken', 'Этот логин уже занят');
      newNickname = parsed.data;
    }

    const passwordHash = await this.passwords.hash(password);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, ...(newNickname ? { nickname: newNickname } : {}) },
      }),
      this.prisma.passwordToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    return { userId: record.userId };
  }

  private async find(token: string) {
    const record = await this.prisma.passwordToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return record;
  }
}
