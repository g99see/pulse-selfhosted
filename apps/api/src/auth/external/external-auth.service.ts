// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Логика входа и привязки внешних учётных записей (ТЗ §3.1, §7):
 * — вход по существующей привязке (provider, subject);
 * — привязка к существующему пользователю, только если Google подтвердил email;
 * — иначе создание пользователя с нейтральным никнеймом и passwordHash = null;
 * — Telegram без email получает технический адрес tg-<id>@telegram.invalid;
 * — отвязка запрещена, если это единственный способ входа.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type ExternalIdentity, type User } from '@prisma/client';
import type { ExternalProviderId, LinkedIdentity } from '@puls/shared';
import { httpError } from '../../common/http-error';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService, type SessionContext } from '../session.service';
import type { GoogleIdTokenClaims } from './google.tokens';
import { uniqueNickname } from './nickname';
import type { TelegramVerifiedUser } from './telegram';

export const TELEGRAM_EMAIL_DOMAIN = 'telegram.invalid';
export const GOOGLE_EMAIL_DOMAIN = 'google.invalid';

/** Технический адрес Telegram-аккаунта: реального email у провайдера нет. */
export function telegramPlaceholderEmail(subject: string): string {
  return `tg-${subject}@${TELEGRAM_EMAIL_DOMAIN}`;
}

/** Технический адрес Google-аккаунта без подтверждённого email. */
export function googlePlaceholderEmail(subject: string): string {
  return `g-${subject}@${GOOGLE_EMAIL_DOMAIN}`;
}

