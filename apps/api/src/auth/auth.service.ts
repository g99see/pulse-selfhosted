// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma, type Account, type User } from '@prisma/client';
import type {
  LoginInput,
  OnboardingInput,
  PublicUser,
  RegisterInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { INSTANCE_SETTINGS_ID } from '../common/instance';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_VERIFY_TTL_HOURS } from './cookies';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { SessionService, type SessionContext } from './session.service';
import { generateToken, hashToken } from './tokens';
import { TwoFactorService } from './two-factor.service';

/** Пользователь в ответах API — контракт общий с web (см. @puls/shared). */
export type { PublicUser };

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    timezone: user.timezone,
    currency: user.currency,
    locale: user.locale,
    goals: user.goals,
    notificationsEnabled: user.notificationsEnabled,
    quietHours: { start: user.quietHoursStart, end: user.quietHoursEnd },
    profileVisibility: user.profileVisibility,
    emailVerified: user.emailVerifiedAt !== null,
    onboardingStep: user.onboardingStep,
    onboardingCompleted: user.onboardingCompletedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

interface IssuedSession {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

/** Результат входа: либо сессия, либо необходимость второго фактора (ТЗ §6). */
export type LoginOutcome =
  | IssuedSession
  | { twoFactorRequired: true; challengeToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async register(input: RegisterInput): Promise<{ user: PublicUser; verificationSent: true }> {
    await this.assertRegistrationOpen();

    const [byEmail, byNickname] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: input.email } }),
      this.prisma.user.findUnique({ where: { nickname: input.nickname } }),
    ]);
    if (byEmail) throw httpError(409, 'email_taken', 'Этот email уже зарегистрирован');
    if (byNickname) throw httpError(409, 'nickname_taken', 'Этот никнейм уже занят');

    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          nickname: input.nickname,
          passwordHash,
          locale: input.locale,
        },
      });
    } catch (error) {
      // Гонка двух регистраций с одним email/никнеймом.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta?.target as string[] | undefined)?.join(',') ?? '');
        if (target.includes('nickname')) {
          throw httpError(409, 'nickname_taken', 'Этот никнейм уже занят');
        }
        throw httpError(409, 'email_taken', 'Этот email уже зарегистрирован');
      }
      throw error;
    }

    await this.issueVerificationToken(user);
    return { user: toPublicUser(user), verificationSent: true };
  }

  async login(input: LoginInput, context: SessionContext): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Не раскрываем, существует ли адрес: и на пустом месте считаем хеш.
    const passwordHash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await this.passwords.verify(passwordHash, input.password);

    if (!user || !user.passwordHash || !passwordOk) {
      throw httpError(401, 'invalid_credentials', 'Неверный email или пароль');
    }
    if (user.emailVerifiedAt === null) {
      throw httpError(403, 'email_not_verified', 'Подтвердите email — мы отправили ссылку письмом');
    }

    // Пароль верен, но включена 2FA: выдаём пропуск, сессию пока не создаём.
    if (this.twoFactor.requiresTwoFactor(user)) {
      const challengeToken = await this.twoFactor.createChallenge(user.id);
      return { twoFactorRequired: true, challengeToken };
    }

    const { token, session } = await this.sessions.create(user.id, context);
    return { user: toPublicUser(user), token, expiresAt: session.expiresAt };
  }

  /** Второй шаг входа: код TOTP или резервный код по пропуску (ТЗ §6). */
  async loginWithTwoFactor(
    challengeToken: string,
    code: string,
    context: SessionContext,
  ): Promise<IssuedSession> {
    const user = await this.twoFactor.consumeChallenge(challengeToken, code);
    const { token, session } = await this.sessions.create(user.id, context);
    return { user: toPublicUser(user), token, expiresAt: session.expiresAt };
  }

  async verifyEmail(token: string, context: SessionContext): Promise<IssuedSession> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw httpError(400, 'invalid_token', 'Ссылка недействительна или устарела');
    }

    const now = new Date();
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: record.user.emailVerifiedAt ?? now },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
    ]);

    const { token: sessionToken, session } = await this.sessions.create(user.id, context);
    return { user: toPublicUser(user), token: sessionToken, expiresAt: session.expiresAt };
  }

  /** Отправляет письмо повторно. Ответ всегда одинаковый — против перебора адресов. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.emailVerifiedAt === null) {
      await this.issueVerificationToken(user);
    }
  }

  /**
   * Режим регистрации инстанса (ТЗ §9 п.7). По умолчанию open; invite и closed
   * отклоняют самостоятельную регистрацию. Механизма приглашений пока нет,
   * поэтому invite ведёт себя как закрытый режим с отдельным кодом ошибки.
   */
  private async assertRegistrationOpen(): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    const mode = settings?.registrationMode ?? 'open';

    if (mode === 'closed') {
      throw httpError(403, 'registration_closed', 'Регистрация на этом сервере закрыта');
    }
    if (mode === 'invite') {
      throw httpError(
        403,
        'registration_invite_required',
        'Регистрация — только по приглашению администратора',
      );
    }
  }

  private async issueVerificationToken(user: User): Promise<void> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
      }),
    ]);

    await this.mail.sendEmailVerification(user.email, token);
  }

  async completeOnboarding(
    userId: string,
    input: OnboardingInput,
  ): Promise<{ user: PublicUser; accounts: Account[] }> {
    const accounts = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.account.count({ where: { userId } });

      if (input.firstAccount && existing === 0) {
        await tx.account.create({
          data: {
            userId,
            name: input.firstAccount.name,
            type: input.firstAccount.type,
            balance: new Prisma.Decimal(input.firstAccount.balance),
            currency: input.currency,
          },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          timezone: input.timezone,
          currency: input.currency,
          locale: input.locale,
          goals: input.goals,
          notificationsEnabled: input.notificationsEnabled,
          quietHoursStart: input.quietHoursStart,
          quietHoursEnd: input.quietHoursEnd,
          profileVisibility: input.profileVisibility,
          onboardingStep: 4,
          onboardingCompletedAt: new Date(),
        },
      });

      return tx.account.findMany({ where: { userId } });
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { user: toPublicUser(user), accounts };
  }
}