/** true — email технический, UI предложит указать настоящий (ТЗ §3.1). */
export function needsEmail(user: { email: string }): boolean {
  return user.email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`) || user.email.endsWith(`@${GOOGLE_EMAIL_DOMAIN}`);
}

export interface IssuedExternalSession {
  user: User;
  token: string;
  expiresAt: Date;
}

export interface IdentitiesSummary {
  email: string;
  passwordSet: boolean;
  identities: LinkedIdentity[];
}

@Injectable()
export class ExternalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async loginWithGoogle(claims: GoogleIdTokenClaims, context: SessionContext): Promise<IssuedExternalSession> {
    const user = await this.resolveGoogleUser(claims);
    return this.issueSession(user, context);
  }

  async loginWithTelegram(verified: TelegramVerifiedUser, context: SessionContext): Promise<IssuedExternalSession> {
    const user = await this.resolveTelegramUser(verified);
    return this.issueSession(user, context);
  }

  async linkGoogleIdentity(userId: string, claims: GoogleIdTokenClaims): Promise<void> {
    const verifiedEmail = verifiedGoogleEmail(claims);
    await this.attachIdentity(userId, 'google', claims.sub, verifiedEmail);

    if (verifiedEmail) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.emailVerifiedAt === null && user.email === verifiedEmail) {
        await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      }
    }
  }

  async linkTelegramIdentity(userId: string, verified: TelegramVerifiedUser): Promise<void> {
    await this.attachIdentity(userId, 'telegram', verified.subject, null);
  }

  async listIdentities(userId: string): Promise<IdentitiesSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { externalIdentities: { orderBy: { createdAt: 'asc' } } },
    });
    if (!user) throw httpError(401, 'unauthorized', 'Требуется вход');

    return {
      email: user.email,
      passwordSet: user.passwordHash !== null,
      identities: user.externalIdentities.map((identity) => toLinkedIdentity(identity)),
    };
  }

  async unlinkIdentity(userId: string, provider: ExternalProviderId): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { externalIdentities: true },
    });
    if (!user) throw httpError(401, 'unauthorized', 'Требуется вход');

    const identity = user.externalIdentities.find((item) => item.provider === provider);
    if (!identity) throw httpError(404, 'identity_not_found', 'Такой способ входа не привязан');

    // Без пароля и без других привязок отвязка лишила бы доступа к аккаунту.
    if (user.passwordHash === null && user.externalIdentities.length <= 1) {
      throw httpError(
        409,
        'last_login_method',
        'Это единственный способ входа. Сначала задайте пароль или привяжите другой сервис',
      );
    }

    await this.prisma.externalIdentity.delete({ where: { id: identity.id } });
  }

  private async resolveTelegramUser(verified: TelegramVerifiedUser): Promise<User> {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: verified.subject } },
      include: { user: true },
    });
    if (existing) return existing.user;

    const nickname = await this.generateNickname();
    const email = telegramPlaceholderEmail(verified.subject);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, nickname, passwordHash: null, locale: 'ru' },
        });
        await tx.externalIdentity.create({
          data: { userId: user.id, provider: 'telegram', subject: verified.subject, email: null },
        });
        return user;
      });
    } catch (error) {
      // Гонка двух входов с одним Telegram-аккаунтом.
      const raced = await this.findIdentity('telegram', verified.subject);
      if (raced) return raced;
      throw error;
    }
  }

  private async resolveGoogleUser(claims: GoogleIdTokenClaims): Promise<User> {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: claims.sub } },
      include: { user: true },
    });
    if (existing) {
      const email = verifiedGoogleEmail(claims);
      if (email && existing.email !== email) {
        await this.prisma.externalIdentity
          .update({ where: { id: existing.id }, data: { email } })
          .catch(() => undefined);
      }
      return existing.user;
    }

    const verifiedEmail = verifiedGoogleEmail(claims);

    // Привязка к существующему пользователю — только при подтверждённом email.
    if (verifiedEmail) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: verifiedEmail } });
      if (byEmail) {
        await this.prisma.externalIdentity.create({
          data: { userId: byEmail.id, provider: 'google', subject: claims.sub, email: verifiedEmail },
        });
        if (byEmail.emailVerifiedAt === null) {
          return this.prisma.user.update({
            where: { id: byEmail.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
        return byEmail;
      }
    }

    const email = verifiedEmail ?? googlePlaceholderEmail(claims.sub);
    const nickname = await this.generateNickname();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            nickname,
            passwordHash: null,
            emailVerifiedAt: verifiedEmail ? new Date() : null,
            locale: 'ru',
          },
        });
        await tx.externalIdentity.create({
          data: { userId: user.id, provider: 'google', subject: claims.sub, email: verifiedEmail },
        });
        return user;
      });
    } catch (error) {
      const raced = await this.findIdentity('google', claims.sub);
      if (raced) return raced;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const byEmail = await this.prisma.user.findUnique({ where: { email } });
        if (byEmail) return byEmail;
      }
      throw error;
    }
  }

  private async attachIdentity(
    userId: string,
    provider: ExternalProviderId,
    subject: string,
    email: string | null,
  ): Promise<void> {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
    });
    if (existing) {
      if (existing.userId === userId) return;
      throw httpError(409, 'identity_taken', 'Эта учётная запись уже привязана к другому пользователю');
    }

    const own = await this.prisma.externalIdentity.findFirst({ where: { userId, provider } });
    if (own) {
      throw httpError(409, 'provider_already_linked', 'Этот сервис уже привязан к вашему аккаунту');
    }

    await this.prisma.externalIdentity.create({ data: { userId, provider, subject, email } });
  }

  private async findIdentity(provider: ExternalProviderId, subject: string): Promise<User | null> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      include: { user: true },
    });
    return identity?.user ?? null;
  }

  private async generateNickname(): Promise<string> {
    return uniqueNickname(
      async (candidate) => (await this.prisma.user.findUnique({ where: { nickname: candidate } })) !== null,
    );
  }

  private async issueSession(user: User, context: SessionContext): Promise<IssuedExternalSession> {
    const { token, session } = await this.sessions.create(user.id, context);
    return { user, token, expiresAt: session.expiresAt };
  }
}

/** Email подтверждён Google — только тогда по нему можно привязывать аккаунт. */
export function verifiedGoogleEmail(claims: GoogleIdTokenClaims): string | null {
  if (claims.email_verified !== true) return null;
  if (typeof claims.email !== 'string' || claims.email.length === 0) return null;
  return claims.email.trim().toLowerCase();
}

function toLinkedIdentity(identity: ExternalIdentity): LinkedIdentity {
  return {
    provider: identity.provider as ExternalProviderId,
    email: identity.email,
    createdAt: identity.createdAt.toISOString(),
  };
}
